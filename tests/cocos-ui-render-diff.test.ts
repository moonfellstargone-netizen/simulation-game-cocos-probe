import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CocosSessionHost, CocosUiShellController, diffCocosUiShellSnapshots } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

function makeShell() {
  const { configs, contracts } = buildRuntimeWithoutState();
  const storage = new InMemorySaveStoragePort();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: testBuildId('cocos_ui_render_diff_test'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  const shell = new CocosUiShellController(host);
  return { host, shell, storage };
}

test('render snapshot diff returns no changed sections for identical snapshots and does not mutate inputs', () => {
  const { shell } = makeShell();
  const before = shell.currentSnapshot();
  const beforeClone = cloneForCompare(before);
  const afterClone = cloneForCompare(before);

  const diff = diffCocosUiShellSnapshots(before, afterClone);
  assert.deepEqual(diff.changed_sections, []);
  assert.equal(diff.lifecycle_changed, false);
  assert.equal(diff.menu_changed, false);
  assert.equal(diff.save_load_changed, false);
  assert.equal(diff.errors_changed, false);
  assert.deepEqual(before, beforeClone);
  assert.deepEqual(afterClone, beforeClone);
});

test('render snapshot diff detects create, preview, confirm, save and load sections with stable order', async () => {
  const { shell } = makeShell();
  const initial = shell.currentSnapshot();
  const created = shell.createSession();
  const createDiff = diffCocosUiShellSnapshots(initial, created);
  assert.deepEqual(createDiff.changed_sections, ['lifecycle', 'menu', 'save_load']);
  assert.equal(createDiff.lifecycle_changed, true);
  assert.equal(createDiff.menu_changed, true);
  assert.equal(createDiff.save_load_changed, true);
  assert.equal(createDiff.before_operation, null);
  assert.equal(createDiff.after_operation, 'create_session');

  const savedInitial = await shell.save({ slot_id: 'diff_initial' });
  const saveDiff = diffCocosUiShellSnapshots(created, savedInitial);
  assert.deepEqual(saveDiff.changed_sections, ['lifecycle', 'save_load']);
  assert.equal(saveDiff.save_load_changed, true);

  const previewed = shell.previewMenu({ action_type: 'advance_time', minutes: 60 });
  const previewDiff = diffCocosUiShellSnapshots(savedInitial, previewed);
  assert.equal(previewDiff.lifecycle_changed, true);
  assert.equal(previewDiff.menu_changed, true);
  assert.deepEqual(previewDiff.changed_sections, ['lifecycle', 'menu']);

  const confirmed = shell.confirmMenu({ action_type: 'advance_time', minutes: 60 });
  const confirmDiff = diffCocosUiShellSnapshots(previewed, confirmed);
  assert.equal(confirmDiff.menu_changed, true);
  assert.equal(confirmDiff.save_load_changed, true);
  assert.deepEqual(confirmDiff.changed_sections, ['lifecycle', 'menu', 'save_load']);

  const loaded = await shell.load({ slot_id: 'diff_initial' });
  const loadDiff = diffCocosUiShellSnapshots(confirmed, loaded);
  assert.equal(loadDiff.menu_changed, true);
  assert.equal(loadDiff.save_load_changed, true);
  assert.deepEqual(loadDiff.changed_sections, ['lifecycle', 'menu', 'save_load']);
});

test('render snapshot diff detects failed load presentation changes', async () => {
  const { shell, storage } = makeShell();
  shell.createSession();
  await storage.write('diff_broken', '{"broken":true}');
  const before = shell.currentSnapshot();

  const failed = await shell.load({ slot_id: 'diff_broken' });
  const diff = diffCocosUiShellSnapshots(before, failed);
  assert.equal(diff.lifecycle_changed, true);
  assert.equal(diff.save_load_changed, true);
  assert.equal(diff.changed_sections.includes('save_load'), true);
  assert.equal(failed.save_load.errors.some((error) => error.code === 'ERR_COCOS_SESSION_LOAD_REJECTED'), true);
});

test('render snapshot diff source stays a lightweight shell snapshot summary', () => {
  const text = readFileSync(join(process.cwd(), 'src/cocos-creator-adapter/shell/CocosUiShellSnapshotDiff.ts'), 'utf8');
  for (const required of [
    'CocosUiShellSnapshotDiff',
    'CocosUiShellSnapshotSection',
    'diffCocosUiShellSnapshots',
    'changed_sections',
    'lifecycle_changed',
    'menu_changed',
    'save_load_changed',
    'errors_changed'
  ]) {
    assert.equal(text.includes(required), true, `snapshot diff source missing ${required}`);
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
    assert.equal(text.includes(forbidden), false, `snapshot diff source leaked forbidden token ${forbidden}`);
  }
});
