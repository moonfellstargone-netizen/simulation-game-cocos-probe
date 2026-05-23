import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosActionDispatcher } from '../src/cocos-app/adapters/CocosActionDispatcher';
import { CocosRuntimeFacade } from '../src/cocos-app/adapters/CocosRuntimeFacade';
import { FieldMenuController } from '../src/cocos-app/controllers/FieldMenuController';
import { InventoryMenuController } from '../src/cocos-app/controllers/InventoryMenuController';
import { StorageAudit } from '../src/game-core';
import type { ActionResult, GameState } from '../src/game-core';
import { buildRuntime, cloneForCompare } from './support/runtimeHarness';

function dispatchAndAssert(result: ActionResult, actionType: string): ActionResult {
  assert.equal(result.success, true, `${actionType} failed with ${result.status_code}`);
  return result;
}

function runCoreLoopThroughCocosAdapter() {
  const { runtime, state, configs, contracts } = buildRuntime();
  const dispatcher = new CocosActionDispatcher(runtime.pipeline, () => state);
  const facade = new CocosRuntimeFacade(dispatcher, () => state, configs, contracts);
  const refs: Record<string, string> = {};

  const plant = dispatchAndAssert(facade.dispatch('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  }), 'plant_crop');
  refs.crop = plant.created_objects.find((item) => item.object_type === 'CropInstance')!.object_id;

  dispatchAndAssert(facade.dispatch('advance_time', { minutes: 5400 }), 'advance_time');

  const harvest = dispatchAndAssert(facade.dispatch('harvest_crop', { crop_id: refs.crop }), 'harvest_crop');
  refs.cabbage_lot = harvest.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const split = dispatchAndAssert(facade.dispatch('split_lot', {
    source_lot_id: refs.cabbage_lot,
    quantity: { amount: 300, unit: 'g' }
  }), 'split_lot');
  refs.cabbage_split_lot = split.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const start = dispatchAndAssert(facade.dispatch('start_processing', {
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

  dispatchAndAssert(facade.dispatch('advance_time', { minutes: 2880 }), 'advance_time');

  const collect = dispatchAndAssert(facade.dispatch('collect_processing_result', { task_id: refs.pickling_task }), 'collect_processing_result');
  refs.pickled_cabbage_lot = collect.created_objects.find((item) => item.object_type === 'MaterialLot')!.object_id;

  const cook = dispatchAndAssert(facade.dispatch('cook_dish', {
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

  const submit = dispatchAndAssert(facade.dispatch('submit_order', {
    order_id: 'tavern_home_dish_001',
    submitted_object_refs: [{ object_type: 'DishLot', object_id: refs.dish_lot }]
  }), 'submit_order');

  return { runtime, state, contracts, dispatcher, facade, refs, submit };
}

test('Cocos adapter can run the Stage 1A formal core loop and returns ActionResult without direct SaveFile writes', () => {
  const { state, contracts, refs } = runCoreLoopThroughCocosAdapter();
  const order = state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001');

  assert.equal(order?.status, 'completed');
  assert.equal(Number(state.save_file.player_state.money), 137);
  assert.deepEqual(state.save_file.player_state.reputation_map, { west_market_tavern: 1 });
  assert.equal(state.save_file.dish_lots.some((item) => item.dish_lot_id === refs.dish_lot), false);
  assert.equal(state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_type === 'DishLot' && ref.object_id === refs.dish_lot)), false);
  contracts.assertSaveFile(state.save_file);
  new StorageAudit().assertReconciled(state.save_file);
});

test('Cocos adapter rejects system and non-formal actions before dispatching into ActionPipeline', () => {
  const { runtime, state } = buildRuntime();
  const dispatcher = new CocosActionDispatcher(runtime.pipeline, () => state);
  const before = cloneForCompare(state);

  assert.throws(() => dispatcher.dispatchRequest({
    request_id: 'bad_system_from_cocos',
    actor_id: 'player',
    action_type: 'system.release_reservation',
    created_time: state.save_file.world_time.absolute_minute,
    idempotency_key: 'bad_system_from_cocos',
    parameters: {}
  }), /ERR_DEV_RUNNER_SYSTEM_ACTION_FORBIDDEN/);
  assert.deepEqual(state, before);

  assert.throws(() => dispatcher.dispatchRequest({
    request_id: 'bad_debug_from_cocos',
    actor_id: 'player',
    action_type: 'debug_shortcut',
    created_time: state.save_file.world_time.absolute_minute,
    idempotency_key: 'bad_debug_from_cocos',
    parameters: {}
  }), /ERR_DEV_RUNNER_ACTION_NOT_FORMAL/);
  assert.deepEqual(state, before);
});

test('CocosRuntimeFacade view model is read-only and summarizes completed loop state', () => {
  const { state, facade } = runCoreLoopThroughCocosAdapter();
  const before = cloneForCompare(state);
  const viewModel = facade.getViewModel();

  assert.equal(viewModel.money, 137);
  assert.equal(viewModel.orders.find((order) => order.id === 'tavern_home_dish_001')?.status, 'completed');
  assert.equal(viewModel.dish_lot_count, 0);
  assert.equal(viewModel.active_reservation_count, 0);
  assert.deepEqual(state, before);
});

test('Existing menu controllers dispatch through Cocos runtime facade formal request path', () => {
  const { runtime, state, configs, contracts } = buildRuntime();
  const dispatcher = new CocosActionDispatcher(runtime.pipeline, () => state);
  const facade = new CocosRuntimeFacade(dispatcher, () => state, configs, contracts);
  const field = new FieldMenuController(facade);
  const inventory = new InventoryMenuController(facade);

  const plant = field.requestPlantCabbage('field_plot_01', 'seed_cabbage_initial_001');
  assert.equal(plant.success, true);
  const cropId = plant.created_objects.find((item) => item.object_type === 'CropInstance')!.object_id;
  const tooEarlyHarvest = field.requestHarvest(cropId);
  assert.equal(tooEarlyHarvest.success, false);
  assert.equal(tooEarlyHarvest.domain_events.length, 0);

  const split = inventory.requestSplit('salt_initial_001', { amount: 1, unit: 'g' });
  assert.equal(split.success, true);
});

test('Cocos adapter source stays presentation-only and does not depend on fixture or direct state mutation patterns', () => {
  const root = process.cwd();
  const files = collectFiles(join(root, 'src/cocos-app')).filter((file) => file.endsWith('.ts'));
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');

  for (const forbidden of ['Stage1AFixtureRunner', 'save_result_aliases', 'system.inject_active_reservation', 'system.release_reservation']) {
    assert.equal(combined.includes(forbidden), false, `cocos-app leaked forbidden token ${forbidden}`);
  }
  for (const forbiddenPattern of [/save_file\.[A-Za-z0-9_]+\s*=/, /\.inventory\s*=/, /\.orders\s*=/, /\.dish_lots\s*=/, /\.reservations\s*=/]) {
    assert.equal(forbiddenPattern.test(combined), false, `cocos-app contains direct state mutation pattern ${forbiddenPattern}`);
  }
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
