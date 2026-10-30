import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import {
  CocosSceneBindingController,
  CocosSceneBindingSnapshotApplier,
  CocosSessionHost,
  CocosUiShellController,
  RecordingCocosSceneBindingPort,
  diffCocosUiShellSnapshots,
  type CocosSceneBindingUpdate,
  type CocosUiShellRenderSnapshot
} from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';
import { ControlledBindingPort, settleBindingTurn } from './support/controlledBindingPort';

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

function makeControlledSceneBinding() {
  const { host, shell } = makeSceneBinding();
  const port = new ControlledBindingPort<CocosSceneBindingUpdate>();
  const binding = CocosSceneBindingController.fromShell(shell, {
    applySceneBindingUpdate: (update) => port.apply(update)
  });
  return { host, shell, port, binding };
}

function assertSceneMatchesShell(port: ControlledBindingPort<CocosSceneBindingUpdate>, shell: CocosUiShellController) {
  const snapshot = shell.currentSnapshot();
  for (const section of ['lifecycle', 'menu', 'save_load', 'errors'] as const) {
    assert.deepEqual(port.latest(section)?.snapshot, snapshot[section], `actual ${section} binding must match the shell`);
  }
}

test('scene binding serializes commands through async section application and takes before at execution time', async (t) => {
  const { host, shell, port, binding } = makeControlledSceneBinding();
  await binding.execute({ name: 'create_session' });
  await binding.applyInitialSnapshot();
  port.clearHistory();

  const gate = port.pauseNext('lifecycle');
  const first = binding.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  await gate.entered;
  const second = binding.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 120 } });
  t.after(async () => {
    gate.resume();
    await Promise.allSettled([first, second]);
  });
  await settleBindingTurn();
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420', 'the second command waits for the first binding batch');
  assert.equal(port.recordedUpdates().length, 0);

  gate.resume();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.command_result.status, 'completed');
  assert.equal(secondResult.command_result.status, 'completed');
  assert.equal(secondResult.diff.before_operation, 'menu_confirm');
  assert.equal(secondResult.diff.after_operation, 'menu_confirm');
  assert.equal(secondResult.diff.lifecycle_changed, false, 'before is read after the previous command finishes');
  assert.deepEqual(port.recordedUpdates().filter((update) => update.section === 'menu').map((update) =>
    (update.snapshot as CocosUiShellRenderSnapshot['menu']).view_model?.time_label), ['day 1 minute 420', 'day 1 minute 540']);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 540');
  assertSceneMatchesShell(port, shell);
});

test('initial rendering and commands share one binding order and capture snapshots when their turn starts', async (t) => {
  const { host, shell, port, binding } = makeControlledSceneBinding();
  await binding.execute({ name: 'create_session' });
  const gate = port.pauseNext('lifecycle');
  const initial = binding.applyInitialSnapshot();
  await gate.entered;
  const action = binding.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  const latestInitial = binding.applyInitialSnapshot();
  t.after(async () => {
    gate.resume();
    await Promise.allSettled([initial, action, latestInitial]);
  });
  await settleBindingTurn();
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 360');

  gate.resume();
  const [, , latest] = await Promise.all([initial, action, latestInitial]);
  assert.deepEqual(latest.map((update) => update.section), ['lifecycle', 'menu', 'save_load', 'errors']);
  assert.deepEqual(latest.find((update) => update.section === 'menu')?.snapshot, shell.currentSnapshot().menu);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
  assertSceneMatchesShell(port, shell);
});

test('rejected binding leaves the formal action committed and the queued refresh resynchronizes all sections once', async (t) => {
  const { host, shell, port, binding } = makeControlledSceneBinding();
  await binding.execute({ name: 'create_session' });
  await binding.applyInitialSnapshot();
  const gate = port.pauseNext('menu');
  const error = new Error('controlled-scene-binding-rejection');
  const action = binding.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  const rejection = assert.rejects(action, (caught) => caught === error);
  await gate.entered;
  const recovery = binding.execute({ name: 'refresh' });
  t.after(async () => {
    gate.resume();
    await Promise.allSettled([rejection, recovery]);
  });
  gate.reject(error);
  await rejection;
  const recovered = await recovery;

  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420', 'render recovery must not replay the action');
  assert.equal(recovered.command_result.status, 'completed');
  assert.deepEqual(recovered.diff.changed_sections, ['lifecycle']);
  assert.deepEqual(recovered.applied_updates.map((update) => update.section), ['lifecycle', 'menu', 'save_load', 'errors']);
  assert.ok(recovered.applied_updates.every((update) => update.reason === 'initial_render'));
  assertSceneMatchesShell(port, shell);
  const healthy = await binding.execute({ name: 'refresh' });
  assert.deepEqual(healthy.applied_updates, [], 'a healthy unchanged refresh must keep the diff optimization');
});

test('failed initial rendering and repeated recovery failures stay dirty until a whole batch succeeds', async (t) => {
  const { host, shell, port, binding } = makeControlledSceneBinding();
  await binding.execute({ name: 'create_session' });
  const initialGate = port.pauseNext('menu');
  const initialError = new Error('controlled-initial-rejection');
  const initial = binding.applyInitialSnapshot();
  const initialRejection = assert.rejects(initial, (caught) => caught === initialError);
  await initialGate.entered;
  initialGate.reject(initialError);
  await initialRejection;

  const retryGate = port.pauseNext('errors');
  const retryError = new Error('controlled-recovery-rejection');
  const retry = binding.execute({ name: 'refresh' });
  const retryRejection = assert.rejects(retry, (caught) => caught === retryError);
  t.after(async () => {
    initialGate.resume();
    retryGate.resume();
    await Promise.allSettled([initialRejection, retryRejection]);
  });
  await retryGate.entered;
  retryGate.reject(retryError);
  await retryRejection;

  const recovered = await binding.execute({ name: 'refresh' });
  assert.deepEqual(recovered.diff.changed_sections, []);
  assert.deepEqual(recovered.applied_updates.map((update) => update.section), ['lifecycle', 'menu', 'save_load', 'errors']);
  assertSceneMatchesShell(port, shell);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 360');
});

test('synchronously throwing ports reject the caller without poisoning later binding work', async () => {
  const { host, shell } = makeSceneBinding();
  const port = new ControlledBindingPort<CocosSceneBindingUpdate>();
  const error = new Error('controlled-synchronous-binding-throw');
  let fail = false;
  const binding = CocosSceneBindingController.fromShell(shell, {
    applySceneBindingUpdate(update) {
      if (fail && update.section === 'menu') {
        fail = false;
        throw error;
      }
      return port.apply(update);
    }
  });
  await binding.execute({ name: 'create_session' });
  fail = true;
  await assert.rejects(binding.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } }),
    (caught) => caught === error);
  const recovered = await binding.execute({ name: 'refresh' });
  assert.equal(recovered.command_result.status, 'completed');
  assertSceneMatchesShell(port, shell);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
});
