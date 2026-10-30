import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosSessionHost, SaveLoadInteractionController } from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, type SaveStoragePort } from '../src/game-core';
import { buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';
import { ControlledSaveStoragePort, captureSerializedSession } from './support/controlledSaveStoragePort';

function makeSaveUi(storage: SaveStoragePort = new InMemorySaveStoragePort()) {
  const { configs, contracts } = buildRuntimeWithoutState();
  const host = new CocosSessionHost(configs, contracts, storage, {
    buildId: testBuildId('cocos_save_load_ui_test'),
    nowIso8601: '2026-05-21T00:00:00.000Z'
  });
  host.createSession();
  const controller = new SaveLoadInteractionController(host);
  return { host, controller, storage };
}

test('Save/load UI binding saves and loads only through session host and refreshes render snapshots', async () => {
  const { host, controller } = makeSaveUi();
  const initial = controller.refresh();
  assert.equal(initial.view_model?.time_label, 'day 1 minute 360');
  assert.equal(initial.selectable_view_model?.field_options.some((field) => field.enabled), true);

  const saved = await controller.save({ slot_id: 'slot_stage1a_initial' });
  assert.equal(saved.last_save_result?.slot_id, 'slot_stage1a_initial');
  assert.equal(saved.last_save_result.byte_length > 0, true);
  assert.equal(saved.errors.length, 0);

  const plantResult = host.requireSession().dispatch('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  });
  assert.equal(plantResult.success, true);
  assert.equal(host.requireSession().getSelectableViewModel().field_options.find((field) => field.id === 'field_plot_01')?.enabled, false);

  const loaded = await controller.load({ slot_id: 'slot_stage1a_initial' });
  assert.equal(loaded.last_load_result?.slot_id, 'slot_stage1a_initial');
  assert.equal(loaded.view_model?.time_label, 'day 1 minute 360');
  assert.equal(loaded.selectable_view_model?.field_options.find((field) => field.id === 'field_plot_01')?.enabled, true);
  assert.equal(loaded.errors.length, 0);
});

test('Failed load is presented as an error and does not damage the current session state', async () => {
  const { host, controller, storage } = makeSaveUi();
  const before = cloneForCompare(host.requireSession().getViewModel());
  await storage.write('broken_slot', '{"not":"a valid runtime snapshot"}');

  const result = await controller.load({ slot_id: 'broken_slot' });
  assert.equal(result.last_load_result, null);
  assert.equal(result.errors.some((error) => error.code === 'ERR_COCOS_SESSION_LOAD_REJECTED'), true);
  assert.deepEqual(host.requireSession().getViewModel(), before);
  assert.deepEqual(result.view_model, before);

  const afterFailureSave = await controller.save({ slot_id: 'slot_after_failed_load' });
  assert.equal(afterFailureSave.last_save_result?.slot_id, 'slot_after_failed_load');
  assert.equal(afterFailureSave.errors.length, 0);
});

for (const operation of ['read', 'write'] as const) {
  test(`Save/load UI presents ordinary ${operation} errors, clears old success results, and recovers`, async () => {
    const storage = new ControlledSaveStoragePort();
    const { host, controller } = makeSaveUi(storage);
    const session = host.requireSession();
    const initialView = session.getViewModel();
    const initialSave = await controller.save({ slot_id: 'ui_recovery' });
    assert.equal(initialSave.last_save_result?.slot_id, 'ui_recovery');
    const savedState = await storage.read('ui_recovery');
    assert.notEqual(savedState, null);
    if (operation === 'read') {
      const loaded = await controller.load({ slot_id: 'ui_recovery' });
      assert.equal(loaded.last_load_result?.slot_id, 'ui_recovery');
    }
    assert.equal(session.dispatch('advance_time', { minutes: 60 }).success, true);
    const beforeView = session.getViewModel();
    const beforeSelectable = session.getSelectableViewModel();
    const beforeState = await captureSerializedSession(session, storage, `ui_before_${operation}`);
    const failure = new Error(`storage ${operation} interrupted`);
    storage.failNext(operation, failure);

    const failed = operation === 'read'
      ? await controller.load({ slot_id: 'ui_recovery' })
      : await controller.save({ slot_id: 'ui_write_retry' });
    assert.equal(failed.last_save_result, null);
    assert.equal(failed.last_load_result, null);
    assert.deepEqual(failed.errors, [{ code: null, message: failure.message }]);
    assert.deepEqual(failed.view_model, beforeView);
    assert.deepEqual(failed.selectable_view_model, beforeSelectable);
    assert.deepEqual(session.getViewModel(), beforeView);
    assert.equal(await captureSerializedSession(session, storage, `ui_after_${operation}_failure`), beforeState);

    const retried = operation === 'read'
      ? await controller.load({ slot_id: 'ui_recovery' })
      : await controller.save({ slot_id: 'ui_write_retry' });
    assert.deepEqual(retried.errors, []);
    if (operation === 'read') {
      assert.equal(retried.last_load_result?.slot_id, 'ui_recovery');
      assert.deepEqual(retried.view_model, initialView);
      assert.equal(await captureSerializedSession(session, storage, 'ui_after_read_retry'), savedState);
    } else {
      assert.equal(retried.last_save_result?.slot_id, 'ui_write_retry');
      assert.equal(await storage.read('ui_write_retry'), beforeState);
      assert.deepEqual(retried.view_model, beforeView);
    }
  });
}

test('Save/load UI binding rejects invalid slot selections before storage access', async () => {
  const { host, controller } = makeSaveUi();
  const before = cloneForCompare(host.requireSession().getViewModel());

  const emptySlot = await controller.save({ slot_id: '   ' });
  assert.equal(emptySlot.last_save_result, null);
  assert.equal(emptySlot.errors.some((error) => error.code === 'ERR_SAVE_SLOT_ID_REQUIRED'), true);
  assert.deepEqual(host.requireSession().getViewModel(), before);

  const unsupportedSlot = await controller.load({ slot_id: 'bad slot with spaces' });
  assert.equal(unsupportedSlot.last_load_result, null);
  assert.equal(unsupportedSlot.errors.some((error) => error.code === 'ERR_SAVE_SLOT_ID_UNSUPPORTED'), true);
  assert.deepEqual(host.requireSession().getViewModel(), before);
});

test('Save/load UI binding source stays engine-neutral and does not touch raw runtime state', () => {
  const files = [
    ...collectFiles(join(process.cwd(), 'src/cocos-creator-adapter/save')).filter((file) => file.endsWith('.ts')),
    ...collectFiles(join(process.cwd(), 'src/cocos-creator-adapter/errors')).filter((file) => file.endsWith('.ts'))
  ];
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');

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
    assert.equal(combined.includes(forbidden), false, `save/load UI source leaked forbidden token ${forbidden}`);
  }

  for (const forbiddenPattern of [/\.inventory\s*=/, /\.orders\s*=/, /\.dish_lots\s*=/, /\.reservations\s*=/, /\.money\s*=/]) {
    assert.equal(forbiddenPattern.test(combined), false, `save/load UI source contains direct mutation pattern ${forbiddenPattern}`);
  }
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
