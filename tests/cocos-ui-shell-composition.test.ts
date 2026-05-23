import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosSessionHost, CocosUiShellController } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

function makeShell() {
  const { configs, contracts } = buildRuntimeWithoutState();
  const storage = new InMemorySaveStoragePort();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: testBuildId('cocos_ui_shell_test'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  const shell = new CocosUiShellController(host);
  return { host, shell, storage };
}

test('Cocos UI shell composes session host, menu, save/load and error presentation without real Creator nodes', async () => {
  const { host, shell } = makeShell();
  assert.equal(shell.currentSnapshot().lifecycle.has_session, false);

  const created = shell.createSession();
  assert.equal(host.hasSession(), true);
  assert.equal(created.lifecycle.last_operation, 'create_session');
  assert.equal(created.menu.view_model?.time_label, 'day 1 minute 360');
  assert.equal(created.save_load.view_model?.time_label, 'day 1 minute 360');
  assert.equal(created.menu.selectable_view_model?.field_options.some((option) => option.enabled), true);

  const previewed = shell.previewMenu({ action_type: 'advance_time', minutes: 60 });
  assert.equal(previewed.lifecycle.last_operation, 'menu_preview');
  assert.equal(previewed.menu.last_preview_result?.success, true);
  assert.equal(host.requireSession().getViewModel().time_label, 'day 1 minute 360');

  const saved = await shell.save({ slot_id: 'shell_initial' });
  assert.equal(saved.lifecycle.last_operation, 'save');
  assert.equal(saved.save_load.last_save_result?.slot_id, 'shell_initial');
  assert.equal(saved.errors.length, 0);

  const advanced = shell.confirmMenu({ action_type: 'advance_time', minutes: 60 });
  assert.equal(advanced.lifecycle.last_operation, 'menu_confirm');
  assert.equal(advanced.menu.last_action_result?.success, true);
  assert.equal(advanced.menu.view_model?.time_label, 'day 1 minute 420');
  assert.equal(advanced.save_load.view_model?.time_label, 'day 1 minute 420');

  const loaded = await shell.load({ slot_id: 'shell_initial' });
  assert.equal(loaded.lifecycle.last_operation, 'load');
  assert.equal(loaded.save_load.last_load_result?.slot_id, 'shell_initial');
  assert.equal(loaded.menu.view_model?.time_label, 'day 1 minute 360');
  assert.equal(loaded.save_load.view_model?.time_label, 'day 1 minute 360');
  assert.equal(loaded.save_load.errors.length, 0);
});

test('Cocos UI shell presents load errors without damaging the current session', async () => {
  const { host, shell, storage } = makeShell();
  shell.createSession();
  const before = cloneForCompare(host.requireSession().getViewModel());
  await storage.write('shell_broken', '{"broken":true}');

  const failed = await shell.load({ slot_id: 'shell_broken' });
  assert.equal(failed.lifecycle.last_operation, 'load');
  assert.equal(failed.save_load.last_load_result, null);
  assert.equal(failed.save_load.errors.some((error) => error.code === 'ERR_COCOS_SESSION_LOAD_REJECTED'), true);
  assert.deepEqual(host.requireSession().getViewModel(), before);
  assert.deepEqual(failed.menu.view_model, before);
});

test('Cocos UI shell reports shell-level lifecycle errors through the shell snapshot', () => {
  const { shell } = makeShell();
  const missingSession = shell.refresh();

  assert.equal(missingSession.lifecycle.has_session, false);
  assert.equal(missingSession.lifecycle.last_operation, 'refresh');
  assert.equal(missingSession.errors.some((error) => error.code === 'ERR_COCOS_SESSION_NOT_CREATED'), true);
});

test('Cocos UI shell source stays engine-neutral and only composes existing UI/session boundaries', () => {
  const files = collectFiles(join(process.cwd(), 'src/cocos-creator-adapter/shell')).filter((file) => file.endsWith('.ts'));
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');

  for (const required of [
    'CocosSessionHost',
    'MinimalMenuInteractionController',
    'SaveLoadInteractionController',
    'CocosErrorPresenter',
    'CocosUiShellRenderSnapshot'
  ]) {
    assert.equal(combined.includes(required), true, `shell source missing ${required}`);
  }

  for (const forbidden of [
    'game-core/dev-api',
    'game-core/testing-api',
    'Stage1AFixtureRunner',
    'Stage1AHeadlessRuntime',
    'Stage1AActionScriptRunner',
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
    'domain_events',
    'field_plot_01',
    'seed_cabbage_initial_001',
    'salt_initial_001',
    'pickling_jar_basic_01'
  ]) {
    assert.equal(combined.includes(forbidden), false, `shell source leaked forbidden token ${forbidden}`);
  }

  for (const forbiddenPattern of [/\.inventory\s*=/, /\.orders\s*=/, /\.dish_lots\s*=/, /\.reservations\s*=/, /\.money\s*=/]) {
    assert.equal(forbiddenPattern.test(combined), false, `shell source contains direct state mutation pattern ${forbiddenPattern}`);
  }
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
