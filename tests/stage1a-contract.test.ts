import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntime, cloneForCompare } from './support/runtimeHarness';
import { StorageAudit } from '../src/game-core/index';
import type { GameRuntime, GameState } from '../src/game-core/index';

const picklingFacilityRef = { location_id: 'home', storage_type: 'pickling_jar', container_id: 'pickling_jar_basic_01', definition_id: 'pickling_jar_basic', facility_id: 'pickling_jar_basic_01' };

function dispatch(runtime: GameRuntime, state: GameState, action_type: string, parameters: unknown, suffix: string) {
  return runtime.pipeline.dispatch(state, {
    request_id: `req_${suffix}`,
    actor_id: 'player',
    action_type,
    created_time: state.save_file.world_time.absolute_minute,
    idempotency_key: `idem_${suffix}`,
    parameters
  });
}

function prepareHarvestedCabbage(runtime: GameRuntime, state: GameState): string {
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }, 'prepare_plant');
  assert.equal(plant.success, true);
  dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'prepare_time');
  const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: plant.created_objects[0]!.object_id }, 'prepare_harvest');
  assert.equal(harvest.success, true);
  return harvest.created_objects[0]!.object_id;
}

function prepareProcessingTask(runtime: GameRuntime, state: GameState): string {
  const cabbageLotId = prepareHarvestedCabbage(runtime, state);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 300, unit: 'g' } }, 'prepare_split');
  assert.equal(split.success, true);
  const start = dispatch(runtime, state, 'start_processing', {
    method_id: 'pickling_cabbage_basic',
    input_lots: [
      { lot_id: split.created_objects[0]!.object_id, quantity: { amount: 300, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ],
    facility_ref: picklingFacilityRef
  }, 'prepare_start_processing');
  assert.equal(start.success, true);
  return start.created_objects[0]!.object_id;
}



function preparePickledCabbage(runtime: GameRuntime, state: GameState): string {
  const taskId = prepareProcessingTask(runtime, state);
  const ready = dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'prepare_pickled_ready');
  assert.equal(ready.success, true);
  const collect = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'prepare_pickled_collect');
  assert.equal(collect.success, true);
  return collect.created_objects[0]!.object_id;
}

function cookBaconCabbage(runtime: GameRuntime, state: GameState, pickledLotId: string, suffix = 'cook_bacon_cabbage') {
  return dispatch(runtime, state, 'cook_dish', {
    recipe_variant_id: 'bacon_cabbage_basic',
    ingredients: {
      main: { lot_id: pickledLotId, quantity: { amount: 250, unit: 'g' } },
      side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
      oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
    },
    technique: 'stir_fry',
    operation_profile: { heat_level: 'high', active_minutes: 8 },
    target_storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: 'home_room_temp_01' }
  }, suffix);
}

test('NewGameBuilder output validates against save_file.schema.json', () => {
  const { contracts, state } = buildRuntime();
  assert.doesNotThrow(() => contracts.assertSaveFile(state.save_file));
  new StorageAudit().assertReconciled(state.save_file);
});

test('plant_crop creates schema-valid DomainEvent and ActionResult mutation summary', () => {
  const { contracts, runtime, state } = buildRuntime();
  const request = {
    request_id: 'req_contract_plant_001',
    actor_id: 'player',
    action_type: 'plant_crop',
    created_time: state.save_file.world_time.absolute_minute,
    idempotency_key: 'idem_contract_plant_001',
    parameters: {
      field_plot_id: 'field_plot_01',
      seed_lot_id: 'seed_cabbage_initial_001',
      seed_quantity: { amount: 1, unit: 'count' }
    }
  };
  assert.doesNotThrow(() => contracts.assertActionRequest(request));
  const result = runtime.pipeline.dispatch(state, request);
  assert.equal(result.success, true);
  assert.equal(result.consumed_resources[0]?.resource_id, 'seed_cabbage_initial_001');
  assert.equal(result.created_objects[0]?.object_type, 'CropInstance');
  assert.equal(result.updated_objects.some((item) => item.object_type === 'FieldPlotState'), true);
  assert.equal(result.domain_events[0]?.event_type, 'farming.crop_planted');
  assert.equal(result.domain_events[0]?.source_action_id, request.request_id);
  assert.doesNotThrow(() => contracts.assertDomainEvent(result.domain_events[0]!));
  assert.doesNotThrow(() => contracts.assertActionResult(result));
  new StorageAudit().assertReconciled(state.save_file);
});

test('split_lot creates a new lot and leaves storage used_capacity reconciled', () => {
  const { contracts, runtime, state } = buildRuntime();
  const lotId = prepareHarvestedCabbage(runtime, state);
  const result = dispatch(runtime, state, 'split_lot', { source_lot_id: lotId, quantity: { amount: 300, unit: 'g' } }, 'split_lot');

  assert.equal(result.success, true);
  assert.equal(result.created_objects[0]?.object_type, 'MaterialLot');
  assert.equal(result.updated_objects.some((item) => item.object_id === lotId), true);
  assert.equal(result.domain_events.some((event) => event.event_type === 'inventory.lot_created'), true);
  assert.equal(result.domain_events.some((event) => event.event_type === 'inventory.lot_updated'), true);
  assert.doesNotThrow(() => contracts.assertActionResult(result));
  for (const event of result.domain_events) assert.doesNotThrow(() => contracts.assertDomainEvent(event));
  new StorageAudit().assertReconciled(state.save_file);
});

test('start_processing consumes configured input lots, creates schema-valid ProcessingTask, and reports event summary', () => {
  const { contracts, runtime, state } = buildRuntime();
  const cabbageLotId = prepareHarvestedCabbage(runtime, state);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 300, unit: 'g' } }, 'proc_split');
  const splitLotId = split.created_objects[0]!.object_id;
  const result = dispatch(runtime, state, 'start_processing', {
    method_id: 'pickling_cabbage_basic',
    input_lots: [
      { lot_id: splitLotId, quantity: { amount: 300, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ],
    facility_ref: picklingFacilityRef
  }, 'proc_start');

  assert.equal(result.success, true);
  assert.equal(result.created_objects[0]?.object_type, 'ProcessingTask');
  assert.equal(result.consumed_resources.length, 2);
  assert.equal(result.domain_events[0]?.event_type, 'processing.task_started');
  const task = state.save_file.processing_tasks.find((item) => item.task_id === result.created_objects[0]?.object_id);
  assert.ok(task);
  assert.equal(task.status, 'active');
  assert.equal(task.current_stage, 'fermenting');
  assert.doesNotThrow(() => contracts.assertProcessingTask(task!));
  assert.doesNotThrow(() => contracts.assertActionResult(result));
  for (const event of result.domain_events) assert.doesNotThrow(() => contracts.assertDomainEvent(event));
  new StorageAudit().assertReconciled(state.save_file);
});

test('processing task state machine closes active -> ready_to_collect -> completed and collect creates schema-valid MaterialLot', () => {
  const { contracts, runtime, state } = buildRuntime();
  const taskId = prepareProcessingTask(runtime, state);
  const task = state.save_file.processing_tasks.find((item) => item.task_id === taskId)!;
  assert.equal(task.status, 'active');

  const readyResult = dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'proc_ready');
  assert.equal(readyResult.success, true);
  assert.equal(task.status, 'ready_to_collect');
  assert.equal(task.current_stage, 'ready');
  assert.doesNotThrow(() => contracts.assertProcessingTask(task));

  const collect = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'proc_collect');
  assert.equal(collect.success, true);
  assert.equal(task.status, 'completed');
  assert.equal(collect.created_objects[0]?.object_type, 'MaterialLot');
  assert.equal(collect.updated_objects.some((item) => item.object_type === 'ProcessingTask' && item.object_id === taskId), true);
  assert.equal(collect.domain_events[0]?.event_type, 'processing.task_completed');
  const outputLot = state.save_file.inventory.find((item) => item.lot_id === collect.created_objects[0]!.object_id)!;
  assert.equal(outputLot.base_id, 'cabbage');
  assert.equal(outputLot.current_form, 'pickled');
  assert.equal(outputLot.source_ref.source_id, taskId);
  assert.doesNotThrow(() => contracts.assertProcessingTask(task));
  assert.doesNotThrow(() => contracts.assertMaterialLot(outputLot));
  assert.doesNotThrow(() => contracts.assertActionResult(collect));
  for (const event of collect.domain_events) assert.doesNotThrow(() => contracts.assertDomainEvent(event));
  new StorageAudit().assertReconciled(state.save_file);
});

test('failed basic actions roll back SaveFile, DomainEvent stream, and storage reconciliation cache', () => {
  const { runtime, state } = buildRuntime();
  const audit = new StorageAudit();

  const beforePlant = cloneForCompare(state);
  const invalidPlant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'missing_seed_lot', seed_quantity: { amount: 1, unit: 'count' } }, 'bad_plant');
  assert.equal(invalidPlant.success, false);
  assert.deepEqual(state, beforePlant);
  audit.assertReconciled(state.save_file);

  const cabbageLotId = prepareHarvestedCabbage(runtime, state);

  const beforeSplit = cloneForCompare(state);
  const invalidSplit = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 999999, unit: 'g' } }, 'bad_split');
  assert.equal(invalidSplit.success, false);
  assert.deepEqual(state, beforeSplit);
  audit.assertReconciled(state.save_file);

  const beforeStore = cloneForCompare(state);
  const invalidStore = dispatch(runtime, state, 'store_item', { object_ref: { object_type: 'MaterialLot', object_id: cabbageLotId }, storage_ref: { location_id: 'home', storage_type: 'missing', container_id: 'missing_container' } }, 'bad_store');
  assert.equal(invalidStore.success, false);
  assert.deepEqual(state, beforeStore);
  audit.assertReconciled(state.save_file);
});

test('processing failures roll back task creation, input consumption, output creation, and DomainEvent stream', () => {
  const { runtime, state } = buildRuntime();
  const audit = new StorageAudit();

  const missingTaskBefore = cloneForCompare(state);
  const missingTask = dispatch(runtime, state, 'collect_processing_result', { task_id: 'missing_task' }, 'bad_collect_missing');
  assert.equal(missingTask.success, false);
  assert.equal(missingTask.status_code, 'ERR_PROCESSING_TASK_NOT_FOUND');
  assert.deepEqual(state, missingTaskBefore);
  audit.assertReconciled(state.save_file);

  const taskId = prepareProcessingTask(runtime, state);
  const beforeNotReady = cloneForCompare(state);
  const notReady = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'bad_collect_not_ready');
  assert.equal(notReady.success, false);
  assert.equal(notReady.status_code, 'ERR_PROCESSING_TASK_NOT_READY');
  assert.deepEqual(state, beforeNotReady);
  audit.assertReconciled(state.save_file);

  dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'collect_ready_for_repeat');
  const collect = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'collect_once');
  assert.equal(collect.success, true);
  const beforeRepeat = cloneForCompare(state);
  const repeat = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'bad_collect_repeat');
  assert.equal(repeat.success, false);
  assert.equal(repeat.status_code, 'ERR_PROCESSING_TASK_ALREADY_COMPLETED');
  assert.deepEqual(state, beforeRepeat);
  audit.assertReconciled(state.save_file);

  const fresh = buildRuntime();
  const freshState = fresh.state;
  const freshRuntime = fresh.runtime;
  const lotId = prepareHarvestedCabbage(freshRuntime, freshState);
  const beforeInputShortage = cloneForCompare(freshState);
  const inputShortage = dispatch(freshRuntime, freshState, 'start_processing', {
    method_id: 'pickling_cabbage_basic',
    input_lots: [
      { lot_id: lotId, quantity: { amount: 999999, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
    ],
    facility_ref: picklingFacilityRef
  }, 'bad_start_input_shortage');
  assert.equal(inputShortage.success, false);
  assert.deepEqual(freshState, beforeInputShortage);
  audit.assertReconciled(freshState.save_file);
});

test('storage audit rejects ghost references left by invalid external state', () => {
  const { state } = buildRuntime();
  state.save_file.storage_containers[0]!.active_object_refs.push({ object_type: 'MaterialLot', object_id: 'ghost_lot' });
  const report = new StorageAudit().audit(state.save_file);
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === 'ERR_STORAGE_GHOST_REF'), true);
});


test('cook_dish consumes configured lots, creates schema-valid DishLot, and keeps storage reconciled', () => {
  const { contracts, runtime, state } = buildRuntime();
  const pickledLotId = preparePickledCabbage(runtime, state);
  const result = cookBaconCabbage(runtime, state, pickledLotId, 'cook_success_contract');

  assert.equal(result.success, true);
  assert.equal(result.created_objects[0]?.object_type, 'DishLot');
  assert.equal(result.consumed_resources.some((item) => item.resource_id === pickledLotId), true);
  assert.equal(result.consumed_resources.some((item) => item.resource_id === 'bacon_initial_001'), true);
  assert.equal(result.consumed_resources.some((item) => item.resource_id === 'oil_initial_001'), true);
  assert.equal(result.updated_objects.some((item) => item.object_type === 'StorageContainer'), true);
  assert.equal(result.domain_events[0]?.event_type, 'cooking.dish_created');
  assert.equal(state.save_file.inventory.find((item) => item.lot_id === pickledLotId)?.quantity.amount, 50);

  const dish = state.save_file.dish_lots.find((item) => item.dish_lot_id === result.created_objects[0]?.object_id);
  assert.ok(dish);
  assert.equal(dish?.recognized_dish_id, 'bacon_cabbage');
  assert.equal(dish?.serving_count, 2);
  assert.equal(dish?.components.some((item) => item.source_lot_id === pickledLotId && item.role === 'main'), true);
  assert.equal(dish?.suitability_tags.includes('home_style'), true);
  assert.equal(typeof dish?.dish_profile.saltiness, 'number');
  assert.equal(typeof dish?.dish_profile.oiliness, 'number');
  assert.equal(typeof dish?.dish_profile.wateriness, 'number');
  assert.equal(typeof dish?.dish_profile.safety_risk, 'number');
  contracts.assertDishLot(dish!);
  contracts.assertActionResult(result);
  for (const event of result.domain_events) contracts.assertDomainEvent(event);
  new StorageAudit().assertReconciled(state.save_file);
});

test('submit_order resolves demand profile, completes order, rewards player, and removes submitted DishLot from storage', () => {
  const { contracts, runtime, state } = buildRuntime();
  const pickledLotId = preparePickledCabbage(runtime, state);
  const cook = cookBaconCabbage(runtime, state, pickledLotId, 'order_prepare_cook');
  const dishId = cook.created_objects[0]!.object_id;
  const beforeMoney = Number(state.save_file.player_state.money);
  const beforeRep = Number((state.save_file.player_state.reputation_map as Record<string, number>).west_market_tavern);
  const result = dispatch(runtime, state, 'submit_order', {
    order_id: 'tavern_home_dish_001',
    submitted_object_refs: [{ object_type: 'DishLot', object_id: dishId }]
  }, 'submit_success_contract');

  assert.equal(result.success, true);
  assert.equal(result.status_code, 'OK_DEMAND_ACCEPTED');
  assert.equal(result.domain_events.map((event) => event.event_type).includes('order.submitted'), true);
  assert.equal(result.domain_events.map((event) => event.event_type).includes('order.completed'), true);
  assert.equal(result.updated_objects.some((item) => item.object_type === 'Order'), true);
  assert.equal(result.updated_objects.some((item) => item.object_type === 'PlayerState'), true);
  assert.equal(result.consumed_resources[0]?.resource_type, 'DishLot');
  assert.equal(result.consumed_resources[0]?.resource_id, dishId);

  const order = state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001');
  assert.equal(order?.status, 'completed');
  assert.equal(order?.submitted_object_refs[0]?.object_id, dishId);
  assert.equal(order?.result_summary?.result_key, 'OK_DEMAND_ACCEPTED');
  assert.equal(Number(order?.result_summary?.match_score) >= 60, true);
  assert.equal(Number(order?.result_summary?.reward_final) > 0, true);
  assert.equal(Number(state.save_file.player_state.money) > beforeMoney, true);
  assert.equal(Number((state.save_file.player_state.reputation_map as Record<string, number>).west_market_tavern), beforeRep + 1);
  assert.equal(state.save_file.dish_lots.some((item) => item.dish_lot_id === dishId), false);
  assert.equal(state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_type === 'DishLot' && ref.object_id === dishId)), false);

  contracts.assertOrder(order!);
  contracts.assertSaveFile(state.save_file);
  contracts.assertActionResult(result);
  for (const event of result.domain_events) contracts.assertDomainEvent(event);
  new StorageAudit().assertReconciled(state.save_file);
});

test('cooking and submit_order failures roll back SaveFile, DomainEvent stream, and StorageAudit state', () => {
  const audit = new StorageAudit();

  {
    const { runtime, state } = buildRuntime();
    const pickledLotId = preparePickledCabbage(runtime, state);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'cook_dish', {
      recipe_variant_id: 'bacon_cabbage_basic',
      ingredients: {
        main: { lot_id: pickledLotId, quantity: { amount: 999999, unit: 'g' } },
        side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
        oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
      },
      technique: 'stir_fry',
      operation_profile: { heat_level: 'high', active_minutes: 8 }
    }, 'bad_cook_shortage');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_NOT_ENOUGH_RESOURCE');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'cook_dish', {
      recipe_variant_id: 'bacon_cabbage_basic',
      ingredients: {
        main: { lot_id: 'salt_initial_001', quantity: { amount: 250, unit: 'g' } },
        side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
        oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
      },
      technique: 'stir_fry',
      operation_profile: { heat_level: 'high', active_minutes: 8 }
    }, 'bad_cook_illegal_form');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_INVALID_LOT_STATE');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const pickledLotId = preparePickledCabbage(runtime, state);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'cook_dish', {
      recipe_variant_id: 'bacon_cabbage_basic',
      ingredients: {
        main: { lot_id: pickledLotId, quantity: { amount: 250, unit: 'g' } },
        side: { lot_id: 'bacon_initial_001', quantity: { amount: 50, unit: 'g' } },
        oil: { lot_id: 'oil_initial_001', quantity: { amount: 10, unit: 'ml' } }
      },
      technique: 'boil',
      operation_profile: { heat_level: 'high', active_minutes: 8 }
    }, 'bad_cook_technique');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_COOKING_TECHNIQUE_MISMATCH');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'submit_order', {
      order_id: 'missing_order',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: 'missing_dish' }]
    }, 'bad_order_missing');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ORDER_NOT_FOUND');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: 'missing_dish' }]
    }, 'bad_order_object_missing');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_DISH_LOT_NOT_FOUND');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'MaterialLot', object_id: 'salt_initial_001' }]
    }, 'bad_order_object_type');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_SUBMITTED_OBJECT_TYPE_UNSUPPORTED');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }

  {
    const { runtime, state } = buildRuntime();
    const pickledLotId = preparePickledCabbage(runtime, state);
    const cook = cookBaconCabbage(runtime, state, pickledLotId, 'repeat_submit_prepare');
    const dishId = cook.created_objects[0]!.object_id;
    const first = dispatch(runtime, state, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: dishId }]
    }, 'repeat_submit_first');
    assert.equal(first.success, true);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: dishId }]
    }, 'repeat_submit_second');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ORDER_NOT_AVAILABLE');
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
  }
});

function injectTestReservation(state: GameState, lotId: string, amount: number, suffix: string): string {
  const lot = state.save_file.inventory.find((item) => item.lot_id === lotId);
  assert.ok(lot);
  const reservationId = `res_test_${suffix}`;
  state.save_file.reservations.push({
    reservation_id: reservationId,
    actor_id: 'test_runner',
    target_ref: { object_type: 'MaterialLot', object_id: lotId },
    quantity: { amount, unit: lot.quantity.unit },
    reason: 'reservation_guard_contract_test',
    created_time: state.save_file.world_time.absolute_minute,
    expire_time: null,
    status: 'active',
    source_action_id: null,
    flags: ['test_only']
  });
  return reservationId;
}

function releaseTestReservation(state: GameState, reservationId: string): void {
  const reservation = state.save_file.reservations.find((item) => item.reservation_id === reservationId);
  assert.ok(reservation);
  reservation.status = 'released';
}

test('active reservation blocks split_lot, start_processing, and cook_dish without polluting failed Action state', () => {
  const audit = new StorageAudit();

  {
    const { contracts, runtime, state } = buildRuntime();
    const cabbageLotId = prepareHarvestedCabbage(runtime, state);
    const reservationId = injectTestReservation(state, cabbageLotId, 50, 'split');
    const reservation = state.save_file.reservations.find((item) => item.reservation_id === reservationId)!;
    contracts.assertReservation(reservation);
    audit.assertReconciled(state.save_file);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 50, unit: 'g' } }, 'reserved_split_failure');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ALREADY_RESERVED');
    assert.equal(failed.domain_events.length, 0);
    assert.equal(failed.event_log_entries.length, 0);
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
    releaseTestReservation(state, reservationId);
    const releasedSplit = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 50, unit: 'g' } }, 'released_split_success');
    assert.equal(releasedSplit.success, true);
    contracts.assertSaveFile(state.save_file);
    audit.assertReconciled(state.save_file);
  }

  {
    const { contracts, runtime, state } = buildRuntime();
    const cabbageLotId = prepareHarvestedCabbage(runtime, state);
    const split = dispatch(runtime, state, 'split_lot', { source_lot_id: cabbageLotId, quantity: { amount: 300, unit: 'g' } }, 'reservation_processing_split');
    assert.equal(split.success, true);
    const splitLotId = split.created_objects[0]!.object_id;
    const reservationId = injectTestReservation(state, splitLotId, 50, 'processing');
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'start_processing', {
      method_id: 'pickling_cabbage_basic',
      input_lots: [
        { lot_id: splitLotId, quantity: { amount: 300, unit: 'g' } },
        { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
      ],
      facility_ref: picklingFacilityRef
    }, 'reserved_processing_failure');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ALREADY_RESERVED');
    assert.equal(failed.domain_events.length, 0);
    assert.equal(failed.event_log_entries.length, 0);
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
    releaseTestReservation(state, reservationId);
    const releasedStart = dispatch(runtime, state, 'start_processing', {
      method_id: 'pickling_cabbage_basic',
      input_lots: [
        { lot_id: splitLotId, quantity: { amount: 300, unit: 'g' } },
        { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
      ],
      facility_ref: picklingFacilityRef
    }, 'released_processing_success');
    assert.equal(releasedStart.success, true);
    contracts.assertSaveFile(state.save_file);
    audit.assertReconciled(state.save_file);
  }

  {
    const { contracts, runtime, state } = buildRuntime();
    const pickledLotId = preparePickledCabbage(runtime, state);
    const reservationId = injectTestReservation(state, pickledLotId, 50, 'cooking');
    const before = cloneForCompare(state);
    const failed = cookBaconCabbage(runtime, state, pickledLotId, 'reserved_cooking_failure');
    assert.equal(failed.success, false);
    assert.equal(failed.status_code, 'ERR_ALREADY_RESERVED');
    assert.equal(failed.domain_events.length, 0);
    assert.equal(failed.event_log_entries.length, 0);
    assert.deepEqual(state, before);
    audit.assertReconciled(state.save_file);
    releaseTestReservation(state, reservationId);
    const releasedCook = cookBaconCabbage(runtime, state, pickledLotId, 'released_cooking_success');
    assert.equal(releasedCook.success, true);
    contracts.assertSaveFile(state.save_file);
    audit.assertReconciled(state.save_file);
  }
});

test('StorageAudit detects active reservation target and quantity inconsistencies', () => {
  const { runtime, state } = buildRuntime();
  const audit = new StorageAudit();
  const cabbageLotId = prepareHarvestedCabbage(runtime, state);
  const lot = state.save_file.inventory.find((item) => item.lot_id === cabbageLotId)!;

  const excessive = injectTestReservation(state, cabbageLotId, lot.quantity.amount + 1, 'excessive');
  let report = audit.audit(state.save_file);
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === 'ERR_RESERVATION_QUANTITY_EXCEEDS_LOT' && issue.object_id === cabbageLotId), true);

  state.save_file.reservations = state.save_file.reservations.filter((item) => item.reservation_id !== excessive);
  state.save_file.reservations.push({
    reservation_id: 'res_test_ghost',
    actor_id: 'test_runner',
    target_ref: { object_type: 'MaterialLot', object_id: 'missing_lot_for_reservation' },
    quantity: { amount: 1, unit: 'g' },
    reason: 'reservation_audit_contract_test',
    created_time: state.save_file.world_time.absolute_minute,
    expire_time: null,
    status: 'active',
    source_action_id: null,
    flags: ['test_only']
  });
  report = audit.audit(state.save_file);
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === 'ERR_RESERVATION_TARGET_MISSING' && issue.object_id === 'missing_lot_for_reservation'), true);
});
