import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosAppRuntimeSession } from '../src/cocos-app/runtime/CocosAppRuntimeSession';
import { FieldMenuController } from '../src/cocos-app/controllers/FieldMenuController';
import { InventoryMenuController } from '../src/cocos-app/controllers/InventoryMenuController';
import { InMemorySaveStoragePort, type ActionResult, type SaveFile, type SaveStoragePort } from '../src/game-core';
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

test('a loaded accepted order preserves rejected submissions, recovers legally and remains settled across a fresh session', async () => {
  const storage = new InMemorySaveStoragePort();
  const seed = makeSession(storage);
  const refs = runCoreLoopThroughSession(seed.session, false);
  const source = JSON.parse(await captureSerializedSession(seed.session, storage, 'accepted_order_source')) as SaveFile;
  source.orders[0]!.status = 'accepted';
  source.orders[0]!.deadline_absolute_minute = source.world_time.absolute_minute + 60;
  const healthy = JSON.stringify(source);
  await storage.write('accepted_order_healthy', healthy);
  const session = makeSession(storage).session;
  const parameters = { order_id: source.orders[0]!.order_id, submitted_object_refs: [{ object_type: 'DishLot', object_id: refs.dish_lot! }] };
  const unsafe = structuredClone(source);
  unsafe.dish_lots.find((dish) => dish.dish_lot_id === refs.dish_lot)!.dish_profile.safety_risk = 26;
  const lowScore = structuredClone(source);
  const poorDish = lowScore.dish_lots.find((dish) => dish.dish_lot_id === refs.dish_lot)!;
  poorDish.dish_profile.safety_risk = 0;
  poorDish.dish_profile.saltiness = 0;
  poorDish.dish_profile.oiliness = 0;
  poorDish.suitability_tags = [];
  poorDish.defects = [];
  for (const failure of [
    { save: source, parameters: { ...parameters, submitted_object_refs: [{ object_type: 'DishLot', object_id: 'missing_order_session_dish' }] }, code: 'ERR_DISH_LOT_NOT_FOUND' },
    { save: unsafe, parameters, code: 'ERR_DEMAND_REJECTED_SAFETY' },
    { save: lowScore, parameters, code: 'ERR_DEMAND_SCORE_TOO_LOW' }
  ]) {
    const serialized = JSON.stringify(failure.save);
    await storage.write('accepted_order_rejection', serialized);
    await session.load('accepted_order_rejection');
    const beforeView = session.getViewModel();
    const beforeSelectable = session.getSelectableViewModel();
    assert.equal(beforeSelectable.order_options[0]!.enabled, true, 'enabled represents state and deadline, not a promise that a chosen dish matches');
    assert.equal(session.preview('submit_order', failure.parameters).status_code, failure.code);
    const rejected = session.dispatch('submit_order', failure.parameters);
    assert.equal(rejected.success, false);
    assert.equal(rejected.status_code, failure.code);
    assert.deepEqual(rejected.domain_events, []);
    assert.deepEqual(rejected.event_log_entries, []);
    assert.deepEqual(rejected.consumed_resources, []);
    assert.equal(await captureSerializedSession(session, storage, 'accepted_order_after_rejection'), serialized);
    assert.deepEqual(session.getViewModel(), beforeView);
    assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);
    await session.load('accepted_order_healthy');
    assert.equal(session.preview('submit_order', parameters).success, true, 'a rejected operation leaves healthy requests usable');
    assert.equal(await captureSerializedSession(session, storage, 'accepted_order_recovered_preview'), healthy);
  }
  const completed = dispatchAndAssert(session.dispatch('submit_order', parameters), 'accepted submit_order');
  assert.deepEqual(completed.domain_events.map((event) => event.event_type), ['order.submitted', 'order.completed']);
  assert.equal(completed.consumed_resources.length, 1);
  assert.equal(completed.consumed_resources[0]!.resource_id, refs.dish_lot);
  const complete = await captureSerializedSession(session, storage, 'accepted_order_completed');
  const save = JSON.parse(complete) as SaveFile;
  const order = save.orders[0]!;
  assert.equal(order.status, 'completed');
  assert.deepEqual(order.submitted_object_refs, parameters.submitted_object_refs);
  assert.equal(order.result_summary!.result_key, 'OK_DEMAND_ACCEPTED');
  assert.ok(order.result_summary!.reward_final! > 0);
  assert.equal(Number(save.player_state.money) - Number(source.player_state.money), order.result_summary!.reward_final);
  const profile = seed.configs.requiredDoc<{ reward_rules: { reputation_delta_on_success: number } }>('configs/demands/tavern_home_dish.yaml');
  const reputation = (state: SaveFile) => Number((state.player_state.reputation_map as Record<string, number>).west_market_tavern);
  assert.equal(reputation(save) - reputation(source), profile.reward_rules.reputation_delta_on_success);
  assert.equal(save.dish_lots.some((dish) => dish.dish_lot_id === refs.dish_lot), false);
  assert.equal(save.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_id === refs.dish_lot)), false);
  assert.deepEqual(save.inventory, source.inventory);
  assert.deepEqual(save.fuel_state, source.fuel_state);
  assert.deepEqual(save.world_time, source.world_time);
  const restored = makeSession(storage).session;
  await restored.load('accepted_order_completed');
  for (const current of [session, restored]) {
    const beforeView = current.getViewModel();
    const beforeSelectable = current.getSelectableViewModel();
    assert.equal(beforeSelectable.order_options[0]!.enabled, false);
    assert.equal(current.preview('submit_order', parameters).status_code, 'ERR_ORDER_NOT_AVAILABLE');
    const duplicate = current.dispatch('submit_order', parameters);
    assert.equal(duplicate.success, false);
    assert.equal(duplicate.status_code, 'ERR_ORDER_NOT_AVAILABLE');
    assert.deepEqual(duplicate.domain_events, []);
    assert.deepEqual(duplicate.event_log_entries, []);
    assert.equal(await captureSerializedSession(current, storage, 'accepted_order_duplicate'), complete);
    assert.deepEqual(current.getViewModel(), beforeView);
    assert.deepEqual(current.getSelectableViewModel(), beforeSelectable);
  }
});

test('loaded open orders share the inclusive deadline and expire through formal time settlement without reviving old failed saves', async () => {
  const storage = new InMemorySaveStoragePort();
  const seed = makeSession(storage).session;
  const refs = runCoreLoopThroughSession(seed, false);
  const source = JSON.parse(await captureSerializedSession(seed, storage, 'order_deadline_source')) as SaveFile;
  const parameters = { order_id: source.orders[0]!.order_id, submitted_object_refs: [{ object_type: 'DishLot', object_id: refs.dish_lot! }] };
  for (const status of ['available', 'accepted']) {
    const save = structuredClone(source);
    save.orders[0]!.status = status;
    save.orders[0]!.deadline_absolute_minute = save.world_time.absolute_minute + 1;
    await storage.write('order_deadline_open', JSON.stringify(save));
    const session = makeSession(storage).session;
    await session.load('order_deadline_open');
    assert.equal(session.getSelectableViewModel().order_options[0]!.enabled, true);
    dispatchAndAssert(session.dispatch('advance_time', { minutes: 1 }), 'advance exactly to deadline');
    assert.equal(session.getViewModel().orders[0]!.status, status);
    assert.equal(session.getSelectableViewModel().order_options[0]!.enabled, true);
    assert.equal(session.preview('submit_order', parameters).success, true, `${status} stays eligible at the exact deadline`);
    dispatchAndAssert(session.dispatch('advance_time', { minutes: 1 }), 'advance beyond deadline');
    assert.equal(session.getViewModel().orders[0]!.status, 'expired');
    assert.equal(session.getSelectableViewModel().order_options[0]!.enabled, false);
    const expired = await captureSerializedSession(session, storage, 'order_deadline_expired');
    const expiredSave = JSON.parse(expired) as SaveFile;
    assert.deepEqual(expiredSave.dish_lots, source.dish_lots);
    assert.deepEqual(expiredSave.storage_containers, source.storage_containers);
    assert.equal(expiredSave.player_state.money, source.player_state.money);
    assert.deepEqual(expiredSave.player_state.reputation_map, source.player_state.reputation_map);
    const rejected = session.dispatch('submit_order', parameters);
    assert.equal(rejected.status_code, 'ERR_ORDER_NOT_AVAILABLE');
    assert.deepEqual(rejected.domain_events, []);
    assert.equal(await captureSerializedSession(session, storage, 'order_deadline_after_reject'), expired);

    const overdue = structuredClone(source);
    overdue.orders[0]!.status = status;
    overdue.orders[0]!.deadline_absolute_minute = overdue.world_time.absolute_minute - 1;
    const serialized = JSON.stringify(overdue);
    await storage.write('order_deadline_overdue_open', serialized);
    await session.load('order_deadline_overdue_open');
    const view = session.getViewModel();
    assert.equal(view.orders[0]!.status, status, 'load does not silently settle an overdue open order');
    assert.equal(session.getSelectableViewModel().order_options[0]!.enabled, false);
    assert.equal(session.preview('submit_order', parameters).status_code, 'ERR_ORDER_NOT_AVAILABLE');
    assert.equal(session.dispatch('submit_order', parameters).status_code, 'ERR_ORDER_NOT_AVAILABLE');
    assert.equal(await captureSerializedSession(session, storage, 'order_deadline_overdue_rejected'), serialized);
    assert.deepEqual(session.getViewModel(), view);
    dispatchAndAssert(session.dispatch('advance_time', { minutes: 1 }), 'settle loaded overdue order');
    assert.equal(session.getViewModel().orders[0]!.status, 'expired');
  }
  const oldFailed = structuredClone(source);
  oldFailed.orders[0]!.status = 'failed';
  oldFailed.orders[0]!.deadline_absolute_minute = oldFailed.world_time.absolute_minute - 1;
  const serialized = JSON.stringify(oldFailed);
  await storage.write('order_deadline_old_failed', serialized);
  const restored = makeSession(storage).session;
  await restored.load('order_deadline_old_failed');
  assert.equal(await captureSerializedSession(restored, storage, 'order_deadline_old_failed_loaded'), serialized, 'old failed states are not migrated');
  dispatchAndAssert(restored.dispatch('advance_time', { minutes: 1 }), 'advance old failed save');
  assert.equal(restored.getViewModel().orders[0]!.status, 'failed');
  assert.equal(restored.getSelectableViewModel().order_options[0]!.enabled, false);
});

test('split quantity failures preserve saved state and full splits survive a fresh-session load with legal recovery', async () => {
  const storage = new InMemorySaveStoragePort();
  const first = makeSession(storage).session;
  const before = await captureSerializedSession(first, storage, 'split_quantity_before');
  const view = first.getViewModel();
  const selectable = first.getSelectableViewModel();
  for (const [source_lot_id, amount, unit] of [['salt_initial_001', 0, 'g'], ['seed_cabbage_initial_001', 0.5, 'count'], ['salt_initial_001', Number.MIN_VALUE, 'g']] as const) {
    const failed = first.dispatch('split_lot', { source_lot_id, quantity: { amount, unit } });
    assert.equal(failed.success, false);
    assert.deepEqual(failed.domain_events, []);
    assert.deepEqual(first.getViewModel(), view);
    assert.deepEqual(first.getSelectableViewModel(), selectable);
    assert.equal(await captureSerializedSession(first, storage, 'split_quantity_failed'), before);
  }
  const full = dispatchAndAssert(first.dispatch('split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 200, unit: 'g' } }), 'full quantity split');
  const fullId = full.created_objects[0]!.object_id;
  assert.equal(fullId, 'lot_split_000001');
  assert.deepEqual(full.updated_objects.find((object) => object.object_id === 'salt_initial_001')?.summary, { status: 'consumed' });
  await first.save('split_quantity_full');
  const restored = makeSession(storage).session;
  await restored.load('split_quantity_full');
  assert.equal(restored.getSelectableViewModel().splittable_lot_options.some((lot) => lot.id === 'salt_initial_001'), false);
  const fraction = dispatchAndAssert(restored.dispatch('split_lot', { source_lot_id: fullId, quantity: { amount: 0.25, unit: 'g' } }), 'fraction after full quantity load');
  assert.equal(fraction.created_objects[0]?.object_id, 'lot_split_000002');
  const saved = JSON.parse(await captureSerializedSession(restored, storage, 'split_quantity_complete'));
  assert.equal(saved.inventory.every((lot: { quantity: { amount: number } }) => lot.quantity.amount > 0), true);
  const remaining = saved.inventory.find((lot: { lot_id: string }) => lot.lot_id === fullId);
  assert.equal(remaining.quantity.amount, 199.75);
  assert.equal(remaining.storage_footprint.amount, 2);
});

test('split capacity overflow restores the entire public session and moving a batch permits healthy splitting', async () => {
  const storage = new InMemorySaveStoragePort();
  const session = makeSession(storage).session;
  const initial = session.getSelectableViewModel();
  const salt = initial.splittable_lot_options.find((lot) => lot.base_id === 'salt')!;
  const room = initial.storage_target_options.find((target) => target.id === salt.storage_ref.container_id)!;
  const availableSlots = room.capacity.amount - room.used_capacity;
  assert.ok(Number.isInteger(availableSlots) && availableSlots > 0);
  for (let index = 0; index < availableSlots; index += 1) {
    const split = session.dispatch('split_lot', { source_lot_id: salt.id, quantity: { amount: 1, unit: salt.quantity.unit } });
    assert.equal(split.success, true);
    assert.equal(session.getSelectableViewModel().storage_target_options.find((target) => target.id === room.id)!.used_capacity, room.used_capacity + index + 1);
  }
  const full = session.getSelectableViewModel();
  assert.equal(full.storage_target_options.find((target) => target.id === room.id)!.used_capacity, room.capacity.amount);
  const before = await captureSerializedSession(session, storage, 'split_capacity_before');
  const beforeView = session.getViewModel();
  const beforeSelectable = session.getSelectableViewModel();
  const parameters = { source_lot_id: salt.id, quantity: { amount: 1, unit: salt.quantity.unit } };
  assert.equal(session.preview('split_lot', parameters).status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  const failed = session.dispatch('split_lot', parameters);
  assert.equal(failed.success, false);
  assert.equal(failed.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(failed.domain_events, []);
  assert.deepEqual(failed.event_log_entries, []);
  assert.deepEqual(session.getViewModel(), beforeView);
  assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);
  assert.equal(await captureSerializedSession(session, storage, 'split_capacity_after_failure'), before);
  const movable = full.splittable_lot_options.find((lot) => lot.storage_ref.container_id === room.id
    && full.storage_target_options.some((target) => target.id !== room.id && target.enabled && target.supported_forms.includes(lot.current_form)))!;
  assert.ok(movable);
  const target = full.storage_target_options.find((item) => item.id !== room.id && item.enabled && item.supported_forms.includes(movable.current_form))!;
  const moved = session.dispatch('store_item', { object_ref: { object_type: 'MaterialLot', object_id: movable.id },
    storage_ref: { location_id: target.location_id, storage_type: target.storage_type, container_id: target.id } });
  assert.equal(moved.success, true);
  assert.equal(session.preview('split_lot', parameters).success, true);
  const recovered = session.dispatch('split_lot', parameters);
  assert.equal(recovered.success, true);
  const created = session.getSelectableViewModel().splittable_lot_options.find((lot) => lot.id === recovered.created_objects[0]!.object_id)!;
  assert.deepEqual(created.quantity, parameters.quantity);
  await session.save('split_capacity_recovered');
});

test('fresh sessions resume saved split and event IDs, preserve failed loads and keep IDs above older loaded saves', async () => {
  const storage = new InMemorySaveStoragePort();
  const first = makeSession(storage).session;
  const parameters = { source_lot_id: 'salt_initial_001', quantity: { amount: 10, unit: 'g' } };
  assert.equal(dispatchAndAssert(first.dispatch('split_lot', parameters), 'first split').created_objects[0]?.object_id, 'lot_split_000001');
  await first.save('id_recovery_old');
  const second = makeSession(storage).session;
  await second.load('id_recovery_old');
  const beforeFailure = await captureSerializedSession(second, storage, 'id_recovery_before');
  const beforeView = second.getViewModel();
  const failed = second.dispatch('split_lot', { ...parameters, source_lot_id: 'missing_lot_for_id_recovery' });
  assert.equal(failed.success, false);
  assert.equal(failed.status_code, 'ERR_MATERIAL_LOT_NOT_FOUND');
  assert.deepEqual(second.getViewModel(), beforeView);
  assert.equal(await captureSerializedSession(second, storage, 'id_recovery_after_failure'), beforeFailure);
  const resumed = dispatchAndAssert(second.dispatch('split_lot', parameters), 'restored split');
  assert.equal(resumed.created_objects[0]?.object_id, 'lot_split_000002');
  assert.deepEqual(resumed.domain_events.map((event) => event.event_id), ['evt_000003', 'evt_000004']);
  assert.equal(dispatchAndAssert(second.dispatch('split_lot', parameters), 'next split').created_objects[0]?.object_id, 'lot_split_000003');
  await second.load('id_recovery_old');
  const afterOlderLoad = dispatchAndAssert(second.dispatch('split_lot', parameters), 'split after older load');
  assert.equal(afterOlderLoad.created_objects[0]?.object_id, 'lot_split_000004', 'same-runtime IDs never move backwards after an older load');
  assert.deepEqual(afterOlderLoad.domain_events.map((event) => event.event_id), ['evt_000007', 'evt_000008']);
  const beforeBadLoad = await captureSerializedSession(second, storage, 'id_recovery_before_bad_load');
  await storage.write('id_recovery_broken', '{invalid json');
  await assert.rejects(second.load('id_recovery_broken'));
  assert.equal(await captureSerializedSession(second, storage, 'id_recovery_after_bad_load'), beforeBadLoad);
  assert.equal(dispatchAndAssert(second.dispatch('split_lot', parameters), 'healthy split after rejected load').created_objects[0]?.object_id, 'lot_split_000005');
  await second.save('id_recovery_latest');
  const third = makeSession(storage).session;
  await third.load('id_recovery_latest');
  assert.equal(dispatchAndAssert(third.dispatch('split_lot', parameters), 'third session split').created_objects[0]?.object_id, 'lot_split_000006');
  await third.save('id_recovery_complete');
});

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

function runCoreLoopThroughSession(session: CocosAppRuntimeSession, submitOrder = true) {
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

  if (submitOrder) {
    dispatchAndAssert(session.dispatch('submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: refs.dish_lot }]
    }), 'submit_order');
  }

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
