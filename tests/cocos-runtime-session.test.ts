import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosAppRuntimeSession } from '../src/cocos-app/runtime/CocosAppRuntimeSession';
import { FieldMenuController } from '../src/cocos-app/controllers/FieldMenuController';
import { InventoryMenuController } from '../src/cocos-app/controllers/InventoryMenuController';
import { InMemorySaveStoragePort, type ActionResult, type SaveStoragePort } from '../src/game-core';
import { buildRuntimeWithoutState } from './support/runtimeHarness';
import { ControlledSaveStoragePort, captureSerializedSession } from './support/controlledSaveStoragePort';

function makeSession(storage: SaveStoragePort = new InMemorySaveStoragePort()) {
  const { configs, contracts } = buildRuntimeWithoutState();
  return {
    configs,
    session: new CocosAppRuntimeSession(configs, contracts, storage, {
      buildId: testBuildId('cocos_session_test'),
      nowIso8601: '2026-05-19T00:00:00.000Z'
    }),
    storage
  };
}

test('processing required inputs direct session failures preserve the save and allow load, healthy start and collection', async () => {
  const storage = new InMemorySaveStoragePort();
  const { session, configs } = makeSession(storage);
  const plant = dispatchAndAssert(session.dispatch('plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }), 'plant_crop');
  dispatchAndAssert(session.dispatch('advance_time', { minutes: 5400 }), 'advance_time');
  const harvest = dispatchAndAssert(session.dispatch('harvest_crop', { crop_id: plant.created_objects[0]!.object_id }), 'harvest_crop');
  const cabbageId = harvest.created_objects[0]!.object_id;
  const method = configs.requiredDoc<{ input_view_requirements: Array<{ base_id?: string; min_quantity_g?: number }>; process_duration_minutes: number; output_form_rules: { success_form: string } }>('configs/processing/methods/pickling_cabbage_basic.yaml');
  const minimumSalt = method.input_view_requirements.find((item) => item.base_id === 'salt')!.min_quantity_g!;
  const primary = { lot_id: cabbageId, quantity: { amount: 300, unit: 'g' } };
  const salt = { lot_id: 'salt_initial_001', quantity: { amount: minimumSalt, unit: 'g' } };
  const facility_ref = { location_id: 'home', storage_type: 'pickling_jar', container_id: 'pickling_jar_basic_01', definition_id: 'pickling_jar_basic', facility_id: 'pickling_jar_basic_01' };
  const before = await captureSerializedSession(session, storage, 'processing_before');
  const beforeView = session.getViewModel();
  const beforeSelectable = session.getSelectableViewModel();
  for (const input_lots of [[primary], [salt], [primary, { ...salt, quantity: { amount: minimumSalt - 0.001, unit: 'g' } }]]) {
    const failed = session.dispatch('start_processing', { method_id: 'pickling_cabbage_basic', input_lots, facility_ref });
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_PROCESSING_INPUT_MISSING');
    assert.deepEqual(failed.domain_events, []);
    assert.deepEqual(failed.event_log_entries, []);
    assert.deepEqual(session.getViewModel(), beforeView);
    assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);
    assert.equal(await captureSerializedSession(session, storage, 'processing_after_failure'), before);
  }
  await session.save('processing_recovery');
  dispatchAndAssert(session.dispatch('advance_time', { minutes: 60 }), 'advance_time');
  await session.load('processing_recovery');
  assert.equal(await captureSerializedSession(session, storage, 'processing_after_load'), before);
  const started = dispatchAndAssert(session.dispatch('start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [primary, salt], facility_ref }), 'start_processing');
  const taskId = started.created_objects[0]!.object_id;
  assert.equal(taskId, 'task_processing_000001', 'failures allocate no task ID');
  const afterStart = JSON.parse(await captureSerializedSession(session, storage, 'processing_active'));
  const beforeSave = JSON.parse(before);
  for (const [lotId, consumed] of [[cabbageId, 300], ['salt_initial_001', minimumSalt]] as const) {
    assert.equal(afterStart.inventory.find((lot: { lot_id: string }) => lot.lot_id === lotId).quantity.amount,
      beforeSave.inventory.find((lot: { lot_id: string }) => lot.lot_id === lotId).quantity.amount - consumed);
  }
  const restored = makeSession(storage).session;
  await restored.load('processing_active');
  assert.equal(restored.getViewModel().processing_tasks.find((task) => task.id === taskId)?.status, 'active');
  dispatchAndAssert(restored.dispatch('advance_time', { minutes: method.process_duration_minutes }), 'advance_time');
  assert.equal(restored.getViewModel().processing_tasks.find((task) => task.id === taskId)?.status, 'ready_to_collect');
  const collected = dispatchAndAssert(restored.dispatch('collect_processing_result', { task_id: taskId }), 'collect_processing_result');
  const output = restored.getSelectableViewModel().splittable_lot_options.find((lot) => lot.id === collected.created_objects[0]!.object_id)!;
  assert.equal(output.base_id, 'cabbage');
  assert.equal(output.current_form, method.output_form_rules.success_form);
  assert.deepEqual(output.quantity, primary.quantity);
  assert.equal(restored.getViewModel().processing_tasks.find((task) => task.id === taskId)?.status, 'completed');
  const complete = await captureSerializedSession(restored, storage, 'processing_complete');
  await restored.load('processing_complete');
  assert.equal(await captureSerializedSession(restored, storage, 'processing_complete_reloaded'), complete);
  dispatchAndAssert(restored.dispatch('advance_time', { minutes: 60 }), 'advance_time');
});

function dispatchAndAssert(result: ActionResult, actionType: string): ActionResult {
  assert.equal(result.success, true, `${actionType} failed with ${result.status_code}`);
  return result;
}

function runCoreLoopThroughSession(session: CocosAppRuntimeSession) {
  const refs: Record<string, string> = {};

  const plant = dispatchAndAssert(session.dispatch('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  }), 'plant_crop');
  refs.crop = plant.created_objects.find((item) => item.object_type === 'CropInstance')!.object_id;

  dispatchAndAssert(session.dispatch('advance_time', { minutes: 5400 }), 'advance_time');

  const harvest = dispatchAndAssert(session.dispatch('harvest_crop', { crop_id: refs.crop }), 'harvest_crop');
  refs.cabbage_lot = harvest.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const split = dispatchAndAssert(session.dispatch('split_lot', {
    source_lot_id: refs.cabbage_lot,
    quantity: { amount: 300, unit: 'g' }
  }), 'split_lot');
  refs.cabbage_split_lot = split.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const start = dispatchAndAssert(session.dispatch('start_processing', {
    method_id: 'pickling_cabbage_basic',
    input_lots: [
      { lot_id: refs.cabbage_split_lot, quantity: { amount: 300, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ],
    facility_ref: {
      location_id: 'home',
      storage_type: 'pickling_jar',
      container_id: 'pickling_jar_basic_01',
      definition_id: 'pickling_jar_basic',
      facility_id: 'pickling_jar_basic_01'
    }
  }), 'start_processing');
  refs.pickling_task = start.created_objects.find((item) => item.object_type === 'ProcessingTask')!.object_id;

  dispatchAndAssert(session.dispatch('advance_time', { minutes: 2880 }), 'advance_time');

  const collect = dispatchAndAssert(session.dispatch('collect_processing_result', { task_id: refs.pickling_task }), 'collect_processing_result');
  refs.pickled_cabbage_lot = collect.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const cook = dispatchAndAssert(session.dispatch('cook_dish', {
    recipe_variant_id: 'bacon_cabbage_basic',
    ingredients: {
      main: { lot_id: refs.pickled_cabbage_lot, quantity: { amount: 250, unit: 'g' } },
      side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
      oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
    },
    technique: 'stir_fry',
    operation_profile: { heat_level: 'high', active_minutes: 8 },
    target_storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: 'home_room_temp_01' }
  }), 'cook_dish');
  refs.dish_lot = cook.created_objects.find((item) => item.object_type === 'DishLot')!.object_id;

  dispatchAndAssert(session.dispatch('submit_order', {
    order_id: 'tavern_home_dish_001',
    submitted_object_refs: [{ object_type: 'DishLot', object_id: refs.dish_lot }]
  }), 'submit_order');

  return refs;
}

test('CocosAppRuntimeSession runs Stage 1A through public session.dispatch and view model only', () => {
  const { session } = makeSession();
  runCoreLoopThroughSession(session);
  const viewModel = session.getViewModel();

  assert.equal(viewModel.money, 137);
  assert.equal(viewModel.orders.find((order) => order.id === 'tavern_home_dish_001')?.status, 'completed');
  assert.equal(viewModel.dish_lot_count, 0);
  assert.equal(viewModel.active_reservation_count, 0);
});

test('CocosAppRuntimeSession rejects system actions before formal dispatch and keeps view state unchanged', () => {
  const { session } = makeSession();
  const before = session.getViewModel();

  assert.throws(() => session.dispatch('system.inject_active_reservation' as never, {}), /ERR_DEV_RUNNER_SYSTEM_ACTION_FORBIDDEN/);
  assert.deepEqual(session.getViewModel(), before);
});

test('CocosAppRuntimeSession saves and loads only through SaveManager plus SaveStoragePort', async () => {
  const storage = new InMemorySaveStoragePort();
  const first = makeSession(storage).session;
  runCoreLoopThroughSession(first);

  const saved = await first.save('slot_stage1a');
  assert.equal(saved.slot_id, 'slot_stage1a');
  assert.equal(saved.world_minute > 0, true);
  assert.equal(saved.byte_length > 0, true);

  const second = makeSession(storage).session;
  const loaded = await second.load('slot_stage1a');
  assert.equal(loaded.slot_id, 'slot_stage1a');
  assert.equal(loaded.view_model.money, 137);
  assert.equal(second.getViewModel().orders.find((order) => order.id === 'tavern_home_dish_001')?.status, 'completed');
  assert.equal(second.getViewModel().dish_lot_count, 0);
});

test('Session distinguishes a read rejection from a missing slot, preserves complete state, and can retry', async () => {
  const storage = new ControlledSaveStoragePort();
  const { session } = makeSession(storage);
  const initialView = session.getViewModel();
  const savedState = await captureSerializedSession(session, storage, 'session_recovery');
  dispatchAndAssert(session.dispatch('advance_time', { minutes: 60 }), 'advance_time');
  const beforeView = session.getViewModel();
  const beforeSelectable = session.getSelectableViewModel();
  const beforeState = await captureSerializedSession(session, storage, 'session_before_read');
  assert.notEqual(beforeState, savedState);

  const failure = new Error('storage read interrupted');
  storage.failNext('read', failure);
  await assert.rejects(session.load('session_recovery'), { message: failure.message });
  assert.deepEqual(session.getViewModel(), beforeView);
  assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);
  assert.equal(await captureSerializedSession(session, storage, 'session_after_read_failure'), beforeState);

  assert.equal(await storage.read('session_missing'), null);
  await assert.rejects(session.load('session_missing'), /ERR_SAVE_SLOT_NOT_FOUND:session_missing/);
  assert.deepEqual(session.getViewModel(), beforeView);
  assert.equal(await captureSerializedSession(session, storage, 'session_after_missing'), beforeState);

  const loaded = await session.load('session_recovery');
  assert.deepEqual(loaded.view_model, initialView);
  assert.equal(await captureSerializedSession(session, storage, 'session_after_read_retry'), savedState);
});

test('Session rejects a failed write without changing complete state and permits a healthy retry', async () => {
  const storage = new ControlledSaveStoragePort();
  const { session } = makeSession(storage);
  dispatchAndAssert(session.dispatch('advance_time', { minutes: 60 }), 'advance_time');
  const beforeView = session.getViewModel();
  const beforeSelectable = session.getSelectableViewModel();
  const beforeState = await captureSerializedSession(session, storage, 'session_before_write');

  const failure = new Error('storage write interrupted');
  storage.failNext('write', failure);
  await assert.rejects(session.save('session_write_retry'), { message: failure.message });
  assert.deepEqual(session.getViewModel(), beforeView);
  assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);
  assert.equal(await captureSerializedSession(session, storage, 'session_after_write_failure'), beforeState);

  const saved = await session.save('session_write_retry');
  assert.equal(saved.slot_id, 'session_write_retry');
  assert.equal(await storage.read('session_write_retry'), beforeState);
  assert.deepEqual(session.getViewModel(), beforeView);
});

test('Cocos menu controllers depend on session dispatch boundary rather than raw dispatcher state access', () => {
  const { session } = makeSession();
  const field = new FieldMenuController(session);
  const inventory = new InventoryMenuController(session);

  const plant = dispatchAndAssert(field.requestPlantCabbage('field_plot_01', 'seed_cabbage_initial_001'), 'plant_crop');
  const cropId = plant.created_objects.find((item) => item.object_type === 'CropInstance')!.object_id;
  const tooEarlyHarvest = field.requestHarvest(cropId);
  assert.equal(tooEarlyHarvest.success, false);
  assert.equal(tooEarlyHarvest.domain_events.length, 0);

  const split = inventory.requestSplit('salt_initial_001', { amount: 1, unit: 'g' });
  assert.equal(split.success, true);
});

test('Cocos session and save port sources remain platform-neutral and do not import dev/testing runtime', () => {
  const root = process.cwd();
  const files = [
    ...collectFiles(join(root, 'src/cocos-app')).filter((file) => file.endsWith('.ts')),
    join(root, 'src/game-core/save/SaveStoragePort.ts')
  ];
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');

  for (const forbidden of [
    'Stage1AFixtureRunner',
    'Stage1AHeadlessRuntime',
    'Stage1AActionScriptRunner',
    'game-core/dev-api',
    'game-core/testing-api',
    'system.inject_active_reservation',
    'system.release_reservation',
    'save_result_aliases',
    "from 'node:fs'",
    'from "node:fs"',
    "from 'fs'",
    'from "fs"',
    "from 'cc'",
    'from "cc"',
    'wx.'
  ]) {
    assert.equal(combined.includes(forbidden), false, `session boundary leaked forbidden token ${forbidden}`);
  }
  for (const forbiddenPattern of [/save_file\.[A-Za-z0-9_]+\s*=/, /\.inventory\s*=/, /\.orders\s*=/, /\.dish_lots\s*=/, /\.reservations\s*=/]) {
    assert.equal(forbiddenPattern.test(combined), false, `session boundary contains direct state mutation pattern ${forbiddenPattern}`);
  }
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
