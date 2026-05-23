import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CocosComponentNodeBindingAdapter,
  QinglanUiSceneProbeComponent,
  RecordingCocosComponentNodeBindingPort,
  RecordingCocosSceneBindingPort,
  createNodeBindingPatch,
  mapSceneSectionToNodeTarget,
  CocosSessionHost,
  CocosUiShellController,
  CocosSceneBindingController
} from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';
import { testBuildId } from './support/buildId.mjs';

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
