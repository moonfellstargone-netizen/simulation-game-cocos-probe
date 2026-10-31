import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CocosComponentNodeBindingAdapter,
  QinglanUiSceneProbeComponent,
  RecordingCocosComponentNodeBindingPort,
  RecordingCocosSceneBindingPort,
  createNodeBindingPatch,
  mapSceneSectionToNodeTarget,
  CocosSessionHost,
  CocosUiShellController,
  CocosSceneBindingController,
  createStage1AHost,
  type CocosComponentNodeBindingPatch
} from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type RuntimeConfigSnapshot } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';
import { testBuildId } from './support/buildId.mjs';
import { ControlledBindingPort, settleBindingTurn } from './support/controlledBindingPort';

function makeComponentProbe() {
  const { configs, contracts } = buildRuntimeWithoutState();
  const storage = new InMemorySaveStoragePort();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: testBuildId('cocos_component_node_binding_test'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  const nodePort = new RecordingCocosComponentNodeBindingPort();
  const component = new QinglanUiSceneProbeComponent(host, nodePort);
  return { host, storage, nodePort, component };
}

test('component node binding maps scene sections to stable node targets', () => {
  assert.equal(mapSceneSectionToNodeTarget('lifecycle'), 'lifecycle_panel');
  assert.equal(mapSceneSectionToNodeTarget('menu'), 'menu_panel');
  assert.equal(mapSceneSectionToNodeTarget('save_load'), 'save_load_panel');
  assert.equal(mapSceneSectionToNodeTarget('errors'), 'error_panel');

  const patch = createNodeBindingPatch({
    sequence: 3,
    section: 'errors',
    reason: 'changed_section',
    operation: 'refresh',
    snapshot: []
  });
  assert.equal(patch.target, 'error_panel');
  assert.equal(patch.visible, false);
  assert.deepEqual(patch.payload, []);
});

test('component probe mounts through shell and applies node binding patches without direct core access', async () => {
  const { host, nodePort, component } = makeComponentProbe();

  const mounted = await component.mount();
  assert.equal(mounted.command_result.status, 'completed');
  assert.equal(host.hasSession(), true);
  assert.deepEqual(nodePort.recordedPatches().map((patch) => patch.target), ['lifecycle_panel', 'menu_panel', 'save_load_panel']);
  assert.deepEqual(nodePort.recordedPatches().map((patch) => patch.reason), ['changed_section', 'changed_section', 'changed_section']);

  const beforePreview = cloneForCompare(host.requireSession().getViewModel());
  nodePort.clear();
  const previewed = await component.execute({ name: 'menu_preview', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(previewed.command_result.status, 'completed');
  assert.deepEqual(nodePort.recordedPatches().map((patch) => patch.target), ['lifecycle_panel', 'menu_panel']);
  assert.deepEqual(host.requireSession().getViewModel(), beforePreview);

  nodePort.clear();
  const confirmed = await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(confirmed.command_result.status, 'completed');
  assert.deepEqual(nodePort.recordedPatches().map((patch) => patch.target), ['lifecycle_panel', 'menu_panel', 'save_load_panel']);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
});

test('component node binding adapter consumes scene binding updates and preserves payload copies', async () => {
  const { configs, contracts } = buildRuntimeWithoutState();
  const storage = new InMemorySaveStoragePort();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: testBuildId('component_adapter_scene_bridge'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  const shell = new CocosUiShellController(host);
  const scenePort = new RecordingCocosSceneBindingPort();
  const sceneBinding = CocosSceneBindingController.fromShell(shell, scenePort);
  const nodePort = new RecordingCocosComponentNodeBindingPort();
  const adapter = new CocosComponentNodeBindingAdapter(nodePort);

  const created = await sceneBinding.execute({ name: 'create_session' });
  for (const update of created.applied_updates) {
    await adapter.applySceneBindingUpdate(update);
  }

  const patches = nodePort.recordedPatches();
  assert.deepEqual(patches.map((patch) => patch.section), ['lifecycle', 'menu', 'save_load']);
  assert.deepEqual(patches.map((patch) => patch.target), ['lifecycle_panel', 'menu_panel', 'save_load_panel']);
  assert.equal((patches[0].payload as { has_session: boolean }).has_session, true);

  const leaked = nodePort.recordedPatches();
  (leaked[0].payload as { has_session: boolean }).has_session = false;
  assert.equal((nodePort.recordedPatches()[0].payload as { has_session: boolean }).has_session, true);
});

test('component probe surfaces load failure patches and preserves current session', async () => {
  const { host, storage, nodePort, component } = makeComponentProbe();
  await component.mount();
  await component.execute({ name: 'save', selection: { slot_id: 'component_initial' } });
  await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });

  const beforeFailedLoad = cloneForCompare(host.requireSession().getViewModel());
  await storage.write('component_broken', '{"broken":true}');
  nodePort.clear();

  const failed = await component.execute({ name: 'load', selection: { slot_id: 'component_broken' } });
  assert.equal(failed.command_result.status, 'failed');
  assert.equal(nodePort.recordedPatches().some((patch) => patch.target === 'save_load_panel'), true);
  assert.equal(nodePort.recordedPatches().some((patch) => patch.target === 'save_load_panel' && Array.isArray((patch.payload as { errors?: unknown[] }).errors) && ((patch.payload as { errors?: unknown[] }).errors?.length ?? 0) > 0), true);
  assert.deepEqual(host.requireSession().getViewModel(), beforeFailedLoad);
});

test('component probe can unmount without retaining a session', async () => {
  const { host, nodePort, component } = makeComponentProbe();
  await component.mount();
  nodePort.clear();

  const destroyed = await component.unmount();
  assert.equal(destroyed.command_result.status, 'completed');
  assert.equal(host.hasSession(), false);
  assert.deepEqual(nodePort.recordedPatches().map((patch) => patch.target), ['lifecycle_panel']);
});

// The async component regressions enter through the public bootstrap, not the runtime harness.
function makeControlledComponentProbe() {
  const snapshot = JSON.parse(readFileSync('design_snapshot/generated/stage_1A_runtime_snapshot.json', 'utf8')) as RuntimeConfigSnapshot;
  const schemas = Object.fromEntries(snapshot.schema_paths.map((path) => [path,
    JSON.parse(readFileSync(`design_snapshot/${path}`, 'utf8')) as unknown]));
  const host = createStage1AHost({
    snapshot,
    schemas,
    storage: new InMemorySaveStoragePort(),
    buildId: testBuildId('component_async_binding'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  const shell = new CocosUiShellController(host);
  const nodePort = new ControlledBindingPort<CocosComponentNodeBindingPatch>();
  const component = new QinglanUiSceneProbeComponent(host, {
    applyNodeBindingPatch: (patch) => nodePort.apply(patch)
  }, { shell });
  return { host, shell, nodePort, component };
}

function assertNodesMatchShell(port: ControlledBindingPort<CocosComponentNodeBindingPatch>, shell: CocosUiShellController) {
  const snapshot = shell.currentSnapshot();
  for (const section of ['lifecycle', 'menu', 'save_load', 'errors'] as const) {
    assert.deepEqual(port.latest(section)?.payload, snapshot[section], `actual ${section} node must match the shell`);
  }
}

test('public component applies a successful action after a failed load and keeps failure history observable', async () => {
  const { host, shell, nodePort, component } = makeControlledComponentProbe();
  await component.mount();
  await component.applyInitialSnapshot();
  const before = host.requireSession().getViewModel();
  const failedLoad = await component.execute({ name: 'load', selection: { slot_id: 'component_missing' } });
  assert.equal(failedLoad.command_result.status, 'failed');
  assert.match(failedLoad.command_result.error_message ?? '', /ERR_SAVE_SLOT_NOT_FOUND/);
  assert.deepEqual(host.requireSession().getViewModel(), before);
  assertNodesMatchShell(nodePort, shell);
  const failureSnapshot = structuredClone(failedLoad);

  const confirmed = await component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(confirmed.command_result.status, 'completed');
  assert.equal(confirmed.command_result.error_message, null);
  assert.equal(confirmed.command_result.snapshot.menu.last_action_result?.success, true);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
  assert.equal((nodePort.latest('menu')?.payload as { view_model: { time_label: string } }).view_model.time_label, 'day 1 minute 420');
  assert.deepEqual(confirmed.command_result.snapshot.save_load.errors, failedLoad.command_result.snapshot.save_load.errors);
  assertNodesMatchShell(nodePort, shell);

  const refreshed = await component.refresh();
  assert.equal(refreshed.command_result.status, 'completed');
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
  assertNodesMatchShell(nodePort, shell);
  const unmounted = await component.unmount();
  assert.equal(unmounted.command_result.status, 'completed');
  assert.equal(unmounted.command_result.snapshot.lifecycle.has_session, false);
  assert.equal(host.hasSession(), false);
  assert.deepEqual(failedLoad, failureSnapshot);
  assertNodesMatchShell(nodePort, shell);
});

test('public component keeps async node updates in command order', async (t) => {
  const { host, shell, nodePort, component } = makeControlledComponentProbe();
  await component.mount();
  await component.applyInitialSnapshot();
  nodePort.clearHistory();
  const gate = nodePort.pauseNext('lifecycle');
  const first = component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  await gate.entered;
  const second = component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 120 } });
  t.after(async () => {
    gate.resume();
    await Promise.allSettled([first, second]);
  });
  await settleBindingTurn();
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
  assert.equal(nodePort.recordedUpdates().length, 0);
  gate.resume();
  await Promise.all([first, second]);

  assert.deepEqual(nodePort.recordedUpdates().filter((patch) => patch.section === 'menu').map((patch) =>
    (patch.payload as { view_model: { time_label: string } }).view_model.time_label), ['day 1 minute 420', 'day 1 minute 540']);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 540');
  assertNodesMatchShell(nodePort, shell);
});

test('public component refresh repairs a partially failed node batch without replaying the formal action', async (t) => {
  const { host, shell, nodePort, component } = makeControlledComponentProbe();
  await component.mount();
  await component.applyInitialSnapshot();
  const gate = nodePort.pauseNext('menu');
  const error = new Error('controlled-node-binding-rejection');
  const action = component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  const rejection = assert.rejects(action, (caught) => caught === error);
  await gate.entered;
  const refresh = component.refresh();
  t.after(async () => {
    gate.resume();
    await Promise.allSettled([rejection, refresh]);
  });
  gate.reject(error);
  await rejection;
  const recovered = await refresh;

  assert.equal(recovered.command_result.status, 'completed');
  assert.deepEqual(recovered.applied_updates.map((update) => update.section), ['lifecycle', 'menu', 'save_load', 'errors']);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
  assertNodesMatchShell(nodePort, shell);
  assert.deepEqual((await component.refresh()).applied_updates, []);
});

test('public component unmount waits for old node applications and cannot be overwritten by a late batch', async (t) => {
  const { host, shell, nodePort, component } = makeControlledComponentProbe();
  await component.mount();
  const gate = nodePort.pauseNext('lifecycle');
  const action = component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  await gate.entered;
  const unmount = component.unmount();
  t.after(async () => {
    gate.resume();
    await Promise.allSettled([action, unmount]);
  });
  await settleBindingTurn();
  assert.equal(host.hasSession(), true, 'unmount remains behind the pending binding operation');
  gate.resume();
  await Promise.all([action, unmount]);
  assert.equal(host.hasSession(), false);
  assert.deepEqual(nodePort.latest('lifecycle')?.payload, { has_session: false, last_operation: 'destroy_session' });
  const applied = nodePort.recordedUpdates().length;
  await settleBindingTurn();
  assert.equal(nodePort.recordedUpdates().length, applied, 'no older operation applies after unmount completes');
  assert.deepEqual(nodePort.latest('lifecycle')?.payload, shell.currentSnapshot().lifecycle);
});

test('component mount, explicit initial rendering and unmount share their public call order', async (t) => {
  const { host, nodePort, component } = makeControlledComponentProbe();
  const gate = nodePort.pauseNext('lifecycle');
  const mount = component.mount();
  await gate.entered;
  const initial = component.applyInitialSnapshot();
  const unmount = component.unmount();
  t.after(async () => {
    gate.resume();
    await Promise.allSettled([mount, initial, unmount]);
  });
  await settleBindingTurn();
  assert.equal(host.hasSession(), true);
  assert.equal(nodePort.recordedUpdates().length, 0);
  gate.resume();
  const [, initialUpdates] = await Promise.all([mount, initial, unmount]);
  assert.deepEqual(initialUpdates.map((update) => update.section), ['lifecycle', 'menu', 'save_load', 'errors']);
  assert.deepEqual(initialUpdates.find((update) => update.section === 'lifecycle')?.snapshot,
    { has_session: true, last_operation: 'create_session' });
  assert.deepEqual(nodePort.latest('lifecycle')?.payload, { has_session: false, last_operation: 'destroy_session' });
  assert.equal(host.hasSession(), false);
});

test('a node failure can be repaired by explicit initial rendering while business command failure stays visible', async () => {
  const { host, shell, nodePort, component } = makeControlledComponentProbe();
  await component.mount();
  const gate = nodePort.pauseNext('menu');
  const error = new Error('controlled-node-initial-repair');
  const action = component.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  const rejection = assert.rejects(action, (caught) => caught === error);
  await gate.entered;
  gate.reject(error);
  await rejection;
  await component.applyInitialSnapshot();
  assertNodesMatchShell(nodePort, shell);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');

  const failedLoad = await component.execute({ name: 'load', selection: { slot_id: 'missing_binding_slot' } });
  assert.equal(failedLoad.command_result.status, 'failed');
  assert.ok(failedLoad.command_result.snapshot.save_load.errors.length > 0);
  assertNodesMatchShell(nodePort, shell);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 420');
});
