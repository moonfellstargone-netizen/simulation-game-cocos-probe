import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProbeInventory } from '../apps/cocos-probe/template/assets/scripts/ProbeInventory';
import { ProbeInteraction } from '../apps/cocos-probe/template/assets/scripts/ProbeInteraction';
import { ProbeLifetime, type ProbeCommand, type ProbeCommandResult, type ProbeMenuSnapshot } from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot, type SaveFile } from '../src/game-core';

const SAVE = { name: 'save', selection: { slot_id: 'web_probe' } } as const;
const LOAD = { name: 'load', selection: { slot_id: 'web_probe' } } as const;
type Intercept = (command: ProbeCommand, execute: () => Promise<ProbeCommandResult>) => Promise<ProbeCommandResult>;

async function probe(storage = new InMemorySaveStoragePort(), intercept?: Intercept) {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const inventory = new ProbeInventory();
  let host: CocosSessionHost | null = null;
  let menu: ProbeMenuSnapshot | null = null;
  let calls = 0;
  const lifetime = new ProbeLifetime({
    loadResources: async () => ({ snapshot, buildId: 'web_split_contract', schemas: Object.fromEntries(snapshot.schema_paths.map((path) => [path,
      JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))])) }),
    createHost: (input) => {
      host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot, storage, nowIso8601: '2026-11-01T00:00:00.000Z' });
      return host;
    },
    createBinding: (current) => new QinglanUiSceneProbeComponent(current as CocosSessionHost, {
      applyNodeBindingPatch: (patch) => { if (patch.section === 'menu') { menu = patch.payload as ProbeMenuSnapshot; inventory.refresh(menu); } }
    })
  });
  const interaction = new ProbeInteraction({ isAvailable: () => !lifetime.isDisposed() && lifetime.status().phase === 'ready',
    execute: (command) => { calls++; const execute = () => lifetime.execute(command); return intercept ? intercept(command, execute) : execute(); }, onChange: () => {} });
  await lifetime.start();
  async function send(command: ProbeCommand) {
    if (command.name !== 'menu_preview' && !(command.name === 'menu_confirm' && command.selection.action_type === 'split_lot')) inventory.invalidateSplitPreview();
    const result = await interaction.execute(command);
    if (result && !lifetime.isDisposed()) inventory.acceptSplitResult(command, result);
    return result;
  }
  async function serialized() { await host!.requireSession().save('capture'); return (await storage.read('capture'))!; }
  return { inventory, lifetime, interaction, storage, send, serialized, calls: () => calls, session: () => host!.requireSession(), menu: () => menu! };
}
type Probe = Awaited<ReturnType<typeof probe>>;
function select(p: Probe, id: string) {
  for (let i = 0; p.inventory.status().selectedLotId !== id && i <= p.inventory.status().lotOptions.length; i++) p.inventory.selectNextLot();
  assert.equal(p.inventory.status().selectedLotId, id);
}
async function preview(p: Probe, amount: string) {
  p.inventory.setSplitQuantity(amount);
  const command = p.inventory.splitPreviewCommand(); assert.ok(command);
  const result = await p.send(command); assert.ok(result);
  return { command, result };
}
async function confirm(p: Probe) {
  const command = p.inventory.splitConfirmCommand(); assert.ok(command);
  const result = await p.send(command); assert.ok(result);
  return result;
}
function lot(p: Probe, id: string) { return p.inventory.status().lotOptions.find((item) => item.id === id); }
async function harvest(p: Probe) {
  const choices = p.session().getSelectableViewModel();
  const field = choices.field_options.find((item) => item.enabled)!; const seed = choices.seed_lot_options.find((item) => item.enabled)!;
  await p.send({ name: 'menu_confirm', selection: { action_type: 'plant_crop', field_option_id: field.id, seed_lot_option_id: seed.id,
    seed_quantity: { amount: 1, unit: seed.quantity.unit } } });
  for (let day = 0; day < 30 && p.session().getSelectableViewModel().harvestable_crop_options.length === 0; day++) {
    await p.send({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } });
  }
  const crop = p.session().getSelectableViewModel().harvestable_crop_options.find((item) => item.field_plot_id === field.id); assert.ok(crop);
  const result = await p.send({ name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: crop.id } });
  const id = result!.command_result.snapshot!.menu!.last_action_result!.created_objects.find((item) => item.object_type === 'MaterialLot')?.object_id;
  assert.ok(id); return id;
}

test('split input uses complete numeric text and the selected original unit without dispatching while editing', async (t) => {
  const p = await probe(); t.after(() => p.lifetime.dispose());
  const salt = p.inventory.status().lotOptions.find((item) => item.base_id === 'salt')!; select(p, salt.id);
  const before = await p.serialized(); const calls = p.calls();
  for (const text of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e309', '12g', '1.2tail', '0x10']) {
    p.inventory.setSplitQuantity(text);
    assert.equal(p.inventory.status().splitQuantityText, text);
    assert.equal(p.inventory.splitPreviewCommand(), null, text);
    assert.equal(p.inventory.splitConfirmCommand(), null);
    assert.ok(p.inventory.status().splitInputError);
  }
  p.inventory.setSplitQuantity(' 0.25 ');
  assert.equal(p.inventory.status().splitUnit, salt.quantity.unit);
  assert.deepEqual(p.inventory.splitPreviewCommand(), { name: 'menu_preview', selection: {
    action_type: 'split_lot', source_lot_option_id: salt.id, quantity: { amount: 0.25, unit: 'g' }
  } });
  assert.equal(p.inventory.status().canConfirmSplit, false, 'explicit successful preview is required');
  p.inventory.selectNextLot();
  assert.equal(p.inventory.status().splitQuantityText, '');
  assert.equal(p.inventory.status().splitPreview, null);
  assert.equal(p.calls(), calls);
  assert.equal(await p.serialized(), before);
});

test('real public split preview preserves the full save and IDs before 1200g becomes actual 900g and 300g lots', async (t) => {
  const p = await probe(); t.after(() => p.lifetime.dispose());
  const id = await harvest(p); select(p, id); assert.equal(lot(p, id)!.quantity.amount, 1200);
  const before = await p.serialized();
  await preview(p, '300');
  assert.deepEqual(p.inventory.status().splitPreview, { success: true, statusCode: 'OK' });
  assert.equal(p.inventory.status().canConfirmSplit, true);
  assert.equal(await p.serialized(), before);
  await preview(p, '300');
  assert.equal(await p.serialized(), before);
  const result = await confirm(p);
  const created = result.command_result.snapshot!.menu!.last_action_result!.created_objects.find((item) => item.object_type === 'MaterialLot')!;
  assert.equal(created.object_id, 'lot_split_000001');
  assert.deepEqual(lot(p, id)!.quantity, { amount: 900, unit: 'g' });
  assert.deepEqual(lot(p, created.object_id)!.quantity, { amount: 300, unit: 'g' });
  assert.deepEqual(p.inventory.status().splitResult, { sourceLotId: id, newLotId: created.object_id,
    quantity: { amount: 300, unit: 'g' }, remainingQuantity: { amount: 900, unit: 'g' } });
  assert.equal(p.inventory.status().selectedLotId, id);
  assert.equal(p.inventory.status().splitQuantityText, '');
  assert.equal(p.inventory.status().canConfirmSplit, false);
});

test('gram and millilitre fractions and whole counts use formal quantities; a full split removes the source choice', async (t) => {
  for (const [unit, text] of [['g', '0.25'], ['ml', '0.1'], ['count', '1']] as const) {
    const p = await probe(); t.after(() => p.lifetime.dispose());
    const source = p.inventory.status().lotOptions.find((item) => item.quantity.unit === unit)!; select(p, source.id);
    const original = source.quantity.amount;
    await preview(p, text); await confirm(p);
    assert.deepEqual(p.inventory.status().splitResult?.quantity, { amount: Number(text), unit });
    assert.equal(lot(p, source.id)!.quantity.amount, original - Number(text));
    await preview(p, String(lot(p, source.id)!.quantity.amount)); await confirm(p);
    assert.equal(lot(p, source.id), undefined);
    assert.equal(p.inventory.status().selectedLotId, null);
    assert.equal(p.inventory.status().splitResult?.remainingQuantity, null);
    assert.ok(p.inventory.status().lotOptions.every((item) => item.quantity.amount > 0));
  }
});

test('fractional counts and excessive quantities reach formal preview refusal without state changes then recover', async (t) => {
  const p = await probe(); t.after(() => p.lifetime.dispose());
  for (const [unit, text] of [['count', '0.5'], ['g', '999999']] as const) {
    const source = p.inventory.status().lotOptions.find((item) => item.quantity.unit === unit)!; select(p, source.id);
    const before = await p.serialized();
    await preview(p, text);
    assert.equal(p.interaction.status().operation.status, 'failed');
    assert.equal(p.inventory.status().splitPreview?.success, false);
    assert.equal(p.inventory.status().splitQuantityText, text);
    assert.equal(p.inventory.splitConfirmCommand(), null);
    assert.equal(await p.serialized(), before);
    await preview(p, '1'); await confirm(p);
    assert.equal(p.interaction.status().operation.status, 'completed');
  }
});

test('stale preview receipts cannot reappear after quantity changes, panel invalidation or source removal', async (t) => {
  const p = await probe(); t.after(() => p.lifetime.dispose());
  const source = p.inventory.status().lotOptions.find((item) => item.quantity.unit === 'g')!; select(p, source.id);
  const saved = await preview(p, '1');
  p.inventory.setSplitQuantity('2');
  p.inventory.acceptSplitResult(saved.command, saved.result);
  assert.equal(p.inventory.status().splitPreview, null);
  await preview(p, '2'); p.inventory.invalidateSplitPreview();
  p.inventory.acceptSplitResult(saved.command, saved.result);
  assert.equal(p.inventory.status().canConfirmSplit, false);
  const current = await preview(p, '2');
  p.inventory.refresh({ selectable_view_model: null });
  p.inventory.acceptSplitResult(current.command, current.result);
  assert.equal(p.inventory.status().selectedLotId, null);
  assert.equal(p.inventory.status().splitQuantityText, '');
  assert.equal(p.inventory.splitPreviewCommand(), null);
  assert.equal(p.inventory.status().splitPreview, null);
});

test('an unconsumed real preview receipt cannot revive confirmation after editing or invalidation while its return is delayed', async (t) => {
  for (const change of ['edit', 'invalidate'] as const) {
    let release!: () => void; let reached!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { reached = resolve; });
    const p = await probe(undefined, async (command, execute) => {
      const result = await execute();
      if (command.name === 'menu_preview') { reached(); await held; }
      return result;
    }); t.after(() => p.lifetime.dispose());
    const source = p.inventory.status().lotOptions.find((item) => item.quantity.unit === 'g')!; select(p, source.id);
    p.inventory.setSplitQuantity('1'); const command = p.inventory.splitPreviewCommand(); assert.ok(command);
    const before = await p.serialized(); const pending = p.send(command); await started;
    assert.equal(p.menu().last_preview_result?.success, true, 'the real preview completed before its outer receipt was delivered');
    assert.equal(p.inventory.status().splitPreview, null, 'no outer receipt has been consumed yet');
    if (change === 'edit') p.inventory.setSplitQuantity('2');
    else p.inventory.invalidateSplitPreview();
    release(); await pending;
    assert.equal(p.inventory.status().splitQuantityText, change === 'edit' ? '2' : '1');
    assert.equal(p.inventory.status().splitPreview, null, `${change} must invalidate the still-pending receipt`);
    assert.equal(p.inventory.status().canConfirmSplit, false);
    assert.equal(p.inventory.splitConfirmCommand(), null);
    assert.equal(await p.serialized(), before);
    await preview(p, '3');
    assert.equal(p.inventory.status().canConfirmSplit, true, 'a fresh preview can recover after the stale receipt is rejected');
  }
});

test('capacity refusal uses canonical batches, keeps the complete save and recovers after an existing whole-lot move', async (t) => {
  const p = await probe(); t.after(() => p.lifetime.dispose());
  const salt = p.inventory.status().lotOptions.find((item) => item.base_id === 'salt')!;
  const room = p.inventory.status().targetOptions.find((item) => item.id === salt.storage_ref.container_id)!;
  const free = room.capacity.amount - room.used_capacity;
  select(p, salt.id);
  for (let i = 0; i < free; i++) { await preview(p, '1'); await confirm(p); }
  const before = await p.serialized();
  await preview(p, '1');
  assert.deepEqual(p.inventory.status().splitPreview, { success: false, statusCode: 'ERR_STORAGE_CAPACITY_OVERFLOW' });
  assert.equal(await p.serialized(), before);
  const stock = p.inventory.status();
  const movable = stock.lotOptions.find((item) => item.id !== salt.id && item.storage_ref.container_id === room.id
    && stock.targetOptions.some((target) => target.id !== room.id && target.enabled && target.supported_forms.includes(item.current_form)))!;
  const target = stock.targetOptions.find((item) => item.id !== room.id && item.enabled && item.supported_forms.includes(movable.current_form))!;
  await p.send({ name: 'menu_confirm', selection: { action_type: 'store_item', source_lot_option_id: movable.id, target_storage_option_id: target.id } });
  select(p, salt.id); await preview(p, '1'); await confirm(p);
  assert.equal(p.interaction.status().operation.status, 'completed');
});

test('manual loading in a fresh public host keeps split IDs unique and clears the old preview', async (t) => {
  const storage = new InMemorySaveStoragePort(); const first = await probe(storage); t.after(() => first.lifetime.dispose());
  const source = first.inventory.status().lotOptions.find((item) => item.base_id === 'salt')!; select(first, source.id);
  await preview(first, '1'); await confirm(first); await first.send(SAVE);
  const saved = JSON.parse((await storage.read('web_probe'))!) as SaveFile;
  const previousIds = new Set(saved.inventory.map((item) => item.lot_id));
  await preview(first, '1'); await first.send(LOAD);
  assert.equal(first.inventory.status().splitPreview, null);
  const second = await probe(storage); t.after(() => second.lifetime.dispose()); await second.send(LOAD); select(second, source.id);
  await preview(second, '0.25'); const result = await confirm(second);
  const created = result.command_result.snapshot!.menu!.last_action_result!.created_objects[0]!.object_id;
  assert.equal(previousIds.has(created), false); assert.equal(created, 'lot_split_000002');
  const restored = JSON.parse(await second.serialized()) as SaveFile;
  assert.equal(new Set(restored.inventory.map((item) => item.lot_id)).size, restored.inventory.length);
});

test('preview feedback requires its own action result and does not require or reuse a formal ActionResult', async (t) => {
  let corrupt = true;
  const p = await probe(undefined, async (command, execute) => {
    const result = await execute();
    if (command.name === 'menu_preview' && corrupt) {
      const detached = structuredClone(result); Reflect.set(detached.command_result.snapshot!.menu!, 'last_preview_result', null); return detached;
    }
    return result;
  }); t.after(() => p.lifetime.dispose());
  const source = p.inventory.status().lotOptions.find((item) => item.quantity.unit === 'g')!; select(p, source.id);
  p.inventory.setSplitQuantity('1');
  await assert.rejects(p.send(p.inventory.splitPreviewCommand()!), /ERR_COCOS_PROBE_ACTION_SUMMARY_MISSING_OR_MISMATCHED/);
  assert.equal(p.inventory.status().canConfirmSplit, false);
  corrupt = false; await preview(p, '1');
  assert.equal(p.interaction.status().operation.message, '本次校验通过，尚未执行');
  assert.equal(p.menu().last_action_result, null);
});

test('rapid duplicate confirmations are admitted once while a delayed result cannot restore a disposed split view', async (t) => {
  let release!: () => void; let reached!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { reached = resolve; });
  const p = await probe(undefined, async (command, execute) => {
    const result = await execute();
    if (command.name === 'menu_confirm' && command.selection.action_type === 'split_lot') { reached(); await held; }
    return result;
  }); t.after(() => p.lifetime.dispose());
  const source = p.inventory.status().lotOptions.find((item) => item.quantity.unit === 'g')!; select(p, source.id);
  await preview(p, '1'); const command = p.inventory.splitConfirmCommand()!; const calls = p.calls();
  const pending = p.send(command); await started;
  assert.equal(await p.send(command), null); assert.equal(p.calls(), calls + 1);
  p.inventory.invalidateSplitPreview(); await p.lifetime.dispose(); release(); await pending;
  assert.equal(p.inventory.status().splitResult, null);
  assert.equal(p.inventory.status().canConfirmSplit, false);
});
