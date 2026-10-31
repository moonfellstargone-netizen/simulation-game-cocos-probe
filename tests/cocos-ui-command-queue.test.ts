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
