import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StorageAudit } from '../src/game-core/index';
import { Stage1AActionScriptRunner, Stage1AHeadlessRuntime } from '../src/game-core/dev-api';
import { Stage1AFixtureRunner } from '../src/game-core/testing-api';
import type { Stage1AFixtureDocument } from '../src/game-core/testing-api';
import { buildRuntimeWithoutState } from './support/runtimeHarness';

function runHeadlessCoreLoop() {
  const { configs, contracts } = buildRuntimeWithoutState();
  const runtime = new Stage1AHeadlessRuntime(configs, contracts, { buildId: 'headless_test_v0_0_2_22', nowIso8601: '2026-05-19T00:00:00.000Z' });
  const script = new Stage1AActionScriptRunner();
  const report = script.runCoreLoop(runtime);
  return { runtime, report, contracts };
}

test('Headless runner completes Stage 1A core loop through submit_order with formal ActionPipeline dispatches', () => {
  const { runtime, report, contracts } = runHeadlessCoreLoop();

  assert.deepEqual(report.step_results.map((step) => step.action_type), [
    'plant_crop',
    'advance_time',
    'harvest_crop',
    'split_lot',
    'start_processing',
    'advance_time',
    'collect_processing_result',
    'cook_dish',
    'submit_order'
  ]);
  assert.equal(report.step_results.every((step) => step.success), true);
  assert.equal(report.step_results.some((step) => step.action_type.startsWith('system.')), false);

  const order = runtime.state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001');
  assert.equal(order?.status, 'completed');
  assert.equal(Number(runtime.state.save_file.player_state.money), 137);
  assert.deepEqual(runtime.state.save_file.player_state.reputation_map, { west_market_tavern: 1 });
  assert.equal(runtime.state.save_file.dish_lots.some((item) => item.dish_lot_id === report.refs.dish_lot), false);
  assert.equal(runtime.state.save_file.processing_tasks.some((item) => item.task_id === report.refs.pickling_task && item.status === 'completed'), true);
  assert.equal(runtime.state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_type === 'DishLot' && ref.object_id === report.refs.dish_lot)), false);

  contracts.assertSaveFile(runtime.state.save_file);
  for (const result of report.step_results.map((step) => step.result)) {
    contracts.assertActionResult(result);
    for (const event of result.domain_events) contracts.assertDomainEvent(event);
  }
  new StorageAudit().assertReconciled(runtime.state.save_file);
});

test('Headless runner rejects system action requests before ActionPipeline dispatch', () => {
  const { configs, contracts } = buildRuntimeWithoutState();
  const runtime = new Stage1AHeadlessRuntime(configs, contracts, { buildId: 'headless_system_reject_v0_0_2_22' });
  const before = structuredClone(runtime.state);

  assert.throws(() => runtime.dispatchRequest({
    request_id: 'bad_system_request',
    actor_id: 'player',
    action_type: 'system.inject_active_reservation',
    created_time: runtime.state.save_file.world_time.absolute_minute,
    idempotency_key: 'bad_system_request',
    parameters: {}
  }), /ERR_DEV_RUNNER_SYSTEM_ACTION_FORBIDDEN/);
  assert.deepEqual(runtime.state, before);
});

test('Headless runner final key business state matches formal fixture runner state without requiring full JSON equality', () => {
  const headless = runHeadlessCoreLoop();
  const { snapshot, configs, contracts, runtime } = buildRuntimeWithoutState();
  const fixture = snapshot.loaded_documents['tests/fixtures/stage_1A_action_sequence.yaml'] as Stage1AFixtureDocument;
  const fixtureReport = new Stage1AFixtureRunner(runtime.pipeline, { configs, buildId: 'fixture_compare_v0_0_2_22', nowIso8601: '2026-05-19T00:00:00.000Z' }).runFixtureThroughStepId(fixture, 'T20_release_injected_reservation');

  const headlessOrder = headless.runtime.state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001');
  const fixtureOrder = fixtureReport.state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001');

  assert.equal(headlessOrder?.status, fixtureOrder?.status);
  assert.equal(Number(headless.runtime.state.save_file.player_state.money), Number(fixtureReport.state.save_file.player_state.money));
  assert.deepEqual(headless.runtime.state.save_file.player_state.reputation_map, fixtureReport.state.save_file.player_state.reputation_map);
  assert.equal(headless.runtime.state.save_file.dish_lots.length, 0);
  assert.equal(fixtureReport.state.save_file.dish_lots.length, 0);
  assert.equal(headless.runtime.state.save_file.processing_tasks.some((item) => item.status === 'completed'), true);
  assert.equal(fixtureReport.state.save_file.processing_tasks.some((item) => item.status === 'completed'), true);

  contracts.assertSaveFile(headless.runtime.state.save_file);
  contracts.assertSaveFile(fixtureReport.state.save_file);
  new StorageAudit().assertReconciled(headless.runtime.state.save_file);
  new StorageAudit().assertReconciled(fixtureReport.state.save_file);
});

test('Headless runtime and Cocos adapter source do not import or call fixture runner', () => {
  const root = process.cwd();
  const headlessSource = readFileSync(join(root, 'src/game-core/dev/Stage1AHeadlessRuntime.ts'), 'utf8') + readFileSync(join(root, 'src/game-core/dev/Stage1AActionScriptRunner.ts'), 'utf8');
  const adapterSource = readFileSync(join(root, 'src/cocos-app/adapters/CocosActionDispatcher.ts'), 'utf8');

  assert.equal(headlessSource.includes('Stage1AFixtureRunner'), false);
  assert.equal(adapterSource.includes('Stage1AFixtureRunner'), false);
});
