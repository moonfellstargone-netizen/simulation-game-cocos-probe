import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CocosSessionHost, CocosUiShellCommandQueue, CocosUiShellController } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type SaveStoragePort } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';
import { ControlledSaveStoragePort, captureSerializedSession } from './support/controlledSaveStoragePort';

function makeQueuedShell(storage: SaveStoragePort = new InMemorySaveStoragePort()) {
  const { configs, contracts } = buildRuntimeWithoutState();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: testBuildId('cocos_ui_command_queue_test'),
    randomSeed: 'farming-test-23',
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  const shell = new CocosUiShellController(host);
  const queue = new CocosUiShellCommandQueue(shell);
  return { host, shell, queue, storage };
}

test('Cocos UI command queue executes shell commands and returns render snapshots', async () => {
  const { host, queue } = makeQueuedShell();

  const created = await queue.execute({ name: 'create_session' });
  assert.equal(created.status, 'completed');
  assert.equal(created.snapshot.lifecycle.last_operation, 'create_session');
  assert.equal(created.snapshot.lifecycle.has_session, true);

  const beforePreview = cloneForCompare(host.requireSession().getViewModel());
  const previewed = await queue.execute({ name: 'menu_preview', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(previewed.status, 'completed');
  assert.equal(previewed.snapshot.lifecycle.last_operation, 'menu_preview');
  assert.equal(previewed.snapshot.menu.last_preview_result?.success, true);
  assert.deepEqual(host.requireSession().getViewModel(), beforePreview);

  const confirmed = await queue.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(confirmed.status, 'completed');
  assert.equal(confirmed.snapshot.lifecycle.last_operation, 'menu_confirm');
  assert.equal(confirmed.snapshot.menu.last_action_result?.success, true);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');

  const saved = await queue.execute({ name: 'save', selection: { slot_id: 'queue_after_confirm' } });
  assert.equal(saved.status, 'completed');
  assert.equal(saved.snapshot.lifecycle.last_operation, 'save');
  assert.equal(saved.snapshot.save_load.last_save_result?.slot_id, 'queue_after_confirm');

  const refreshed = await queue.execute({ name: 'refresh' });
  assert.equal(refreshed.status, 'completed');
  assert.equal(refreshed.snapshot.lifecycle.last_operation, 'refresh');

  const loaded = await queue.execute({ name: 'load', selection: { slot_id: 'queue_after_confirm' } });
  assert.equal(loaded.status, 'completed');
  assert.equal(loaded.snapshot.lifecycle.last_operation, 'load');
  assert.equal(loaded.snapshot.save_load.last_load_result?.slot_id, 'queue_after_confirm');

  const destroyed = await queue.execute({ name: 'destroy_session' });
  assert.equal(destroyed.status, 'completed');
  assert.equal(destroyed.snapshot.lifecycle.has_session, false);
});

test('direct split queue validates independently without preview and rejects before dispatch', async () => {
  const { host, queue, storage } = makeQueuedShell();
  await queue.execute({ name: 'create_session' });
  const session = host.requireSession();
  const lot = session.getSelectableViewModel().splittable_lot_options.find(item => item.enabled && item.quantity.unit === 'count' && item.quantity.amount >= 2);
  assert.ok(lot);
  const before = await captureSerializedSession(session, storage, 'direct_split_before');
  let previews = 0;
  const originalPreview = session.preview.bind(session);
  session.preview = () => { previews++; throw new Error('direct split must not call preview'); };
  const invalid = await queue.execute({ name: 'menu_confirm_split_direct', selection: { action_type: 'split_lot', source_lot_option_id: lot.id, quantity: { amount: 0.5, unit: 'count' } } });
  assert.equal(invalid.status, 'completed');
  assert.deepEqual(invalid.snapshot.menu.last_split_validation_result, { action_type: 'split_lot', success: false, status_code: 'ERR_SPLIT_QUANTITY_INVALID' });
  assert.equal(invalid.snapshot.menu.last_action_result, null);
  assert.equal(invalid.snapshot.menu.last_preview_result, null);
  assert.equal(await captureSerializedSession(session, storage, 'direct_split_after_rejection'), before);
  assert.equal(previews, 0);
  const selection = { action_type: 'split_lot' as const, source_lot_option_id: lot.id, quantity: { amount: 1, unit: 'count' as const } };
  const [first, second] = await Promise.all([
    queue.enqueue({ name: 'menu_confirm_split_direct', selection }),
    queue.enqueue({ name: 'menu_confirm_split_direct', selection })
  ]);
  for (const result of [first, second]) {
    assert.equal(result.status, 'completed');
    assert.equal(result.command_name, 'menu_confirm_split_direct');
    assert.deepEqual(result.snapshot.menu.last_split_validation_result, { action_type: 'split_lot', success: true, status_code: 'OK' });
    assert.equal(result.snapshot.menu.last_preview_result, null);
    assert.equal(result.snapshot.menu.last_action_result?.success, true);
    assert.equal(result.snapshot.menu.last_action_result?.created_objects.length, 1);
  }
  assert.notEqual(first.snapshot.menu.last_action_result?.created_objects[0]?.object_id, second.snapshot.menu.last_action_result?.created_objects[0]?.object_id);
  const remaining = session.getSelectableViewModel().splittable_lot_options.find(item => item.id === lot.id);
  assert.equal(remaining?.quantity.amount, lot.quantity.amount - 2);
  assert.equal(previews, 0);
  session.preview = originalPreview;
  const legacy = await queue.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(legacy.snapshot.menu.last_preview_result?.success, true, 'legacy confirm retains preview behavior');
  assert.equal(legacy.snapshot.menu.last_split_validation_result, null);
  host.destroySession();
});

test('direct split distinguishes dispatch-side failure from safe pre-dispatch rejection', async () => {
  const { host, queue } = makeQueuedShell();
  await queue.execute({ name: 'create_session' });
  const session = host.requireSession();
  const lot = session.getSelectableViewModel().splittable_lot_options.find(item => item.enabled && item.quantity.unit === 'count' && item.quantity.amount > 1);
  assert.ok(lot);
  let previewCalls = 0;
  session.preview = () => { previewCalls++; throw new Error('unexpected preview'); };
  const dispatch = session.dispatch.bind(session);
  session.dispatch = ((...args: Parameters<typeof session.dispatch>) => {
    dispatch(...args);
    throw new Error('injected failure after formal commit');
  }) as typeof session.dispatch;
  const result = await queue.execute({ name: 'menu_confirm_split_direct', selection: { action_type: 'split_lot', source_lot_option_id: lot.id, quantity: { amount: 1, unit: 'count' } } });
  assert.equal(result.status, 'failed');
  assert.equal(result.snapshot.menu.last_split_validation_result?.success, true, 'pre-dispatch validation succeeded');
  assert.equal(result.snapshot.menu.last_action_result, null, 'missing result must not imply rollback');
  assert.match(result.error_message ?? '', /injected failure after formal commit/);
  assert.equal(session.getSelectableViewModel().splittable_lot_options.find(item => item.id === lot.id)?.quantity.amount, lot.quantity.amount - 1);
  assert.equal(previewCalls, 0);
  host.destroySession();
});

test('Cocos UI command queue serializes async save/load commands in enqueue order', async () => {
  const storage = new ControlledSaveStoragePort();
  const { queue } = makeQueuedShell(storage);
  await queue.execute({ name: 'create_session' });

  const pendingWrite = storage.deferNext('write');
  const firstSave = queue.enqueue({ name: 'save', selection: { slot_id: 'queue_initial' } });
  await pendingWrite.entered;
  const confirm = queue.enqueue({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  const secondSave = queue.enqueue({ name: 'save', selection: { slot_id: 'queue_advanced' } });
  const loadInitial = queue.enqueue({ name: 'load', selection: { slot_id: 'queue_initial' } });
  try {
    await Promise.resolve();
    assert.deepEqual(storage.operations, ['write:queue_initial']);
    assert.equal(queue.status(), 'running');
  } finally {
    pendingWrite.resume();
  }

  const results = await Promise.all([firstSave, confirm, secondSave, loadInitial]);
  assert.deepEqual(results.map((result) => result.command_name), ['save', 'menu_confirm', 'save', 'load']);
  assert.deepEqual(storage.operations, ['write:queue_initial', 'write:queue_advanced', 'read:queue_initial']);
  assert.equal(results[0].snapshot.save_load.last_save_result?.world_minute, 360);
  assert.equal(results[1].snapshot.menu.view_model?.time_label, 'day 1 minute 420');
  assert.equal(results[2].snapshot.save_load.last_save_result?.world_minute, 420);
  assert.equal(results[3].snapshot.menu.view_model?.time_label, 'day 1 minute 360');
});

test('Cocos UI command queue exposes failed command status while preserving later command execution', async () => {
  const { host, queue, storage } = makeQueuedShell(new InMemorySaveStoragePort());
  await queue.execute({ name: 'create_session' });
  await queue.execute({ name: 'save', selection: { slot_id: 'queue_good' } });
  await storage.write('queue_broken', '{"broken":true}');
  const before = cloneForCompare(host.requireSession().getViewModel());

  const failedLoad = await queue.execute({ name: 'load', selection: { slot_id: 'queue_broken' } });
  assert.equal(failedLoad.status, 'failed');
  assert.match(failedLoad.error_message ?? '', /ERR_COCOS_SESSION_LOAD_REJECTED/);
  assert.equal(queue.status(), 'failed');
  assert.equal(queue.lastExecutionResult()?.status, 'failed');
  assert.deepEqual(host.requireSession().getViewModel(), before);

  const loadedGood = await queue.execute({ name: 'load', selection: { slot_id: 'queue_good' } });
  assert.equal(loadedGood.status, 'completed');
  assert.equal(queue.status(), 'completed');
  assert.equal(loadedGood.snapshot.save_load.last_load_result?.slot_id, 'queue_good');
});

for (const operation of ['read', 'write'] as const) {
  test(`Command queue waits for delayed ${operation} rejection, preserves state, and continues queued work`, async () => {
    const storage = new ControlledSaveStoragePort();
    const { host, queue } = makeQueuedShell(storage);
    await queue.execute({ name: 'create_session' });
    const initialView = host.requireSession().getViewModel();
    await queue.execute({ name: 'save', selection: { slot_id: 'queue_recovery' } });
    const savedState = await storage.read('queue_recovery');
    assert.notEqual(savedState, null);
    await queue.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
    const session = host.requireSession();
    const beforeView = session.getViewModel();
    const beforeSelectable = session.getSelectableViewModel();
    const beforeState = await captureSerializedSession(session, storage, `queue_before_${operation}`);
    const failure = new Error(`delayed storage ${operation} interrupted`);
    const pending = storage.deferNext(operation);
    const command = operation === 'read'
      ? { name: 'load' as const, selection: { slot_id: 'queue_recovery' } }
      : { name: 'save' as const, selection: { slot_id: 'queue_write_retry' } };
    const failedCommand = queue.enqueue(command);
    await pending.entered;
    const enteredOperationCount = storage.operations.length;
    const laterSave = queue.enqueue({ name: 'save', selection: { slot_id: 'queue_after_failure' } });

    try {
      await Promise.resolve();
      assert.equal(queue.status(), 'running');
      assert.equal(storage.operations.length, enteredOperationCount);
      assert.deepEqual(session.getViewModel(), beforeView);
      assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);
    } finally {
      pending.reject(failure);
    }

    const [failed, continued] = await Promise.all([failedCommand, laterSave]);
    assert.equal(failed.command_name, command.name);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error_message, failure.message);
    assert.equal(failed.snapshot.save_load.last_save_result, null);
    assert.equal(failed.snapshot.save_load.last_load_result, null);
    assert.deepEqual(failed.snapshot.save_load.errors, [{ code: null, message: failure.message }]);
    assert.deepEqual(failed.snapshot.save_load.view_model, beforeView);
    assert.deepEqual(failed.snapshot.menu.view_model, beforeView);
    assert.equal(continued.status, 'completed');
    assert.equal(continued.snapshot.save_load.last_save_result?.slot_id, 'queue_after_failure');
    assert.deepEqual(continued.snapshot.save_load.errors, []);
    assert.equal(queue.status(), 'completed');
    assert.equal(queue.lastExecutionResult()?.snapshot.save_load.last_save_result?.slot_id, 'queue_after_failure');
    assert.deepEqual(session.getViewModel(), beforeView);
    assert.equal(await storage.read('queue_after_failure'), beforeState);
    assert.equal(await captureSerializedSession(session, storage, `queue_after_${operation}_failure`), beforeState);

    const retried = await queue.execute(command);
    assert.equal(retried.status, 'completed');
    assert.deepEqual(retried.snapshot.save_load.errors, []);
    if (operation === 'read') {
      assert.equal(retried.snapshot.save_load.last_load_result?.slot_id, 'queue_recovery');
      assert.deepEqual(session.getViewModel(), initialView);
      assert.equal(await captureSerializedSession(session, storage, 'queue_after_read_retry'), savedState);
    } else {
      assert.equal(retried.snapshot.save_load.last_save_result?.slot_id, 'queue_write_retry');
      assert.equal(await storage.read('queue_write_retry'), beforeState);
    }
  });
}

test('a failed load does not mislabel a later menu command or replay its action', async () => {
  const { host, queue } = makeQueuedShell();
  await queue.execute({ name: 'create_session' });
  const before = host.requireSession().getViewModel();

  const failedLoad = await queue.execute({ name: 'load', selection: { slot_id: 'queue_missing' } });
  assert.equal(failedLoad.status, 'failed');
  assert.match(failedLoad.error_message ?? '', /ERR_SAVE_SLOT_NOT_FOUND/);
  assert.deepEqual(host.requireSession().getViewModel(), before);
  const failureSnapshot = structuredClone(failedLoad);

  const previewed = await queue.execute({ name: 'menu_preview', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(previewed.status, 'completed');
  assert.equal(previewed.error_message, null);
  assert.equal(previewed.snapshot.menu.last_preview_result?.success, true);
  assert.deepEqual(host.requireSession().getViewModel(), before);

  const confirmed = await queue.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(confirmed.status, 'completed');
  assert.equal(confirmed.error_message, null);
  assert.equal(confirmed.snapshot.menu.last_action_result?.success, true);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
  assert.deepEqual(confirmed.snapshot.save_load.errors, failedLoad.snapshot.save_load.errors);
  assert.deepEqual(queue.lastExecutionResult(), confirmed);
  assert.deepEqual(failedLoad, failureSnapshot);

  const failedMenu = await queue.execute({ name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: 'not_in_selectable_options' } });
  assert.equal(failedMenu.status, 'failed');
  assert.match(failedMenu.error_message ?? '', /ERR_MENU_OPTION_NOT_FOUND/);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
});

for (const menuCommand of ['menu_preview', 'menu_confirm'] as const) {
  for (const storageCommand of ['save', 'load'] as const) {
    test(`a failed ${menuCommand} does not mislabel a healthy ${storageCommand}`, async () => {
      const { host, queue } = makeQueuedShell();
      await queue.execute({ name: 'create_session' });
      await queue.execute({ name: 'save', selection: { slot_id: 'queue_menu_recovery' } });
      const before = host.requireSession().getViewModel();
      const failedMenu = await queue.execute({ name: menuCommand, selection: { action_type: 'harvest_crop', crop_option_id: 'not_in_selectable_options' } });
      assert.equal(failedMenu.status, 'failed');
      assert.match(failedMenu.error_message ?? '', /ERR_MENU_OPTION_NOT_FOUND/);
      const failureSnapshot = structuredClone(failedMenu);

      const recovered = await queue.execute({ name: storageCommand, selection: { slot_id: 'queue_menu_recovery' } });
      assert.equal(recovered.status, 'completed');
      assert.equal(recovered.error_message, null);
      assert.equal(storageCommand === 'save'
        ? recovered.snapshot.save_load.last_save_result?.slot_id
        : recovered.snapshot.save_load.last_load_result?.slot_id, 'queue_menu_recovery');
      assert.deepEqual(recovered.snapshot.menu.errors, failedMenu.snapshot.menu.errors);
      assert.deepEqual(host.requireSession().getViewModel(), before);
      assert.deepEqual(failedMenu, failureSnapshot);

      const failedLoad = await queue.execute({ name: 'load', selection: { slot_id: 'queue_still_missing' } });
      assert.equal(failedLoad.status, 'failed');
      assert.match(failedLoad.error_message ?? '', /ERR_SAVE_SLOT_NOT_FOUND/);
      assert.deepEqual(host.requireSession().getViewModel(), before);
    });
  }
}

test('refresh and lifecycle commands report their own errors while preserving historical panel results', async () => {
  const { host, queue } = makeQueuedShell();
  const missingSession = await queue.execute({ name: 'refresh' });
  assert.equal(missingSession.status, 'failed');
  assert.match(missingSession.error_message ?? '', /ERR_COCOS_SESSION_NOT_CREATED/);
  await queue.execute({ name: 'create_session' });
  await queue.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  const failedLoad = await queue.execute({ name: 'load', selection: { slot_id: 'queue_missing_for_lifecycle' } });
  assert.equal(failedLoad.status, 'failed');
  const savedMenuResult = structuredClone(failedLoad.snapshot.menu.last_action_result);
  assert.equal(savedMenuResult?.success, true);

  const refreshed = await queue.execute({ name: 'refresh' });
  assert.equal(refreshed.status, 'completed');
  assert.equal(refreshed.error_message, null);
  assert.deepEqual(refreshed.snapshot.save_load.errors, failedLoad.snapshot.save_load.errors);
  assert.deepEqual(refreshed.snapshot.menu.last_action_result, savedMenuResult);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');

  const destroyed = await queue.execute({ name: 'destroy_session' });
  assert.equal(destroyed.status, 'completed');
  assert.equal(destroyed.error_message, null);
  assert.equal(host.hasSession(), false);
  assert.deepEqual(destroyed.snapshot.save_load.errors, failedLoad.snapshot.save_load.errors);
  assert.deepEqual(destroyed.snapshot.menu.last_action_result, savedMenuResult);

  const failedRefresh = await queue.execute({ name: 'refresh' });
  assert.equal(failedRefresh.status, 'failed');
  assert.match(failedRefresh.error_message ?? '', /ERR_COCOS_SESSION_NOT_CREATED/);
  const recreated = await queue.execute({ name: 'create_session' });
  assert.equal(recreated.status, 'completed');
  assert.equal(recreated.error_message, null);
  assert.equal(recreated.snapshot.lifecycle.has_session, true);
  assert.deepEqual(recreated.snapshot.save_load.errors, failedLoad.snapshot.save_load.errors);
});

test('Cocos UI command queue source stays a shell wrapper without platform or core shortcuts', () => {
  const text = readFileSync(join(process.cwd(), 'src/cocos-creator-adapter/shell/CocosUiCommandQueue.ts'), 'utf8');
  for (const required of [
    'CocosUiShellCommandQueue',
    'CocosUiShellCommand',
    'CocosUiShellCommandStatus',
    'CocosUiShellCommandExecutionResult',
    'CocosUiShellController',
    'enqueue',
    'execute'
  ]) {
    assert.equal(text.includes(required), true, `queue source missing ${required}`);
  }

  for (const forbidden of [
    'game-core/dev-api',
    'game-core/testing-api',
    'Stage1AFixtureRunner',
    'Stage1AHeadlessRuntime',
    "from 'cc'",
    'from "cc"',
    "from 'node:fs'",
    'from "node:fs"',
    "from 'fs'",
    'from "fs"',
    'wx.',
    'GameState',
    'SaveFile',
    'save_file',
    'inventory',
    'orders',
    'dish_lots',
    'reservations'
  ]) {
    assert.equal(text.includes(forbidden), false, `queue source leaked forbidden token ${forbidden}`);
  }
});

test('direct processing queue validates before dispatch without calling preview', async () => {
  const { host, queue, storage } = makeQueuedShell();
  await queue.execute({ name: 'create_session' });
  const session = host.requireSession();
  let current = session.getSelectableViewModel();
  const field = current.field_options.find(item => item.enabled)!;
  const seed = current.seed_lot_options.find(item => item.enabled)!;
  let earlierActions = 2;
  assert.equal(session.dispatch('plant_crop', { field_plot_id: field.id, seed_lot_id: seed.id, seed_quantity: { amount: 1, unit: seed.quantity.unit } }).success, true);
  for (let i = 0; i < 30 && !session.getSelectableViewModel().harvestable_crop_options.some(item => item.field_plot_id === field.id); i++) {
    assert.equal(session.dispatch('advance_time', { minutes: 1440 }).success, true);
    earlierActions++;
  }
  const crop = session.getSelectableViewModel().harvestable_crop_options.find(item => item.field_plot_id === field.id)!;
  assert.ok(crop);
  assert.equal(session.dispatch('harvest_crop', { crop_id: crop.id }).success, true);
  current = session.getSelectableViewModel();
  const method = current.processing_method_options[0]!;
  const facility = current.processing_facility_options.find(item => item.enabled && method.compatible_facility_ids.includes(item.id))!;
  const inputs = method.input_requirements.map((requirement, index) => {
    const lot = current.processable_lot_options.find(item => item.enabled && requirement.lot_ids.includes(item.id))!;
    assert.ok(lot);
    return { lot_option_id: lot.id, quantity: { amount: index === 0 ? 300 : 15, unit: lot.quantity.unit } };
  });
  const selection = { action_type: 'start_processing' as const, method_id: method.id, input_lots: inputs, facility_option_id: facility.id };
  let previews = 0; session.preview = () => { previews++; throw new Error('direct processing must not call preview'); };
  let dispatches = 0;
  const originalDispatch = session.dispatch.bind(session);
  session.dispatch = ((...args: Parameters<typeof session.dispatch>) => { dispatches++; return originalDispatch(...args); }) as typeof session.dispatch;
  const before = await captureSerializedSession(session, storage, 'processing_direct_before');
  const originalSelectable = session.getSelectableViewModel.bind(session);
  session.getSelectableViewModel = () => {
    const view = originalSelectable();
    const projectedFacility = view.processing_facility_options.find(item => item.id === facility.id)!;
    Reflect.set(projectedFacility.facility_ref, 'storage_type', 'invalid_schema_value');
    return view;
  };
  const malformed = await queue.execute({ name: 'menu_confirm_processing_direct', selection });
  assert.deepEqual(malformed.snapshot.menu.last_processing_validation_result, { action_type: 'start_processing', success: false, status_code: 'ERR_SCHEMA_VALIDATION_FAILED' });
  assert.equal(malformed.snapshot.menu.last_action_result, null);
  assert.equal(dispatches, 0);
  assert.equal(await captureSerializedSession(session, storage, 'processing_direct_after_schema_rejection'), before);
  session.getSelectableViewModel = originalSelectable;
  const invalid = await queue.execute({ name: 'menu_confirm_processing_direct', selection: { ...selection, input_lots: inputs.slice(0, 1) } });
  assert.equal(invalid.status, 'completed');
  assert.deepEqual(invalid.snapshot.menu.last_processing_validation_result, { action_type: 'start_processing', success: false, status_code: 'ERR_PROCESSING_INPUT_MISSING' });
  assert.equal(invalid.snapshot.menu.last_action_result, null);
  assert.equal(await captureSerializedSession(session, storage, 'processing_direct_after'), before);
  const started = await queue.execute({ name: 'menu_confirm_processing_direct', selection });
  assert.equal(started.status, 'completed');
  assert.deepEqual(started.snapshot.menu.last_processing_validation_result, { action_type: 'start_processing', success: true, status_code: 'OK' });
  assert.equal(started.snapshot.menu.last_action_result?.success, true);
  assert.equal(started.snapshot.menu.last_action_result?.request_id, `start_processing_${String(earlierActions * 2 + 1).padStart(6, '0')}`);
  assert.equal(started.snapshot.menu.last_action_result?.created_objects.find(item => item.object_type === 'ProcessingTask')?.object_id, 'task_processing_000001');
  assert.equal(started.snapshot.menu.last_preview_result, null);
  const task = session.getSelectableViewModel().processing_task_options[0]!;
  assert.ok(task);
  const early = await queue.execute({ name: 'menu_confirm_processing_direct', selection: { action_type: 'collect_processing_result', task_option_id: task.id } });
  assert.equal(early.snapshot.menu.last_processing_validation_result?.success, false);
  assert.equal(early.snapshot.menu.last_action_result, null);
  assert.equal(session.dispatch('advance_time', { minutes: task.expected_finish_minute - task.start_world_minute }).success, true);
  const collected = await queue.execute({ name: 'menu_confirm_processing_direct', selection: { action_type: 'collect_processing_result', task_option_id: task.id } });
  assert.equal(collected.status, 'completed');
  assert.deepEqual(collected.snapshot.menu.last_processing_validation_result, { action_type: 'collect_processing_result', success: true, status_code: 'OK' });
  assert.equal(collected.snapshot.menu.last_action_result?.success, true);
  const actualDispatch = session.dispatch.bind(session);
  session.dispatch = ((...args: Parameters<typeof session.dispatch>) => {
    actualDispatch(...args);
    throw new Error('injected after processing dispatch');
  }) as typeof session.dispatch;
  const afterDispatch = await queue.execute({ name: 'menu_confirm_processing_direct', selection });
  assert.equal(afterDispatch.status, 'failed');
  assert.equal(afterDispatch.snapshot.menu.last_processing_validation_result?.success, true);
  assert.equal(afterDispatch.snapshot.menu.last_action_result, null);
  assert.match(afterDispatch.error_message ?? '', /injected after processing dispatch/);
  assert.equal(session.getSelectableViewModel().processing_task_options.length, 2, 'formal action may have committed before failure');
  assert.equal(previews, 0);
  host.destroySession();
});
