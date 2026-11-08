import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { MaterialLot, SaveFile, StorageContainer } from '../src/game-core/domain/types';
import type { PhysicalPolicy } from '../src/game-core/storage/PhysicalCapacity';
import { PhysicalPolicyRegistry } from '../src/game-core/storage/PhysicalPolicyRegistry';
import { StorageReconciler } from '../src/game-core/storage/StorageReconciler';
import { StorageAudit } from '../src/game-core/storage/StorageAudit';
import { buildRuntime, buildRuntimeWithoutState } from './support/runtimeHarness';
import { CocosAppRuntimeSession } from '../src/cocos-app/runtime/CocosAppRuntimeSession';
import { InMemorySaveStoragePort, SaveManager } from '../src/game-core';

const config = parse(readFileSync('design_snapshot/configs/storage/physical_capacity_policies.yaml', 'utf8')) as { policies: PhysicalPolicy[]; default_policy_id: string };
const registry = new PhysicalPolicyRegistry(config.policies);
const makeSave = (physical: boolean): SaveFile => {
  const container = { container_id: 'room', location_id: 'home', storage_type: 'room_temp', container_type: 'room_temp',
    capacity: { amount: 1, unit: 'slot_weight' }, used_capacity: 0, supported_forms: ['fresh', 'cooked_dish'], flags: [], active_object_refs: [],
    ...(physical ? { capacity_limits: { mass_g: 2000, volume_ml: 4000 }, used_capacity_limits: { mass_g: 0, volume_ml: 0 } } : {}) } as StorageContainer;
  const lot = { lot_id: 'c', base_id: 'cabbage', current_form: 'fresh', quantity: { amount: 1200, unit: 'g' },
    storage_ref: { container_id: 'room', location_id: 'home', storage_type: 'room_temp' }, storage_footprint: { amount: 12, unit: 'slot_weight' } } as MaterialLot;
  return { storage_containers: [container], inventory: [lot], dish_lots: [], reservations: [],
    ...(physical ? { physical_capacity_policy_id: config.default_policy_id } : {}) } as unknown as SaveFile;
};

test('new physical save reconciles dual dimensions without enforcing old slot limit', () => {
  const save = makeSave(true);
  new StorageReconciler(registry).reconcile(save);
  assert.equal(save.storage_containers[0]!.used_capacity, 12);
  assert.deepEqual(save.storage_containers[0]!.used_capacity_limits, { mass_g: 1200, volume_ml: 1920 });
  assert.equal(new StorageAudit(registry).audit(save).ok, true);
});

test('old save keeps original slot limit and needs no policy registry', () => {
  const save = makeSave(false);
  const before = structuredClone(save);
  assert.throws(() => new StorageReconciler().reconcile(save), /ERR_STORAGE_CAPACITY_OVERFLOW/);
  assert.deepEqual(save, before);
  save.storage_containers[0]!.capacity.amount = 12;
  new StorageReconciler().reconcile(save);
  assert.equal(new StorageAudit().audit(save).ok, true);
  assert.equal(save.storage_containers[0]!.used_capacity_limits, undefined);
});

test('dual physical overflows leave actual save and caches untouched', () => {
  const save = makeSave(true);
  save.storage_containers[0]!.capacity_limits = { mass_g: 1199, volume_ml: 1919 };
  const before = structuredClone(save);
  assert.throws(() => new StorageReconciler(registry).reconcile(save), /ERR_STORAGE_CAPACITY_OVERFLOW:room:mass,volume/);
  assert.deepEqual(save, before);
});

test('mixed models, unknown policy and missing registry are rejected', () => {
  const save = makeSave(true);
  assert.throws(() => new StorageReconciler().reconcile(save), /ERR_PHYSICAL_POLICY_MISSING/);
  (save as SaveFile & { physical_capacity_policy_id: string }).physical_capacity_policy_id = 'not-registered';
  assert.throws(() => new StorageReconciler(registry).reconcile(save), /ERR_PHYSICAL_POLICY_MISSING/);
  (save as SaveFile & { physical_capacity_policy_id: string }).physical_capacity_policy_id = config.default_policy_id;
  delete save.storage_containers[0]!.used_capacity_limits;
  assert.throws(() => new StorageReconciler(registry).reconcile(save), /ERR_PHYSICAL_MODEL_MIXED/);
});

test('readonly material candidate validates using full existing dish inventory', () => {
  const save = makeSave(true);
  save.dish_lots.push({ dish_lot_id: 'dish1', recognized_dish_id: 'bacon_cabbage', storage_form: 'cooked_dish',
    total_quantity: { amount: 420, unit: 'g' }, storage_ref: { container_id: 'room', location_id: 'home', storage_type: 'room_temp' },
    storage_footprint: { amount: 2, unit: 'slot_weight' } } as SaveFile['dish_lots'][number]);
  save.storage_containers[0]!.capacity_limits = { mass_g: 1619, volume_ml: 4000 };
  const before = structuredClone(save);
  assert.throws(() => new StorageReconciler(registry).assertMaterials(save, save.inventory), /ERR_STORAGE_CAPACITY_OVERFLOW:room:mass/);
  assert.deepEqual(save, before);
});

test('readonly prospective new lot can use an unallocated temporary ID without mutating save', () => {
  const save = makeSave(true);
  const extra = { ...save.inventory[0]!, lot_id: '', quantity: { amount: 300, unit: 'g' } };
  const before = structuredClone(save);
  assert.doesNotThrow(() => new StorageReconciler(registry).assertMaterials(save, [...save.inventory, extra]));
  assert.deepEqual(save, before);
});

test('audit rejects tampered cache and capacity policy is frozen on registration', () => {
  const save = makeSave(true);
  new StorageReconciler(registry).reconcile(save);
  save.storage_containers[0]!.used_capacity_limits!.volume_ml++;
  assert.ok(new StorageAudit(registry).audit(save).issues.some(item => item.code === 'ERR_PHYSICAL_USED_CAPACITY_MISMATCH'));
  const p = structuredClone(config.policies[0]!);
  const snapshot = new PhysicalPolicyRegistry([p]);
  p.rules[0]!.volume_ul_per_unit.numerator = 1;
  assert.notEqual(snapshot.resolve(p.id).rules[0]!.volume_ul_per_unit.numerator, 1);
});

test('old save with an injected partial physical container is rejected without modifying it', () => {
  const save = makeSave(false);
  save.storage_containers[0]!.capacity_limits = { mass_g: 1000, volume_ml: 1000 };
  const before = structuredClone(save);
  assert.throws(() => new StorageReconciler(registry).reconcile(save), /ERR_PHYSICAL_MODEL_MIXED/);
  assert.deepEqual(save, before);
});

test('legacy and physical models return the same public error for an unsupported storage form', () => {
  for (const physical of [false, true]) {
    const save = makeSave(physical);
    save.storage_containers[0]!.supported_forms = ['cut'];
    const before = structuredClone(save);
    assert.throws(() => new StorageReconciler(physical ? registry : undefined).reconcile(save),
      error => error instanceof Error && error.message === 'ERR_STORAGE_FORM_NOT_SUPPORTED:room:fresh');
    assert.deepEqual(save, before);
  }
});

test('legacy and physical models return the same public error for a missing container', () => {
  for (const physical of [false, true]) {
    const save = makeSave(physical);
    save.inventory[0]!.storage_ref.container_id = 'absent';
    const before = structuredClone(save);
    assert.throws(() => new StorageReconciler(physical ? registry : undefined).reconcile(save),
      error => error instanceof Error && error.message === 'ERR_STORAGE_CONTAINER_NOT_FOUND:absent');
    assert.deepEqual(save, before);
  }
});

test('policy covers each loaded material and seed form and the active dish', () => {
  const documents = [
    'design_snapshot/configs/materials/crops/cabbage.yaml',
    'design_snapshot/configs/materials/seasonings/salt.yaml',
    'design_snapshot/configs/materials/seasonings/cooking_oil.yaml',
    'design_snapshot/configs/materials/aromatics/ginger.yaml',
    'design_snapshot/configs/materials/meats/bacon.yaml',
    'design_snapshot/configs/farming/seeds/cabbage_seed.yaml'
  ];
  const rules = registry.resolve(config.default_policy_id).rules;
  for (const path of documents) {
    const document = parse(readFileSync(path, 'utf8')) as { id: string; base_unit: string; forms: Record<string, unknown> };
    for (const form of Object.keys(document.forms)) {
      assert.equal(rules.filter(item => item.kind === 'MaterialLot' && item.definition_id === document.id
        && item.quantity_unit === document.base_unit && item.form === form).length, 1, `${document.id}:${form}`);
    }
  }
  for (const form of ['cooked_dish', 'dish']) assert.equal(rules.filter(item => item.kind === 'DishLot'
    && item.definition_id === 'bacon_cabbage' && item.quantity_unit === 'g' && item.form === form).length, 1);
});

test('new game starts with three independent cellar jars and a separate processing jar', () => {
  const { state, contracts } = buildRuntime();
  const jars = state.save_file.storage_containers.filter(item => item.container_type === 'cellar_jar');
  assert.deepEqual(jars.map(item => item.container_id), ['home_cellar_01', 'home_cellar_jar_02', 'home_cellar_jar_03']);
  for (const jar of jars) {
    assert.deepEqual(jar.capacity_limits, { mass_g: 12000, volume_ml: 20000 });
    assert.deepEqual(jar.used_capacity_limits, { mass_g: 0, volume_ml: 0 });
    assert.deepEqual(jar.supported_forms, ['fresh', 'cut', 'cured', 'pickled']);
  }
  const processing = state.save_file.storage_containers.find(item => item.container_id === 'pickling_jar_basic_01')!;
  assert.equal(processing.container_type, 'pickling_jar');
  assert.deepEqual(processing.supported_forms, ['pickling']);
  assert.ok(state.save_file.storage_containers.find(item => item.container_id === 'home_room_temp_01')!.supported_forms.includes('pickled'));
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(registry).assertReconciled(state.save_file);
});

test('legacy cellar facility capacity does not impose an extra shared limit on real jar transfers', () => {
  const { runtime, state, contracts } = buildRuntime();
  const facility = state.save_file.facilities_state.home_cellar_01 as Record<string, unknown>;
  assert.equal(facility.capacity_g, 20000, 'historical facility metadata remains present');
  facility.capacity_g = 1; // Deliberately smaller than the real harvested cabbage, only in this in-memory test.
  const dispatch = (action_type: string, parameters: unknown, suffix: string) => runtime.pipeline.dispatch(state, {
    request_id: `cellar_metadata_${suffix}`, idempotency_key: `cellar_metadata_idem_${suffix}`, actor_id: 'player',
    action_type, created_time: state.save_file.world_time.absolute_minute, parameters
  });
  const plant = dispatch('plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' } }, 'plant');
  assert.equal(plant.success, true, plant.status_code);
  assert.equal(dispatch('advance_time', { minutes: 5400 }, 'time').success, true);
  const harvested = dispatch('harvest_crop', { crop_id: plant.created_objects[0]!.object_id }, 'harvest');
  assert.equal(harvested.success, true, harvested.status_code);
  const lotId = harvested.created_objects[0]!.object_id;
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, lotId).quantity.amount, 1200);
  const moved = dispatch('store_item', { object_ref: { object_type: 'MaterialLot', object_id: lotId },
    storage_ref: { location_id: 'home', storage_type: 'cellar', container_id: 'home_cellar_01' } }, 'move');
  assert.equal(moved.success, true, moved.status_code);
  const jar = state.save_file.storage_containers.find(item => item.container_id === 'home_cellar_01')!;
  assert.deepEqual(jar.used_capacity_limits, { mass_g: 1200, volume_ml: 1920 });
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(registry).assertReconciled(state.save_file);
});

test('three jars enforce their own dual capacity while allowing mixed forms', () => {
  const { state } = buildRuntime();
  const save = state.save_file;
  const ids = ['home_cellar_01', 'home_cellar_jar_02', 'home_cellar_jar_03'];
  const base = makeSave(true).inventory[0]!;
  const cabbage = (id: string, jar: string) => ({ ...structuredClone(base), lot_id: id,
    storage_ref: { container_id: jar, location_id: 'home', storage_type: 'cellar' } });
  const initial = [...save.inventory];
  const ten = Array.from({ length: 10 }, (_, i) => cabbage(`jar_one_${i}`, ids[0]!));
  const another = Array.from({ length: 10 }, (_, i) => cabbage(`jar_two_${i}`, ids[1]!));
  const checker = new StorageReconciler(registry);
  assert.doesNotThrow(() => checker.assertMaterials(save, [...initial, ...ten, ...another]));
  assert.throws(() => checker.assertMaterials(save, [...initial, ...ten, cabbage('overflow', ids[0]!)]), /ERR_STORAGE_CAPACITY_OVERFLOW:home_cellar_01/);
  const bacon = { ...structuredClone(base), lot_id: 'mixed_bacon', base_id: 'bacon', current_form: 'cured',
    storage_ref: { container_id: ids[2]!, location_id: 'home', storage_type: 'cellar' } };
  const mixed = Array.from({ length: 9 }, (_, i) => cabbage(`jar_three_${i}`, ids[2]!));
  assert.doesNotThrow(() => checker.assertMaterials(save, [...initial, ...mixed, bacon]));
  assert.throws(() => checker.assertMaterials(save, [...initial, ...mixed, bacon, cabbage('mixed_overflow', ids[2]!)]), /ERR_STORAGE_CAPACITY_OVERFLOW:home_cellar_jar_03/);
});

test('real harvested, processed and starter lots can mix while three real jars retain separate contents', () => {
  const { runtime, state, contracts } = buildRuntime();
  const dispatch = (action_type: string, parameters: unknown, suffix: string) => runtime.pipeline.dispatch(state, {
    request_id: `real_jars_${suffix}`, idempotency_key: `real_jars_idem_${suffix}`, actor_id: 'player',
    action_type, created_time: state.save_file.world_time.absolute_minute, parameters
  });
  const ok = (result: ReturnType<typeof dispatch>) => { assert.equal(result.success, true, result.status_code); return result; };
  const plant = ok(dispatch('plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 6, unit: 'count' }, seeds_per_tile: 2 }, 'plant'));
  ok(dispatch('advance_time', { minutes: 5400 }, 'grow'));
  const ready = plant.created_objects.filter(item => state.save_file.crop_instances.find(crop => crop.crop_id === item.object_id)?.lifecycle_status === 'ready_to_harvest');
  assert.equal(ready.length, 3);
  const lots = ready.map((crop, index) => ok(dispatch('harvest_crop', { crop_id: crop.object_id }, `harvest_${index}`)).created_objects[0]!.object_id);
  const jars = ['home_cellar_01', 'home_cellar_jar_02', 'home_cellar_jar_03'];
  const transfer = (id: string, target: string, suffix: string) => ok(dispatch('store_item', {
    object_ref: { object_type: 'MaterialLot', object_id: id },
    storage_ref: { location_id: 'home', storage_type: 'cellar', container_id: target }
  }, suffix));
  transfer(lots[0]!, jars[0]!, 'fresh_first');
  transfer('bacon_initial_001', jars[0]!, 'bacon_first');
  transfer(lots[1]!, jars[1]!, 'fresh_second');
  const task = ok(dispatch('start_processing', { method_id: 'pickling_cabbage_basic', input_lots: [
    { lot_id: lots[2], quantity: { amount: 300, unit: 'g' } },
    { lot_id: 'salt_initial_001', quantity: { amount: 15, unit: 'g' } }
  ], facility_ref: { location_id: 'home', storage_type: 'pickling_jar', container_id: 'pickling_jar_basic_01',
    definition_id: 'pickling_jar_basic', facility_id: 'pickling_jar_basic_01' } }, 'start_processing'));
  ok(dispatch('advance_time', { minutes: 2880 }, 'processing_time'));
  const output = ok(dispatch('collect_processing_result', { task_id: task.created_objects[0]!.object_id }, 'collect')).created_objects[0]!.object_id;
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, output).storage_ref.container_id, 'home_room_temp_01');
  transfer(output, jars[0]!, 'pickled_first');
  transfer(lots[2]!, jars[2]!, 'cut_third');
  const first = state.save_file.inventory.filter(item => item.storage_ref.container_id === jars[0]).map(item => `${item.base_id}/${item.current_form}`).sort();
  assert.deepEqual(first, ['bacon/cured', 'cabbage/fresh', 'cabbage/pickled']);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, lots[1]!).storage_ref.container_id, jars[1]);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, lots[2]!).storage_ref.container_id, jars[2]);
  contracts.assertSaveFile(state.save_file);
  new StorageAudit(registry).assertReconciled(state.save_file);
});

test('manufactured legacy cellar save loads without silently acquiring jars or physical metadata', async () => {
  const { state, contracts } = buildRuntime();
  const save = state.save_file;
  save.storage_containers = save.storage_containers.filter(item => !['home_cellar_jar_02', 'home_cellar_jar_03'].includes(item.container_id));
  const cellar = save.storage_containers.find(item => item.container_id === 'home_cellar_01')!;
  cellar.container_type = 'cellar_container';
  const room = save.storage_containers.find(item => item.container_id === 'home_room_temp_01')!;
  room.supported_forms = room.supported_forms.filter(form => form !== 'pickled');
  delete save.physical_capacity_policy_id;
  for (const container of save.storage_containers) { delete container.capacity_limits; delete container.used_capacity_limits; }
  contracts.assertSaveFile(save);
  new StorageAudit().assertReconciled(save);
  const serialized = new SaveManager().serialize(state);
  const storage = new InMemorySaveStoragePort();
  await storage.write('legacy', serialized);
  const { configs, contracts: currentContracts } = buildRuntimeWithoutState();
  const session = new CocosAppRuntimeSession(configs, currentContracts, storage);
  await session.load('legacy');
  await session.save('legacy_roundtrip');
  assert.equal(await storage.read('legacy'), serialized);
  assert.equal(await storage.read('legacy_roundtrip'), serialized);
  const roundtrip = JSON.parse(serialized) as SaveFile;
  assert.equal(roundtrip.storage_containers.find(item => item.container_id === 'home_cellar_01')!.container_type, 'cellar_container');
  assert.equal(roundtrip.storage_containers.some(item => item.container_type === 'cellar_jar'), false);
  assert.equal(roundtrip.physical_capacity_policy_id, undefined);
});

test('manufactured prior physical cellar preserves its original limits and container layout across load', async () => {
  const { state, contracts } = buildRuntime();
  const save = state.save_file;
  save.storage_containers = save.storage_containers.filter(item => !['home_cellar_jar_02', 'home_cellar_jar_03'].includes(item.container_id));
  const cellar = save.storage_containers.find(item => item.container_id === 'home_cellar_01')!;
  cellar.container_type = 'cellar_container';
  cellar.capacity_limits = { mass_g: 150000, volume_ml: 300000 };
  const room = save.storage_containers.find(item => item.container_id === 'home_room_temp_01')!;
  room.supported_forms = room.supported_forms.filter(form => form !== 'pickled');
  contracts.assertSaveFile(save);
  new StorageAudit(registry).assertReconciled(save);
  const serialized = new SaveManager().serialize(state);
  const storage = new InMemorySaveStoragePort();
  await storage.write('prior_physical', serialized);
  const { configs, contracts: currentContracts } = buildRuntimeWithoutState();
  const session = new CocosAppRuntimeSession(configs, currentContracts, storage);
  await session.load('prior_physical');
  await session.save('roundtrip');
  assert.equal(await storage.read('prior_physical'), serialized);
  assert.equal(await storage.read('roundtrip'), serialized);
  const preserved = JSON.parse(serialized) as SaveFile;
  assert.deepEqual(preserved.storage_containers.find(item => item.container_id === 'home_cellar_01')!.capacity_limits,
    { mass_g: 150000, volume_ml: 300000 });
  assert.equal(preserved.storage_containers.some(item => item.container_type === 'cellar_jar'), false);
});

test('formal transfer to a full jar rolls back and another jar remains usable', () => {
  const { runtime, state, contracts } = buildRuntime();
  const dispatch = (action_type: string, parameters: unknown, id: string) => runtime.pipeline.dispatch(state, {
    request_id: `req_jar_${id}`, actor_id: 'player', action_type, created_time: state.save_file.world_time.absolute_minute,
    idempotency_key: `idem_jar_${id}`, parameters
  });
  const plant = dispatch('plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' } }, 'plant');
  assert.equal(plant.success, true, plant.status_code);
  assert.equal(dispatch('advance_time', { minutes: 5400 }, 'time').success, true);
  const harvest = dispatch('harvest_crop', { crop_id: plant.created_objects[0]!.object_id }, 'harvest');
  assert.equal(harvest.success, true, harvest.status_code);
  const selectedId = harvest.created_objects[0]!.object_id;
  const selected = runtime.inventory.findMaterialLot(state.save_file, selectedId);
  for (let i = 0; i < 10; i++) {
    const lot = structuredClone(selected);
    lot.lot_id = `test_legacy_cabbage_${i}`;
    delete lot.cabbage_pieces;
    lot.storage_ref = { location_id: 'home', storage_type: 'cellar', container_id: 'home_cellar_jar_02' };
    state.save_file.inventory.push(lot);
  }
  new StorageReconciler(registry).reconcile(state.save_file);
  contracts.assertSaveFile(state.save_file);
  const before = structuredClone(state);
  const target = (id: string) => ({ object_ref: { object_type: 'MaterialLot', object_id: selectedId },
    storage_ref: { location_id: 'home', storage_type: 'cellar', container_id: id } });
  assert.equal(dispatch('store_item', target('home_cellar_jar_02'), 'full').status_code, 'ERR_STORAGE_CAPACITY_OVERFLOW');
  assert.deepEqual(state, before);
  assert.equal(dispatch('store_item', target('home_cellar_jar_03'), 'free').success, true);
  assert.equal(runtime.inventory.findMaterialLot(state.save_file, selectedId).storage_ref.container_id, 'home_cellar_jar_03');
  new StorageAudit(registry).assertReconciled(state.save_file);
});
