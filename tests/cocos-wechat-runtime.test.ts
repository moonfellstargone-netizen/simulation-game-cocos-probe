import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { WechatProbeController, readCandidateIdentity, type CandidateIdentity,
  type WechatCommand, type WechatCommandResult, type WechatProbeSnapshot, type WechatResources } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController';
import { createStage1AHost, QinglanUiSceneProbeComponent, type CocosSessionHost } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot, type SaveStoragePort } from '../src/game-core';
import { WECHAT_BACKUP_SLOT_ID, WECHAT_SAVE_SLOT_ID, WECHAT_SAVE_BACKUP_KEY, WECHAT_SAVE_STORAGE_KEY,
  WechatSaveStoragePort } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatSaveStoragePort';
import { deriveBuildId } from '../tools/quality/lib/versionSurface.mjs';

const target = JSON.parse(readFileSync('tools/quality/rules/project-target.json', 'utf8'));
function identity(seed = '1', version = target.version): CandidateIdentity {
  return { schema: 'wechat-candidate/v1', candidate_id: `wechat-${seed.repeat(8)}-${seed.repeat(4)}-${seed.repeat(4)}-${seed.repeat(4)}-${seed.repeat(12)}`,
    source_commit: 'a'.repeat(40), short_commit: 'a'.repeat(12),
    version: version.codePackageVersion, build_id: deriveBuildId('cocos_wechat_probe', version.snakeVersion) };
}
function resources(buildId = identity().build_id): WechatResources {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  return { snapshot, schemas: Object.fromEntries(snapshot.schema_paths.map(path => [path,
    JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8'))])), buildId };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(options: { identity?: CandidateIdentity; storage?: SaveStoragePort; randomSeed?: string;
  load?: () => Promise<{ resources: WechatResources; identity: unknown }>;
  prepareBackupRecovery?: () => Promise<void>;
  recoverValidatedBackup?: () => Promise<void>;
  cancelFirstFailedSave?: () => Promise<void>;
  onChange?: (snapshot: WechatProbeSnapshot) => void;
  receiveMenu?: boolean;
  intercept?: (command: WechatCommand, execute: () => Promise<WechatCommandResult>) => Promise<WechatCommandResult>;
  patch?: () => void | Promise<void> } = {}) {
  let host: CocosSessionHost | null = null;
  let binding: QinglanUiSceneProbeComponent | null = null;
  let factories = 0;
  const states: WechatProbeSnapshot[] = [];
  const current = options.identity ?? identity();
  const controller = new WechatProbeController({
    load: options.load ?? (async () => ({ resources: resources(current.build_id), identity: current })),
    createHost: input => {
      factories++;
      host = createStage1AHost({ snapshot: input.snapshot as RuntimeConfigSnapshot, schemas: input.schemas,
        buildId: input.buildId, nowIso8601: '2026-11-03T00:00:00.000Z', storage: options.storage ?? new InMemorySaveStoragePort(),
        randomSeed: options.randomSeed ?? 'farming-test-23' }); // Successful setup unless this test explicitly selects a failure seed.
      return host;
    },
    createBinding: currentHost => {
      binding = new QinglanUiSceneProbeComponent(currentHost as CocosSessionHost, { applyNodeBindingPatch: patch => {
        if (options.receiveMenu && patch.section === 'menu') controller.acceptMenuPatch(patch.payload);
        return options.patch?.();
      } });
      if (!options.intercept) return binding;
      const actual = binding;
      return { mount: () => actual.mount(), unmount: () => actual.unmount(),
        execute: command => options.intercept!(command, () => actual.execute(command)) };
    },
    prepareBackupRecovery: options.prepareBackupRecovery,
    recoverValidatedBackup: options.recoverValidatedBackup,
    cancelFirstFailedSave: options.cancelFirstFailedSave,
    onChange: state => { states.push(state); options.onChange?.(state); }
  });
  return { controller, states, host: () => host!, binding: () => binding!, factories: () => factories };
}

test('M3 processing validates without preview, then starts, restores and collects via real public pipeline', async () => {
  const storage = new InMemorySaveStoragePort();
  const commands: string[] = [];
  let lastStarted: WechatCommandResult | null = null; let replay = false;
  const p = harness({ storage, receiveMenu: true, intercept: async (command, execute) => {
    commands.push(command.name);
    if (replay && command.name === 'menu_confirm_processing_direct') return lastStarted!;
    const result = await execute();
    if (command.name === 'menu_confirm_processing_direct' && command.selection.action_type === 'start_processing'
        && result.command_result.snapshot?.menu?.last_action_result?.success) lastStarted = result;
    return result;
  } });
  await p.controller.start();
  const capture = async () => { await p.host().requireSession().save('capture'); return storage.read('capture'); };
  try {
    const initial = p.controller.snapshot().menu!.selectable_view_model!;
    const field = initial.field_options.find(item => item.enabled)!;
    const seed = initial.seed_lot_options.find(item => item.enabled)!;
    await p.controller.plant(field.id, seed.id, { amount: 1, unit: seed.quantity.unit });
    for (let i = 0; i < 4; i++) await p.controller.advanceDay();
    const crop = p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.find(item => item.enabled)!;
    assert.ok(crop); await p.controller.harvest(crop.id);
    const menu = p.controller.snapshot().menu!.selectable_view_model!;
    const method = menu.processing_method_options.find(item => item.enabled)!;
    const facility = menu.processing_facility_options.find(item => item.enabled && method.compatible_facility_ids.includes(item.id))!;
    const inputs = method.input_requirements.map(requirement => {
      const lot = menu.processable_lot_options.find(item => item.enabled && requirement.lot_ids.includes(item.id))!;
      assert.ok(lot);
      return { lot_option_id: lot.id, quantity: { amount: requirement.min_quantity?.amount ?? Math.min(300, lot.quantity.amount), unit: lot.quantity.unit } };
    });
    const selection = { action_type: 'start_processing' as const, method_id: method.id, facility_option_id: facility.id, input_lots: inputs };
    const before = await capture();
    await assert.rejects(p.controller.confirmProcessing({ ...selection, input_lots: inputs.slice(0, 1) }), /ERR_WECHAT_PROBE_ACTION_FAILED/);
    assert.deepEqual(await capture(), before);
    assert.equal(commands.filter(name => name === 'menu_preview').length, 0);
    const started = await p.controller.confirmProcessing(selection);
    const taskId = started.processing_result!.taskId;
    assert.equal(started.processing_result!.actionType, 'start_processing');
    assert.ok(started.menu!.selectable_view_model!.processing_task_options.some(task => task.id === taskId && task.status === 'active'));
    const afterStart = await capture();
    const refreshed = await p.controller.refreshProcessingView();
    assert.ok(refreshed.menu!.selectable_view_model!.processing_task_options.some(task => task.id === taskId));
    assert.deepEqual(await capture(), afterStart, 'refresh only reads the current session');
    assert.equal(commands.at(-1), 'refresh');
    replay = true;
    await assert.rejects(p.controller.confirmProcessing(selection), /ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN/);
    assert.deepEqual(await capture(), afterStart, 'replayed receipt cannot create or pretend to create a task');
    replay = false;
    await assert.rejects(p.controller.confirmProcessing({ action_type: 'collect_processing_result', task_option_id: taskId }), /ERR_WECHAT_PROBE_ACTION_FAILED/);
    assert.deepEqual(await capture(), afterStart);
    await p.controller.save(); await p.controller.load();
    assert.equal(p.controller.snapshot().processing_result, null);
    await p.controller.advanceDay(); await p.controller.advanceDay();
    const collected = await p.controller.confirmProcessing({ action_type: 'collect_processing_result', task_option_id: taskId });
    assert.equal(collected.processing_result!.actionType, 'collect_processing_result');
    assert.equal(collected.processing_result!.taskId, taskId);
    assert.ok(collected.processing_result!.lotId);
    assert.equal(collected.menu!.selectable_view_model!.processing_task_options.find(task => task.id === taskId)!.status, 'completed');
    assert.equal(commands.filter(name => name === 'menu_preview').length, 0);
  } finally { await p.controller.dispose(); }
});

test('M3 processing refresh rejects an invalid or backgrounded receipt without replacing the menu', async () => {
  for (const mode of ['invalid', 'missing-lots', 'missing-methods', 'hidden'] as const) {
    const gate = deferred<void>(); const entered = deferred<void>();
    const p = harness({ receiveMenu: true, intercept: async (command, execute) => {
      const result = await execute();
      if (command.name !== 'refresh') return result;
      if (mode === 'hidden') { entered.resolve(); await gate.promise; return result; }
      if (mode === 'missing-lots' || mode === 'missing-methods') {
        const altered = structuredClone(result);
        Reflect.deleteProperty(altered.command_result.snapshot!.menu!.selectable_view_model!, mode === 'missing-lots' ? 'processable_lot_options' : 'processing_method_options');
        return altered;
      }
      return { command_result: { ...result.command_result, snapshot: { ...result.command_result.snapshot,
        lifecycle: { has_session: false } } } };
    } });
    await p.controller.start();
    try {
      const before = p.controller.snapshot().menu;
      const pending = p.controller.refreshProcessingView();
      if (mode === 'hidden') { await entered.promise; p.controller.setVisible(false); gate.resolve(); }
      await assert.rejects(pending, /ERR_WECHAT_REFRESH_FAILED/);
      assert.deepEqual(p.controller.snapshot().menu, before);
    } finally { await p.controller.dispose(); }
  }
});

test('M3 processing refresh accepts its own changed menu patch without dispatching a second action', async () => {
  const commands: string[] = [];
  const p = harness({ receiveMenu: true, intercept: async (command, execute) => { commands.push(command.name); return execute(); } });
  await p.controller.start();
  try {
    const before = p.controller.snapshot().time_label;
    const action = p.host().requireSession().dispatch('advance_time', { minutes: 60 });
    assert.equal(action.success, true);
    const updated = await p.controller.refreshProcessingView();
    assert.notEqual(updated.time_label, before);
    assert.equal(updated.menu!.view_model!.time_label, updated.time_label);
    assert.deepEqual(commands, ['refresh']);
  } finally { await p.controller.dispose(); }
});

test('M3 processing verifies direct receipts after dispatch and backgrounding', async () => {
  for (const mode of ['failed-after-dispatch', 'missing-task', 'hidden-valid', 'hidden-bad'] as const) {
    const gate = deferred<void>(); const entered = deferred<void>();
    const p = harness({ receiveMenu: true, intercept: async (command, execute) => {
      const result = await execute();
      if (command.name !== 'menu_confirm_processing_direct' || command.selection.action_type !== 'start_processing') return result;
      if (mode.startsWith('hidden-')) { entered.resolve(); await gate.promise; }
      if (mode === 'failed-after-dispatch') return { command_result: { ...result.command_result, status: 'failed', error_message: 'render-failed' } };
      if (mode === 'missing-task' || mode === 'hidden-bad') return { command_result: { ...result.command_result,
        snapshot: { ...result.command_result.snapshot, menu: { ...result.command_result.snapshot!.menu,
          last_action_result: { success: true, created_objects: [] } } } } };
      return result;
    } });
    await p.controller.start();
    try {
      const initial = p.controller.snapshot().menu!.selectable_view_model!;
      const field = initial.field_options.find(item => item.enabled)!;
      const seed = initial.seed_lot_options.find(item => item.enabled)!;
      await p.controller.plant(field.id, seed.id, { amount: 1, unit: seed.quantity.unit });
      for (let i = 0; i < 4; i++) await p.controller.advanceDay();
      await p.controller.harvest(p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.find(item => item.enabled)!.id);
      const menu = p.controller.snapshot().menu!.selectable_view_model!;
      const method = menu.processing_method_options.find(item => item.enabled)!;
      const facility = menu.processing_facility_options.find(item => item.enabled && method.compatible_facility_ids.includes(item.id))!;
      const input_lots = method.input_requirements.map(req => {
        const lot = menu.processable_lot_options.find(item => item.enabled && req.lot_ids.includes(item.id))!;
        return { lot_option_id: lot.id, quantity: { amount: req.min_quantity?.amount ?? Math.min(300, lot.quantity.amount), unit: lot.quantity.unit } };
      });
      const before = p.controller.snapshot().completed_commands;
      const pending = p.controller.confirmProcessing({ action_type: 'start_processing', method_id: method.id, facility_option_id: facility.id, input_lots });
      if (mode.startsWith('hidden-')) { await entered.promise; p.controller.setVisible(false); gate.resolve(); }
      if (mode === 'hidden-valid') { await pending; assert.equal(p.controller.snapshot().completed_commands, before + 1); }
      else { await assert.rejects(pending, /ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN/); assert.equal(p.controller.snapshot().completed_commands, before); }
      assert.equal(p.controller.snapshot().processing_result, null);
      assert.equal(p.host().requireSession().getSelectableViewModel().processing_task_options.length, 1, 'formal action really committed');
    } finally { await p.controller.dispose(); }
  }
});

test('M3 direct split validates independently, preserves state on rejection and supports optional preview and full split', async () => {
  const storage = new InMemorySaveStoragePort();
  const commands: string[] = [];
  const p = harness({ storage, receiveMenu: true, intercept: async (command, execute) => {
    commands.push(command.name);
    return execute();
  } });
  await p.controller.start();
  const capture = async () => { await p.host().requireSession().save('capture'); return storage.read('capture'); };
  try {
    const options = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options;
    const count = options.find(item => item.enabled && item.quantity.unit === 'count')!;
    const grams = options.find(item => item.enabled && item.quantity.unit === 'g')!;
    assert.ok(count && grams);
    const before = await capture();
    for (const [lot, amount] of [[count, 0.5], [grams, grams.quantity.amount + 1]] as const) {
      await assert.rejects(p.controller.confirmSplit(lot.id, { amount, unit: lot.quantity.unit }), /ERR_WECHAT_PROBE_ACTION_FAILED/);
      assert.deepEqual(await capture(), before);
      assert.equal(p.controller.snapshot().split_result, null);
    }
    assert.equal(commands.filter(name => name === 'menu_preview').length, 0);
    const direct = await p.controller.confirmSplit(grams.id, { amount: 1, unit: grams.quantity.unit });
    assert.deepEqual(direct.split_result!.quantity, { amount: 1, unit: grams.quantity.unit });
    assert.deepEqual(direct.split_result!.remainingQuantity, { amount: grams.quantity.amount - 1, unit: grams.quantity.unit });
    await p.controller.previewSplit(grams.id, { amount: 1, unit: grams.quantity.unit });
    assert.equal(p.controller.snapshot().split_preview?.success, true);
    const detached = p.controller.snapshot().split_preview!;
    Reflect.set(detached.quantity, 'amount', 99);
    assert.equal(p.controller.snapshot().split_preview!.quantity.amount, 1);
    const fractional = await p.controller.confirmSplit(grams.id, { amount: 0.1, unit: grams.quantity.unit });
    assert.equal(fractional.split_result!.quantity.amount, 0.1);
    assert.equal(fractional.split_result!.remainingQuantity!.amount, grams.quantity.amount - 1 - 0.1);
    const remaining = fractional.split_result!.remainingQuantity!;
    await p.controller.confirmSplit(grams.id, remaining);
    assert.equal(p.controller.snapshot().split_result!.remainingQuantity, null);
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.some(item => item.id === grams.id), false);
  } finally { await p.controller.dispose(); }
});

test('M3 optional preview is invalidated by state changes and delayed receipts', async () => {
  const gate = deferred<void>(); const entered = deferred<void>(); let hold = false;
  const p = harness({ receiveMenu: true, patch: () => { if (hold) { entered.resolve(); return gate.promise; } } });
  await p.controller.start();
  try {
    const lot = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item => item.enabled && item.quantity.unit === 'g')!;
    const preview = () => p.controller.previewSplit(lot.id, { amount: 1, unit: lot.quantity.unit });
    for (const invalidate of [() => p.controller.invalidateSplitPreview(), () => p.controller.setVisible(false),
      () => p.controller.acceptMenuPatch({ ...p.controller.snapshot().menu!, view_model: { time_label: 'changed' } })]) {
      await preview(); assert.equal(p.controller.snapshot().split_preview?.success, true);
      invalidate(); assert.equal(p.controller.snapshot().split_preview, null);
      p.controller.setVisible(true);
    }
    await p.controller.advance();
    await preview(); await p.controller.save(); assert.equal(p.controller.snapshot().split_preview, null);
    await preview(); await p.controller.load(); assert.equal(p.controller.snapshot().split_preview, null);
    hold = true; const pending = preview(); await entered.promise;
    await assert.rejects(p.controller.confirmSplit(lot.id, { amount: 1, unit: lot.quantity.unit }), /BUSY/);
    p.controller.invalidateSplitPreview();
    gate.resolve(); await pending;
    assert.equal(p.controller.snapshot().split_preview, null);
    hold = false;
    const direct = await p.controller.confirmSplit(lot.id, { amount: 2, unit: lot.quantity.unit });
    assert.equal(direct.split_result?.quantity.amount, 2);
  } finally { await p.controller.dispose(); }
});

test('M3 delayed preview after hide or disposal cannot restore its old result', async () => {
  for (const stop of ['hide', 'dispose'] as const) {
    const gate = deferred<void>(); const entered = deferred<void>(); let hold = false;
    const p = harness({ receiveMenu: true, patch: () => { if (hold) { entered.resolve(); return gate.promise; } } });
    await p.controller.start();
    const lot = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item => item.enabled && item.quantity.unit === 'g')!;
    const before = p.host().requireSession().getSelectableViewModel();
    hold = true; const pending = p.controller.previewSplit(lot.id, { amount: 1, unit: lot.quantity.unit });
    await entered.promise;
    if (stop === 'hide') p.controller.setVisible(false);
    const closing = stop === 'dispose' ? p.controller.dispose() : null;
    gate.resolve(); await pending; if (closing) await closing;
    assert.equal(p.controller.snapshot().split_preview, null);
    if (stop === 'hide') {
      assert.deepEqual(p.host().requireSession().getSelectableViewModel(), before);
      p.controller.setVisible(true); await p.controller.dispose();
    }
  }
});

test('M3 direct split reports untrustworthy or post-dispatch failures as uncertain', async () => {
  for (const fault of ['missing-created', 'patch', 'failed-after-dispatch', 'action-failure', 'contradictory-validation'] as const) {
    let patchFault = false;
    const p = harness({ receiveMenu: true,
      patch: () => { if (patchFault) { patchFault = false; throw new Error('patch-failure'); } },
      intercept: async (command, execute) => {
        const result = await execute();
        if (command.name !== 'menu_confirm_split_direct') return result;
        const menu = result.command_result.snapshot!.menu!;
        if (fault === 'failed-after-dispatch') return { command_result: { ...result.command_result, status: 'failed', error_message: 'render-failed' } };
        const action = fault === 'missing-created' ? { success: true, created_objects: [] }
          : fault === 'action-failure' ? { success: false, status_code: 'ERR_EXAMPLE', created_objects: [] } : menu.last_action_result;
        const validation = fault === 'contradictory-validation'
          ? { action_type: 'split_lot', success: false, status_code: 'ERR_EXAMPLE' } : menu.last_split_validation_result;
        return { command_result: { ...result.command_result, snapshot: { ...result.command_result.snapshot,
          menu: { ...menu, last_action_result: action, last_split_validation_result: validation } } } };
      } });
    await p.controller.start();
    try {
      const lot = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item => item.enabled && item.quantity.unit === 'g')!;
      if (fault === 'patch') patchFault = true;
      const completed = p.controller.snapshot().completed_commands;
      await assert.rejects(p.controller.confirmSplit(lot.id, { amount: 1, unit: lot.quantity.unit }), /SPLIT_RESULT_UNCERTAIN/);
      assert.equal(p.controller.snapshot().completed_commands, completed);
      assert.equal(p.controller.snapshot().split_result, null);
      assert.equal(p.host().requireSession().getSelectableViewModel().splittable_lot_options.find(item => item.id === lot.id)!.quantity.amount, lot.quantity.amount - 1);
    } finally { await p.controller.dispose(); }
  }
});

test('M3 direct split rejects an old success receipt without a new state change', async () => {
  let old: WechatCommandResult | null = null;
  let replay = false;
  const p = harness({ receiveMenu: true, intercept: async (command, execute) => {
    if (command.name !== 'menu_confirm_split_direct') return execute();
    if (replay) return old!;
    old = await execute();
    return old;
  } });
  await p.controller.start();
  try {
    const lot = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item => item.enabled && item.quantity.unit === 'g')!;
    await p.controller.confirmSplit(lot.id, { amount: 1, unit: lot.quantity.unit });
    const before = p.host().requireSession().getSelectableViewModel();
    replay = true;
    await assert.rejects(p.controller.confirmSplit(lot.id, { amount: 1, unit: lot.quantity.unit }), /SPLIT_RESULT_UNCERTAIN/);
    assert.deepEqual(p.host().requireSession().getSelectableViewModel(), before);
    assert.equal(p.controller.snapshot().split_result, null);
  } finally { await p.controller.dispose(); }
});

test('M3 direct split verifies receipt after backgrounding and ignores stale presentation', async () => {
  for (const valid of [false, true]) {
    const gate = deferred<void>(); const entered = deferred<void>();
    const p = harness({ receiveMenu: true, intercept: async (command, execute) => {
      const result = await execute();
      if (command.name !== 'menu_confirm_split_direct') return result;
      entered.resolve(); await gate.promise;
      if (valid) return result;
      return { command_result: { ...result.command_result, snapshot: { ...result.command_result.snapshot,
        menu: { ...result.command_result.snapshot!.menu, last_action_result: { success: true, created_objects: [] } } } } };
    } });
    await p.controller.start();
    try {
      const lot = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item => item.enabled && item.quantity.unit === 'g')!;
      const before = p.controller.snapshot().completed_commands;
      const pending = p.controller.confirmSplit(lot.id, { amount: 1, unit: lot.quantity.unit });
      await entered.promise; p.controller.setVisible(false); gate.resolve();
      if (valid) { await pending; assert.equal(p.controller.snapshot().completed_commands, before + 1); }
      else { await assert.rejects(pending, /SPLIT_RESULT_UNCERTAIN/); assert.equal(p.controller.snapshot().completed_commands, before); }
      assert.equal(p.controller.snapshot().split_result, null);
    } finally { await p.controller.dispose(); }
  }
});
test('M3 public menu drives planting and storage through the real binding; restored session replaces observations', async () => {
  const storage = new InMemorySaveStoragePort();
  const p = harness({ storage, receiveMenu: true });
  await p.controller.start();
  try {
    const initial = p.controller.snapshot();
    const fields = initial.menu!.selectable_view_model!.field_options;
    const seeds = initial.menu!.selectable_view_model!.seed_lot_options;
    const field = fields.find(item => item.enabled)!;
    const seed = seeds.find(item => item.enabled)!;
    assert.ok(field && seed);
    // The exposed menu is detached from internal state, even without a platform clone API.
    const cleanMenu = p.controller.snapshot().menu;
    Reflect.set(field, 'enabled', false);
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.field_options.find(item => item.id === field.id)!.enabled, true);
    const nativeClone = globalThis.structuredClone;
    try {
      Reflect.set(globalThis, 'structuredClone', undefined);
      p.controller.acceptMenuPatch(cleanMenu);
      assert.equal(p.controller.snapshot().menu!.selectable_view_model!.field_options.find(item => item.id === field.id)!.enabled, true);
    } finally { Reflect.set(globalThis, 'structuredClone', nativeClone); }
    await assert.rejects(p.controller.plant('missing-field', seed.id, { amount: 1, unit: seed.quantity.unit }));
    assert.equal(p.controller.snapshot().time_label, initial.time_label);
    await p.controller.plant(field.id, seed.id, { amount: 1, unit: seed.quantity.unit });
    const planted = p.controller.snapshot();
    assert.equal(planted.menu!.selectable_view_model!.field_options.find(item => item.id === field.id)!.enabled, true);
    assert.equal(planted.menu!.selectable_view_model!.field_options.find(item => item.id === field.id)!.available_tiles, 5);
    assert.equal(planted.menu!.selectable_view_model!.seed_lot_options.find(item => item.id === seed.id)!.quantity.amount, seed.quantity.amount - 1);
    await p.controller.save();
    await p.controller.advance();
    await p.controller.load();
    assert.equal(p.controller.snapshot().time_label, planted.time_label);
    assert.deepEqual(p.controller.snapshot().menu!.selectable_view_model, planted.menu!.selectable_view_model);
    assert.equal(p.controller.snapshot().identity!.candidate_id, initial.identity!.candidate_id);
    const menu = p.controller.snapshot().menu!.selectable_view_model!;
    const pair = menu.splittable_lot_options.flatMap(lot => menu.storage_target_options.map(target => ({ lot, target })))
      .find(({ lot, target }) => lot.enabled && target.enabled && lot.storage_ref.container_id !== target.id && target.supported_forms.includes(lot.current_form));
    assert.ok(pair, 'public menu provides a transferable lot and distinct storage target');
    await p.controller.move(pair.lot.id, pair.target.id);
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item => item.id === pair.lot.id)!.storage_ref.container_id, pair.target.id);
    p.controller.setVisible(false);
    await assert.rejects(p.controller.move(pair.lot.id, pair.target.id), /HIDDEN/);
    p.controller.setVisible(true);
    for (let day = 0; day < 10 && !p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.some(item => item.enabled); day++) {
      await p.controller.advanceDay();
    }
    const crop = p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.find(item => item.enabled && item.field_plot_id === field.id);
    assert.ok(crop, 'formal time progression creates a public harvest option');
    await p.controller.harvest(crop.id);
    const harvested = p.controller.snapshot();
    assert.equal(harvested.menu!.selectable_view_model!.field_options.find(item => item.id === field.id)!.enabled, true);
    assert.ok(!harvested.menu!.selectable_view_model!.harvestable_crop_options.some(item => item.id === crop.id));
    const beforeStale = harvested.menu!.selectable_view_model;
    await assert.rejects(p.controller.harvest(crop.id));
    assert.deepEqual(p.controller.snapshot().menu!.selectable_view_model, beforeStale);
    await p.controller.advance();
    assert.equal(p.controller.snapshot().last_error, null);
  } finally {
    await p.controller.dispose();
  }
  assert.equal(p.controller.snapshot().menu, null);
});

test('M3 planting keeps its busy and background guards during a delayed real binding update', async () => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  let hold = false;
  const p = harness({ receiveMenu: true, patch: () => { if (hold) { entered.resolve(); return gate.promise; } } });
  await p.controller.start();
  const menu = p.controller.snapshot().menu!.selectable_view_model!;
  const field = menu.field_options.find(item => item.enabled)!;
  const seed = menu.seed_lot_options.find(item => item.enabled)!;
  hold = true;
  const planting = p.controller.plant(field.id, seed.id, { amount: 1, unit: seed.quantity.unit });
  await entered.promise;
  await assert.rejects(p.controller.plant(field.id, seed.id, { amount: 1, unit: seed.quantity.unit }), /BUSY/);
  p.controller.setVisible(false);
  await assert.rejects(p.controller.harvest('no-crop'), /HIDDEN/);
  gate.resolve();
  await planting;
  const state = p.controller.snapshot();
  assert.equal(state.completed_commands, 1);
  assert.equal(state.menu!.selectable_view_model!.seed_lot_options.find(item => item.id === seed.id)!.quantity.amount, seed.quantity.amount - 1);
  await p.controller.dispose();
});

test('M1 public formal resources start once and one command advances one hour through the binding queue', async () => {
  const gate = deferred<{ resources: WechatResources; identity: unknown }>();
  const original = identity();
  const p = harness({ load: () => gate.promise });
  const first = p.controller.start();
  assert.equal(p.controller.start(), first);
  await assert.rejects(p.controller.advance(), /NOT_READY/);
  gate.resolve({ resources: resources(), identity: original });
  await first;
  assert.equal(p.factories(), 1);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 360');
  const result = await p.controller.advance();
  assert.equal(result.time_label, 'day 1 minute 420');
  assert.equal(result.busy, false);
  assert.equal(result.accepted_commands, 1);
  assert.equal(result.completed_commands, 1);
  assert.equal(result.identity?.candidate_id, original.candidate_id);
  assert.equal(Object.isFrozen(result.identity), true);
  (original as { candidate_id: string }).candidate_id = identity('2').candidate_id;
  assert.notEqual(p.controller.snapshot().identity?.candidate_id, original.candidate_id);
  await p.controller.dispose();
  assert.equal(p.host().hasSession(), false);
  await assert.rejects(p.controller.advance(), /NOT_READY/);
  await assert.rejects(p.controller.start(), /CLOSED/);
});

test('M1 rejects concurrent input and suppresses completion feedback after disposal of an accepted action', async () => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  let hold = false;
  const p = harness({ patch: () => { if (hold) { entered.resolve(); return gate.promise; } } });
  await p.controller.start();
  hold = true;
  const advancing = p.controller.advance();
  await entered.promise;
  await assert.rejects(p.controller.advance(), /BUSY/);
  const closing = p.controller.dispose();
  const countAtClose = p.states.length;
  gate.resolve();
  await Promise.all([advancing, closing]);
  assert.equal(p.states.length, countAtClose);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().accepted_commands, 1);
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.equal(p.host().hasSession(), false);
  assert.equal(p.controller.dispose(), closing);
});

test('M1 resource failure and invalid candidate identity produce no usable half-started host', async () => {
  for (const bad of [null, {}, { ...identity(), short_commit: 'bad' }, { ...identity(), candidate_id: 'wechat-' + '-'.repeat(36) }]) {
    assert.throws(() => readCandidateIdentity(bad), /CANDIDATE_INVALID/);
    const p = harness({ load: async () => ({ resources: resources(), identity: bad }) });
    await assert.rejects(p.controller.start(), /CANDIDATE_INVALID/);
    assert.equal(p.factories(), 0);
    assert.equal(p.controller.snapshot().phase, 'failed');
    await p.controller.dispose();
  }
  const mismatch = harness({ load: async () => ({ resources: resources('different'), identity: identity() }) });
  await assert.rejects(mismatch.controller.start(), /CANDIDATE_BUILD_ID/);
  assert.equal(mismatch.factories(), 0);
  const invalidSchemas = harness({ load: async () => ({ resources: { ...resources(), schemas: {} }, identity: identity() }) });
  await assert.rejects(invalidSchemas.controller.start(), /SCHEMA/);
  assert.equal(invalidSchemas.controller.snapshot().phase, 'failed');
  assert.equal(invalidSchemas.controller.snapshot().has_session, false);
  await invalidSchemas.controller.dispose();
});

test('M1 disposal before asynchronous resource completion never creates a session', async () => {
  const gate = deferred<{ resources: WechatResources; identity: unknown }>();
  const p = harness({ load: () => gate.promise });
  const starting = p.controller.start();
  await p.controller.dispose();
  gate.resolve({ resources: resources(), identity: identity() });
  await starting;
  assert.equal(p.factories(), 0);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().identity, null);
});

test('M1 startup preserves its primary failure and failed state even when binding cleanup also rejects', async () => {
  const input = resources();
  let host: CocosSessionHost | null = null;
  const controller = new WechatProbeController({
    load: async () => ({ resources: input, identity: identity() }),
    createHost: value => {
      host = createStage1AHost({ ...value, snapshot: value.snapshot as RuntimeConfigSnapshot,
        storage: new InMemorySaveStoragePort(), nowIso8601: '2026-11-03T00:00:00.000Z' });
      return host;
    },
    createBinding: () => ({
      mount: async () => { throw new Error('primary-mount-failure'); },
      execute: async () => { throw new Error('not-mounted'); },
      unmount: async () => { throw new Error('cleanup-failure'); }
    })
  });
  await assert.rejects(controller.start(), /primary-mount-failure/);
  assert.equal(controller.snapshot().phase, 'failed');
  assert.equal(controller.snapshot().last_error, 'primary-mount-failure');
  assert.equal(controller.snapshot().has_session, false);
  assert.equal((host as CocosSessionHost | null)?.hasSession(), false);
  await controller.dispose();
});

test('M1 action binding failure preserves the committed world and a later input can recover', async () => {
  let fail = false;
  const p = harness({ patch: () => { if (fail) throw new Error('view-port-failure'); } });
  await p.controller.start();
  fail = true;
  await assert.rejects(p.controller.advance(), /view-port-failure/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().busy, false);
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.match(p.controller.snapshot().last_error!, /view-port-failure/);
  fail = false;
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 480');
  assert.equal(p.controller.snapshot().accepted_commands, 2);
  assert.equal(p.controller.snapshot().completed_commands, 1);
  assert.equal(p.controller.snapshot().last_error, null);
  await p.controller.dispose();
});

test('M1 disposal during delayed startup cleanup cannot overwrite the closed state with a late failure', async () => {
  const cleanup = deferred<void>();
  const entered = deferred<void>();
  const phases: string[] = [];
  let host: CocosSessionHost | null = null;
  const controller = new WechatProbeController({
    load: async () => ({ resources: resources(), identity: identity() }),
    createHost: value => {
      host = createStage1AHost({ ...value, snapshot: value.snapshot as RuntimeConfigSnapshot,
        storage: new InMemorySaveStoragePort(), nowIso8601: '2026-11-03T00:00:00.000Z' });
      return host;
    },
    createBinding: () => ({
      mount: async () => { throw new Error('primary-mount-failure'); },
      execute: async () => { throw new Error('not-mounted'); },
      unmount: async () => { entered.resolve(); await cleanup.promise; }
    }),
    onChange: state => phases.push(state.phase)
  });
  const starting = controller.start();
  await entered.promise;
  await controller.dispose();
  assert.deepEqual(phases, ['loading', 'closed']);
  cleanup.resolve();
  await starting;
  assert.deepEqual(phases, ['loading', 'closed']);
  assert.equal(controller.snapshot().phase, 'closed');
  assert.equal((host as CocosSessionHost | null)?.hasSession(), false);
});

test('M1 identity stays with running candidate B when a public controlled load restores candidate A metadata', async () => {
  const storage = new InMemorySaveStoragePort();
  const a = harness({ storage, identity: identity('1', target.previous) });
  await a.controller.start();
  await a.controller.advance();
  await a.binding().execute({ name: 'save', selection: { slot_id: 'identity_contract' } });
  const savedBytes = await storage.read('identity_contract');
  assert.ok(savedBytes);
  const b = harness({ storage, identity: identity('2') });
  await b.controller.start();
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 360');
  const loaded = await b.binding().execute({ name: 'load', selection: { slot_id: 'identity_contract' } });
  assert.equal(loaded.command_result.status, 'completed');
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(b.controller.snapshot().identity?.candidate_id, identity('2').candidate_id);
  assert.equal(b.controller.snapshot().identity?.build_id, identity('2').build_id);
  assert.equal(await storage.read('identity_contract'), savedBytes);
  await Promise.all([a.controller.dispose(), b.controller.dispose()]);
  const reloaded = harness({ identity: identity('2') });
  await reloaded.controller.start();
  assert.equal(reloaded.controller.snapshot().time_label, 'day 1 minute 360', 'M1 deliberately creates a temporary new session');
  assert.equal(reloaded.controller.snapshot().identity?.candidate_id, identity('2').candidate_id);
  await reloaded.controller.dispose();
});

test('M2 manual save/load restores A state in B while the running B identity stays independent', async () => {
  const storage = new InMemorySaveStoragePort();
  const a = harness({ storage, identity: identity('1') });
  await a.controller.start();
  await a.controller.advance();
  await a.controller.save();
  const saved = await storage.read(WECHAT_SAVE_SLOT_ID);
  assert.ok(saved);
  await a.controller.dispose();
  const b = harness({ storage, identity: identity('2') });
  await b.controller.start();
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 360');
  await b.controller.load();
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(b.controller.snapshot().identity?.candidate_id, identity('2').candidate_id);
  assert.equal(await storage.read(WECHAT_SAVE_SLOT_ID), saved);
  await b.controller.advance();
  assert.equal(b.controller.snapshot().time_label, 'day 1 minute 480');
  await b.controller.dispose();
});

test('M2 empty, invalid, read and write failures preserve session and allow healthy retry', async () => {
  const delegate = new InMemorySaveStoragePort();
  let failRead = false;
  let failWrite = false;
  const storage: SaveStoragePort = {
    read: async slot => { if (failRead) throw new Error('injected-read-failure'); return delegate.read(slot); },
    write: async (slot, data) => { if (failWrite) throw new Error('injected-write-failure'); return delegate.write(slot, data); }
  };
  const p = harness({ storage });
  await p.controller.start();
  await p.controller.advance();
  await assert.rejects(p.controller.load(), /SAVE_SLOT_NOT_FOUND/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  await delegate.write(WECHAT_SAVE_SLOT_ID, '{broken');
  await assert.rejects(p.controller.load(), /LOAD_REJECTED/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  failRead = true;
  await assert.rejects(p.controller.load(), /injected-read-failure/);
  failRead = false;
  failWrite = true;
  await assert.rejects(p.controller.save(), /injected-write-failure/);
  assert.equal(await delegate.read(WECHAT_SAVE_SLOT_ID), '{broken');
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  failWrite = false;
  await p.controller.save();
  await p.controller.advance();
  await p.controller.load();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().last_error, null);
  await p.controller.dispose();
});

test('WeChat outer shows the empty primary slot as guidance but preserves real failures and command semantics', async () => {
  const bundled = await build({
    entryPoints: ['apps/cocos-wechat-probe/template/assets/scripts/CocosWechatProbe.ts'],
    bundle: true, write: false, platform: 'node', format: 'esm',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    plugins: [{ name: 'cocos-test-ports', setup(builder) {
      builder.onResolve({ filter: /^cc$/ }, () => ({ path: 'cc', namespace: 'test-ports' }));
      builder.onResolve({ filter: /generated\/probe-runtime\.js$/ }, () => ({ path: 'runtime', namespace: 'test-ports' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-ports' }, args => ({ contents: args.path === 'cc'
        ? `export class Component { constructor() { this.node = {}; } }
           export const _decorator = { ccclass: () => value => value };
           export const isValid = () => true;
           export const Button = {}, Camera = {}, Canvas = {}, Color = {}, EditBox = {}, Game = {}, game = {}, Graphics = {}, JsonAsset = {}, Label = {}, Layers = {}, Node = {}, resources = {}, ResolutionPolicy = {}, screen = {}, sys = {}, UITransform = {}, view = {};`
        : 'export const createStage1AHost = () => {}; export class QinglanUiSceneProbeComponent {}', loader: 'js' }));
    } }]
  });
  const { CocosWechatProbe } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0]!.text).toString('base64'));
  const probe = new CocosWechatProbe();
  probe.labels = Object.fromEntries(['candidate', 'commit', 'time', 'status', 'result', 'hint'].map(name => [name, { string: '' }]));
  const values = new Map<string, string>([[WECHAT_SAVE_BACKUP_KEY, 'preserve-existing-backup']]);
  let readError: string | null = null;
  let writeError: string | null = null;
  const platform = {
    get length() { if (readError) throw new Error(readError); return values.size; },
    key(index: number) { return Array.from(values.keys())[index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (writeError) throw new Error(writeError); values.set(key, value); },
    removeItem(key: string) { values.delete(key); }
  };
  const actualStorage = new WechatSaveStoragePort(() => platform, async () => {});
  let delayedRead: Promise<void> | null = null;
  const storage: SaveStoragePort = {
    read: async slot => { if (delayedRead) await delayedRead; return actualStorage.read(slot); },
    write: (slot, value) => actualStorage.write(slot, value)
  };
  let onFinished: ((snapshot: WechatProbeSnapshot) => void) | null = null;
  const p = harness({ storage, onChange: state => { probe.render(state); onFinished?.(state); } });
  probe.controller = p.controller;
  await p.controller.start();
  await p.controller.advance();
  const click = async (action: () => void) => {
    const accepted = p.controller.snapshot().accepted_commands + 1;
    const finished = new Promise<void>(resolve => {
      onFinished = state => { if (!state.busy && state.accepted_commands >= accepted) resolve(); };
    });
    action();
    await finished;
    onFinished = null;
    await new Promise(resolve => setImmediate(resolve));
  };
  const infos: unknown[][] = [];
  const errors: unknown[][] = [];
  const oldInfo = console.info;
  const oldError = console.error;
  console.info = (...args: unknown[]) => { infos.push(args); };
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const completed = p.controller.snapshot().completed_commands;
    await click(() => probe.onRead());
    assert.equal(probe.labels.status.string, '未找到主存档；无备份时可先保存');
    assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
    assert.equal(p.controller.snapshot().completed_commands, completed);
    assert.equal(p.controller.snapshot().last_error, 'ERR_SAVE_SLOT_NOT_FOUND:wechat_probe');
    assert.ok(infos.some(args => args[0] === '[wechat-m2] empty-save-slot'));
    assert.equal(errors.length, 0);

    await click(() => probe.onSave());
    assert.equal(p.controller.snapshot().last_error, 'ERR_WECHAT_SAVE_BACKUP_CONFLICT');
    assert.equal(values.get(WECHAT_SAVE_BACKUP_KEY), 'preserve-existing-backup');
    assert.equal(values.has(WECHAT_SAVE_STORAGE_KEY), false);
    values.delete(WECHAT_SAVE_BACKUP_KEY);

    for (const message of ['ERR_WECHAT_STORAGE_UNAVAILABLE', 'ERR_SAVE_LOAD_REJECTED',
      'ERR_WECHAT_BACKUP_RESTORED_RESULT_UNCERTAIN:ERR_SAVE_SLOT_NOT_FOUND:wechat_probe',
      'ERR_SAVE_SLOT_NOT_FOUND:other_slot', 'ERR_SAVE_SLOT_NOT_FOUND:wechat_probe']) {
      readError = message;
      await click(() => probe.onRead());
      assert.notEqual(probe.labels.status.string, '未找到主存档；无备份时可先保存', message);
      assert.equal(errors.at(-1)?.[0], '[wechat-m2] load-failed', message);
      if (message === 'ERR_SAVE_SLOT_NOT_FOUND:wechat_probe') {
        assert.equal(p.controller.snapshot().last_error, 'ERR_WECHAT_STORAGE_READ_FAILED');
      }
    }
    readError = null;
    values.set(WECHAT_SAVE_STORAGE_KEY, '{broken');
    await click(() => probe.onRead());
    assert.notEqual(probe.labels.status.string, '未找到主存档；无备份时可先保存');
    assert.equal(values.get(WECHAT_SAVE_STORAGE_KEY), '{broken');
    values.delete(WECHAT_SAVE_STORAGE_KEY);
    writeError = 'ERR_SAVE_SLOT_NOT_FOUND:wechat_probe';
    await click(() => probe.onSave());
    assert.equal(probe.labels.status.string, '操作失败，请查看日志', 'other operations do not present a read-specific hint');
    assert.equal(errors.at(-1)?.[0], '[wechat-m2] save-failed');
    writeError = null;
    await click(() => probe.onSave());
    assert.equal(probe.labels.status.string, '状态: ready');
    assert.equal(p.controller.snapshot().completed_commands, completed + 1);

    values.delete(WECHAT_SAVE_STORAGE_KEY);
    const readGate = deferred<void>();
    delayedRead = readGate.promise;
    const reading = click(() => probe.onRead());
    assert.equal(p.controller.snapshot().busy, true);
    probe.onSave();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors.at(-1)?.[0], '[wechat-m2] save-failed');
    assert.match(String(errors.at(-1)?.[1]), /ERR_WECHAT_PROBE_BUSY/);
    readGate.resolve();
    await reading;
    delayedRead = null;
    assert.equal(p.controller.snapshot().last_error, 'ERR_SAVE_SLOT_NOT_FOUND:wechat_probe');
    assert.equal(probe.labels.status.string, '未找到主存档；无备份时可先保存');
    assert.equal(infos.at(-1)?.[0], '[wechat-m2] empty-save-slot');
  } finally {
    console.info = oldInfo;
    console.error = oldError;
    await p.controller.dispose();
  }
});

test('M2 background blocks new commands, allows in-flight completion and foreground does not auto-save or advance', async () => {
  const delegate = new InMemorySaveStoragePort();
  const gate = deferred<void>();
  const entered = deferred<void>();
  let writes = 0;
  let reads = 0;
  const storage: SaveStoragePort = {
    read: async slot => { reads++; return delegate.read(slot); },
    write: async (slot, data) => { writes++; entered.resolve(); await gate.promise; await delegate.write(slot, data); }
  };
  const p = harness({ storage });
  await p.controller.start();
  const saving = p.controller.save();
  await entered.promise;
  await assert.rejects(p.controller.advance(), /BUSY/);
  p.controller.setVisible(false);
  await assert.rejects(p.controller.advance(), /HIDDEN/);
  await assert.rejects(p.controller.load(), /HIDDEN/);
  gate.resolve();
  await saving;
  assert.equal(p.controller.snapshot().visible, false);
  assert.equal(p.controller.snapshot().busy, false);
  p.controller.setVisible(true);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 360');
  assert.equal(writes, 1);
  assert.equal(reads, 0);
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  await p.controller.dispose();
});

test('M2 cannot report storage success for a completed command with a missing or wrong per-command receipt', async () => {
  let mode: 'missing' | 'wrong' | 'normal' = 'missing';
  const controller = new WechatProbeController({
    load: async () => ({ resources: resources(), identity: identity() }),
    createHost: value => createStage1AHost({ ...value, snapshot: value.snapshot as RuntimeConfigSnapshot,
      storage: new InMemorySaveStoragePort(), nowIso8601: '2026-11-03T00:00:00.000Z' }),
    createBinding: host => {
      const binding = new QinglanUiSceneProbeComponent(host as CocosSessionHost, { applyNodeBindingPatch: () => {} });
      return {
        mount: () => binding.mount(),
        unmount: () => binding.unmount(),
        execute: command => {
          if (mode === 'missing') return Promise.resolve({ command_result: { status: 'completed' } });
          if (mode === 'wrong') return Promise.resolve({ command_result: { status: 'completed',
            snapshot: { save_load: { last_save_result: { slot_id: 'other' } } } } });
          return binding.execute(command);
        }
      };
    }
  });
  await controller.start();
  await assert.rejects(controller.save(), /STORAGE_FAILED/);
  mode = 'wrong';
  await assert.rejects(controller.save(), /STORAGE_FAILED/);
  assert.equal(controller.snapshot().completed_commands, 0);
  mode = 'normal';
  await controller.save();
  assert.equal(controller.snapshot().completed_commands, 1);
  await controller.dispose();
});

test('M2 disposal suppresses late UI completion for a save already accepted by the storage port', async () => {
  const gate = deferred<void>();
  const entered = deferred<void>();
  const delegate = new InMemorySaveStoragePort();
  const p = harness({ storage: {
    read: slot => delegate.read(slot),
    write: async (slot, value) => { entered.resolve(); await gate.promise; await delegate.write(slot, value); }
  } });
  await p.controller.start();
  const saving = p.controller.save();
  await entered.promise;
  const closing = p.controller.dispose();
  const notifications = p.states.length;
  gate.resolve();
  await Promise.all([saving, closing]);
  assert.equal(p.states.length, notifications);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.ok(await delegate.read(WECHAT_SAVE_SLOT_ID), 'an accepted in-flight write is not claimed to be cancelled');
  assert.equal(p.host().hasSession(), false);
});

test('M2 explicitly loads a validated backup and protects the healthy session from bad or rejected backup reads', async () => {
  const delegate = new InMemorySaveStoragePort();
  let backupRead: 'normal' | 'corrupt' | 'reject' = 'normal';
  let recoveries = 0;
  let failRecovery = false;
  let stateProbe = '';
  const storage: SaveStoragePort = {
    read: async slot => {
      if (slot === WECHAT_BACKUP_SLOT_ID && backupRead === 'reject') throw new Error('backup-read-failed');
      if (slot === WECHAT_BACKUP_SLOT_ID && backupRead === 'corrupt') return '{invalid-backup';
      return delegate.read(slot);
    },
    write: async (slot, value) => {
      if (slot === 'state_probe') { stateProbe = value; return; }
      assert.equal(slot, WECHAT_SAVE_SLOT_ID);
      const old = await delegate.read(slot);
      if (old !== null) await delegate.write(WECHAT_BACKUP_SLOT_ID, old);
      await delegate.write(slot, value);
    }
  };
  const p = harness({ storage, identity: identity('2'), prepareBackupRecovery: async () => {
    const input = resources();
    const host = createStage1AHost({ ...input, snapshot: input.snapshot as RuntimeConfigSnapshot,
      storage: { read: () => storage.read(WECHAT_BACKUP_SLOT_ID), write: async () => { throw new Error('read only'); } },
      nowIso8601: '2026-11-03T00:00:00.000Z' });
    try { await host.requireSession().load(WECHAT_BACKUP_SLOT_ID); }
    finally { host.destroySession(); }
  }, recoverValidatedBackup: async () => {
    recoveries++;
    if (failRecovery) throw new Error('promotion-failed');
    const backup = await delegate.read(WECHAT_BACKUP_SLOT_ID);
    assert.ok(backup);
    await delegate.write(WECHAT_SAVE_SLOT_ID, backup);
  } });
  await p.controller.start();
  await assert.rejects(p.controller.loadBackup(), /SAVE_SLOT_NOT_FOUND/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 360');
  assert.equal(recoveries, 0);
  await p.controller.advance();
  await p.controller.save();
  await p.controller.advance();
  await p.controller.save();
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 540');
  await p.host().requireSession().save('state_probe');
  const healthyState = stateProbe;
  backupRead = 'reject';
  await assert.rejects(p.controller.loadBackup(), /backup-read-failed/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 540');
  await p.host().requireSession().save('state_probe');
  assert.equal(stateProbe, healthyState);
  backupRead = 'corrupt';
  await assert.rejects(p.controller.loadBackup(), /LOAD_REJECTED/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 540');
  await p.host().requireSession().save('state_probe');
  assert.equal(stateProbe, healthyState);
  assert.equal(recoveries, 0, 'invalid or rejected backup never invokes recovery');
  backupRead = 'normal';
  failRecovery = true;
  const beforeFailure = p.controller.snapshot().completed_commands;
  await assert.rejects(p.controller.loadBackup(), /BACKUP_RECOVERY_INCOMPLETE:promotion-failed/);
  assert.equal(p.controller.snapshot().completed_commands, beforeFailure);
  assert.equal(p.controller.snapshot().busy, false);
  assert.match(p.controller.snapshot().last_error!, /BACKUP_RECOVERY_INCOMPLETE/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 540');
  await p.host().requireSession().save('state_probe');
  assert.equal(stateProbe, healthyState, 'failed promotion leaves the full current session intact');
  failRecovery = false;
  await p.controller.loadBackup();
  assert.equal(recoveries, 2);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().identity?.candidate_id, identity('2').candidate_id);
  assert.equal(p.controller.snapshot().last_error, null);
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 480');
  await p.controller.dispose();
});

test('M2 backup recovery requires a recovery callback and remains busy while promotion is pending', async () => {
  const missing = harness();
  await missing.controller.start();
  await assert.rejects(missing.controller.loadBackup(), /BACKUP_RECOVERY_UNAVAILABLE/);
  assert.equal(missing.controller.snapshot().time_label, 'day 1 minute 360');
  assert.equal(missing.controller.snapshot().accepted_commands, 0);
  await missing.controller.dispose();

  const storage = new InMemorySaveStoragePort();
  const old = harness({ storage });
  await old.controller.start();
  await old.controller.advance();
  await old.controller.save();
  const oldBytes = await storage.read(WECHAT_SAVE_SLOT_ID);
  assert.ok(oldBytes);
  await storage.write(WECHAT_BACKUP_SLOT_ID, oldBytes);
  await old.controller.dispose();
  const gate = deferred<void>();
  const entered = deferred<void>();
  const p = harness({ storage, prepareBackupRecovery: async () => {}, recoverValidatedBackup: async () => { entered.resolve(); await gate.promise; } });
  await p.controller.start();
  const loading = p.controller.loadBackup();
  await entered.promise;
  assert.equal(p.controller.snapshot().busy, true);
  await assert.rejects(p.controller.advance(), /BUSY/);
  await assert.rejects(p.controller.save(), /BUSY/);
  const closing = p.controller.dispose();
  const notifications = p.states.length;
  gate.resolve();
  await Promise.all([loading, closing]);
  assert.equal(p.states.length, notifications);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.equal(p.host().hasSession(), false);

  const readGate = deferred<void>();
  const readEntered = deferred<void>();
  let promotions = 0;
  const gatedStorage: SaveStoragePort = {
    read: async slot => { readEntered.resolve(); await readGate.promise; return storage.read(slot); },
    write: (slot, value) => storage.write(slot, value)
  };
  const late = harness({ storage: gatedStorage,
    prepareBackupRecovery: async () => { await gatedStorage.read(WECHAT_BACKUP_SLOT_ID); },
    recoverValidatedBackup: async () => { promotions++; } });
  await late.controller.start();
  const lateLoad = late.controller.loadBackup();
  await readEntered.promise;
  const lateClosing = late.controller.dispose();
  readGate.resolve();
  await Promise.all([lateLoad, lateClosing]);
  assert.equal(promotions, 0, 'a disposed controller must not start a late promotion');
  assert.equal(late.controller.snapshot().phase, 'closed');
});

test('M2 checks pending recovery inside the busy lock before reading a backup or changing the session', async () => {
  let reads = 0;
  let recovered = 0;
  let mode: 'not-pending' | 'error' | 'wait' = 'not-pending';
  const entered = deferred<void>();
  const gate = deferred<void>();
  const delegate = new InMemorySaveStoragePort();
  const storage: SaveStoragePort = {
    read: async slot => { reads++; return delegate.read(slot); },
    write: (slot, value) => delegate.write(slot, value)
  };
  const p = harness({ storage, prepareBackupRecovery: async () => {
    if (mode === 'not-pending') throw new Error('ERR_WECHAT_RECOVERY_NOT_PENDING');
    if (mode === 'error') throw new Error('prepare-rejected');
    entered.resolve();
    await gate.promise;
  }, recoverValidatedBackup: async () => { recovered++; } });
  await p.controller.start();
  await p.controller.advance();
  await assert.rejects(p.controller.loadBackup(), /RECOVERY_NOT_PENDING/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(reads, 0);
  assert.equal(recovered, 0);
  mode = 'error';
  await assert.rejects(p.controller.loadBackup(), /prepare-rejected/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.match(p.controller.snapshot().last_error!, /prepare-rejected/);
  assert.equal(p.controller.snapshot().busy, false);
  assert.equal(reads, 0);
  assert.equal(recovered, 0);
  mode = 'wait';
  const loading = p.controller.loadBackup();
  await entered.promise;
  assert.equal(p.controller.snapshot().busy, true);
  await assert.rejects(p.controller.advance(), /BUSY/);
  const closing = p.controller.dispose();
  gate.resolve();
  await Promise.all([loading, closing]);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(reads, 0, 'disposal during preparation must not start a late load');
  assert.equal(recovered, 0);
});

test('M2 rejects backup recovery without both preparation and validated recovery callbacks', async () => {
  for (const options of [
    { prepareBackupRecovery: async () => {} },
    { recoverValidatedBackup: async () => {} }
  ]) {
    const p = harness(options);
    await p.controller.start();
    await assert.rejects(p.controller.loadBackup(), /BACKUP_RECOVERY_UNAVAILABLE/);
    assert.equal(p.controller.snapshot().accepted_commands, 0);
    assert.equal(p.controller.snapshot().time_label, 'day 1 minute 360');
    await p.controller.dispose();
  }
});

test('M2 reports a failed final load separately after successful storage recovery and preserves the whole session', async () => {
  let stateProbe = '';
  let promoted = false;
  let playerReads = 0;
  const storage: SaveStoragePort = {
    read: async () => { playerReads++; throw new Error('final-main-read-failed'); },
    write: async (slot, value) => { assert.equal(slot, 'state_probe'); stateProbe = value; }
  };
  const p = harness({ storage, prepareBackupRecovery: async () => {}, recoverValidatedBackup: async () => { promoted = true; } });
  await p.controller.start();
  await p.controller.advance();
  await p.host().requireSession().save('state_probe');
  const before = stateProbe;
  const completed = p.controller.snapshot().completed_commands;
  await assert.rejects(p.controller.loadBackup(), /BACKUP_RESTORED_RESULT_UNCERTAIN:final-main-read-failed/);
  assert.equal(promoted, true);
  assert.equal(playerReads, 1);
  assert.equal(p.controller.snapshot().completed_commands, completed);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  await p.host().requireSession().save('state_probe');
  assert.equal(stateProbe, before);
  assert.match(p.controller.snapshot().last_error!, /BACKUP_RESTORED_RESULT_UNCERTAIN/);
  await p.controller.dispose();
});

test('M2 binding patch failure after recovered load reports uncertainty because the session may already be replaced', async () => {
  const storage = new InMemorySaveStoragePort();
  let failPatch = false;
  const p = harness({ storage, prepareBackupRecovery: async () => {}, recoverValidatedBackup: async () => {},
    patch: () => { if (failPatch) throw new Error('binding-patch-failed'); } });
  await p.controller.start();
  await p.controller.advance();
  await p.controller.save();
  await p.controller.advance();
  await p.host().requireSession().save('state_before');
  const before = await storage.read('state_before');
  const completed = p.controller.snapshot().completed_commands;
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 480');
  failPatch = true;
  await assert.rejects(p.controller.loadBackup(), /BACKUP_RESTORED_RESULT_UNCERTAIN:binding-patch-failed/);
  assert.equal(p.controller.snapshot().completed_commands, completed);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  await p.host().requireSession().save('state_after');
  assert.notEqual(await storage.read('state_after'), before, 'the session was committed before the patch rejected');
  assert.match(p.controller.snapshot().last_error!, /BACKUP_RESTORED_RESULT_UNCERTAIN/);
  failPatch = false;
  await p.controller.dispose();
});

test('M2 explicit first-save cancellation preserves the session and reports callback failures', async () => {
  const missing = harness();
  await missing.controller.start();
  await assert.rejects(missing.controller.cancelFirstFailedSave(), /FIRST_CANCEL_UNAVAILABLE/);
  assert.equal(missing.controller.snapshot().accepted_commands, 0);
  await missing.controller.dispose();

  let calls = 0;
  let shouldFail = true;
  const p = harness({ cancelFirstFailedSave: async () => {
    calls++;
    if (shouldFail) throw new Error('cancel-rejected');
  } });
  await p.controller.start();
  await p.controller.advance();
  p.controller.setVisible(false);
  await assert.rejects(p.controller.cancelFirstFailedSave(), /HIDDEN/);
  assert.equal(calls, 0);
  p.controller.setVisible(true);
  const previousCompletions = p.controller.snapshot().completed_commands;
  await assert.rejects(p.controller.cancelFirstFailedSave(), /cancel-rejected/);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().completed_commands, previousCompletions);
  assert.match(p.controller.snapshot().last_error!, /cancel-rejected/);
  assert.equal(p.controller.snapshot().busy, false);
  shouldFail = false;
  await p.controller.cancelFirstFailedSave();
  assert.equal(calls, 2);
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 420');
  assert.equal(p.controller.snapshot().completed_commands, previousCompletions + 1);
  assert.equal(p.controller.snapshot().last_error, null);
  await p.controller.advance();
  assert.equal(p.controller.snapshot().time_label, 'day 1 minute 480');
  await p.controller.dispose();
  await assert.rejects(p.controller.cancelFirstFailedSave(), /NOT_READY/);
});

test('M2 explicit first-save cancellation shares the busy lock and suppresses late success after disposal', async () => {
  const entered = deferred<void>();
  const gate = deferred<void>();
  let calls = 0;
  const p = harness({ cancelFirstFailedSave: async () => { calls++; entered.resolve(); await gate.promise; } });
  await p.controller.start();
  const cancellation = p.controller.cancelFirstFailedSave();
  await entered.promise;
  assert.equal(p.controller.snapshot().busy, true);
  await assert.rejects(p.controller.cancelFirstFailedSave(), /BUSY/);
  await assert.rejects(p.controller.advance(), /BUSY/);
  assert.equal(calls, 1);
  const closing = p.controller.dispose();
  const notifications = p.states.length;
  gate.resolve();
  await Promise.all([cancellation, closing]);
  assert.equal(p.states.length, notifications);
  assert.equal(p.controller.snapshot().phase, 'closed');
  assert.equal(p.controller.snapshot().completed_commands, 0);
  assert.equal(p.host().hasSession(), false);
});


test('M3 grouped sowing validates independently and three failed seeds release one planting position after reveal', async () => {
  const storage = new InMemorySaveStoragePort();
  const p = harness({ storage, receiveMenu: true, randomSeed: 'farming-test-28' });
  await p.controller.start();
  const capture = async () => { await p.host().requireSession().save('probability-audit'); return storage.read('probability-audit'); };
  try {
    const menu = p.controller.snapshot().menu!.selectable_view_model!;
    const field = menu.field_options[0]; const seed = menu.seed_lot_options[0];
    const before = await capture();
    for (const [total, perTile] of [[4, 3], [1.5, 1], [12, 3], [4, 4], [3, 0]]) {
      await assert.rejects(p.controller.plant(field.id, seed.id, { amount: total, unit: 'count' }, perTile));
      assert.equal(await capture(), before, 'invalid grouping and insufficient seed cannot change world state or random stream');
    }
    await p.controller.plant(field.id, seed.id, { amount: 3, unit: 'count' }, 3);
    let current = p.controller.snapshot().menu!.selectable_view_model!;
    assert.equal(current.field_options[0].available_tiles, 5);
    assert.equal(current.field_options[0].active_crop_count, 1);
    assert.equal(current.seed_lot_options[0].quantity.amount, seed.quantity.amount - 3);
    assert.deepEqual(current.crop_status_options!.map(item => [item.lifecycle_status, item.growth_stage]), [['active', 'seed']]);
    assert.equal(JSON.stringify(current).includes('germination'), false);
    await p.controller.save(); await p.controller.load();
    assert.deepEqual(p.controller.snapshot().menu!.selectable_view_model!.crop_status_options, current.crop_status_options);
    await p.controller.advanceDay();
    current = p.controller.snapshot().menu!.selectable_view_model!;
    assert.deepEqual(current.crop_status_options!.map(item => [item.lifecycle_status, item.growth_stage]), [['failed', 'withered']]);
    assert.equal(current.harvestable_crop_options.length, 0);
    assert.equal(current.field_options[0].available_tiles, 6);
    assert.equal(current.field_options[0].active_crop_count, 0);
    assert.equal(p.controller.snapshot().last_error, null, 'a germination failure is gameplay, not a program error');
    const failureBeforeHarvest = await capture();
    await assert.rejects(p.controller.harvest(current.crop_status_options![0].id));
    assert.equal(await capture(), failureBeforeHarvest);
    await p.controller.plant(field.id, seed.id, { amount: 4, unit: 'count' }, 2);
    current = p.controller.snapshot().menu!.selectable_view_model!;
    assert.equal(current.field_options[0].active_crop_count, 2);
    assert.equal(current.field_options[0].available_tiles, 4);
    assert.equal(current.seed_lot_options[0].quantity.amount, seed.quantity.amount - 7);
    assert.equal(current.crop_status_options!.filter(item => item.lifecycle_status === 'failed').length, 1, 'failed sowing remains visible as history');
  } finally { await p.controller.dispose(); }
});

test('M3 whole cabbage merge and count split use direct commands and preserve piece identities', async () => {
  const commands: string[] = [];
  const p = harness({ receiveMenu: true, intercept: async (command, execute) => { commands.push(command.name); return execute(); } });
  await p.controller.start();
  try {
    const menu = p.controller.snapshot().menu!.selectable_view_model!;
    await p.controller.plant(menu.field_options.find(item => item.enabled)!.id, menu.seed_lot_options.find(item => item.enabled)!.id, { amount: 2, unit: 'count' });
    for (let i = 0; i < 4; i++) await p.controller.advanceDay();
    const crops = p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.filter(item => item.enabled);
    assert.equal(crops.length, 2);
    for (const crop of crops) await p.controller.harvest(crop.id);
    const cabbages = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.filter(item => item.base_id === 'cabbage' && item.cabbage_pieces?.kind === 'whole');
    assert.equal(cabbages.length, 2);
    const before = commands.length;
    const merged = await p.controller.confirmMerge(cabbages[0].id, cabbages[1].id);
    assert.deepEqual(commands.slice(before), ['menu_confirm_merge_direct'], 'merge directly validates and dispatches without preview');
    assert.equal(merged.merge_result?.targetLotId, cabbages[1].id);
    const joined = merged.menu!.selectable_view_model!.splittable_lot_options.find(item => item.id === cabbages[1].id)!;
    assert.equal(joined.cabbage_pieces?.kind, 'whole');
    if (joined.cabbage_pieces?.kind !== 'whole') throw new Error('whole cabbage expected');
    assert.equal(joined.cabbage_pieces.pieces.length, 2);
    const ids = joined.cabbage_pieces.pieces.map(item => item.id);
    const splitStart = commands.length;
    const split = await p.controller.confirmSplit(joined.id, { amount: 1, unit: 'count' });
    assert.deepEqual(commands.slice(splitStart), ['menu_confirm_split_direct']);
    assert.equal(split.split_result?.pieceCount, 1);
    assert.equal(split.split_result?.remainingPieceCount, 1);
    const after = split.menu!.selectable_view_model!.splittable_lot_options;
    const taken = after.find(item => item.id === split.split_result!.newLotId)!;
    const remain = after.find(item => item.id === joined.id)!;
    assert.equal(taken.cabbage_pieces?.kind, 'whole');
    assert.equal(remain.cabbage_pieces?.kind, 'whole');
    if (taken.cabbage_pieces?.kind !== 'whole' || remain.cabbage_pieces?.kind !== 'whole') throw new Error('whole cabbage expected');
    assert.deepEqual([taken.cabbage_pieces.pieces[0].id, remain.cabbage_pieces.pieces[0].id], ids);
    assert.equal(taken.quantity.amount + remain.quantity.amount, joined.quantity.amount);
  } finally { await p.controller.dispose(); }
});

test('M3 merge isolates malformed success receipts and never retries after dispatch', async () => {
  for (const mode of ['missing-source', 'duplicate-update', 'wrong-weight'] as const) {
    let mergeCommands = 0;
    const p = harness({ receiveMenu: true, intercept: async (command, execute) => {
      const result = await execute();
      if (command.name !== 'menu_confirm_merge_direct') return result;
      mergeCommands++;
      const copy = structuredClone(result) as any;
      const updates = copy.command_result.snapshot.menu.last_action_result.updated_objects;
      const sourceIndex = updates.findIndex((item: any) => item.object_id === command.selection.source_lot_option_id);
      const targetIndex = updates.findIndex((item: any) => item.object_id === command.selection.target_lot_option_id);
      if (mode === 'missing-source') updates.splice(sourceIndex, 1);
      if (mode === 'duplicate-update') updates.push(structuredClone(updates[sourceIndex]));
      if (mode === 'wrong-weight') updates[targetIndex].summary.quantity.amount++;
      return copy;
    } });
    await p.controller.start();
    try {
      const menu = p.controller.snapshot().menu!.selectable_view_model!;
      await p.controller.plant(menu.field_options.find(item => item.enabled)!.id, menu.seed_lot_options.find(item => item.enabled)!.id, { amount: 2, unit: 'count' });
      for (let i = 0; i < 4; i++) await p.controller.advanceDay();
      for (const crop of p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.filter(item => item.enabled)) await p.controller.harvest(crop.id);
      const cabbages = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.filter(item => item.base_id === 'cabbage' && item.cabbage_pieces?.kind === 'whole');
      assert.equal(cabbages.length, 2);
      await assert.rejects(p.controller.confirmMerge(cabbages[0].id, cabbages[1].id), /ERR_WECHAT_MERGE_RESULT_UNCERTAIN/);
      assert.equal(mergeCommands, 1);
      assert.equal(p.controller.snapshot().merge_result, null);
      assert.equal(p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.some(item => item.id === cabbages[0].id), false, 'formal merge committed; uncertainty is not called rollback');
    } finally { await p.controller.dispose(); }
  }
});

test('M3 count split isolates missing roles, duplicate IDs and inconsistent quantities after formal dispatch', async () => {
  for (const mode of ['missing-role', 'duplicate-id', 'wrong-weight'] as const) {
    let corrupt = false;
    let splitCommands = 0;
    const p = harness({ receiveMenu: true, intercept: async (command, execute) => {
      const result = await execute();
      if (command.name !== 'menu_confirm_split_direct') return result;
      splitCommands++;
      if (!corrupt) return result;
      const copy = structuredClone(result) as any;
      const created = copy.command_result.snapshot.menu.last_action_result.created_objects;
      if (mode === 'missing-role') delete created[0].summary.split_role;
      if (mode === 'duplicate-id') created.push(structuredClone(created[0]));
      if (mode === 'wrong-weight') created[0].summary.quantity.amount++;
      return copy;
    } });
    await p.controller.start();
    try {
      const menu = p.controller.snapshot().menu!.selectable_view_model!;
      await p.controller.plant(menu.field_options.find(item => item.enabled)!.id, menu.seed_lot_options.find(item => item.enabled)!.id, { amount: 1, unit: 'count' });
      for (let i = 0; i < 4; i++) await p.controller.advanceDay();
      const crop = p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.find(item => item.enabled)!;
      await p.controller.harvest(crop.id);
      const lot = p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item => item.base_id === 'cabbage' && item.cabbage_pieces?.kind === 'whole')!;
      corrupt = true;
      await assert.rejects(p.controller.confirmSplit(lot.id, { amount: 1, unit: 'count' }), /ERR_WECHAT_SPLIT_RESULT_UNCERTAIN/);
      assert.equal(splitCommands, 1, 'uncertainty never automatically resubmits');
      assert.equal(p.controller.snapshot().split_result, null);
      assert.equal(p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.some(item => item.id === lot.id), false, 'formal split already committed; failure is not claimed as rollback');
    } finally { await p.controller.dispose(); }
  }
});

test('M3 planting rejects ten positions, reveals six sowing outcomes and harvest obeys a controlled physical storage capacity', async () => {
  const storage = new InMemorySaveStoragePort();
  const fixture = resources();
  const config = (fixture.snapshot as RuntimeConfigSnapshot).loaded_documents['configs/storage/physical_capacity_policies.yaml'] as { initial_container_limits: Record<string, { mass_g: number; volume_ml: number }> };
  config.initial_container_limits.home_room_temp_01 = { mass_g: 3500, volume_ml: 100000 };
  const p = harness({ storage, receiveMenu: true, load: async () => ({ resources: fixture, identity: identity() }) });
  await p.controller.start();
  const capture = async () => { await p.host().requireSession().save('quantity-audit'); return storage.read('quantity-audit'); };
  try {
    const menu = p.controller.snapshot().menu!.selectable_view_model!;
    const field = menu.field_options.find(item => item.enabled)!;
    const seed = menu.seed_lot_options.find(item => item.enabled)!;
    assert.equal(field.capacity_tiles, 6); assert.equal(field.available_tiles, 6);
    const before = await capture();
    await assert.rejects(p.controller.plant(field.id, seed.id, { amount: 10, unit: seed.quantity.unit }));
    assert.equal(await capture(), before, 'over-capacity rejection leaves the entire serialized save unchanged');
    await p.controller.plant(field.id, seed.id, { amount: 2, unit: seed.quantity.unit });
    let after = p.controller.snapshot().menu!.selectable_view_model!;
    assert.equal(after.field_options[0].available_tiles, 4);
    assert.equal(after.field_options[0].active_crop_count, 2);
    assert.equal(after.field_options[0].enabled, true);
    await p.controller.plant(field.id, seed.id, { amount: 4, unit: seed.quantity.unit });
    after = p.controller.snapshot().menu!.selectable_view_model!;
    assert.equal(after.field_options[0].available_tiles, 0);
    assert.equal(after.field_options[0].active_crop_count, 6);
    assert.equal(after.field_options[0].enabled, false);
    assert.equal(after.seed_lot_options.find(item => item.id === seed.id)!.quantity.amount, seed.quantity.amount - 6);
    await p.controller.save(); await p.controller.load();
    for (let i = 0; i < 4; i++) await p.controller.advanceDay();
    const crops = p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.filter(item => item.enabled);
    const failures = p.controller.snapshot().menu!.selectable_view_model!.crop_status_options!.filter(item => item.lifecycle_status === 'failed').length;
    assert.equal(crops.length + failures, 6, 'each sown position reveals either one crop or one failure');
    let harvested = 0;
    for (const crop of crops) {
      const beforeHarvest = await capture();
      try { await p.controller.harvest(crop.id); harvested++; }
      catch (error) {
        assert.match(String(error), /ERR_STORAGE_CAPACITY_OVERFLOW/);
        assert.equal(await capture(), beforeHarvest, 'full storage never consumes a mature crop or frees its tile');
        break;
      }
    }
    assert.ok(harvested > 0 && harvested < crops.length, 'the controlled 3500g test capacity rejects at least one successful crop');
    after = p.controller.snapshot().menu!.selectable_view_model!;
    assert.equal(after.field_options[0].available_tiles, harvested + failures);
    assert.equal(after.field_options[0].active_crop_count, crops.length - harvested);
    assert.equal(after.splittable_lot_options.filter(item => item.base_id === 'cabbage').reduce((total, item) => total + item.quantity.amount, 0), harvested * 1200);
  } finally { await p.controller.dispose(); }
});

test('M3 ordinary actions reject receipts belonging to a different command or action', async () => {
  for (const mode of ['old-action', 'wrong-command', 'missing-request', 'failed-after-preview'] as const) {
    let previous: WechatCommandResult | null = null;
    let corrupt = false;
    const p = harness({ receiveMenu: true, intercept: async (command, execute) => {
      if (corrupt && mode === 'old-action') return previous!;
      const result = await execute();
      if (corrupt) {
        const copy = structuredClone(result);
        if (mode === 'wrong-command') Reflect.set(copy.command_result, 'command_name', 'load');
        else if (mode === 'failed-after-preview') Reflect.set(copy.command_result.snapshot!.menu!.last_action_result!, 'success', false);
        else Reflect.deleteProperty(copy.command_result.snapshot!.menu!.last_action_result!, 'request_id');
        return copy;
      }
      previous = result; return result;
    } });
    await p.controller.start();
    try {
      await p.controller.advance();
      const before = p.controller.snapshot().completed_commands;
      const menu = p.controller.snapshot().menu!.selectable_view_model!;
      corrupt = true;
      await assert.rejects(p.controller.plant(menu.field_options[0].id, menu.seed_lot_options[0].id,
        { amount: 1, unit: menu.seed_lot_options[0].quantity.unit }), /ERR_WECHAT_ACTION_RESULT_UNCERTAIN/);
      assert.equal(p.controller.snapshot().completed_commands, before, 'mismatched evidence never reports completed planting');
    } finally { await p.controller.dispose(); }
  }
});

test('M3 a same-action receipt cannot report another planting and load preserves the dispatcher identity scope', async () => {
  let replay = false;
  let firstReceipt: WechatCommandResult | null = null;
  const storage = new InMemorySaveStoragePort();
  const p = harness({ storage, receiveMenu: true, intercept: async (command, execute) => {
    if (replay && command.name === 'menu_confirm') return firstReceipt!;
    const result = await execute();
    if (command.name === 'menu_confirm' && firstReceipt === null) firstReceipt = result;
    return result;
  } });
  await p.controller.start();
  try {
    const initial = p.controller.snapshot().menu!.selectable_view_model!;
    const field = initial.field_options.find(item => item.enabled)!;
    const seed = initial.seed_lot_options.find(item => item.enabled)!;
    const plant = () => p.controller.plant(field.id, seed.id, { amount: 2, unit: seed.quantity.unit });
    await p.controller.save();
    await plant();
    const completed = p.controller.snapshot().completed_commands;
    await p.host().requireSession().save('receipt-audit');
    const before = await storage.read('receipt-audit');
    replay = true;
    await assert.rejects(plant(), /ERR_WECHAT_ACTION_RESULT_UNCERTAIN/);
    assert.equal(p.controller.snapshot().completed_commands, completed);
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.field_options[0].active_crop_count, 2);
    await p.host().requireSession().save('receipt-audit');
    assert.equal(await storage.read('receipt-audit'), before, 'replayed evidence triggers no retry and changes no game state');
    replay = false;
    await plant();
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.field_options[0].active_crop_count, 4);
    await p.controller.load();
    await plant();
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.field_options[0].active_crop_count, 2,
      'normal load keeps the dispatcher sequence and a new request is accepted');
    replay = true;
    const afterLoad = p.controller.snapshot().completed_commands;
    await assert.rejects(plant(), /ERR_WECHAT_ACTION_RESULT_UNCERTAIN/);
    assert.equal(p.controller.snapshot().completed_commands, afterLoad, 'load does not forget already observed receipts');
  } finally { await p.controller.dispose(); }
  const replacement = harness({ storage, receiveMenu: true });
  await replacement.controller.start();
  try {
    await replacement.controller.load();
    const menu = replacement.controller.snapshot().menu!.selectable_view_model!;
    await replacement.controller.plant(menu.field_options[0].id, menu.seed_lot_options[0].id,
      { amount: 2, unit: menu.seed_lot_options[0].quantity.unit });
    assert.equal(replacement.controller.snapshot().menu!.selectable_view_model!.field_options[0].active_crop_count, 2,
      'a new controller owns a new Session and can legitimately reuse the initial request sequence');
  } finally { await replacement.controller.dispose(); }
});

test('wechat DishLot transfer uses formal action, rejects incompatible jars, and isolates a lost receipt', async () => {
  const storage = new InMemorySaveStoragePort(); let corrupt = false;
  const p = harness({storage, receiveMenu:true, intercept: async (command, execute) => {
    const result=await execute();
    if (!corrupt || command.name !== 'menu_confirm' || command.selection.action_type !== 'store_item' || !('source_dish_lot_option_id' in command.selection)) return result;
    const copy=structuredClone(result); Reflect.set(copy.command_result.snapshot!.menu!, 'last_action_result', null); return copy;
  }});
  await p.controller.start();
  try {
    const first=p.controller.snapshot().menu!.selectable_view_model!; const field=first.field_options.find(x=>x.enabled)!;const seed=first.seed_lot_options.find(x=>x.enabled)!;
    await p.controller.plant(field.id,seed.id,{amount:1,unit:seed.quantity.unit});
    for (let i=0;i<15 && !p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.some(x=>x.enabled);i++) await p.controller.advanceDay();
    await p.controller.harvest(p.controller.snapshot().menu!.selectable_view_model!.harvestable_crop_options.find(x=>x.enabled)!.id);
    const vm=p.host().requireSession().getSelectableViewModel(); const cabbage=vm.splittable_lot_options.find(x=>x.base_id==='cabbage' && x.current_form==='fresh')!;
    const bacon=vm.splittable_lot_options.find(x=>x.base_id==='bacon')!; const recipe=vm.cookable_recipe_options.find(x=>x.enabled)!;
    const cooked=await p.binding().execute({name:'menu_confirm',selection:{action_type:'cook_dish',recipe_option_id:recipe.id,ingredient_options:{main:{lot_option_id:cabbage.id,quantity:{amount:250,unit:'g'}},side:{lot_option_id:bacon.id,quantity:{amount:50,unit:'g'}}},operation_profile:{heat_level:'high',active_minutes:8},target_storage_option_id:'home_room_temp_01'}});
    assert.equal(cooked.command_result.snapshot!.menu!.last_action_result!.success,true);
    await p.host().requireSession().save('controlled_capture'); const original=JSON.parse((await storage.read('controlled_capture'))!);
    delete original.physical_capacity_policy_id; for(const item of original.storage_containers){delete item.capacity_limits;delete item.used_capacity_limits;}
    const room=original.storage_containers.find((item:any)=>item.container_id==='home_room_temp_01'); const extra=structuredClone(room); extra.container_id='controlled_dish_room';extra.active_object_refs=[];extra.used_capacity=0;original.storage_containers.push(extra);
    await storage.write(WECHAT_SAVE_SLOT_ID,JSON.stringify(original)); await p.controller.load();
    const dish=p.controller.snapshot().menu!.selectable_view_model!.submittable_dish_lot_options![0]!; assert.equal(dish.storage_form,'cooked_dish');
    const beforeInvalid = p.controller.snapshot().accepted_commands;
    await assert.rejects(p.controller.moveDish(dish.id,'home_cellar_01'),/ERR_WECHAT_PROBE_ACTION_FAILED:ERR_MENU_OPTION_INVALID/);
    assert.equal(p.controller.snapshot().accepted_commands,beforeInvalid,'unsupported form is refused before dispatch');
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.submittable_dish_lot_options![0]!.storage_ref.container_id,'home_room_temp_01');
    await p.controller.moveDish(dish.id,'controlled_dish_room');
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.submittable_dish_lot_options![0]!.storage_ref.container_id,'controlled_dish_room');
    corrupt=true;await assert.rejects(p.controller.moveDish(dish.id,'home_room_temp_01'),/ERR_WECHAT_ACTION_RESULT_UNCERTAIN/);
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.submittable_dish_lot_options![0]!.storage_ref.container_id,'home_room_temp_01');
  } finally { await p.controller.dispose(); }
});

test('wechat decimal split and merge use exact JSON quantities and reject a forged merge receipt', async () => {
  for (const corrupt of [false,true]) {
    const p=harness({receiveMenu:true,intercept:async(command,execute)=>{
      const result=await execute();
      if (!corrupt || command.name!=='menu_confirm_merge_direct') return result;
      const copy=structuredClone(result);const changed=copy.command_result.snapshot!.menu!.last_action_result!.updated_objects!.find(item=>item.object_id===command.selection.target_lot_option_id)!;
      Reflect.set(changed.summary!.quantity!,'amount',0.31);return copy;
    }});
    await p.controller.start();
    try {
      const salt=p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item=>item.base_id==='salt')!;
      const one=await p.controller.confirmSplit(salt.id,{amount:0.1,unit:'g'});
      const two=await p.controller.confirmSplit(salt.id,{amount:0.2,unit:'g'});
      assert.equal(one.split_result!.quantity.amount,0.1);assert.equal(two.split_result!.quantity.amount,0.2);
      if (corrupt) {
        await assert.rejects(p.controller.confirmMerge(one.split_result!.newLotId,two.split_result!.newLotId),/ERR_WECHAT_MERGE_RESULT_UNCERTAIN/);
        const after=p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options;
        assert.equal(after.find(item=>item.id===two.split_result!.newLotId)!.quantity.amount,0.3,'formal merge committed despite a forged receipt');
      } else {
        const merged=await p.controller.confirmMerge(one.split_result!.newLotId,two.split_result!.newLotId);
        assert.equal(merged.merge_result!.quantity.amount,0.3); assert.equal(merged.menu!.selectable_view_model!.splittable_lot_options.some(item=>item.id===one.split_result!.newLotId),false);
      }
    } finally { await p.controller.dispose(); }
  }
});

test('wechat decimal split rejects a forged quantity even when formal action committed', async () => {
  const p=harness({receiveMenu:true,intercept:async(command,execute)=>{
    const result=await execute();if(command.name!=='menu_confirm_split_direct')return result;
    const copy=structuredClone(result); const created=copy.command_result.snapshot!.menu!.last_action_result!.created_objects![0]!;
    Reflect.set(created.summary!.quantity!,'amount',0.11);return copy;
  }});
  await p.controller.start();try {
    const salt=p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item=>item.base_id==='salt')!;
    await assert.rejects(p.controller.confirmSplit(salt.id,{amount:0.1,unit:'g'}),/ERR_WECHAT_SPLIT_RESULT_UNCERTAIN/);
    assert.equal(p.controller.snapshot().split_result,null);
    assert.equal(p.controller.snapshot().menu!.selectable_view_model!.splittable_lot_options.find(item=>item.id===salt.id)!.quantity.amount,199.9);
  } finally {await p.controller.dispose();}
});
