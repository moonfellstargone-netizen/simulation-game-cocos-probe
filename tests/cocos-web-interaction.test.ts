import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProbeLifetime, type ProbeCommand, type ProbeCommandResult, type ProbeMenuSnapshot } from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import { ProbeInteraction, type ProbeInteractionView } from '../apps/cocos-probe/template/assets/scripts/ProbeInteraction';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot } from '../src/game-core';

const ADVANCE = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } } as const;
const SAVE = { name: 'save', selection: { slot_id: 'web_probe' } } as const;
const LOAD = { name: 'load', selection: { slot_id: 'web_probe' } } as const;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

async function readyProbe(intercept?: (
  command: ProbeCommand, execute: () => Promise<ProbeCommandResult>
) => Promise<ProbeCommandResult>) {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const publications: ProbeInteractionView[] = [];
  const errors: unknown[] = [];
  let calls = 0;
  let available = true;
  let host: CocosSessionHost | null = null;
  const lifetime = new ProbeLifetime({
    loadResources: async () => ({
      snapshot, buildId: 'cocos_web_interaction_contract',
      schemas: Object.fromEntries(snapshot.schema_paths.map((path) => [path,
        JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))]))
    }),
    createHost: (input) => {
      host = createStage1AHost({
        ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
        storage: new InMemorySaveStoragePort(), nowIso8601: '2026-10-31T00:00:00.000Z'
      });
      return host;
    },
    createBinding: (host) => new QinglanUiSceneProbeComponent(host as CocosSessionHost, {
      applyNodeBindingPatch: () => {}
    }),
    onError: (error) => errors.push(error)
  });
  const interaction = new ProbeInteraction({
    isAvailable: () => available && !lifetime.isDisposed() && lifetime.status().phase === 'ready',
    execute: (command) => {
      calls++;
      const execute = () => lifetime.execute(command);
      return intercept ? intercept(command, execute) : execute();
    },
    onChange: (state) => publications.push(state)
  });
  await lifetime.start();
  return {
    lifetime, interaction, publications, errors, calls: () => calls,
    setAvailable: (value: boolean) => { available = value; },
    session: () => host!.requireSession()
  };
}

test('empty slot reports this operation failure, then one accepted advance recovers without startup failure', async (t) => {
  const p = await readyProbe();
  t.after(() => p.lifetime.dispose());
  const load = await p.interaction.execute(LOAD);
  assert.equal(load?.command_result.status, 'failed');
  assert.deepEqual(p.interaction.status(), {
    busy: false,
    operation: {
      sequence: 1, name: 'load', status: 'failed', message: '暂无本地存档，请先保存',
      errorMessage: 'ERR_SAVE_SLOT_NOT_FOUND:web_probe', slotId: 'web_probe', worldMinute: null
    }
  });
  assert.equal(p.lifetime.status().phase, 'ready');
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 360');
  const advance = await p.interaction.execute(ADVANCE);
  assert.equal(advance?.command_result.status, 'completed');
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 420');
  assert.deepEqual(p.interaction.status().operation, {
    sequence: 2, name: 'menu_confirm', status: 'completed', message: '已推进一小时',
    errorMessage: null, slotId: null, worldMinute: null
  });
  assert.equal(p.calls(), 2);
  assert.deepEqual(p.errors, []);
});

test('save and load feedback reads the current public result and the fixed slot restores the saved time', async (t) => {
  const p = await readyProbe();
  t.after(() => p.lifetime.dispose());
  assert.equal((await p.interaction.execute(SAVE))?.command_result.status, 'completed');
  assert.deepEqual(p.interaction.status().operation, {
    sequence: 1, name: 'save', status: 'completed', message: '本地保存成功',
    errorMessage: null, slotId: 'web_probe', worldMinute: 360
  });
  await p.interaction.execute(ADVANCE);
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 420');
  assert.equal((await p.interaction.execute(LOAD))?.command_result.status, 'completed');
  assert.deepEqual(p.interaction.status().operation, {
    sequence: 3, name: 'load', status: 'completed', message: '已恢复本地存档',
    errorMessage: null, slotId: 'web_probe', worldMinute: 360
  });
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 360');
  assert.equal(p.calls(), 3);
  assert.deepEqual(p.errors, []);
});

test('busy input is refused before the component queue and one admitted command publishes exactly one completion', async (t) => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  const p = await readyProbe(async (_command, execute) => {
    entered.resolve();
    await gate.promise;
    return execute();
  });
  t.after(async () => { gate.resolve(); await p.lifetime.dispose(); });
  const first = p.interaction.execute(SAVE);
  await entered.promise;
  assert.equal(p.interaction.status().busy, true);
  assert.equal(p.interaction.status().operation.sequence, 1);
  assert.equal(p.interaction.status().operation.status, 'running');
  assert.equal(await p.interaction.execute(SAVE), null);
  assert.equal(await p.interaction.execute(ADVANCE), null);
  assert.equal(await p.interaction.execute(LOAD), null);
  assert.equal(p.calls(), 1);
  gate.resolve();
  await first;
  assert.deepEqual(p.publications.map((state) => [state.busy, state.operation.sequence, state.operation.status]), [
    [true, 1, 'running'], [false, 1, 'completed']
  ]);
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 360');
});

test('unavailable input neither executes nor increments sequence, and status is a detached observation', async (t) => {
  const p = await readyProbe();
  t.after(() => p.lifetime.dispose());
  p.setAvailable(false);
  assert.equal(await p.interaction.execute(SAVE), null);
  assert.equal(p.calls(), 0);
  assert.equal(p.interaction.status().operation.sequence, 0);
  assert.deepEqual(p.publications, []);
  const detached = p.interaction.status();
  Reflect.set(detached.operation, 'sequence', 100);
  assert.equal(p.interaction.status().operation.sequence, 0);
  p.setAvailable(true);
  await p.interaction.execute(ADVANCE);
  await p.lifetime.dispose();
  assert.equal(await p.interaction.execute(LOAD), null);
  assert.equal(p.calls(), 1);
  assert.equal(p.interaction.status().operation.sequence, 1);
});

test('unexpected execution rejection remains rejected and a later command can recover without changing startup phase', async (t) => {
  const original = new Error('unexpected-command-error');
  let reject = true;
  const p = await readyProbe(async (_command, execute) => {
    if (reject) throw original;
    return execute();
  });
  t.after(() => p.lifetime.dispose());
  await assert.rejects(p.interaction.execute(ADVANCE), (error) => error === original);
  assert.equal(p.interaction.status().busy, false);
  assert.equal(p.interaction.status().operation.status, 'failed');
  assert.equal(p.interaction.status().operation.errorMessage, original.message);
  assert.equal(p.lifetime.status().phase, 'ready');
  reject = false;
  assert.equal((await p.interaction.execute(ADVANCE))?.command_result.status, 'completed');
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 420');
  assert.equal(p.interaction.status().operation.sequence, 2);
  assert.equal(p.interaction.status().operation.errorMessage, null);
});

test('completion arriving after disposal cannot publish to the former view or accept another command', async () => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  const p = await readyProbe(async (_command, execute) => {
    const result = await execute();
    entered.resolve();
    await gate.promise;
    return result;
  });
  const pending = p.interaction.execute(SAVE);
  await entered.promise;
  assert.equal(p.publications.length, 1);
  await p.lifetime.dispose();
  gate.resolve();
  await pending;
  assert.equal(p.publications.length, 1, 'late completion has no view callback after closing');
  assert.equal(p.lifetime.status().phase, 'closed');
  assert.equal(p.lifetime.status().hasSession, false);
  assert.equal(await p.interaction.execute(ADVANCE), null);
  assert.equal(p.calls(), 1);
});

test('an incomplete success observation is not presented as a successful save', async (t) => {
  const p = await readyProbe(async () => ({ command_result: { status: 'completed' } }));
  t.after(() => p.lifetime.dispose());
  await assert.rejects(p.interaction.execute(SAVE), /ERR_COCOS_PROBE_SAVE_LOAD_SUMMARY_MISSING/);
  assert.equal(p.interaction.status().operation.status, 'failed');
  assert.equal(p.interaction.status().operation.worldMinute, null);
  assert.equal(p.interaction.status().busy, false);
});

test('a completed queue command with a real rejected preview is not shown as a successful action', async (t) => {
  const p = await readyProbe();
  t.after(() => p.lifetime.dispose());
  const before = p.session().getSelectableViewModel();
  const field = before.field_options.find((option) => option.enabled)!;
  const seed = before.seed_lot_options.find((option) => option.enabled)!;
  const result = await p.interaction.execute({ name: 'menu_confirm', selection: {
    action_type: 'plant_crop', field_option_id: field.id, seed_lot_option_id: seed.id,
    seed_quantity: { amount: seed.quantity.amount + 1, unit: seed.quantity.unit }
  } } as ProbeCommand);
  assert.equal(result?.command_result.status, 'completed', 'the queue contract remains unchanged');
  assert.equal(p.interaction.status().operation.status, 'failed');
  assert.equal(p.interaction.status().operation.errorMessage, 'ERR_NOT_ENOUGH_RESOURCE');
  assert.equal(p.interaction.status().operation.message, '资源不足，请调整数量');
  assert.deepEqual(p.session().getSelectableViewModel(), before, 'a preview refusal changes no public farming state');
  await p.interaction.execute(ADVANCE);
  assert.equal(p.interaction.status().operation.status, 'completed');
  assert.equal(p.lifetime.status().timeLabel, 'day 1 minute 420');
});

test('missing or mismatched public action outcomes fail closed and a later valid result recovers', async () => {
  const business = { success: true, status_code: 'OK', message_key: 'action.ok', message_params: [] };
  const valid: ProbeMenuSnapshot = {
    last_preview_result: { ...business, action_type: 'advance_time' },
    last_action_result: { ...business, request_id: 'observed_request', created_objects: [] }
  };
  const malformed: ProbeCommandResult[] = [
    { command_result: { status: 'completed' } },
    { command_result: { status: 'completed', snapshot: { menu: { ...valid, last_preview_result: null } } } },
    { command_result: { status: 'completed', snapshot: { menu: {
      ...valid, last_preview_result: { ...business, action_type: 'harvest_crop' }
    } } } },
    { command_result: { status: 'completed', snapshot: { menu: { ...valid, last_action_result: null } } } },
    { command_result: { status: 'completed', snapshot: { menu: {
      ...valid, last_action_result: { ...business, request_id: '', created_objects: [] }
    } } } },
    { command_result: { status: 'completed', command_name: 'load', snapshot: { menu: valid } } }
  ];
  for (const observation of malformed) {
    let reply = observation;
    const interaction = new ProbeInteraction({ isAvailable: () => true,
      execute: async () => reply, onChange: () => {} });
    await assert.rejects(interaction.execute(ADVANCE), /ERR_COCOS_PROBE_(ACTION_SUMMARY_MISSING_OR_MISMATCHED|COMMAND_RESULT_MISMATCH)/);
    assert.equal(interaction.status().operation.status, 'failed');
    assert.equal(interaction.status().busy, false);
    reply = { command_result: { status: 'completed', command_name: 'menu_confirm', snapshot: { menu: valid } } };
    await interaction.execute(ADVANCE);
    assert.equal(interaction.status().operation.status, 'completed');
    assert.equal(interaction.status().operation.message, '已推进一小时');
    assert.equal(interaction.status().operation.sequence, 2);
  }
});

test('an observed action failure is distinct from preview success and cannot replace load-specific feedback', async () => {
  const business = { success: true, status_code: 'OK', message_key: 'action.ok', message_params: [] };
  const menu: ProbeMenuSnapshot = {
    last_preview_result: { ...business, action_type: 'plant_crop' },
    last_action_result: { ...business, success: false, status_code: 'ERR_NOT_ENOUGH_RESOURCE',
      request_id: 'failed_request', created_objects: [] }
  };
  let reply: ProbeCommandResult = { command_result: { status: 'completed', snapshot: { menu } } };
  const interaction = new ProbeInteraction({ isAvailable: () => true, execute: async () => reply, onChange: () => {} });
  await interaction.execute({ name: 'menu_confirm', selection: {
    action_type: 'plant_crop', field_option_id: 'selected_field', seed_lot_option_id: 'selected_seed',
    seed_quantity: { amount: 1, unit: 'count' }
  } });
  assert.equal(interaction.status().operation.status, 'failed');
  assert.equal(interaction.status().operation.errorMessage, 'ERR_NOT_ENOUGH_RESOURCE');
  assert.equal(interaction.status().operation.message, '资源不足，请调整数量');
  reply = { command_result: { status: 'completed', snapshot: { menu,
    save_load: { last_load_result: { slot_id: 'web_probe', world_minute: 420 } }
  } } };
  await interaction.execute(LOAD);
  assert.equal(interaction.status().operation.status, 'completed');
  assert.equal(interaction.status().operation.message, '已恢复本地存档');
  assert.equal(interaction.status().operation.worldMinute, 420);
});
