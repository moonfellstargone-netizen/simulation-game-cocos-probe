import test from 'node:test';
import { testBuildId } from './support/buildId.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CocosAppRuntimeSession } from '../src/cocos-app/runtime/CocosAppRuntimeSession';
import { InMemorySaveStoragePort } from '../src/game-core';
import { buildRuntime, buildRuntimeWithoutState, cloneForCompare } from './support/runtimeHarness';

function makeSession(storage = new InMemorySaveStoragePort()) {
  const { configs, contracts } = buildRuntimeWithoutState();
  return new CocosAppRuntimeSession(configs, contracts, storage, {
    buildId: testBuildId('action_preview_boundary_test'),
    nowIso8601: '2026-05-19T00:00:00.000Z'
  });
}

test('split quantity preview rejects discrete fractions, preserves formal IDs and agrees on full-source removal', async () => {
  const storage = new InMemorySaveStoragePort();
  const controlStorage = new InMemorySaveStoragePort();
  const session = makeSession(storage);
  const control = makeSession(controlStorage);
  await session.save('quantity_preview_before');
  const before = await storage.read('quantity_preview_before');
  const view = cloneForCompare(session.getViewModel());
  const selectable = cloneForCompare(session.getSelectableViewModel());
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const [source_lot_id, amount, unit] of [['seed_cabbage_initial_001', 0.5, 'count'], ['salt_initial_001', 0, 'g'], ['salt_initial_001', Number.MIN_VALUE, 'g']] as const) {
      const rejected = session.preview('split_lot', { source_lot_id, quantity: { amount, unit } });
      assert.equal(rejected.success, false);
    }
    const preview = session.preview('split_lot', { source_lot_id: 'salt_initial_001', quantity: { amount: 200, unit: 'g' } });
    assert.equal(preview.success, true);
    assert.equal(preview.effect_counts.created_objects, 1);
    assert.equal(preview.effect_counts.updated_objects, 2);
  }
  await session.save('quantity_preview_after');
  assert.equal(await storage.read('quantity_preview_after'), before);
  assert.deepEqual(session.getViewModel(), view);
  assert.deepEqual(session.getSelectableViewModel(), selectable);
  const parameters = { source_lot_id: 'salt_initial_001', quantity: { amount: 200, unit: 'g' } };
  const actual = session.dispatch('split_lot', parameters);
  const expected = control.dispatch('split_lot', parameters);
  assert.equal(actual.success, true);
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.updated_objects.find((object) => object.object_id === parameters.source_lot_id)?.summary, { status: 'consumed' });
  assert.equal(session.getSelectableViewModel().splittable_lot_options.some((lot) => lot.id === parameters.source_lot_id), false);
  await session.save('quantity_preview_formal');
  await control.save('quantity_preview_control');
  assert.equal(await storage.read('quantity_preview_formal'), await controlStorage.read('quantity_preview_control'));
});

test('repeated split previews before and after loading agree with formal execution without consuming its IDs', async () => {
  const storage = new InMemorySaveStoragePort();
  const seed = makeSession(storage);
  const parameters = { source_lot_id: 'salt_initial_001', quantity: { amount: 10, unit: 'g' } };
  assert.equal(seed.dispatch('split_lot', parameters).success, true);
  await seed.save('preview_id_seed');
  for (const session of [seed, makeSession(storage)]) {
    if (session !== seed) await session.load('preview_id_seed');
    const controlStorage = new InMemorySaveStoragePort();
    const control = makeSession(controlStorage);
    if (session === seed) {
      assert.equal(control.dispatch('split_lot', parameters).success, true);
    } else {
      await controlStorage.write('preview_id_seed', (await storage.read('preview_id_seed'))!);
      await control.load('preview_id_seed');
    }
    await session.save('preview_id_before');
    const before = await storage.read('preview_id_before');
    const beforeView = cloneForCompare(session.getViewModel());
    const beforeSelectable = cloneForCompare(session.getSelectableViewModel());
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const preview = session.preview('split_lot', parameters);
      assert.equal(preview.success, true);
      assert.equal(preview.status_code, 'OK');
      assert.equal(preview.effect_counts.created_objects, 1);
      assert.deepEqual(preview.side_effect_contract, { save_file_changed: false, domain_events_written: 0, event_log_entries_written: 0, real_id_sequence_consumed: false });
      const rejected = session.preview('split_lot', { ...parameters, quantity: { amount: 999999, unit: 'g' } });
      assert.equal(rejected.success, false);
      assert.equal(rejected.status_code, 'ERR_NOT_ENOUGH_RESOURCE');
    }
    await session.save('preview_id_after');
    assert.equal(await storage.read('preview_id_after'), before);
    assert.deepEqual(session.getViewModel(), beforeView);
    assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);
    const actual = session.dispatch('split_lot', parameters);
    const expected = control.dispatch('split_lot', parameters);
    assert.equal(actual.success, true);
    assert.equal(actual.created_objects[0]?.object_id, 'lot_split_000002');
    assert.deepEqual(actual, expected, 'previews leave the formal object and event sequence identical to a healthy control');
    await session.save('preview_id_actual');
    await control.save('preview_id_control');
    assert.equal(await storage.read('preview_id_actual'), await controlStorage.read('preview_id_control'));
  }
});

test('processing required inputs preview preserves complete saved state and real task/event IDs on rejection and success', async () => {
  const storage = new InMemorySaveStoragePort();
  const controlStorage = new InMemorySaveStoragePort();
  const session = makeSession(storage);
  const control = makeSession(controlStorage);
  let cabbage = '';
  for (const current of [session, control]) {
    const plant = current.dispatch('plant_crop', { field_plot_id: 'field_plot_01', seed_lot_id: 'seed_cabbage_initial_001', seed_quantity: { amount: 1, unit: 'count' } });
    assert.equal(plant.success, true);
    assert.equal(current.dispatch('advance_time', { minutes: 5400 }).success, true);
    const harvest = current.dispatch('harvest_crop', { crop_id: plant.created_objects[0]!.object_id });
    assert.equal(harvest.success, true);
    cabbage = harvest.created_objects[0]!.object_id;
  }
  const { configs } = buildRuntimeWithoutState();
  const method = configs.requiredDoc<{ input_view_requirements: Array<{ base_id?: string; min_quantity_g?: number }> }>('configs/processing/methods/pickling_cabbage_basic.yaml');
  const minimumSalt = method.input_view_requirements.find((item) => item.base_id === 'salt')!.min_quantity_g!;
  const primary = { lot_id: cabbage, quantity: { amount: 300, unit: 'g' } };
  const salt = { lot_id: 'salt_initial_001', quantity: { amount: minimumSalt, unit: 'g' } };
  const facility_ref = { location_id: 'home', storage_type: 'pickling_jar', container_id: 'pickling_jar_basic_01', definition_id: 'pickling_jar_basic', facility_id: 'pickling_jar_basic_01' };
  await session.save('preview_before');
  const before = await storage.read('preview_before');
  const beforeView = cloneForCompare(session.getViewModel());
  const beforeSelectable = cloneForCompare(session.getSelectableViewModel());
  for (const input_lots of [[primary], [salt], [primary, { ...salt, quantity: { amount: minimumSalt - 0.001, unit: 'g' } }]]) {
    const preview = session.preview('start_processing', { method_id: 'pickling_cabbage_basic', input_lots, facility_ref });
    assert.equal(preview.success, false);
    assert.equal(preview.status_code, 'ERR_PROCESSING_INPUT_MISSING');
    assert.deepEqual(preview.effect_counts, { consumed_resources: 0, created_objects: 0, updated_objects: 0, released_reservations: 0 });
    await session.save('preview_after');
    assert.equal(await storage.read('preview_after'), before, 'complete serialized state stays identical');
    assert.deepEqual(session.getViewModel(), beforeView, 'domain event history also stays identical');
    assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);
  }
  const parameters = { method_id: 'pickling_cabbage_basic', input_lots: [primary, salt], facility_ref };
  for (let index = 0; index < 2; index += 1) assert.equal(session.preview('start_processing', parameters).success, true);
  await session.save('preview_after_success');
  assert.equal(await storage.read('preview_after_success'), before);
  assert.deepEqual(session.getViewModel(), beforeView);
  const actual = session.dispatch('start_processing', parameters);
  const expected = control.dispatch('start_processing', parameters);
  assert.equal(actual.success, true);
  assert.equal(actual.created_objects[0]?.object_id, 'task_processing_000001');
  assert.deepEqual(actual, expected, 'preview never consumes real task or event IDs');
  await session.save('preview_actual');
  await control.save('preview_control');
  assert.equal(await storage.read('preview_actual'), await controlStorage.read('preview_control'));
});

test('ActionPreview simulates formal dispatch on cloned state without mutating SaveFile, writing events, or consuming real IDs', () => {
  const session = makeSession();
  const beforeView = cloneForCompare(session.getViewModel());
  const beforeSelectable = cloneForCompare(session.getSelectableViewModel());

  const preview = session.preview('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  });

  assert.equal(preview.success, true);
  assert.equal(preview.side_effect_contract.save_file_changed, false);
  assert.equal(preview.side_effect_contract.domain_events_written, 0);
  assert.equal(preview.side_effect_contract.event_log_entries_written, 0);
  assert.equal(preview.side_effect_contract.real_id_sequence_consumed, false);
  assert.deepEqual(session.getViewModel(), beforeView);
  assert.deepEqual(session.getSelectableViewModel(), beforeSelectable);

  const dispatched = session.dispatch('plant_crop', {
    field_plot_id: 'field_plot_01',
    seed_lot_id: 'seed_cabbage_initial_001',
    seed_quantity: { amount: 1, unit: 'count' }
  });
  assert.equal(dispatched.success, true);
  assert.equal(dispatched.created_objects.find((item) => item.object_type === 'CropInstance')?.object_id, 'crop_000001');
});

test('ActionPreview reuses formal business validation instead of unconditional preview success', () => {
  const session = makeSession();
  const before = cloneForCompare(session.getViewModel());

  const preview = session.preview('harvest_crop', { crop_id: 'missing_crop_for_preview' });
  assert.equal(preview.success, false);
  assert.equal(preview.status_code, 'ERR_CROP_NOT_FOUND');
  assert.equal(preview.effect_counts.created_objects, 0);
  assert.deepEqual(session.getViewModel(), before);
});

test('ActionPreview rejects system actions before formal dispatch and formal ActionPipeline rejects preview_only bypass', () => {
  const session = makeSession();
  assert.throws(() => session.preview('system.release_reservation' as never, {}), /ERR_DEV_RUNNER_SYSTEM_ACTION_FORBIDDEN/);

  const { runtime, state } = buildRuntime();
  const result = runtime.pipeline.dispatch(state, {
    request_id: 'bad_preview_only',
    actor_id: 'player',
    action_type: 'advance_time',
    created_time: state.save_file.world_time.absolute_minute,
    idempotency_key: 'bad_preview_only',
    parameters: { minutes: 1 },
    preview_only: true
  });
  assert.equal(result.success, false);
  assert.equal(result.status_code, 'ERR_PREVIEW_ONLY_NOT_ALLOWED_IN_FORMAL_DISPATCH');
});

test('Cocos preview and selectable sources stay platform-neutral and do not import dev/testing API', () => {
  const files = collectFiles(join(process.cwd(), 'src/cocos-app')).filter((file) => file.endsWith('.ts'));
  const combined = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const forbidden of [
    'game-core/dev-api',
    'game-core/testing-api',
    'Stage1AFixtureRunner',
    'Stage1AHeadlessRuntime',
    'Stage1AActionScriptRunner',
    'system.inject_active_reservation',
    'system.release_reservation',
    'wx.',
    "from 'cc'",
    'from "cc"'
  ]) {
    assert.equal(combined.includes(forbidden), false, `UI readiness boundary leaked forbidden token ${forbidden}`);
  }
  for (const forbiddenPattern of [/save_file\.[A-Za-z0-9_]+\s*=/, /\.inventory\s*=/, /\.orders\s*=/, /\.dish_lots\s*=/, /\.reservations\s*=/]) {
    assert.equal(forbiddenPattern.test(combined), false, `UI readiness boundary contains direct state mutation pattern ${forbiddenPattern}`);
  }
});

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(full) : [full];
  });
}
