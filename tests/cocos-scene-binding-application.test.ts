import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import {
  CocosSceneBindingController,
  CocosSceneBindingSnapshotApplier,
  CocosSessionHost,
  CocosUiShellController,
  RecordingCocosSceneBindingPort,
  diffCocosUiShellSnapshots
} from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

function makeSceneBinding() {
  const { configs, contracts } = buildRuntimeWithoutState();
  const storage = new InMemorySaveStoragePort();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: testBuildId('cocos_scene_binding_test'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  const shell = new CocosUiShellController(host);
  const port = new RecordingCocosSceneBindingPort();
  const binding = CocosSceneBindingController.fromShell(shell, port);
  return { host, shell, storage, port, binding };
}

test('scene binding applies stable refresh updates for session creation and initial render', async () => {
  const { binding, port } = makeSceneBinding();

  const initialUpdates = await binding.applyInitialSnapshot();
  assert.deepEqual(initialUpdates.map((update) => update.section), ['lifecycle', 'menu', 'save_load', 'errors']);
  assert.deepEqual(initialUpdates.map((update) => update.reason), ['initial_render', 'initial_render', 'initial_render', 'initial_render']);

  port.clear();
  const created = await binding.execute({ name: 'create_session' });
  assert.equal(created.command_result.status, 'completed');
  assert.deepEqual(created.diff.changed_sections, ['lifecycle', 'menu', 'save_load']);
  assert.deepEqual(created.applied_updates.map((update) => update.section), ['lifecycle', 'menu', 'save_load']);
  assert.deepEqual(port.recordedUpdates().map((update) => update.section), ['lifecycle', 'menu', 'save_load']);
});

test('scene binding distinguishes preview and confirm refresh areas while preserving formal command path', async () => {
  const { host, binding } = makeSceneBinding();
  await binding.execute({ name: 'create_session' });

  const beforePreview = cloneForCompare(host.requireSession().getViewModel());
  const previewed = await binding.execute({ name: 'menu_preview', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(previewed.command_result.status, 'completed');
  assert.deepEqual(previewed.applied_updates.map((update) => update.section), ['lifecycle', 'menu']);
  assert.equal(previewed.command_result.snapshot.menu.last_preview_result?.success, true);
  assert.deepEqual(host.requireSession().getViewModel(), beforePreview);

  const confirmed = await binding.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(confirmed.command_result.status, 'completed');
  assert.deepEqual(confirmed.applied_updates.map((update) => update.section), ['lifecycle', 'menu', 'save_load']);
  assert.equal(confirmed.command_result.snapshot.menu.last_action_result?.success, true);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
});

test('scene binding forwards save/load refreshes and preserves load failure safety', async () => {
  const { host, binding, storage } = makeSceneBinding();
  await binding.execute({ name: 'create_session' });

  const saved = await binding.execute({ name: 'save', selection: { slot_id: 'scene_initial' } });
  assert.equal(saved.command_result.status, 'completed');
  assert.equal(saved.diff.save_load_changed, true);
  assert.deepEqual(saved.applied_updates.map((update) => update.section), ['lifecycle', 'save_load']);

  await binding.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  const beforeFailedLoad = cloneForCompare(host.requireSession().getViewModel());
  await storage.write('scene_broken', '{"broken":true}');

  const failedLoad = await binding.execute({ name: 'load', selection: { slot_id: 'scene_broken' } });
  assert.equal(failedLoad.command_result.status, 'failed');
  assert.equal(failedLoad.diff.save_load_changed, true);
  assert.equal(failedLoad.applied_updates.some((update) => update.section === 'save_load'), true);
  assert.equal(failedLoad.command_result.snapshot.save_load.errors.some((error) => error.code === 'ERR_COCOS_SESSION_LOAD_REJECTED'), true);
  assert.deepEqual(host.requireSession().getViewModel(), beforeFailedLoad);

  const loaded = await binding.execute({ name: 'load', selection: { slot_id: 'scene_initial' } });
  assert.equal(loaded.command_result.status, 'completed');
  assert.equal(loaded.command_result.snapshot.menu.view_model?.time_label, 'day 1 minute 360');
  assert.equal(loaded.applied_updates.some((update) => update.section === 'save_load'), true);
});

test('scene binding keeps update order stable across continuous commands and skips unchanged snapshots', async () => {
  const { binding, shell } = makeSceneBinding();
  const create = await binding.execute({ name: 'create_session' });
  const preview = await binding.execute({ name: 'menu_preview', selection: { action_type: 'advance_time', minutes: 60 } });
  const confirm = await binding.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });

  assert.deepEqual(create.applied_updates.map((update) => update.sequence), [0, 1, 2]);
  assert.deepEqual(preview.applied_updates.map((update) => update.section), ['lifecycle', 'menu']);
  assert.deepEqual(confirm.applied_updates.map((update) => update.section), ['lifecycle', 'menu', 'save_load']);

  const sameBefore = shell.currentSnapshot();
  const sameAfter = cloneForCompare(sameBefore);
  const diff = diffCocosUiShellSnapshots(sameBefore, sameAfter);
  const applier = new CocosSceneBindingSnapshotApplier();
  assert.deepEqual(diff.changed_sections, []);
  assert.deepEqual(applier.createUpdates({ before: sameBefore, after: sameAfter, diff }), []);
});

test('scene binding observes command failure and continues later queued commands', async () => {
  const { binding } = makeSceneBinding();

  const failedRefresh = await binding.execute({ name: 'refresh' });
  assert.equal(failedRefresh.command_result.status, 'failed');
  assert.equal(failedRefresh.applied_updates.some((update) => update.section === 'errors'), true);

  const created = await binding.execute({ name: 'create_session' });
  assert.equal(created.command_result.status, 'completed');
  assert.equal(created.command_result.snapshot.lifecycle.has_session, true);
});
