import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProbeLifetime, type ProbeCommand, type ProbeCommandResult, type ProbeMenuSnapshot } from '../apps/cocos-probe/template/assets/scripts/ProbeLifetime';
import { ProbeInteraction } from '../apps/cocos-probe/template/assets/scripts/ProbeInteraction';
import { ProbeProcessing } from '../apps/cocos-probe/template/assets/scripts/ProbeProcessing';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot } from '../src/game-core';

type Intercept = (command: ProbeCommand, next: () => Promise<ProbeCommandResult>) => Promise<ProbeCommandResult>;
const SAVE = { name: 'save', selection: { slot_id: 'web_probe' } } as const;
const LOAD = { name: 'load', selection: { slot_id: 'web_probe' } } as const;
const DAY = { name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } } as const;

async function processingProbe(storage = new InMemorySaveStoragePort(), intercept?: Intercept) {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  let host: CocosSessionHost | null = null;
  let menu: ProbeMenuSnapshot | null = null;
  const processing = new ProbeProcessing();
  let calls = 0;
  const lifetime = new ProbeLifetime({
    loadResources: async () => ({ snapshot, buildId: 'web_processing_contract', schemas: Object.fromEntries(snapshot.schema_paths.map((path) => [path,
      JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))])) }),
    createHost: (input) => host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot, storage, nowIso8601: '2026-11-01T00:00:00.000Z' }),
    createBinding: (current) => new QinglanUiSceneProbeComponent(current as CocosSessionHost, {
      applyNodeBindingPatch: (patch) => { if (patch.section === 'menu') { menu = patch.payload as ProbeMenuSnapshot; processing.refresh(menu); } }
    })
  });
  const interaction = new ProbeInteraction({ isAvailable: () => !lifetime.isDisposed() && lifetime.status().phase === 'ready',
    execute: (command) => { calls++; const next = () => lifetime.execute(command); return intercept ? intercept(command, next) : next(); }, onChange: () => {} });
  await lifetime.start();
  const send = async (command: ProbeCommand) => {
    if ((command.name !== 'menu_preview' && command.name !== 'menu_confirm')
      || (command.selection.action_type !== 'start_processing' && command.selection.action_type !== 'collect_processing_result')) processing.invalidatePreview();
    try {
      const result = await interaction.execute(command);
      if (result && !lifetime.isDisposed()) processing.acceptProcessingResult(command, result);
      return result;
    } catch (error) { processing.invalidatePreview(); throw error; }
  };
  async function capture() { await host!.requireSession().save('processing_capture'); return storage.read('processing_capture'); }
  async function harvest() {
    const current = host!.requireSession().getSelectableViewModel();
    const field = current.field_options.find((item) => item.enabled)!;
    const seed = current.seed_lot_options.find((item) => item.enabled)!;
    await send({ name: 'menu_confirm', selection: { action_type: 'plant_crop', field_option_id: field.id,
      seed_lot_option_id: seed.id, seed_quantity: { amount: 1, unit: seed.quantity.unit } } });
    for (let day = 0; day < 30 && !host!.requireSession().getSelectableViewModel().harvestable_crop_options.some((item) => item.field_plot_id === field.id); day++) {
      await send({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } });
    }
    const crop = host!.requireSession().getSelectableViewModel().harvestable_crop_options.find((item) => item.field_plot_id === field.id)!;
    await send({ name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: crop.id } });
  }
  function startSelection(includeSalt = true) {
    const current = host!.requireSession().getSelectableViewModel();
    const method = current.processing_method_options[0]!;
    const facility = current.processing_facility_options.find((item) => item.enabled && method.compatible_facility_ids.includes(item.id))!;
    const inputs = method.input_requirements.slice(0, includeSalt ? undefined : 1).map((requirement, index) => {
      const lot = current.processable_lot_options.find((item) => item.enabled && requirement.lot_ids.includes(item.id))!;
      return { lot_option_id: lot.id, quantity: { amount: index === 0 ? 300 : 15, unit: lot.quantity.unit } };
    });
    return { action_type: 'start_processing', method_id: method.id, input_lots: inputs, facility_option_id: facility.id } as const;
  }
  return { lifetime, interaction, processing, storage, send, capture, harvest, startSelection, calls: () => calls,
    session: () => host!.requireSession(), menu: () => menu! };
}

test('the existing public start and collection path reports this processing outcome rather than an advance-time message', async (t) => {
  const p = await processingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest();
  const time = p.lifetime.status().timeLabel;
  const started = await p.send({ name: 'menu_confirm', selection: p.startSelection() } as ProbeCommand);
  assert.equal(started!.command_result.status, 'completed');
  assert.equal(p.interaction.status().operation.message, '加工开工成功');
  assert.equal(p.lifetime.status().timeLabel, time, 'starting does not privately add configured operation minutes');
  const task = p.session().getSelectableViewModel().processing_task_options[0]!;
  await p.send({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: task.expected_finish_minute - task.start_world_minute } });
  await p.send({ name: 'menu_confirm', selection: { action_type: 'collect_processing_result', task_option_id: task.id } } as ProbeCommand);
  assert.equal(p.interaction.status().operation.message, '加工产物领取成功');
});

type PublicProcessing = Awaited<ReturnType<typeof processingProbe>>;

function chooseMethodAndFacility(p: PublicProcessing) {
  p.processing.selectNextMethod(); p.processing.selectNextFacility();
  assert.ok(p.processing.status().selectedMethodId && p.processing.status().selectedFacilityId);
}

function input(p: PublicProcessing, index: number, quantity: string) {
  const requirements = p.processing.status().methodOptions.find((item) => item.id === p.processing.status().selectedMethodId)!.input_requirements;
  for (let i = 0; i <= requirements.length && p.processing.status().selectedRequirementIndex !== index; i++) p.processing.selectNextInput();
  assert.equal(p.processing.status().selectedRequirementIndex, index);
  p.processing.selectNextLot();
  const selected = p.processing.status().inputSelections.find((item) => item.requirementIndex === index);
  assert.ok(selected?.lotId, 'the public requirement must offer a real enabled batch');
  p.processing.setInputQuantity(quantity);
  return selected.lotId;
}

async function previewProcessing(p: PublicProcessing) {
  const command = p.processing.startPreviewCommand(); assert.ok(command);
  const result = await p.send(command); assert.ok(result); return { command, result };
}

async function startProcessing(p: PublicProcessing) {
  const command = p.processing.startConfirmCommand(); assert.ok(command);
  const result = await p.send(command); assert.ok(result); return result;
}

test('new-game method requirements remain inspectable with no cabbage; editing copies options and never sends commands', async (t) => {
  const p = await processingProbe(); t.after(() => p.lifetime.dispose());
  const before = await p.capture();
  const original = p.processing.status();
  assert.equal(original.selectedMethodId, null);
  assert.ok(original.methodOptions[0]!.enabled, 'missing materials do not hide a configured method');
  p.processing.selectNextMethod();
  assert.equal(p.processing.status().currentInputLotOptions.length, 0, 'the new game has no matching fresh vegetable');
  p.processing.selectNextInput(); p.processing.selectNextLot(); p.processing.selectNextFacility();
  for (const quantity of ['', ' ', '0', '-1', 'Infinity', 'NaN', '12g', '0x10', '1e309']) {
    p.processing.setInputQuantity(quantity);
    assert.equal(p.processing.status().canPreview, false, quantity);
    assert.equal(p.processing.startPreviewCommand(), null);
    assert.equal(p.processing.startConfirmCommand(), null);
  }
  p.processing.setInputQuantity('7');
  assert.equal(p.processing.status().canPreview, true, 'below-minimum amounts remain eligible for formal preview refusal');
  const detached = p.processing.status();
  Reflect.set(detached.methodOptions[0]!.input_requirements[0]!.constraints, 'category', 'changed');
  Reflect.set(detached.methodOptions[0]!.tool_requirements, 0, 'changed_tool');
  assert.deepEqual(p.processing.status().methodOptions, original.methodOptions);
  assert.equal(p.calls(), 0);
  assert.equal(await p.capture(), before);
});

test('helper previews missing or insufficient salt without mutation, then starts and collects from actual public results', async (t) => {
  const p = await processingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest(); chooseMethodAndFacility(p);
  const primaryId = input(p, 0, '300');
  let before = await p.capture();
  await previewProcessing(p);
  assert.deepEqual(p.processing.status().preview, { success: false, statusCode: 'ERR_PROCESSING_INPUT_MISSING' });
  assert.equal(p.processing.startConfirmCommand(), null); assert.equal(await p.capture(), before);
  const saltId = input(p, 1, '7');
  await previewProcessing(p);
  assert.equal(p.processing.status().preview?.success, false);
  assert.equal(p.processing.status().currentInputQuantityText, '7');
  assert.equal(await p.capture(), before);
  p.processing.setInputQuantity('15');
  await previewProcessing(p); await previewProcessing(p);
  assert.equal(await p.capture(), before);
  const started = await startProcessing(p);
  const taskId = started.command_result.snapshot!.menu!.last_action_result!.created_objects[0]!.object_id;
  assert.equal(taskId, 'task_processing_000001', 'preview and rejected work must not allocate a real task ID');
  const current = p.processing.status();
  assert.deepEqual(current.startResult, { taskId, methodId: current.selectedMethodId });
  assert.equal(current.selectedTaskId, taskId); assert.equal(current.canCollect, false); assert.equal(current.canStart, false);
  assert.ok(current.inputSelections.every((item) => item.quantityText === ''));
  assert.equal(p.session().getSelectableViewModel().splittable_lot_options.find((item) => item.id === primaryId)!.quantity.amount, 900);
  assert.equal(p.session().getSelectableViewModel().splittable_lot_options.find((item) => item.id === saltId)!.quantity.amount, 185);
  before = await p.capture();
  const early = p.session().dispatch('collect_processing_result', { task_id: taskId });
  assert.equal(early.status_code, 'ERR_PROCESSING_TASK_NOT_READY');
  assert.equal(await p.capture(), before); assert.equal(p.processing.collectCommand(), null);
  await p.send(DAY); await p.send(DAY);
  assert.equal(p.processing.status().taskOptions[0]!.status, 'ready_to_collect');
  const collect = p.processing.collectCommand(); assert.ok(collect);
  const collected = await p.send(collect);
  const outputId = collected!.command_result.snapshot!.menu!.last_action_result!.created_objects[0]!.object_id;
  const output = p.session().getSelectableViewModel().splittable_lot_options.find((item) => item.id === outputId)!;
  assert.deepEqual(p.processing.status().collectResult, { taskId, lotId: outputId, quantity: output.quantity });
  assert.deepEqual(output.quantity, { amount: 300, unit: 'g' }); assert.equal(output.current_form, 'pickled');
  assert.equal(p.processing.status().selectedTaskId, taskId);
  assert.equal(p.processing.status().taskOptions[0]!.status, 'completed'); assert.equal(p.processing.collectCommand(), null);
  before = await p.capture();
  const repeated = p.session().dispatch('collect_processing_result', { task_id: taskId });
  assert.equal(repeated.status_code, 'ERR_PROCESSING_TASK_ALREADY_COMPLETED'); assert.equal(await p.capture(), before);
  const stalePublic = await p.send({ name: 'menu_confirm', selection: { action_type: 'collect_processing_result', task_option_id: taskId } });
  assert.equal(stalePublic!.command_result.status, 'failed'); assert.match(stalePublic!.command_result.error_message!, /ERR_MENU_OPTION_NOT_FOUND/);
  assert.equal(await p.capture(), before);
});

test('input switching, quantity edits and other commands invalidate previews but keep still-legal choices', async (t) => {
  const p = await processingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest(); chooseMethodAndFacility(p);
  input(p, 0, '300'); input(p, 1, '15'); await previewProcessing(p);
  const choices = p.processing.status();
  p.processing.selectNextInput();
  assert.equal(p.processing.status().canStart, false);
  assert.deepEqual(p.processing.status().inputSelections, choices.inputSelections, 'viewing another requirement keeps its entered amount');
  await previewProcessing(p); p.processing.setInputQuantity('301'); assert.equal(p.processing.status().preview, null);
  p.processing.setInputQuantity('300'); await previewProcessing(p);
  await p.send(SAVE); assert.equal(p.processing.status().preview, null); assert.equal(p.processing.startConfirmCommand(), null);
  assert.equal(p.processing.status().selectedMethodId, choices.selectedMethodId);
  assert.equal(p.processing.status().selectedFacilityId, choices.selectedFacilityId);
  await previewProcessing(p); await p.send(LOAD);
  assert.equal(p.processing.status().canStart, false); assert.equal(p.processing.status().preview, null);
  assert.deepEqual(p.processing.status().inputSelections, choices.inputSelections);
});

test('loading a save without the selected input clears that batch and its preview without choosing a replacement', async (t) => {
  const p = await processingProbe(); t.after(() => p.lifetime.dispose());
  await p.send(SAVE);
  const saved = await p.capture();
  await p.harvest(); chooseMethodAndFacility(p);
  const primaryId = input(p, 0, '300'); const saltId = input(p, 1, '15');
  await previewProcessing(p);
  assert.equal(p.processing.status().canStart, true);
  const choices = p.processing.status(); const calls = p.calls();
  await p.send(LOAD);
  const loaded = p.processing.status();
  assert.equal(p.calls(), calls + 1, 'loading does not dispatch or replay a processing action');
  assert.equal(await p.capture(), saved);
  assert.equal(loaded.selectedMethodId, choices.selectedMethodId);
  assert.equal(loaded.selectedFacilityId, choices.selectedFacilityId);
  assert.equal(loaded.preview, null); assert.equal(loaded.canStart, false);
  assert.deepEqual(loaded.inputSelections.find((item) => item.requirementIndex === 0), {
    requirementIndex: 0, lotId: null, quantityText: ''
  });
  assert.equal(loaded.lotOptions.some((item) => item.id === primaryId), false);
  assert.equal(loaded.inputSelections.find((item) => item.requirementIndex === 1)!.lotId, saltId, 'still-valid salt remains selected');
  assert.equal(p.processing.startConfirmCommand(), null);
  await previewProcessing(p);
  assert.equal(p.processing.status().preview?.success, false, 'remaining salt cannot satisfy the missing primary input');
  assert.equal(await p.capture(), saved);
  await p.harvest();
  input(p, 0, '300');
  await previewProcessing(p);
  assert.equal(p.processing.status().canStart, true, 'the player can select the new public batch and recover');
});

test('a missing or mismatched processing preview cannot reuse an older success and a healthy retry does not mutate state', async (t) => {
  for (const kind of ['missing', 'mismatched']) {
    let corrupt = false;
    const p = await processingProbe(undefined, async (command, next) => {
      const result = await next();
      if (!corrupt || command.name !== 'menu_preview') return result;
      const copy = structuredClone(result);
      if (kind === 'missing') Reflect.set(copy.command_result.snapshot!.menu!, 'last_preview_result', null);
      else Reflect.set(copy.command_result.snapshot!.menu!.last_preview_result!, 'action_type', 'split_lot');
      return copy;
    });
    t.after(() => p.lifetime.dispose());
    await p.harvest(); chooseMethodAndFacility(p); input(p, 0, '300'); input(p, 1, '15');
    const before = await p.capture();
    await previewProcessing(p); assert.equal(p.processing.status().canStart, true);
    corrupt = true; const calls = p.calls();
    await assert.rejects(previewProcessing(p), /ERR_COCOS_PROBE_ACTION_SUMMARY_MISSING_OR_MISMATCHED/);
    assert.equal(p.calls(), calls + 1, kind);
    assert.equal(p.processing.status().preview, null, kind);
    assert.equal(p.processing.startConfirmCommand(), null, kind);
    assert.equal(p.interaction.status().operation.status, 'failed', kind);
    assert.equal(p.session().getSelectableViewModel().processing_task_options.length, 0, kind);
    assert.equal(await p.capture(), before, kind);
    corrupt = false; await previewProcessing(p);
    assert.equal(p.processing.status().canStart, true, kind);
    assert.equal(await p.capture(), before, kind);
  }
});

test('fully consumed processing inputs disappear from selection while the real task remains available for later collection', async (t) => {
  const p = await processingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest(); chooseMethodAndFacility(p);
  const current = p.session().getSelectableViewModel();
  const method = current.processing_method_options[0]!;
  const primary = current.processable_lot_options.find((item) => item.enabled && method.input_requirements[0]!.lot_ids.includes(item.id))!;
  const primaryId = input(p, 0, String(primary.quantity.amount)); input(p, 1, '15');
  await previewProcessing(p); await startProcessing(p);
  const state = p.processing.status();
  assert.deepEqual(state.inputSelections.find((item) => item.requirementIndex === 0), {
    requirementIndex: 0, lotId: null, quantityText: ''
  });
  assert.equal(state.lotOptions.some((item) => item.id === primaryId), false);
  assert.equal(state.taskOptions.length, 1); assert.equal(state.taskOptions[0]!.status, 'active');
  assert.equal(state.startResult?.taskId, state.taskOptions[0]!.id);
  assert.equal(state.canStart, false); assert.equal(state.canCollect, false);
  assert.equal(p.processing.startConfirmCommand(), null); assert.equal(p.processing.collectCommand(), null);
  await p.send(DAY); await p.send(DAY);
  const collect = p.processing.collectCommand(); assert.ok(collect);
  await p.send(collect);
  assert.deepEqual(p.processing.status().collectResult?.quantity, primary.quantity);
  assert.equal(p.processing.status().taskOptions[0]!.status, 'completed');
});

test('active tasks survive a fresh host load and later create unique tasks and outputs without auto-loading', async (t) => {
  const storage = new InMemorySaveStoragePort();
  const first = await processingProbe(storage); t.after(() => first.lifetime.dispose()); await first.harvest(); chooseMethodAndFacility(first);
  input(first, 0, '300'); input(first, 1, '15'); await previewProcessing(first); await startProcessing(first); await first.send(SAVE);
  const firstTaskId = first.processing.status().selectedTaskId;
  const second = await processingProbe(storage); t.after(() => second.lifetime.dispose());
  assert.equal(second.processing.status().taskOptions.length, 0, 'a new host does not auto-read the slot');
  await second.send(LOAD); second.processing.selectNextTask();
  assert.equal(second.processing.status().selectedTaskId, firstTaskId); assert.equal(second.processing.status().canCollect, false);
  await second.send(DAY); await second.send(DAY);
  await second.send(second.processing.collectCommand()!);
  const previousOutput = second.processing.status().collectResult!.lotId;
  chooseMethodAndFacility(second); input(second, 0, '300'); input(second, 1, '15'); await previewProcessing(second); await startProcessing(second);
  const nextTaskId = second.processing.status().selectedTaskId;
  assert.notEqual(nextTaskId, firstTaskId); await second.send(SAVE);
  const third = await processingProbe(storage); t.after(() => third.lifetime.dispose()); await third.send(LOAD);
  for (let i = 0; i < third.processing.status().taskOptions.length; i++) { third.processing.selectNextTask(); if (third.processing.status().selectedTaskId === nextTaskId) break; }
  assert.equal(third.processing.status().selectedTaskId, nextTaskId);
  await third.send(DAY); await third.send(DAY); await third.send(third.processing.collectCommand()!);
  assert.notEqual(third.processing.status().collectResult!.lotId, previousOutput);
  const ids = third.session().getSelectableViewModel().splittable_lot_options.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a real pending processing preview receipt cannot revive after an edit or explicit invalidation', async (t) => {
  for (const kind of ['edit', 'invalidate']) {
    let release!: () => void; let reached!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { reached = resolve; });
    const p = await processingProbe(undefined, async (command, next) => { const result = await next(); if (command.name === 'menu_preview') { reached(); await held; } return result; });
    t.after(() => p.lifetime.dispose()); await p.harvest(); chooseMethodAndFacility(p); input(p, 0, '300'); input(p, 1, '15');
    const before = await p.capture();
    const pending = previewProcessing(p); await entered;
    if (kind === 'edit') p.processing.setInputQuantity('16'); else p.processing.invalidatePreview();
    release(); await pending;
    assert.equal(p.processing.status().preview, null); assert.equal(p.processing.status().canStart, false);
    assert.equal(await p.capture(), before);
    await previewProcessing(p); assert.equal(p.processing.status().canStart, true);
  }
});

test('busy processing confirms are admitted once and disposal prevents a late receipt from restoring the view', async () => {
  let release!: () => void; let reached!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; }); const entered = new Promise<void>((resolve) => { reached = resolve; });
  const p = await processingProbe(undefined, async (command, next) => { const result = await next();
    if (command.name === 'menu_confirm' && command.selection.action_type === 'start_processing') { reached(); await held; } return result; });
  await p.harvest(); chooseMethodAndFacility(p); input(p, 0, '300'); input(p, 1, '15'); await previewProcessing(p);
  const command = p.processing.startConfirmCommand()!; const calls = p.calls();
  const pending = p.send(command); await entered;
  assert.equal(await p.send(command), null); assert.equal(p.calls(), calls + 1);
  assert.equal(p.session().getSelectableViewModel().processing_task_options.length, 1);
  p.processing.invalidatePreview(); await p.lifetime.dispose(); release(); await pending;
  assert.equal(p.processing.status().startResult, null); assert.equal(p.processing.status().canStart, false);
});

test('a malformed completion after a committed start fails closed and never retries that action automatically', async (t) => {
  let corrupt = false;
  const p = await processingProbe(undefined, async (command, next) => {
    const result = await next();
    if (corrupt && command.name === 'menu_confirm' && command.selection.action_type === 'start_processing') {
      const copy = structuredClone(result); Reflect.set(copy.command_result.snapshot!.menu!, 'last_action_result', null); return copy;
    }
    return result;
  }); t.after(() => p.lifetime.dispose()); await p.harvest(); chooseMethodAndFacility(p);
  const primary = input(p, 0, '300'); input(p, 1, '15'); await previewProcessing(p);
  corrupt = true; const calls = p.calls();
  await assert.rejects(startProcessing(p), /ERR_COCOS_PROBE_ACTION_SUMMARY_MISSING_OR_MISMATCHED/);
  assert.equal(p.calls(), calls + 1); assert.equal(p.processing.status().canStart, false);
  assert.equal(p.processing.status().startResult, null); assert.equal(p.session().getSelectableViewModel().processing_task_options.length, 1);
  assert.equal(p.session().getSelectableViewModel().splittable_lot_options.find((item) => item.id === primary)!.quantity.amount, 900);
  corrupt = false; await p.send({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(p.session().getSelectableViewModel().processing_task_options.length, 1, 'a later healthy command resynchronizes without replaying the committed start');
});

test('a real missing-required-input preview reports this refusal and preserves the complete saved state', async (t) => {
  const p = await processingProbe(); t.after(() => p.lifetime.dispose()); await p.harvest();
  const before = await p.capture();
  const result = await p.send({ name: 'menu_preview', selection: p.startSelection(false) } as ProbeCommand);
  assert.equal(result!.command_result.snapshot!.menu!.last_preview_result!.status_code, 'ERR_PROCESSING_INPUT_MISSING');
  assert.equal(p.interaction.status().operation.status, 'failed');
  assert.equal(p.interaction.status().operation.message, '加工所需材料缺失或数量不足');
  assert.equal(await p.capture(), before);
});
