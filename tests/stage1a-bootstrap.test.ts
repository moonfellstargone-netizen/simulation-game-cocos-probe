import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createStage1AHost,
  CocosUiShellController,
  CocosUiShellCommandQueue,
  type CocosSessionHost,
  type MenuActionSelection,
  type Stage1ABootstrapResources
} from '../src/cocos-creator-adapter';
import { InMemorySaveStoragePort, RuntimeContractValidator, RuntimeSchemaValidator, StorageAudit, type ActionResult, type RuntimeConfigSnapshot, type SaveFile } from '../src/game-core';
import { testBuildId } from './support/buildId.mjs';
import { ControlledSaveStoragePort } from './support/controlledSaveStoragePort';

class CountingMemoryStorage extends InMemorySaveStoragePort {
  readonly operations: string[] = [];

  override async write(slotId: string, serializedSave: string): Promise<void> {
    this.operations.push(`write:${slotId}`);
    await super.write(slotId, serializedSave);
  }

  override async read(slotId: string): Promise<string | null> {
    this.operations.push(`read:${slotId}`);
    return await super.read(slotId);
  }
}

// Only this test layer reads files; runtime assembly uses the public bootstrap API.
function resources(): Stage1ABootstrapResources & { storage: CountingMemoryStorage } {
  const snapshot = JSON.parse(readFileSync(join(process.cwd(), 'design_snapshot/generated/stage_1A_runtime_snapshot.json'), 'utf8')) as RuntimeConfigSnapshot;
  const schemas = Object.fromEntries(snapshot.schema_paths.map((path) => [
    path,
    JSON.parse(readFileSync(join(process.cwd(), 'design_snapshot', path), 'utf8')) as unknown
  ]));
  return {
    snapshot,
    schemas,
    storage: new CountingMemoryStorage(),
    buildId: testBuildId('bootstrap_integration'),
    nowIso8601: '2026-05-21T00:00:00.000Z',
    randomSeed: 'farming-test-23' // Fixed successful farming setup for bootstrap recovery tests.
  };
}

function assertNotPublished(input: ReturnType<typeof resources>, expected?: RegExp): void {
  let published: CocosSessionHost | undefined;
  const attempt = () => { published = createStage1AHost(input); };
  if (expected) assert.throws(attempt, expected);
  else assert.throws(attempt);
  assert.equal(published, undefined, 'failed assembly must not publish a usable host');
  assert.deepEqual(input.storage.operations, [], 'assembly must not read or write player storage');
  assert.equal(input.storage.snapshot().size, 0);
}

type RecoveryPoint = 'growing' | 'processing' | 'ready' | 'dish' | 'completed';

test('bootstrap explicitly seeds a new game and loading preserves the saved random stream', async () => {
  const input = resources();
  input.randomSeed = 'stage1_fixed_seed';
  const host = createStage1AHost(input);
  const session = host.requireSession();
  assert.equal(session.dispatch('plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } }).success, true);
  await session.save('probability_checkpoint');
  const saved = JSON.parse((await input.storage.read('probability_checkpoint'))!) as SaveFile;
  assert.equal(saved.random_state.seed, 'stage1_fixed_seed');
  assert.equal(saved.crop_instances[0]!.germination?.outcome, 'failed', 'known fixed failure is persisted before reveal');
  const differentHost = createStage1AHost({ ...input, randomSeed: 'different-new-game' });
  await differentHost.requireSession().load('probability_checkpoint');
  await differentHost.requireSession().save('probability_restored');
  assert.equal(await input.storage.read('probability_restored'), await input.storage.read('probability_checkpoint'), 'loading never substitutes the fresh host random seed');
  for (const invalid of ['', ' ', 7, null]) {
    const bad = resources(); Reflect.set(bad, 'randomSeed', invalid);
    assertNotPublished(bad, /ERR_BOOTSTRAP_RESOURCE_INVALID:randomSeed/);
  }
  const unspecified = resources(); delete unspecified.randomSeed;
  const defaultHost = createStage1AHost(unspecified);
  await defaultHost.requireSession().save('default_random_seed');
  assert.equal(JSON.parse((await unspecified.storage.read('default_random_seed'))!).random_state.seed, 'stage1_fixed_seed');
  host.destroySession(); differentHost.destroySession(); defaultHost.destroySession();
});

function recoveryHost(input: Stage1ABootstrapResources) {
  const host = createStage1AHost(input);
  return { host, queue: new CocosUiShellCommandQueue(new CocosUiShellController(host)), input, actions: new Set<string>() };
}

type RecoveryHost = ReturnType<typeof recoveryHost>;

function selectable(p: RecoveryHost) { return p.host.requireSession().getSelectableViewModel(); }

function required<T>(value: T | undefined, message: string): T {
  assert.notEqual(value, undefined, message);
  return value!;
}

// Observation slots belong only to this test; the player checkpoint stays untouched.
async function capture(p: RecoveryHost, slot = 'recovery_observation'): Promise<string> {
  const saved = await p.queue.execute({ name: 'save', selection: { slot_id: slot } });
  assert.equal(saved.status, 'completed', saved.error_message ?? 'save must succeed');
  return required((await p.input.storage.read(slot)) ?? undefined, 'save must write its full serialization');
}

function savedStrings(value: unknown, values = new Set<string>()): Set<string> {
  if (typeof value === 'string') values.add(value);
  else if (Array.isArray(value)) for (const child of value) savedStrings(child, values);
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) { values.add(key); savedStrings(child, values); }
  }
  return values;
}

async function confirm(p: RecoveryHost, selection: MenuActionSelection): Promise<ActionResult> {
  const before = savedStrings(JSON.parse(await capture(p)));
  const execution = await p.queue.execute({ name: 'menu_confirm', selection });
  assert.equal(execution.status, 'completed', execution.error_message ?? selection.action_type);
  assert.equal(execution.snapshot.menu.last_preview_result?.success, true, selection.action_type);
  const result = required(execution.snapshot.menu.last_action_result ?? undefined, 'confirmation must produce an actual ActionResult');
  assert.equal(result.success, true, result.status_code);
  p.actions.add(selection.action_type);
  const createdIds = result.created_objects.map((item) => item.object_id);
  const eventIds = result.domain_events.map((event) => event.event_id);
  assert.equal(new Set(createdIds).size, createdIds.length, 'created objects have distinct IDs');
  assert.equal(new Set(eventIds).size, eventIds.length, 'new domain events have distinct IDs');
  for (const id of [...createdIds, ...eventIds]) assert.equal(before.has(id), false, `creation must not reuse an ID retained anywhere in SaveFile: ${id}`);
  new StorageAudit().assertReconciled(JSON.parse(await capture(p)) as SaveFile);
  return result;
}

function created(result: ActionResult, type: string): string {
  return required(result.created_objects.find((item) => item.object_type === type)?.object_id, `actual ${type} creation`);
}

async function plant(p: RecoveryHost): Promise<string> {
  const options = selectable(p);
  const field = required(options.field_options.find((item) => item.enabled), 'free field');
  const seed = required(options.seed_lot_options.find((item) => item.enabled), 'available seed');
  return created(await confirm(p, { action_type: 'plant_crop', field_option_id: field.id,
    seed_lot_option_id: seed.id, seed_quantity: { amount: 1, unit: seed.quantity.unit } }), 'CropInstance');
}

async function matureAndHarvest(p: RecoveryHost, cropId: string): Promise<string> {
  for (let day = 0; day < 4; day++) await confirm(p, { action_type: 'advance_time', minutes: 1440 });
  assert.ok(selectable(p).harvestable_crop_options.some((item) => item.id === cropId && item.enabled));
  const lotId = created(await confirm(p, { action_type: 'harvest_crop', crop_option_id: cropId }), 'MaterialLot');
  const target = required(selectable(p).storage_target_options.find((item) => item.enabled && item.storage_type === 'cellar'), 'cellar for harvested reserve');
  await confirm(p, { action_type: 'store_item', source_lot_option_id: lotId, target_storage_option_id: target.id });
  return lotId;
}

async function start(p: RecoveryHost, sourceId: string): Promise<string> {
  const splitId = created(await confirm(p, { action_type: 'split_lot', source_lot_option_id: sourceId, quantity: { amount: 300, unit: 'g' } }), 'MaterialLot');
  const options = selectable(p);
  const method = required(options.processing_method_options.find((item) => item.enabled), 'configured processing method');
  const facility = required(options.processing_facility_options.find((item) => item.enabled && method.compatible_facility_ids.includes(item.id)), 'available processing facility');
  const input_lots = method.input_requirements.map((requirement) => {
    const lot = required(options.processable_lot_options.find((item) => item.enabled && requirement.lot_ids.includes(item.id)
      && (requirement.lot_ids.includes(splitId) ? item.id === splitId : true)), 'actual matching required input');
    return { lot_option_id: lot.id, quantity: { amount: lot.id === splitId ? 300 : 15, unit: lot.quantity.unit } };
  });
  return created(await confirm(p, { action_type: 'start_processing', method_id: method.id, facility_option_id: facility.id, input_lots }), 'ProcessingTask');
}

async function makeReady(p: RecoveryHost, taskId: string): Promise<void> {
  const task = required(selectable(p).processing_task_options.find((item) => item.id === taskId), 'saved processing task');
  assert.equal(task.status, 'active');
  await confirm(p, { action_type: 'advance_time', minutes: task.expected_finish_minute - task.start_world_minute });
  assert.equal(selectable(p).processing_task_options.find((item) => item.id === taskId)?.status, 'ready_to_collect');
}

async function collect(p: RecoveryHost, taskId: string): Promise<string> {
  assert.ok(selectable(p).collectable_task_options.some((item) => item.id === taskId && item.enabled));
  const outputId = created(await confirm(p, { action_type: 'collect_processing_result', task_option_id: taskId }), 'MaterialLot');
  assert.equal(selectable(p).processing_task_options.find((item) => item.id === taskId)?.status, 'completed');
  return outputId;
}

async function cook(p: RecoveryHost, outputId: string): Promise<string> {
  const options = selectable(p);
  const recipe = required(options.cookable_recipe_options.find((item) => item.enabled), 'available recipe');
  const ingredient_options: Extract<MenuActionSelection, { action_type: 'cook_dish' }>['ingredient_options'] = {};
  for (const role of recipe.roles) {
    const lot = options.splittable_lot_options.find((item) => item.enabled && role.lot_ids.includes(item.id) && (role.role !== 'main' || item.id === outputId));
    if (!role.required && lot === undefined) continue;
    assert.ok(lot, `actual recipe input ${role.role}`);
    ingredient_options[role.role] = { lot_option_id: lot.id, quantity: { ...required(role.min_quantity ?? undefined, `configured quantity ${role.role}`) } };
  }
  const target = required(options.storage_target_options.find((item) => item.enabled && item.storage_type === 'room_temp' && item.supported_forms.includes('cooked_dish')), 'dish storage');
  return created(await confirm(p, { action_type: 'cook_dish', recipe_option_id: recipe.id, ingredient_options,
    operation_profile: { heat_level: 'high', active_minutes: 8 }, target_storage_option_id: target.id }), 'DishLot');
}

async function submit(p: RecoveryHost, dishId: string): Promise<string> {
  const order = required(selectable(p).order_options.find((item) => item.enabled), 'available order');
  const before = p.host.requireSession().getViewModel();
  await confirm(p, { action_type: 'submit_order', order_option_id: order.id, dish_lot_option_ids: [dishId] });
  const completed = required(selectable(p).order_options.find((item) => item.id === order.id), 'completed order');
  const summary = required(completed.result_summary ?? undefined, 'real order result');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.enabled, false);
  assert.deepEqual(completed.submitted_object_refs, [{ object_type: 'DishLot', object_id: dishId }]);
  assert.equal(typeof summary.match_score, 'number');
  assert.equal(typeof summary.reward_final, 'number');
  assert.equal(p.host.requireSession().getViewModel().money, before.money + summary.reward_final!);
  assert.notDeepEqual(p.host.requireSession().getViewModel().reputation, before.reputation);
  assert.equal(selectable(p).submittable_dish_lot_options.some((item) => item.id === dishId), false);
  return order.id;
}

async function reach(p: RecoveryHost, point: RecoveryPoint) {
  const progress = { cropId: await plant(p), sourceId: '', taskId: '', outputId: '', dishId: '', orderId: '' };
  if (point === 'growing') return progress;
  progress.sourceId = await matureAndHarvest(p, progress.cropId);
  progress.taskId = await start(p, progress.sourceId);
  if (point === 'processing') return progress;
  await makeReady(p, progress.taskId);
  if (point === 'ready') return progress;
  progress.outputId = await collect(p, progress.taskId);
  progress.dishId = await cook(p, progress.outputId);
  if (point === 'dish') return progress;
  progress.orderId = await submit(p, progress.dishId);
  return progress;
}

for (const point of ['growing', 'processing', 'ready', 'dish', 'completed'] as const) {
  test(`independent ${point} checkpoint restores a new public Host and continues actual Stage1A play without ID overwrite`, async () => {
    const input = resources();
    const old = recoveryHost(input);
    const progress = await reach(old, point);
    const raw = await capture(old, 'web_probe');
    const state = JSON.parse(raw) as SaveFile;
    const savedView = old.host.requireSession().getViewModel();
    const savedOptions = selectable(old);
    assert.equal((await old.queue.execute({ name: 'destroy_session' })).status, 'completed');
    assert.equal(old.host.hasSession(), false);
    const operations = [...input.storage.operations];
    const fresh = recoveryHost(input);
    assert.deepEqual(input.storage.operations, operations, 'new Host must not implicitly read or restore player storage');
    assert.notDeepEqual(fresh.host.requireSession().getViewModel(), savedView, 'new Host starts from formal initial state');
    const loaded = await fresh.queue.execute({ name: 'load', selection: { slot_id: 'web_probe' } });
    assert.equal(loaded.status, 'completed', loaded.error_message ?? 'explicit manual load');
    assert.equal(loaded.snapshot.menu.last_action_result, null, 'a new Host must not invent an old current-action success');
    assert.equal(loaded.snapshot.menu.last_preview_result, null);
    assert.equal(await capture(fresh), raw, 'all SaveFile fields, metadata, resources, history and references round-trip exactly');
    assert.deepEqual(selectable(fresh), savedOptions);
    // Domain events are transient; SaveManager restores SaveFile and starts a fresh event queue.
    assert.deepEqual(fresh.host.requireSession().getViewModel(), { ...savedView, recent_events: [] });
    new StorageAudit().assertReconciled(state);

    if (point === 'growing') {
      progress.sourceId = await matureAndHarvest(fresh, progress.cropId);
      progress.taskId = await start(fresh, progress.sourceId);
      await makeReady(fresh, progress.taskId);
      progress.outputId = await collect(fresh, progress.taskId);
      progress.dishId = await cook(fresh, progress.outputId);
      progress.orderId = await submit(fresh, progress.dishId);
      await plant(fresh);
      assert.deepEqual([...fresh.actions].sort(), ['plant_crop', 'advance_time', 'harvest_crop', 'store_item', 'split_lot', 'start_processing', 'collect_processing_result', 'cook_dish', 'submit_order'].sort());
    } else if (point === 'processing' || point === 'ready') {
      if (point === 'processing') await makeReady(fresh, progress.taskId);
      const outputId = await collect(fresh, progress.taskId);
      const beforeRestart = JSON.parse(await capture(fresh)) as SaveFile;
      const newTaskId = await start(fresh, progress.sourceId);
      assert.notEqual(newTaskId, progress.taskId);
      const afterRestart = JSON.parse(await capture(fresh)) as SaveFile;
      assert.deepEqual(afterRestart.processing_tasks.find((task) => task.task_id === progress.taskId), beforeRestart.processing_tasks.find((task) => task.task_id === progress.taskId));
      assert.deepEqual(afterRestart.inventory.find((lot) => lot.lot_id === outputId), beforeRestart.inventory.find((lot) => lot.lot_id === outputId));
      assert.equal(afterRestart.processing_tasks.find((task) => task.task_id === newTaskId)?.status, 'active');
    } else {
      if (point === 'dish') progress.orderId = await submit(fresh, progress.dishId);
      const completedRaw = await capture(fresh);
      const completedState = JSON.parse(completedRaw) as SaveFile;
      const rejected = await fresh.queue.execute({ name: 'menu_confirm', selection: { action_type: 'submit_order',
        order_option_id: progress.orderId, dish_lot_option_ids: [progress.dishId] } });
      assert.equal(rejected.status, 'failed');
      assert.match(rejected.error_message!, /ERR_MENU_OPTION_DISABLED:order_option/);
      assert.equal(rejected.snapshot.menu.last_action_result, null);
      assert.equal(await capture(fresh), completedRaw, 'completed orders cannot pay again or mutate any saved state');
      await plant(fresh);
      if (point === 'completed') {
        const newSplit = created(await confirm(fresh, { action_type: 'split_lot', source_lot_option_id: progress.sourceId, quantity: { amount: 50, unit: 'g' } }), 'MaterialLot');
        assert.equal(savedStrings(state).has(newSplit), false, 'old consumed split IDs retained in task history must not be reused');
      }
      const continued = JSON.parse(await capture(fresh)) as SaveFile;
      assert.deepEqual(continued.orders, completedState.orders, 'later creation preserves completed summary and submitted-object history');
      assert.equal(continued.player_state.money, completedState.player_state.money);
      assert.deepEqual(continued.player_state.reputation_map, completedState.player_state.reputation_map);
      assert.deepEqual(continued.dish_lots, completedState.dish_lots);
      assert.equal(continued.crop_instances.length, completedState.crop_instances.length + 1);
    }
    assert.equal(await input.storage.read('web_probe'), raw, 'continuation must not overwrite the saved checkpoint');
    assert.equal((await fresh.queue.execute({ name: 'destroy_session' })).status, 'completed');
  });
}

for (const failure of ['malformed JSON', 'Schema rejection', 'StorageAudit rejection', 'storage read rejection', 'storage write rejection'] as const) {
  test(`public Host isolates ${failure}, preserves the complete healthy save and continues after a valid load`, async () => {
    const base = resources();
    const storage = new ControlledSaveStoragePort();
    const p = recoveryHost({ ...base, storage });
    const cropId = await plant(p);
    const checkpoint = await capture(p, 'web_probe');
    await confirm(p, { action_type: 'advance_time', minutes: 60 });
    const healthy = await capture(p);
    const view = p.host.requireSession().getViewModel();
    const options = selectable(p);
    let rejection: RegExp;
    if (failure === 'malformed JSON') {
      await storage.write('web_probe', '{');
      rejection = /ERR_COCOS_SESSION_LOAD_REJECTED/;
    } else if (failure === 'Schema rejection') {
      const invalid = JSON.parse(checkpoint);
      delete invalid.crop_instances;
      await storage.write('web_probe', JSON.stringify(invalid));
      rejection = /ERR_COCOS_SESSION_LOAD_REJECTED/;
    } else if (failure === 'StorageAudit rejection') {
      const invalid = JSON.parse(checkpoint) as SaveFile;
      invalid.storage_containers[0]!.used_capacity += 1;
      new RuntimeContractValidator(RuntimeSchemaValidator.fromSnapshotSchemas(base.schemas)).assertSaveFile(invalid);
      assert.equal(new StorageAudit().audit(invalid).ok, false, 'candidate is Schema-valid but violates storage reconciliation');
      await storage.write('web_probe', JSON.stringify(invalid));
      rejection = /ERR_STORAGE_AUDIT_FAILED/;
    } else {
      const operation = failure === 'storage read rejection' ? 'read' : 'write';
      storage.failNext(operation, new Error(`controlled ${operation} rejected`));
      rejection = new RegExp(`controlled ${operation} rejected`);
    }
    const rejected = await p.queue.execute({ name: failure === 'storage write rejection' ? 'save' : 'load', selection: { slot_id: 'web_probe' } });
    assert.equal(rejected.status, 'failed');
    assert.match(rejected.error_message!, rejection);
    assert.equal(rejected.snapshot.save_load.last_save_result, null, 'failed operation clears old save-success feedback');
    assert.equal(rejected.snapshot.save_load.last_load_result, null, 'failed operation must not retain a success receipt');
    assert.deepEqual(p.host.requireSession().getViewModel(), view);
    assert.deepEqual(selectable(p), options);
    assert.equal(await capture(p), healthy, 'every saved field remains healthy after rejection');
    if (failure.startsWith('storage ')) assert.equal(await storage.read('web_probe'), checkpoint, 'the controlled port rejects before touching the original slot');
    await storage.write('web_probe', checkpoint);
    const loaded = await p.queue.execute({ name: 'load', selection: { slot_id: 'web_probe' } });
    assert.equal(loaded.status, 'completed');
    assert.equal(loaded.snapshot.save_load.errors.length, 0);
    assert.equal(await capture(p), checkpoint);
    await matureAndHarvest(p, cropId);
    const secondCrop = await plant(p);
    const continued = JSON.parse(await capture(p)) as SaveFile;
    assert.equal(continued.crop_instances.length, 2);
    assert.equal(savedStrings(JSON.parse(checkpoint)).has(secondCrop), false);
    assert.equal((await p.queue.execute({ name: 'destroy_session' })).status, 'completed');
  });
}

test('formal resources bootstrap a ready host through public shell, action, save/load and lifecycle APIs', async () => {
  const input = resources();
  const originalSnapshot = structuredClone(input.snapshot);
  const originalSchemas = structuredClone(input.schemas);
  const host = createStage1AHost(input);
  assert.equal(host.hasSession(), true);
  assert.deepEqual(input.storage.operations, []);
  const initialView = host.requireSession().getViewModel();
  const queue = new CocosUiShellCommandQueue(new CocosUiShellController(host));
  assert.equal((await queue.execute({ name: 'create_session' })).status, 'completed', 'the shell accepts an already-created session');

  const saved = await queue.execute({ name: 'save', selection: { slot_id: 'bootstrap_initial' } });
  assert.equal(saved.status, 'completed');
  const serializedInitial = await input.storage.read('bootstrap_initial');
  assert.notEqual(serializedInitial, null);
  const save = JSON.parse(serializedInitial!);
  assert.equal(save.created_with_build, input.buildId);
  assert.equal(save.created_at_real_time, input.nowIso8601);

  const advanced = await queue.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  assert.equal(advanced.status, 'completed');
  assert.equal(advanced.snapshot.menu.last_action_result?.success, true);
  assert.notDeepEqual(host.requireSession().getViewModel(), initialView);
  const loaded = await queue.execute({ name: 'load', selection: { slot_id: 'bootstrap_initial' } });
  assert.equal(loaded.status, 'completed');
  assert.deepEqual(host.requireSession().getViewModel(), initialView);
  assert.equal((await queue.execute({ name: 'save', selection: { slot_id: 'bootstrap_restored' } })).status, 'completed');
  assert.equal(await input.storage.read('bootstrap_restored'), serializedInitial);

  assert.equal((await queue.execute({ name: 'destroy_session' })).status, 'completed');
  assert.equal(host.hasSession(), false);
  assert.throws(() => host.requireSession(), /ERR_COCOS_SESSION_NOT_CREATED/);
  assert.deepEqual(input.snapshot, originalSnapshot, 'bootstrap and actions must not rewrite supplied resources');
  assert.deepEqual(input.schemas, originalSchemas);
});

test('a missing declared schema fails before publishing or accessing storage', () => {
  const input = resources();
  delete input.schemas['schemas/action_result.schema.json'];
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_MISSING:schemas\/action_result.schema.json/);
});

test('contract readiness rejects a core schema even when omitted from the caller declaration', () => {
  const input = resources();
  input.snapshot.schema_paths = input.snapshot.schema_paths.filter((path) => path !== 'schemas/action_result.schema.json');
  delete input.schemas['schemas/action_result.schema.json'];
  assertNotPublished(input, /ERR_RUNTIME_SCHEMA_NOT_LOADED:action_result.schema.json/);
});

test('invalid schema syntax is rejected by the existing schema validator before publishing', () => {
  const input = resources();
  input.schemas['schemas/animal_instance.schema.json'] = { $id: 'animal_instance.schema.json', type: 42 };
  assertNotPublished(input);
});

test('bootstrap compiles declared schemas that are not needed just to construct a new session', () => {
  const input = resources();
  // This config schema is outside the nine runtime contracts' reference closure.
  input.schemas['schemas/config/crop_config.schema.json'] = {
    $id: 'crop_config.schema.json',
    $ref: 'missing_bootstrap_reference.schema.json'
  };
  // Control: the runtime contracts still compile, so only checking those is insufficient.
  new RuntimeContractValidator(RuntimeSchemaValidator.fromSnapshotSchemas(input.schemas)).assertReady();
  assertNotPublished(input, /missing_bootstrap_reference.schema.json/);
});

test('duplicate schema identities cannot silently replace a resource', () => {
  const input = resources();
  (input.schemas['schemas/action_result.schema.json'] as Record<string, unknown>).$id = 'action_request.schema.json';
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_ID_DUPLICATE:action_request.schema.json/);
});

test('a schema identity must match its declared resource basename', () => {
  const input = resources();
  (input.schemas['schemas/action_result.schema.json'] as Record<string, unknown>).$id = 'wrong_action_result.schema.json';
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_ID_MISMATCH:schemas\/action_result.schema.json/);
});

test('undeclared schema resources are not silently ignored', () => {
  const input = resources();
  input.schemas['schemas/extra.schema.json'] = { $id: 'extra.schema.json', type: 'object' };
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_UNDECLARED:schemas\/extra.schema.json/);
});

test('schema resources must be schema objects', () => {
  const input = resources();
  input.schemas['schemas/action_result.schema.json'] = null;
  assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_INVALID:schemas\/action_result.schema.json/);
});

test('schema paths are canonical and unique', async (t) => {
  for (const invalidPath of [
    '../schemas/action_result.schema.json',
    '/schemas/action_result.schema.json',
    'C:/schemas/action_result.schema.json',
    'schemas\\action_result.schema.json',
    'schemas/../action_result.schema.json',
    'schemas//action_result.schema.json'
  ]) {
    await t.test(invalidPath, () => {
      const input = resources();
      input.snapshot.schema_paths = [invalidPath];
      assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_PATH_INVALID/);
    });
  }
  await t.test('duplicate declaration', () => {
    const input = resources();
    input.snapshot.schema_paths.push(input.snapshot.schema_paths[0]!);
    assertNotPublished(input, /ERR_BOOTSTRAP_SCHEMA_PATH_DUPLICATE/);
  });
});

test('a missing required configuration fails without publishing a usable host', () => {
  const input = resources();
  delete input.snapshot.loaded_documents['configs/core/new_game_builder_mapping.yaml'];
  assertNotPublished(input, /ERR_CONFIG_DOC_NOT_LOADED/);
});

test('invalid initial state fails the existing session schema or audit checks before publishing', () => {
  const input = resources();
  const initialWorld = input.snapshot.loaded_documents['configs/initial_world/stage_1A_initial_world.yaml'] as { world_time: { absolute_minute: unknown } };
  initialWorld.world_time.absolute_minute = 'not a minute';
  assertNotPublished(input, /ERR_COCOS_SESSION_VALIDATION_FAILED/);
});

test('the Stage1A bootstrap does not open another stage', () => {
  const input = resources();
  (input.snapshot.loaded_documents['configs/active_stage_1A/stage_1A_active_config.yaml'] as Record<string, unknown>).stage_id = 'stage_1B';
  assertNotPublished(input, /ERR_BOOTSTRAP_STAGE_UNSUPPORTED:stage_1B/);
});

test('startup requires explicit build identity and valid timestamp instead of probe defaults', async (t) => {
  for (const [field, value] of [['buildId', ''], ['nowIso8601', 'not a timestamp']] as const) {
    await t.test(field, () => {
      const input = resources();
      input[field] = value;
      assertNotPublished(input, new RegExp(`ERR_BOOTSTRAP_RESOURCE_INVALID:${field}`));
    });
  }
});

test('snapshot resource metadata and containers must have the declared structure', async (t) => {
  for (const field of ['snapshot_id', 'loaded_documents', 'schema_paths'] as const) {
    await t.test(field, () => {
      const input = resources();
      (input.snapshot as unknown as Record<string, unknown>)[field] = null;
      assertNotPublished(input, /ERR_BOOTSTRAP_RESOURCE_INVALID/);
    });
  }
});

test('startup timestamps reject impossible dates and out-of-range clock fields', async (t) => {
  for (const timestamp of [
    '2026-02-30T00:00:00.000Z',
    '2026-04-31T00:00:00+08:00',
    '2025-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T23:60:00Z',
    '2026-01-01T23:59:60Z'
  ]) {
    await t.test(timestamp, () => {
      const input = resources();
      input.nowIso8601 = timestamp;
      assertNotPublished(input, /ERR_BOOTSTRAP_RESOURCE_INVALID:nowIso8601/);
    });
  }
});

test('valid leap dates, offsets and fractional seconds preserve the supplied startup metadata', async (t) => {
  for (const timestamp of [
    '2024-02-29T23:59:59.123Z',
    '2000-02-29T00:00:00+08:00',
    '2026-10-30T11:45:12.1-05:30'
  ]) {
    await t.test(timestamp, async () => {
      const input = resources();
      input.nowIso8601 = timestamp;
      const host = createStage1AHost(input);
      assert.deepEqual(input.storage.operations, []);
      await host.requireSession().save('bootstrap_valid_timestamp');
      const save = JSON.parse((await input.storage.read('bootstrap_valid_timestamp'))!);
      assert.equal(save.created_at_real_time, timestamp);
      assert.equal(save.last_saved_at_real_time, timestamp);
      assert.equal(save.created_with_build, input.buildId);
      host.destroySession();
    });
  }
});
