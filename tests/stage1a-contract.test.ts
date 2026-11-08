import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuntime, buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';
import { ConfigRepository, GameRuntime, NewGameBuilder, SaveManager, StorageAudit } from '../src/game-core/index';
import { DeterministicIdService } from '../src/game-core/id/IdService';
import type { GameState } from '../src/game-core/index';

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

test('integer split requests preserve represented deductions for count, grams and millilitres at large finite quantities', () => {
  for (const id of ['seed_cabbage_initial_001', 'salt_initial_001', 'oil_initial_001']) {
    const { runtime, state, configs, contracts } = buildRuntime();
    const source = runtime.inventory.findMaterialLot(state.save_file, id);
    const definition = Object.values(configs.loadStage1A().documents).find((value) => {
      const candidate = value as { id?: string; storage_footprint_rule?: unknown };
      return candidate?.id === source.base_id && candidate.storage_footprint_rule;
    }) as { storage_footprint_rule: { base_quantity: { amount: number }; footprint: { amount: number } } };
    source.quantity.amount = 2 ** 53 + 2;
    source.storage_footprint.amount = Math.ceil(source.quantity.amount / definition.storage_footprint_rule.base_quantity.amount
      * definition.storage_footprint_rule.footprint.amount);
    state.save_file.storage_containers.find((container) => container.container_id === source.storage_ref.container_id)!.capacity.amount = Number.MAX_VALUE;
    runtime.storageReconciler.reconcile(state.save_file);
    contracts.assertSaveFile(state.save_file);
    new StorageAudit().assertReconciled(state.save_file);
    const before = cloneForCompare(state);
    const failed = dispatch(runtime, state, 'split_lot', { source_lot_id: id, quantity: { amount: 1, unit: source.quantity.unit } }, 'integer_precision_split');
    assert.equal(failed.success, false, `${source.quantity.unit}: an integer request must not deduct two units for one`);
    assert.equal(failed.status_code, 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
    assert.deepEqual(state, before);
    const full = dispatch(runtime, state, 'split_lot', { source_lot_id: id, quantity: { ...source.quantity } }, 'integer_precision_full_recovery');
    assert.equal(full.success, true);
    assert.equal(full.created_objects[0]?.object_id, 'lot_split_000001');
    assert.equal(runtime.inventory.findMaterialLot(state.save_file, full.created_objects[0]!.object_id).quantity.amount, source.quantity.amount);
    assert.equal(state.save_file.inventory.some((lot) => lot.lot_id === id), false);
    contracts.assertSaveFile(state.save_file);
    new StorageAudit().assertReconciled(state.save_file);
  }
});

test('split quantities reject invalid or unrepresentable changes before allocating objects and preserve full state', () => {
  const { runtime, state } = buildRuntime();
  const before = cloneForCompare(state);
  for (const [source_lot_id, amount, unit] of [
    ['salt_initial_001', 0, 'g'], ['salt_initial_001', -1, 'g'],
    ['salt_initial_001', NaN, 'g'], ['salt_initial_001', Infinity, 'g'],
    ['salt_initial_001', '1', 'g'], ['salt_initial_001', true, 'g'],
    ['seed_cabbage_initial_001', 0.5, 'count'],
    ['salt_initial_001', Number.MIN_VALUE, 'g'],
    ['salt_initial_001', 201, 'g'], ['salt_initial_001', 1, 'ml']
  ] as const) {
    const result = dispatch(runtime, state, 'split_lot', { source_lot_id, quantity: { amount, unit } }, 'split_quantity_invalid');
    assert.equal(result.success, false, String(amount) + ' ' + unit);
    assert.deepEqual(result.domain_events, []);
    assert.deepEqual(result.event_log_entries, []);
    assert.deepEqual(state, before);
  }
  const healthy = dispatch(runtime, state, 'split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 0.25, unit: 'g' } }, 'split_quantity_recovered');
  assert.equal(healthy.success, true);
  assert.equal(healthy.created_objects[0]?.object_id, 'lot_split_000001');
  assert.equal(healthy.domain_events[0]?.event_id, 'evt_000001');
});

test('independent split validation is read-only and shares formal quantity, unit, reservation and footprint rules', () => {
  const { runtime, state } = buildRuntime();
  const original = cloneForCompare(state);
  for (const [source, amount, unit, code] of [
    ['salt_initial_001', 201, 'g', 'ERR_NOT_ENOUGH_RESOURCE'],
    ['salt_initial_001', 1, 'ml', 'ERR_QUANTITY_UNIT_MISMATCH'],
    ['seed_cabbage_initial_001', 0.5, 'count', 'ERR_SPLIT_QUANTITY_INVALID'],
    ['salt_initial_001', Number.MIN_VALUE, 'g', 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE']
  ] as const) {
    assert.throws(() => runtime.inventory.assertCanSplit(state.save_file, source, { amount, unit }), new RegExp(code));
    assert.deepEqual(state, original);
  }
  assert.doesNotThrow(() => runtime.inventory.assertCanSplit(state.save_file, 'salt_initial_001', { amount: 0.25, unit: 'g' }));
  assert.doesNotThrow(() => runtime.inventory.assertCanSplit(state.save_file, 'salt_initial_001', { amount: 200, unit: 'g' }));
  assert.deepEqual(state, original);
  const reservationId = injectTestReservation(state, 'salt_initial_001', 1, 'validation');
  const reserved = cloneForCompare(state);
  assert.throws(() => runtime.inventory.assertCanSplit(state.save_file, 'salt_initial_001', { amount: 1, unit: 'g' }), /ERR_ALREADY_RESERVED/);
  assert.deepEqual(state, reserved);
  releaseTestReservation(state, reservationId);
  const result = dispatch(runtime, state, 'split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 0.25, unit: 'g' } }, 'independent_split_recovery');
  assert.equal(result.success, true);
  assert.equal(result.created_objects[0]?.object_id, 'lot_split_000001');
  assert.equal(result.domain_events[0]?.event_id, 'evt_000001');
});

test('independent capacity validation rejects a partial split without consuming IDs but allows a full split at capacity', () => {
  const { runtime, state } = buildRuntime();
  const source = runtime.inventory.findMaterialLot(state.save_file, 'salt_initial_001');
  const container = state.save_file.storage_containers.find(item => item.container_id === source.storage_ref.container_id)!;
  container.capacity.amount = container.used_capacity;
  const before = cloneForCompare(state);
  assert.throws(() => runtime.inventory.assertCanSplit(state.save_file, source.lot_id, { amount: 1, unit: 'g' }), /ERR_STORAGE_CAPACITY_OVERFLOW/);
  assert.deepEqual(state, before);
  const failed = dispatch(runtime, state, 'split_lot', { source_lot_id: source.lot_id, quantity: { amount: 1, unit: 'g' } }, 'full_room_failure');
  assert.equal(failed.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(state, before);
  assert.doesNotThrow(() => runtime.inventory.assertCanSplit(state.save_file, source.lot_id, { ...source.quantity }));
  assert.deepEqual(state, before);
  const full = dispatch(runtime, state, 'split_lot', { source_lot_id: source.lot_id, quantity: { ...source.quantity } }, 'full_room_full_split');
  assert.equal(full.success, true);
  assert.equal(full.created_objects[0]?.object_id, 'lot_split_000001');
  assert.equal(full.domain_events[0]?.event_id, 'evt_000001');
  new StorageAudit().assertReconciled(state.save_file);
});

test('full splits remove the empty source while preserving inherited data, lineage and reconciled capacity', () => {
  for (const id of ['salt_initial_001', 'seed_cabbage_initial_001']) {
    const { runtime, state, contracts } = buildRuntime();
    const original = cloneForCompare(runtime.inventory.findMaterialLot(state.save_file, id));
    const beforeCapacity = state.save_file.storage_containers.find((container) => container.container_id === original.storage_ref.container_id)!.used_capacity;
    const result = dispatch(runtime, state, 'split_lot', { source_lot_id: id, quantity: original.quantity }, 'full_split');
    assert.equal(result.success, true);
    assert.equal(state.save_file.inventory.some((lot) => lot.lot_id === id), false);
    const created = runtime.inventory.findMaterialLot(state.save_file, result.created_objects[0]!.object_id);
    assert.deepEqual(created.quantity, original.quantity);
    assert.deepEqual(created.storage_footprint, original.storage_footprint);
    assert.deepEqual(created.property_profile, original.property_profile);
    assert.deepEqual(created.storage_ref, original.storage_ref);
    assert.equal(created.source_ref.source_type, 'inventory_split');
    assert.equal(created.source_ref.source_id, original.lot_id);
    const origins = created.lineage_summary?.key_origins as Array<{ origin_id: string; source_ref: unknown }>;
    assert.equal(origins.at(-1)?.origin_id, original.lot_id);
    assert.deepEqual(origins.at(-1)?.source_ref, original.source_ref);
    assert.deepEqual(result.updated_objects.find((object) => object.object_id === id)?.summary, { status: 'consumed' });
    assert.equal(result.domain_events.some((event) => event.event_type === 'inventory.lot_updated'), false);
    assert.equal(state.save_file.inventory.every((lot) => lot.quantity.amount > 0), true);
    assert.equal(state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_id === id)), false);
    assert.equal(state.save_file.storage_containers.find((container) => container.container_id === original.storage_ref.container_id)!.used_capacity, beforeCapacity);
    contracts.assertSaveFile(state.save_file);
    new StorageAudit().assertReconciled(state.save_file);
  }
});

test('repeated splits derive both footprints from definitions instead of rounding a previous footprint', () => {
  const { runtime, state, contracts } = buildRuntime();
  const source = prepareHarvestedCabbage(runtime, state);
  for (const amount of [300, 50, 50]) {
    const result = dispatch(runtime, state, 'split_lot', { source_lot_id: source, quantity: { amount, unit: 'g' } }, 'repeated_split_footprint');
    assert.equal(result.success, true);
    const remaining = runtime.inventory.findMaterialLot(state.save_file, source);
    const created = runtime.inventory.findMaterialLot(state.save_file, result.created_objects[0]!.object_id);
    assert.equal(remaining.storage_footprint.amount, Math.ceil(remaining.quantity.amount / 100));
    assert.equal(created.storage_footprint.amount, Math.ceil(amount / 100));
    new StorageAudit().assertReconciled(state.save_file);
  }
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, source).quantity.amount, 800);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, source).storage_footprint.amount, 8);
  contracts.assertSaveFile(state.save_file);
});

test('valid gram and millilitre fractions and integer counts keep exact selected quantities and positive footprints', () => {
  for (const [id, amount, unit] of [['salt_initial_001', 0.25, 'g'], ['oil_initial_001', 0.1, 'ml'], ['seed_cabbage_initial_001', 1, 'count']] as const) {
    const { runtime, state, contracts } = buildRuntime();
    const original = cloneForCompare(runtime.inventory.findMaterialLot(state.save_file, id));
    const result = dispatch(runtime, state, 'split_lot', { source_lot_id: id, quantity: { amount, unit } }, 'fraction_split');
    assert.equal(result.success, true);
    const created = runtime.inventory.findMaterialLot(state.save_file, result.created_objects[0]!.object_id);
    const remaining = runtime.inventory.findMaterialLot(state.save_file, id);
    assert.deepEqual(created.quantity, { amount, unit });
    assert.equal(remaining.quantity.amount, original.quantity.amount - amount);
    assert.equal(created.quantity.amount + remaining.quantity.amount, original.quantity.amount);
    assert.equal(created.storage_footprint.amount, 1);
    contracts.assertSaveFile(state.save_file);
    new StorageAudit().assertReconciled(state.save_file);
  }
});

test('split validates loaded definitions without hardcoded identities and rejects unsafe count subtraction', () => {
  const initial = buildRuntime();
  const snapshot = cloneForCompare(initial.snapshot);
  const originalDefinition = snapshot.loaded_documents['configs/materials/seasonings/salt.yaml'] as Record<string, unknown>;
  const definition = { ...cloneForCompare(originalDefinition), id: 'probe_mineral', storage_footprint_rule: { base_quantity: { amount: 50, unit: 'g' }, footprint: { amount: 2, unit: 'slot_weight' } } };
  snapshot.loaded_documents['configs/materials/custom/probe_mineral.yaml'] = definition;
  const world = snapshot.loaded_documents['configs/initial_world/stage_1A_initial_world.yaml'] as { initial_inventory: typeof initial.state.save_file.inventory };
  const configured = world.initial_inventory.find((lot) => lot.lot_id === 'salt_initial_001')!;
  configured.base_id = 'probe_mineral';
  configured.definition_ref = { type: 'material', id: 'probe_mineral', canonical_id: 'base:probe_mineral' };
  configured.storage_footprint = { amount: 8, unit: 'slot_weight' };
  const configs = new ConfigRepository(snapshot);
  const state = new NewGameBuilder(configs).buildStage1A({ buildId: 'quantity_config_test', nowIso8601: '2026-05-18T00:00:00.000Z' });
  const runtime = new GameRuntime(configs, initial.contracts);
  const split = dispatch(runtime, state, 'split_lot', { source_lot_id: configured.lot_id, quantity: { amount: 25, unit: 'g' } }, 'configured_split');
  assert.equal(split.success, true);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, configured.lot_id).storage_footprint.amount, 7);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, split.created_objects[0]!.object_id).storage_footprint.amount, 1);
  for (const bad of [0, NaN, Infinity, '50', true]) {
    const before = cloneForCompare(state);
    (definition.storage_footprint_rule.base_quantity as { amount: unknown }).amount = bad;
    const failed = dispatch(runtime, state, 'split_lot', { source_lot_id: configured.lot_id, quantity: { amount: 1, unit: 'g' } }, 'invalid_definition_split');
    assert.equal(failed.success, false);
    assert.deepEqual(state, before);
  }
  const big = buildRuntime();
  const seed = big.runtime.inventory.findMaterialLot(big.state.save_file, 'seed_cabbage_initial_001');
  seed.quantity.amount = 2 ** 53 + 2;
  seed.storage_footprint.amount = Math.ceil(seed.quantity.amount / 10);
  big.state.save_file.storage_containers.find((container) => container.container_id === seed.storage_ref.container_id)!.capacity.amount = 2 ** 54;
  big.runtime.storageReconciler.reconcile(big.state.save_file);
  const before = cloneForCompare(big.state);
  const failed = dispatch(big.runtime, big.state, 'split_lot', { source_lot_id: seed.lot_id, quantity: { amount: 1, unit: 'count' } }, 'unrepresentable_count');
  assert.equal(failed.success, false, 'count subtraction must not remove two units for a one-unit request');
  assert.deepEqual(big.state, before);
});

test('deterministic IDs recover nested historical strings and record keys without lowering prefix high-water marks', () => {
  const ids = new DeterministicIdService();
  assert.equal(ids.next('lot_split'), 'lot_split_000001');
  const historical: Record<string, unknown> = {
    lineage_summary: { key_origins: [{ origin_id: 'lot_split_000040', source_ref: { source_id: 'custom.prefix-with_under_score_000009' } }] },
    processing_history: [{ history_id: 'hist_processing_999999' }],
    references: { record_ref_000008: null },
    ignored: ['ignored_12', 'ignored_000005x', '000999', '_000999']
  };
  historical.self = historical;
  ids.observeExisting(historical);
  assert.equal(ids.next('lot_split'), 'lot_split_000041');
  assert.equal(ids.next('custom.prefix-with_under_score'), 'custom.prefix-with_under_score_000010');
  assert.equal(ids.next('hist_processing'), 'hist_processing_1000000');
  assert.equal(ids.next('record_ref'), 'record_ref_000009');
  assert.equal(ids.next('ignored'), 'ignored_000001');
  ids.observeExisting({ older: 'lot_split_000002' });
  assert.equal(ids.next('lot_split'), 'lot_split_000042');
  assert.equal(new DeterministicIdService().next('lot_split'), 'lot_split_000001');
});

test('deterministic IDs advance decimal suffixes beyond Number precision and avoid recursive traversal limits', () => {
  const ids = new DeterministicIdService();
  const huge = '9'.repeat(80);
  let nested: unknown = { source_ref: { source_id: `extreme_prefix_${huge}` }, padded: 'padded_000000000000000000009' };
  for (let depth = 0; depth < 12000; depth += 1) nested = { nested };
  ids.observeExisting(nested);
  assert.equal(ids.next('extreme_prefix'), `extreme_prefix_1${'0'.repeat(80)}`);
  assert.equal(ids.next('extreme_prefix'), `extreme_prefix_1${'0'.repeat(79)}1`);
  assert.equal(ids.next('padded'), 'padded_000010');
});

test('a fresh GameRuntime restores every generated domain prefix through direct pipeline dispatch after save/load', () => {
  const first = buildRuntime();
  const firstPickled = preparePickledCabbage(first.runtime, first.state);
  assert.equal(cookBaconCabbage(first.runtime, first.state, firstPickled).success, true);
  assert.equal(first.state.save_file.inventory.some((lot) => lot.lot_id === 'lot_split_000001'), false, 'consumed split remains only in historical references');
  const saves = new SaveManager();
  const serialized = saves.serialize(first.state);
  const lastEvent = String(first.state.save_file.event_log_summary.last_event_id);
  const restored = saves.deserializeSaveFile(serialized);
  const second = buildRuntimeWithoutState();
  assert.deepEqual(restored.domain_events, []);
  const beforeFailure = cloneForCompare(restored);
  const failed = dispatch(second.runtime, restored, 'split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 999999, unit: 'g' } }, 'restored_rejected_split');
  assert.equal(failed.success, false);
  assert.equal(failed.status_code, 'ERR_NOT_ENOUGH_RESOURCE');
  assert.deepEqual(restored, beforeFailure);
  const split = dispatch(second.runtime, restored, 'split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 10, unit: 'g' } }, 'restored_split');
  assert.equal(split.success, true);
  assert.equal(split.created_objects[0]?.object_id, 'lot_split_000002', 'historical references protect the removed split ID');
  assert.equal(split.domain_events[0]?.event_id, `evt_${String(Number(lastEvent.slice(4)) + 1).padStart(6, '0')}`, 'persisted event summary restores events without the old stream');
  const secondPickled = preparePickledCabbage(second.runtime, restored);
  assert.equal(secondPickled, 'lot_processed_000002');
  const cooked = cookBaconCabbage(second.runtime, restored, secondPickled, 'restored_cook');
  assert.equal(cooked.success, true);
  assert.equal(cooked.created_objects[0]?.object_id, 'dish_000002');
  assert.deepEqual(restored.save_file.crop_instances.map((crop) => crop.crop_id), ['crop_000001', 'crop_000002']);
  assert.deepEqual(restored.save_file.processing_tasks.map((task) => task.task_id), ['task_processing_000001', 'task_processing_000002']);
  assert.deepEqual(restored.save_file.processing_tasks[1]!.reserved_quantities.map((reservation) => reservation.reservation_id), ['res_consumed_000003', 'res_consumed_000004']);
  assert.equal(restored.save_file.inventory.find((lot) => lot.lot_id === 'lot_harvest_000002')?.source_ref.source_id, 'crop_000002');
  assert.equal(restored.save_file.inventory.find((lot) => lot.lot_id === secondPickled)?.processing_history?.[0]?.history_id, 'hist_processing_000002');
  assert.deepEqual(restored.save_file.dish_lots[1]!.components.map((component) => component.component_id), ['dish_component_000004', 'dish_component_000005', 'dish_component_000006']);
  const inventoryIds = restored.save_file.inventory.map((lot) => lot.lot_id);
  assert.equal(new Set(inventoryIds).size, inventoryIds.length);
  second.contracts.assertSaveFile(restored.save_file);
  new StorageAudit().assertReconciled(restored.save_file);
  assert.doesNotThrow(() => saves.serialize(restored));
});

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

test('independent seeds combine within one tile and reveal failure at sprout without rerolling or refunding', () => {
  for (const example of [
    { seed: 'stage1_fixed_seed', seeds: 1, outcome: 'failed' },
    { seed: 'stage1_fixed_seed', seeds: 2, outcome: 'succeeded' },
    { seed: 'farming-test-28', seeds: 3, outcome: 'failed' },
    { seed: 'farming-test-23', seeds: 3, outcome: 'succeeded' }
  ]) {
    const { runtime, state, contracts } = buildRuntime(example.seed);
    const planted = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001',
      seed_quantity: { amount: example.seeds, unit: 'count' }, seeds_per_tile: example.seeds }, 'germination_plant');
    assert.equal(planted.success, true, planted.status_code);
    assert.equal(planted.created_objects.length, 1, 'one tile retains at most one plant, regardless of seed count');
    assert.equal(state.save_file.fields[0]!.occupied_tiles, 1);
    assert.equal(state.save_file.inventory.find(lot => lot.lot_id === 'seed_cabbage_initial_001')!.quantity.amount, 10 - example.seeds);
    let crop = state.save_file.crop_instances[0]!;
    assert.equal(crop.germination!.outcome, example.outcome);
    assert.equal(crop.germination!.revealed, false);
    assert.equal(crop.germination!.per_seed_success_rate, 0.8);
    const stream = cloneForCompare(state.save_file.random_state);
    assert.equal((stream.streams as Record<string, { position: number }>).farming_germination_v1!.position, example.seeds);
    const revealMinute = Math.ceil((crop.expected_harvest_minute - crop.planted_time) * 0.2);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: revealMinute - 1 }, 'before_reveal').success, true);
    assert.equal(state.save_file.crop_instances[0]!.germination!.revealed, false);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'at_reveal').success, true);
    crop = state.save_file.crop_instances[0]!;
    assert.equal(crop.germination!.revealed, true);
    assert.equal(crop.lifecycle_status, example.outcome === 'failed' ? 'failed' : 'active');
    assert.equal(state.save_file.fields[0]!.occupied_tiles, example.outcome === 'failed' ? 0 : 1);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'after_reveal').success, true);
    assert.deepEqual(state.save_file.random_state, stream, 'time advancement never redraws germination');
    const beforeHarvest = cloneForCompare(state);
    const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: crop.crop_id }, 'germination_harvest');
    assert.equal(harvest.success, example.outcome === 'succeeded');
    if (example.outcome === 'failed') assert.deepEqual(state, beforeHarvest);
    else assert.deepEqual(state.save_file.inventory.find(lot => lot.lot_id === harvest.created_objects[0]!.object_id)!.quantity, { amount: 1200, unit: 'g' });
    contracts.assertSaveFile(state.save_file);
  }
});

test('multi-seed tiles preserve independent random position and reject non-divisible requests atomically', () => {
  const subject = buildRuntime('farming-test-23');
  const control = buildRuntime('farming-test-23');
  const params = (amount: number, seeds_per_tile: number) => ({ field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount, unit: 'count' }, seeds_per_tile });
  for (const [amount, seeds] of [[3, 2], [1, 0], [1, 4], [1, 1.5], [12, 3]]) {
    const before = cloneForCompare(subject.state);
    const rejected = dispatch(subject.runtime, subject.state, 'plant_crop', params(amount!, seeds!), 'reject_multiseed');
    assert.equal(rejected.success, false);
    assert.deepEqual(subject.state, before, 'rejection consumes neither seeds nor random draws');
  }
  const actual = dispatch(subject.runtime, subject.state, 'plant_crop', params(6, 3), 'healthy_multiseed');
  const expected = dispatch(control.runtime, control.state, 'plant_crop', params(6, 3), 'healthy_multiseed');
  assert.equal(actual.success, true, actual.status_code);
  assert.deepEqual(actual, expected);
  assert.deepEqual(subject.state, control.state);
  assert.equal(actual.created_objects.length, 2);
  assert.equal(subject.state.save_file.fields[0]!.occupied_tiles, 2);
  assert.equal((subject.state.save_file.random_state.streams as Record<string, { position: number }>).farming_germination_v1!.position, 6);
  const split = buildRuntime('farming-test-23');
  dispatch(split.runtime, split.state, 'plant_crop', params(3, 3), 'split_multiseed_a');
  dispatch(split.runtime, split.state, 'plant_crop', params(3, 3), 'split_multiseed_b');
  assert.deepEqual(split.state.save_file.random_state, subject.state.save_file.random_state);
  assert.deepEqual(split.state.save_file.crop_instances.map(crop => crop.germination), subject.state.save_file.crop_instances.map(crop => crop.germination));
});

test('legacy crops without germination preserve their growth and old saves while probability fields are closed', () => {
  const { runtime, state, contracts } = buildRuntime('farming-test-28');
  const plant = dispatch(runtime, state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }, 'legacy_crop');
  assert.equal(plant.success, true);
  delete state.save_file.crop_instances[0]!.germination;
  state.save_file.random_state.streams = {};
  contracts.assertSaveFile(state.save_file);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'legacy_mature').success, true);
  assert.equal(state.save_file.crop_instances[0]!.lifecycle_status, 'ready_to_harvest');
  assert.deepEqual(state.save_file.random_state.streams, {});
  assert.equal(dispatch(runtime, state, 'harvest_crop', { crop_id: plant.created_objects[0]!.object_id }, 'legacy_harvest').success, true);
  const current = buildRuntime();
  dispatch(current.runtime, current.state, 'plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }, 'schema_crop');
  const malformed = cloneForCompare(current.state.save_file);
  Object.assign(malformed.crop_instances[0]!.germination!, { seeds_per_tile: 4, unexpected: true });
  assert.throws(() => contracts.assertSaveFile(malformed), /ERR_SCHEMA_VALIDATION_FAILED/);
});

test('batch planting creates one independent crop per single-seed tile and supports partially occupied fields', () => {
  const { runtime, state, contracts } = buildRuntime();
  const plant = (amount: number, suffix: string) => dispatch(runtime, state, 'plant_crop', {
    field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount, unit: 'count' }
  }, suffix);
  const first = plant(3, 'batch_first');
  assert.equal(first.success, true, first.status_code);
  assert.equal(first.created_objects.length, 3);
  assert.equal(first.domain_events.length, 3);
  assert.deepEqual(first.consumed_resources[0]!.quantity, { amount: 3, unit: 'count' });
  const second = plant(3, 'batch_fill');
  assert.equal(second.success, true, second.status_code);
  const ids = [...first.created_objects, ...second.created_objects].map(item => item.object_id);
  assert.equal(new Set(ids).size, 6);
  assert.deepEqual(state.save_file.fields[0]!.active_crop_ids, ids);
  assert.equal(state.save_file.fields[0]!.occupied_tiles, 6);
  assert.equal(state.save_file.inventory.find(lot => lot.lot_id === 'seed_cabbage_initial_001')!.quantity.amount, 4);
  const full = cloneForCompare(state);
  const rejected = plant(1, 'batch_full_refused');
  assert.equal(rejected.status_code, 'ERR_FIELD_CAPACITY_EXCEEDED');
  assert.deepEqual(state, full);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'batch_grow').success, true);
  assert.equal(state.save_file.crop_instances.filter(crop => crop.lifecycle_status === 'ready_to_harvest').length, 6);
  const harvest = dispatch(runtime, state, 'harvest_crop', { crop_id: ids[0] }, 'batch_harvest_one');
  assert.equal(harvest.success, true, harvest.status_code);
  assert.equal(state.save_file.fields[0]!.occupied_tiles, 5);
  assert.deepEqual(state.save_file.fields[0]!.active_crop_ids, ids.slice(1));
  assert.deepEqual(state.save_file.inventory.find(lot => lot.lot_id === harvest.created_objects[0]!.object_id)!.quantity, { amount: 1200, unit: 'g' });
  const afterHarvest = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'harvest_crop', { crop_id: ids[0] }, 'batch_duplicate_harvest').success, false);
  assert.deepEqual(state, afterHarvest);
  assert.equal(plant(1, 'batch_replant').success, true);
  assert.equal(state.save_file.fields[0]!.occupied_tiles, 6);
  contracts.assertSaveFile(state.save_file);
  new StorageAudit().assertReconciled(state.save_file);
});

test('batch harvest preserves the crop and field when storage fills and can recover after moving a prior harvest', () => {
  const { runtime, state, contracts } = buildRuntime();
  const planted = dispatch(runtime, state, 'plant_crop', {
    field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 6, unit: 'count' }
  }, 'six_for_storage');
  assert.equal(planted.success, true, planted.status_code);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 5400 }, 'six_mature').success, true);
  const crops = planted.created_objects.map(item => item.object_id);
  const lots: string[] = [];
  for (const crop_id of crops.slice(0, 3)) {
    const harvested = dispatch(runtime, state, 'harvest_crop', { crop_id }, crop_id);
    assert.equal(harvested.success, true, harvested.status_code);
    lots.push(harvested.created_objects[0]!.object_id);
  }
  const before = cloneForCompare(state);
  const rejected = dispatch(runtime, state, 'harvest_crop', { crop_id: crops[3] }, 'fourth_full_storage');
  assert.equal(rejected.success, false);
  assert.equal(rejected.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(state, before);
  const moved = dispatch(runtime, state, 'store_item', {
    object_ref: { object_type: 'MaterialLot', object_id: lots[0] },
    storage_ref: { location_id: 'home', storage_type: 'cellar', container_id: 'home_cellar_01' }
  }, 'make_harvest_space');
  assert.equal(moved.success, true, moved.status_code);
  const recovered = dispatch(runtime, state, 'harvest_crop', { crop_id: crops[3] }, 'fourth_retry');
  assert.equal(recovered.success, true, recovered.status_code);
  assert.equal(state.save_file.fields[0]!.occupied_tiles, 2);
  assert.equal(state.save_file.crop_instances.filter(crop => crop.lifecycle_status === 'ready_to_harvest').length, 2);
  assert.equal(state.save_file.inventory.filter(lot => lot.base_id === 'cabbage').reduce((total, lot) => total + lot.quantity.amount, 0), 4800);
  contracts.assertSaveFile(state.save_file);
});

test('batch planting rejects invalid quantities, capacity and reserved seeds before consumption or ID allocation', () => {
  const cases = [
    { amount: 0, unit: 'count', code: 'ERR_PLANT_QUANTITY_INVALID' },
    { amount: -1, unit: 'count', code: 'ERR_SCHEMA_VALIDATION_FAILED' },
    { amount: 0.5, unit: 'count', code: 'ERR_PLANT_QUANTITY_INVALID' },
    { amount: Number.MAX_SAFE_INTEGER + 1, unit: 'count', code: 'ERR_PLANT_QUANTITY_INVALID' },
    { amount: 1, unit: 'g', code: 'ERR_PLANT_QUANTITY_INVALID' },
    { amount: 10, unit: 'count', code: 'ERR_FIELD_CAPACITY_EXCEEDED' },
    { amount: 11, unit: 'count', code: 'ERR_NOT_ENOUGH_RESOURCE' },
    { amount: 1, unit: 'count', code: 'ERR_ALREADY_RESERVED', reserved: true }
  ];
  for (const example of cases) {
    const { runtime, state } = buildRuntime();
    const reserved = example.reserved ? injectTestReservation(state, 'seed_cabbage_initial_001', 1, 'batch_seed') : null;
    const before = cloneForCompare(state);
    const result = dispatch(runtime, state, 'plant_crop', {
      field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: example.amount, unit: example.unit }
    }, 'invalid_batch');
    assert.equal(result.success, false);
    assert.equal(result.status_code, example.code, `${example.amount} ${example.unit}`);
    assert.deepEqual(result.created_objects, []);
    assert.deepEqual(result.domain_events, []);
    assert.deepEqual(state, before);
    if (reserved) releaseTestReservation(state, reserved);
    const healthy = dispatch(runtime, state, 'plant_crop', {
      field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 2, unit: 'count' }
    }, 'healthy_after_invalid_batch');
    assert.equal(healthy.success, true, healthy.status_code);
    assert.deepEqual(healthy.created_objects.map(item => item.object_id), ['crop_000001', 'crop_000002']);
  }
});

test('plant capacity comes from the configured field definition and inconsistent occupancy is rejected', () => {
  const { runtime, state, configs } = buildRuntime();
  const fieldConfig = configs.requiredDoc<{ field_plot_definitions: Record<string, { capacity_tiles: number }> }>('configs/farming/field_plots.yaml');
  fieldConfig.field_plot_definitions.field_plot_basic!.capacity_tiles = 2;
  const params = { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 3, unit: 'count' } };
  const before = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'plant_crop', params, 'configured_capacity').status_code, 'ERR_FIELD_CAPACITY_EXCEEDED');
  assert.deepEqual(state, before);
  state.save_file.fields[0]!.occupied_tiles = 1;
  const inconsistent = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'plant_crop', { ...params, seed_quantity: { amount: 1, unit: 'count' } }, 'inconsistent_field').status_code, 'ERR_FIELD_STATE_INVALID');
  assert.deepEqual(state, inconsistent);
});

test('crop growth uses configured 50 percent stage and invalid growth configuration preserves formal state', () => {
  const { runtime, state, configs } = buildRuntime();
  const profile = configs.requiredDoc<{ base_growth_duration_minutes: number; stage_sequence: Array<{ min_progress: number; growth_stage: string }> }>('configs/farming/growth_profiles/cabbage_growth_basic.yaml');
  const parameters = { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } };
  const duration = profile.base_growth_duration_minutes;
  for (const invalid of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    profile.base_growth_duration_minutes = invalid;
    const before = cloneForCompare(state);
    assert.equal(dispatch(runtime, state, 'plant_crop', parameters, 'invalid_growth_duration').status_code, 'ERR_CROP_GROWTH_DURATION_INVALID');
    assert.deepEqual(state, before);
  }
  profile.base_growth_duration_minutes = duration;
  const originalStages = structuredClone(profile.stage_sequence);
  profile.stage_sequence = [];
  const beforeInvalidStages = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'plant_crop', parameters, 'invalid_growth_stages').status_code, 'ERR_CROP_GROWTH_STAGE_INVALID');
  assert.deepEqual(state, beforeInvalidStages);
  profile.stage_sequence = originalStages;
  const planted = dispatch(runtime, state, 'plant_crop', parameters, 'stages_plant');
  assert.equal(planted.success, true, planted.status_code);
  assert.equal(planted.created_objects[0]!.object_id, 'crop_000001');
  const crop = state.save_file.crop_instances[0]!;
  const untilHalf = Math.ceil((crop.expected_harvest_minute - crop.planted_time) / 2);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: untilHalf - 1 }, 'before_half').success, true);
  assert.equal(state.save_file.crop_instances[0]!.growth_stage, 'sprout');
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'at_half').success, true);
  assert.equal(state.save_file.crop_instances[0]!.growth_progress, 50);
  assert.equal(state.save_file.crop_instances[0]!.growth_stage, 'growing');
  profile.stage_sequence = [];
  const beforeAdvance = cloneForCompare(state);
  assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'invalid_stage_advance').status_code, 'ERR_CROP_GROWTH_STAGE_INVALID');
  assert.deepEqual(state, beforeAdvance);
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

test('processing independent start validation is read-only and preserves repeated input order and IDs', () => {
  const subject = buildRuntime(); const control = buildRuntime();
  const cabbage = prepareHarvestedCabbage(subject.runtime, subject.state);
  assert.equal(cabbage, prepareHarvestedCabbage(control.runtime, control.state));
  const inputs = [
    { lot_id: cabbage, quantity: { amount: 100, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } },
    { lot_id: cabbage, quantity: { amount: 200, unit: 'g' } }
  ];
  const before = cloneForCompare(subject.state);
  subject.runtime.processing.assertCanStartProcessing(subject.state.save_file, 'pickling_cabbage_basic', inputs, picklingFacilityRef);
  assert.deepEqual(subject.state, before);
  const invalid = [...inputs, { lot_id: cabbage, quantity: { amount: 999999, unit: 'g' } }];
  assert.throws(() => subject.runtime.processing.assertCanStartProcessing(subject.state.save_file, 'pickling_cabbage_basic', invalid, picklingFacilityRef), /ERR_NOT_ENOUGH_RESOURCE/);
  assert.deepEqual(subject.state, before);
  const rejected = dispatch(subject.runtime, subject.state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: invalid, facility_ref: picklingFacilityRef }, 'sequential_refusal');
  assert.equal(rejected.status_code, 'ERR_NOT_ENOUGH_RESOURCE');
  assert.deepEqual(subject.state, before);
  const params = { method_id: 'pickling_cabbage_basic', input_lots: inputs, facility_ref: picklingFacilityRef };
  const actual = dispatch(subject.runtime, subject.state, 'start_processing', params, 'sequential_healthy');
  const expected = dispatch(control.runtime, control.state, 'start_processing', params, 'sequential_healthy');
  assert.equal(actual.success, true);
  assert.deepEqual(actual, expected);
  assert.deepEqual(subject.state, control.state);
});

test('processing collection independently rejects full storage before allocating output IDs and recovers', () => {
  const subject = buildRuntime(); const control = buildRuntime();
  const taskId = prepareProcessingTask(subject.runtime, subject.state);
  assert.equal(taskId, prepareProcessingTask(control.runtime, control.state));
  assert.equal(dispatch(subject.runtime, subject.state, 'advance_time', { minutes: 2880 }, 'independent_ready').success, true);
  assert.equal(dispatch(control.runtime, control.state, 'advance_time', { minutes: 2880 }, 'independent_ready').success, true);
  const cellar = subject.state.save_file.storage_containers.find(item => item.container_id === 'home_cellar_01')!;
  const originalCapacity = cellar.capacity.amount;
  cellar.capacity.amount = cellar.used_capacity;
  const before = cloneForCompare(subject.state);
  assert.throws(() => subject.runtime.processing.assertCanCollect(subject.state.save_file, taskId), /ERR_STORAGE_CAPACITY_OVERFLOW/);
  assert.deepEqual(subject.state, before);
  const rejected = dispatch(subject.runtime, subject.state, 'collect_processing_result', { task_id: taskId }, 'independent_full');
  assert.equal(rejected.status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(subject.state, before);
  subject.state.save_file.storage_containers.find(item => item.container_id === 'home_cellar_01')!.capacity.amount = originalCapacity;
  subject.runtime.processing.assertCanCollect(subject.state.save_file, taskId);
  const actual = dispatch(subject.runtime, subject.state, 'collect_processing_result', { task_id: taskId }, 'independent_collect');
  const expected = dispatch(control.runtime, control.state, 'collect_processing_result', { task_id: taskId }, 'independent_collect');
  assert.equal(actual.success, true);
  assert.deepEqual(actual, expected);
  assert.deepEqual(subject.state, control.state);
});

test('processing required inputs reject missing material and subminimum salt before state or object IDs change', async (t) => {
  for (const missing of ['salt', 'cabbage', 'salt_below_minimum'] as const) {
    await t.test(missing, () => {
      const subject = buildRuntime();
      const control = buildRuntime();
      const cabbage = prepareHarvestedCabbage(subject.runtime, subject.state);
      const controlCabbage = prepareHarvestedCabbage(control.runtime, control.state);
      assert.equal(cabbage, controlCabbage);
      const method = subject.configs.requiredDoc<{ input_view_requirements: Array<{ base_id?: string; min_quantity_g?: number }> }>('configs/processing/methods/pickling_cabbage_basic.yaml');
      const minimumSalt = method.input_view_requirements.find((item) => item.base_id === 'salt')!.min_quantity_g!;
      const inputs = [
        { lot_id: cabbage, quantity: { amount: 300, unit: 'g' } },
        { lot_id: 'salt_initial_001', quantity: { amount: missing === 'salt_below_minimum' ? minimumSalt - 0.001 : minimumSalt, unit: 'g' } }
      ].filter((input) => missing === 'salt' ? input.lot_id !== 'salt_initial_001' : missing === 'cabbage' ? input.lot_id === 'salt_initial_001' : true);
      const before = cloneForCompare(subject.state);
      assert.throws(() => subject.runtime.processing.assertCanStartProcessing(subject.state.save_file, 'pickling_cabbage_basic', inputs, picklingFacilityRef), /ERR_PROCESSING_INPUT_MISSING/);
      assert.deepEqual(subject.state, before);
      const failed = dispatch(subject.runtime, subject.state, 'start_processing', {
        method_id: 'pickling_cabbage_basic', input_lots: inputs, facility_ref: picklingFacilityRef
      }, `required_${missing}`);
      assert.equal(failed.success, false);
      assert.equal(failed.status_code, 'ERR_PROCESSING_INPUT_MISSING');
      for (const effects of [failed.created_objects, failed.updated_objects, failed.consumed_resources, failed.released_reservations, failed.domain_events, failed.event_log_entries]) assert.deepEqual(effects, []);
      subject.contracts.assertActionResult(failed);
      assert.deepEqual(subject.state, before, 'complete SaveFile, storage caches, tasks and domain event stream stay intact');
      new StorageAudit().assertReconciled(subject.state.save_file);

      const healthy = { method_id: 'pickling_cabbage_basic', input_lots: [
        { lot_id: cabbage, quantity: { amount: 300, unit: 'g' } },
        { lot_id: 'salt_initial_001', quantity: { amount: minimumSalt, unit: 'g' } }
      ], facility_ref: picklingFacilityRef };
      const recovered = dispatch(subject.runtime, subject.state, 'start_processing', healthy, 'required_recovered');
      const untouched = dispatch(control.runtime, control.state, 'start_processing', healthy, 'required_recovered');
      assert.equal(recovered.success, true);
      assert.equal(recovered.created_objects[0]?.object_id, 'task_processing_000001');
      assert.deepEqual(recovered, untouched, 'task and domain event IDs match a runtime with no failed request');
      assert.deepEqual(subject.state, control.state, 'consumed reservation IDs and all state match the healthy control');
    });
  }
});

test('processing required inputs accept the configured salt boundary and different legal quantities through collection', () => {
  for (const [cabbageAmount, saltAboveMinimum] of [[100, 0], [300, 0.001], [500, 7]]) {
    const { configs, contracts, runtime, state } = buildRuntime();
    const cabbage = prepareHarvestedCabbage(runtime, state);
    const method = configs.requiredDoc<{ input_view_requirements: Array<{ base_id?: string; min_quantity_g?: number }>; process_duration_minutes: number; output_form_rules: { success_form: string } }>('configs/processing/methods/pickling_cabbage_basic.yaml');
    const saltAmount = method.input_view_requirements.find((item) => item.base_id === 'salt')!.min_quantity_g! + saltAboveMinimum!;
    const beforeCabbage = state.save_file.inventory.find((lot) => lot.lot_id === cabbage)!.quantity.amount;
    const beforeSalt = state.save_file.inventory.find((lot) => lot.lot_id === 'salt_initial_001')!.quantity.amount;
    const started = dispatch(runtime, state, 'start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
      { lot_id: cabbage, quantity: { amount: cabbageAmount, unit: 'g' } },
      { lot_id: 'salt_initial_001', quantity: { amount: saltAmount, unit: 'g' } }
    ], facility_ref: picklingFacilityRef }, 'required_boundary_start');
    assert.equal(started.success, true, started.status_code);
    assert.equal(state.save_file.inventory.find((lot) => lot.lot_id === cabbage)?.quantity.amount, beforeCabbage - cabbageAmount!);
    assert.equal(state.save_file.inventory.find((lot) => lot.lot_id === 'salt_initial_001')?.quantity.amount, beforeSalt - saltAmount);
    const taskId = started.created_objects[0]!.object_id;
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: method.process_duration_minutes }, 'required_boundary_time').success, true);
    const collected = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'required_boundary_collect');
    assert.equal(collected.success, true);
    const output = state.save_file.inventory.find((lot) => lot.lot_id === collected.created_objects[0]!.object_id)!;
    assert.equal(output.base_id, 'cabbage');
    assert.equal(output.current_form, method.output_form_rules.success_form);
    assert.deepEqual(output.quantity, { amount: cabbageAmount, unit: 'g' });
    assert.equal(state.save_file.processing_tasks.find((task) => task.task_id === taskId)?.status, 'completed');
    contracts.assertSaveFile(state.save_file);
    new StorageAudit().assertReconciled(state.save_file);
  }
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
  assert.throws(() => runtime.processing.assertCanCollect(state.save_file, taskId), /ERR_PROCESSING_TASK_NOT_READY/);
  assert.deepEqual(state, beforeNotReady);
  const notReady = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'bad_collect_not_ready');
  assert.equal(notReady.success, false);
  assert.equal(notReady.status_code, 'ERR_PROCESSING_TASK_NOT_READY');
  assert.deepEqual(state, beforeNotReady);
  audit.assertReconciled(state.save_file);

  dispatch(runtime, state, 'advance_time', { minutes: 2880 }, 'collect_ready_for_repeat');
  const collect = dispatch(runtime, state, 'collect_processing_result', { task_id: taskId }, 'collect_once');
  assert.equal(collect.success, true);
  const beforeRepeat = cloneForCompare(state);
  assert.throws(() => runtime.processing.assertCanCollect(state.save_file, taskId), /ERR_PROCESSING_TASK_ALREADY_COMPLETED/);
  assert.deepEqual(state, beforeRepeat);
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

function prepareOrderState(status: string, deadlineOffset: number) {
  const prepared = buildRuntime();
  const { runtime, state, contracts } = prepared;
  const pickledLotId = preparePickledCabbage(runtime, state);
  const cook = cookBaconCabbage(runtime, state, pickledLotId, 'order_state_cook');
  assert.equal(cook.success, true);
  const dishId = cook.created_objects[0]!.object_id;
  const order = state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001')!;
  order.status = status;
  order.deadline_absolute_minute = state.save_file.world_time.absolute_minute + deadlineOffset;
  contracts.assertSaveFile(state.save_file);
  new StorageAudit().assertReconciled(state.save_file);
  const parameters = { order_id: order.order_id, submitted_object_refs: [{ object_type: 'DishLot', object_id: dishId }] };
  return { ...prepared, dishId, order, parameters };
}

function assertOrderRefusalUnchanged(prepared: ReturnType<typeof prepareOrderState>, parameters: unknown, code: string, suffix: string) {
  const before = cloneForCompare(prepared.state);
  const serializedBefore = new SaveManager().serialize(prepared.state);
  const refused = dispatch(prepared.runtime, prepared.state, 'submit_order', parameters, suffix);
  assert.equal(refused.success, false);
  assert.equal(refused.status_code, code);
  assert.deepEqual(refused.domain_events, []);
  assert.deepEqual(refused.event_log_entries, []);
  assert.deepEqual(refused.consumed_resources, []);
  assert.deepEqual(refused.created_objects, []);
  assert.deepEqual(refused.updated_objects, []);
  assert.deepEqual(prepared.state, before);
  assert.equal(new SaveManager().serialize(prepared.state), serializedBefore);
  prepared.contracts.assertSaveFile(prepared.state.save_file);
  new StorageAudit().assertReconciled(prepared.state.save_file);
  return refused;
}

for (const status of ['available', 'accepted']) {
  for (const deadlineOffset of [1, 0]) {
    test(`order state: ${status} settles before or exactly at deadline offset ${deadlineOffset} only once`, () => {
      const prepared = prepareOrderState(status, deadlineOffset);
      const { runtime, state, contracts, dishId, parameters, order } = prepared;
      const before = cloneForCompare(state);
      const submittedDish = before.save_file.dish_lots.find((dish) => dish.dish_lot_id === dishId)!;
      const storedBefore = before.save_file.storage_containers.find((container) => container.container_id === submittedDish.storage_ref.container_id)!;
      const result = dispatch(runtime, state, 'submit_order', parameters, `order_state_${status}_${deadlineOffset}`);
      assert.equal(result.success, true);
      assert.equal(result.status_code, 'OK_DEMAND_ACCEPTED');
      assert.equal(order.status, 'completed');
      assert.deepEqual(order.submitted_object_refs, parameters.submitted_object_refs);
      assert.equal(order.result_summary?.reward_final, 37, 'the existing real-dish baseline reward is preserved');
      assert.equal(order.result_summary?.submitted_count, submittedDish.serving_count);
      assert.equal(state.save_file.player_state.money, Number(before.save_file.player_state.money) + 37);
      assert.equal(state.save_file.player_state.reputation_map.west_market_tavern, before.save_file.player_state.reputation_map.west_market_tavern + 1);
      assert.deepEqual(result.domain_events.map((event) => event.event_type), ['order.submitted', 'order.completed']);
      assert.equal(state.domain_events.length, before.domain_events.length + 2);
      for (const event of result.domain_events) {
        assert.deepEqual(event.payload.submitted_object_refs, parameters.submitted_object_refs);
        assert.equal(event.payload.order_id, order.order_id);
        contracts.assertDomainEvent(event);
      }
      assert.equal(result.consumed_resources.length, 1);
      assert.equal(result.consumed_resources[0]!.resource_id, dishId);
      assert.deepEqual(state.save_file.dish_lots, before.save_file.dish_lots.filter((dish) => dish.dish_lot_id !== dishId));
      assert.deepEqual(state.save_file.inventory, before.save_file.inventory);
      assert.deepEqual(state.save_file.fuel_state, before.save_file.fuel_state);
      assert.equal(state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_type === 'DishLot' && ref.object_id === dishId)), false);
      assert.equal(state.save_file.storage_containers.find((container) => container.container_id === storedBefore.container_id)!.used_capacity, storedBefore.used_capacity - submittedDish.storage_footprint.amount);
      contracts.assertSaveFile(state.save_file);
      new StorageAudit().assertReconciled(state.save_file);
      assertOrderRefusalUnchanged(prepared, parameters, 'ERR_ORDER_NOT_AVAILABLE', 'order_state_repeat');
    });
  }

  test(`order state: directly submitting a past-deadline ${status} order preserves the full state`, () => {
    const prepared = prepareOrderState(status, -1);
    const refused = assertOrderRefusalUnchanged(prepared, prepared.parameters, 'ERR_ORDER_NOT_AVAILABLE', 'order_state_deadline_refused');
    assert.equal(refused.message_params.some((param) => param.key === 'raw_error' && param.value === 'ERR_ORDER_NOT_AVAILABLE:deadline'), true);
    assert.equal(prepared.state.save_file.orders[0]!.status, status, 'refusal does not secretly expire a loaded open order');
  });

  test(`order state: advancing time expires ${status} only after the deadline and leaves terminal states closed`, () => {
    const prepared = prepareOrderState(status, 1);
    const { runtime, state, contracts, order, parameters } = prepared;
    const closed = ['submitted', 'completed', 'failed', 'expired', 'cancelled'].map((closedStatus) => ({
      ...cloneForCompare(order), order_id: `order_state_${closedStatus}`, status: closedStatus,
      deadline_absolute_minute: state.save_file.world_time.absolute_minute
    }));
    state.save_file.orders.push(...closed);
    contracts.assertSaveFile(state.save_file);
    const before = cloneForCompare(state);
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'order_state_at_deadline').success, true);
    assert.equal(order.status, status);
    assert.deepEqual(state.save_file.orders.slice(1), before.save_file.orders.slice(1));
    assert.equal(dispatch(runtime, state, 'advance_time', { minutes: 1 }, 'order_state_after_deadline').success, true);
    assert.equal(order.status, 'expired');
    assert.deepEqual(state.save_file.orders.slice(1), before.save_file.orders.slice(1));
    assert.deepEqual(state.save_file.dish_lots, before.save_file.dish_lots);
    assert.deepEqual(state.save_file.player_state, before.save_file.player_state);
    assert.deepEqual(order.submitted_object_refs, before.save_file.orders[0]!.submitted_object_refs);
    assert.equal(state.domain_events.length, before.domain_events.length + 2);
    assert.deepEqual(state.domain_events.slice(before.domain_events.length).map((event) => event.event_type), ['time.advanced', 'time.advanced']);
    contracts.assertSaveFile(state.save_file);
    assertOrderRefusalUnchanged(prepared, parameters, 'ERR_ORDER_NOT_AVAILABLE', 'order_state_expired_refused');
  });

  test(`order state: ${status} rejects missing or unsupported choices without consuming the healthy dish`, () => {
    const prepared = prepareOrderState(status, 1);
    const { runtime, state, parameters } = prepared;
    assertOrderRefusalUnchanged(prepared, { ...parameters, order_id: 'order_state_missing' }, 'ERR_ORDER_NOT_FOUND', 'order_state_missing_order');
    assertOrderRefusalUnchanged(prepared, { ...parameters, submitted_object_refs: [{ object_type: 'DishLot', object_id: 'order_state_missing_dish' }] }, 'ERR_DISH_LOT_NOT_FOUND', 'order_state_missing_dish');
    assertOrderRefusalUnchanged(prepared, { ...parameters, submitted_object_refs: [{ object_type: 'MaterialLot', object_id: 'salt_initial_001' }] }, 'ERR_SUBMITTED_OBJECT_TYPE_UNSUPPORTED', 'order_state_unsupported');
    assert.equal(dispatch(runtime, state, 'submit_order', parameters, 'order_state_healthy_after_refusal').success, true);
    assert.equal(state.save_file.orders[0]!.status, 'completed');
    assert.equal(state.save_file.player_state.money, 137);
  });

  test(`order state: ${status} demand refusals preserve dish, reward, audit and events`, () => {
    for (const failure of ['safety', 'defect', 'score']) {
      const prepared = prepareOrderState(status, 1);
      const dish = prepared.state.save_file.dish_lots.find((item) => item.dish_lot_id === prepared.dishId)!;
      if (failure === 'safety') dish.dish_profile.safety_risk = 26;
      if (failure === 'defect') dish.defects.push('unsafe');
      if (failure === 'score') {
        dish.dish_profile.saltiness = 0;
        dish.dish_profile.oiliness = 0;
        dish.suitability_tags = [];
      }
      prepared.contracts.assertSaveFile(prepared.state.save_file);
      assertOrderRefusalUnchanged(prepared, prepared.parameters, failure === 'safety' ? 'ERR_DEMAND_REJECTED_SAFETY' : failure === 'defect' ? 'ERR_DEMAND_REJECTED_DEFECT' : 'ERR_DEMAND_SCORE_TOO_LOW', `order_state_${failure}`);
    }
  });

  test(`order state: ${status} settlement failure rolls back a consumed dish and reward and can retry`, () => {
    const prepared = prepareOrderState(status, 1);
    const { runtime, state, parameters } = prepared;
    const handler = runtime.registry.get('submit_order');
    const execute = handler.execute.bind(handler);
    handler.execute = (currentState, request) => {
      execute(currentState, request);
      throw new Error('ERR_ORDER_TEST_SETTLEMENT_REFUSED');
    };
    assertOrderRefusalUnchanged(prepared, parameters, 'ERR_ORDER_TEST_SETTLEMENT_REFUSED', 'order_state_late_failure');
    handler.execute = execute;
    const recovered = dispatch(runtime, state, 'submit_order', parameters, 'order_state_late_recovery');
    assert.equal(recovered.success, true);
    assert.equal(state.save_file.player_state.money, 137);
    assert.equal(state.save_file.player_state.reputation_map.west_market_tavern, 1);
    assert.deepEqual(recovered.domain_events.map((event) => event.event_type), ['order.submitted', 'order.completed']);
    assertOrderRefusalUnchanged(prepared, parameters, 'ERR_ORDER_NOT_AVAILABLE', 'order_state_late_repeated');
  });
}

test('order state: every non-open schema-valid state refuses submission with the complete state preserved', () => {
  for (const status of ['submitted', 'completed', 'failed', 'expired', 'cancelled']) {
    const prepared = prepareOrderState(status, 1);
    assertOrderRefusalUnchanged(prepared, prepared.parameters, 'ERR_ORDER_NOT_AVAILABLE', `order_state_closed_${status}`);
  }
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
