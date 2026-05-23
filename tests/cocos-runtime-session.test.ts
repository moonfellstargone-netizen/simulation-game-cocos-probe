import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosAppRuntimeSession } from '../src/cocos-app/runtime/CocosAppRuntimeSession';
import { FieldMenuController } from '../src/cocos-app/controllers/FieldMenuController';
import { InventoryMenuController } from '../src/cocos-app/controllers/InventoryMenuController';
import { InMemorySaveStoragePort, type ActionResult } from '../src/game-core';
import { buildRuntimeWithoutState } from './support/runtimeHarness';

function makeSession(storage = new InMemorySaveStoragePort()) {
  const { configs, contracts } = buildRuntimeWithoutState();
  return {
    session: new CocosAppRuntimeSession(configs, contracts, storage, {
      buildId: 'cocos_session_test_v0_0_2_22',
      nowIso8601: '2026-05-19T00:00:00.000Z'
    }),
    storage
  };
}

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
