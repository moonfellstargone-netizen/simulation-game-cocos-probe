import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageAudit } from '../src/game-core/index';
import { Stage1AFixtureRunner } from '../src/game-core/testing-api';
import type { Stage1AFixtureDocument } from '../src/game-core/testing-api';
import { buildRuntimeWithoutState } from './support/runtimeHarness';
import { testBuildId } from './support/buildId.mjs';

test('Stage1AFixtureRunner executes the formal fixture through T20_release_injected_reservation without system reservation steps entering ActionPipeline', () => {
  const { snapshot, configs, contracts, runtime } = buildRuntimeWithoutState();
  const fixture = snapshot.loaded_documents['tests/fixtures/stage_1A_action_sequence.yaml'] as Stage1AFixtureDocument;
  const runner = new Stage1AFixtureRunner(runtime.pipeline, { configs, buildId: testBuildId('fixture_runner'), nowIso8601: '2026-05-19T00:00:00.000Z' });
  const report = runner.runFixtureThroughStepId(fixture, 'T20_release_injected_reservation');

  assert.equal(report.fixture_id, 'stage_1A_action_sequence');
  assert.deepEqual(report.step_results.map((item) => item.step_id), [
    'T01_load_config',
    'T02_start_new_game',
    'T03_plant_cabbage',
    'T03B_save_load_mid_growth',
    'T04_advance_until_mature',
    'T05_harvest_cabbage',
    'T06_room_temp_decay',
    'T07_move_to_cellar',
    'T08_cellar_decay',
    'T09_split_cabbage_300g',
    'T10_start_pickling',
    'T11_advance_pickling_until_ready',
    'T12_collect_pickled_cabbage',
    'T13_cook_bacon_cabbage',
    'T14_submit_tavern_order',
    'T15_save_and_load',
    'T16_invalid_lot_failure',
    'T17_split_for_reservation_test',
    'T18_inject_active_reservation',
    'T19_reserved_lot_rollback_failure',
    'T20_release_injected_reservation'
  ]);

  assert.equal(report.step_results.find((item) => item.step_id === 'T16_invalid_lot_failure')?.success, false);
  assert.equal(report.step_results.find((item) => item.step_id === 'T16_invalid_lot_failure')?.status_code, 'ERR_INVALID_LOT_STATE');
  assert.equal(report.step_results.find((item) => item.step_id === 'T19_reserved_lot_rollback_failure')?.success, false);
  assert.equal(report.step_results.find((item) => item.step_id === 'T19_reserved_lot_rollback_failure')?.status_code, 'ERR_ALREADY_RESERVED');
  assert.equal(report.step_results.find((item) => item.step_id === 'T18_inject_active_reservation')?.action_result, undefined);
  assert.equal(report.step_results.find((item) => item.step_id === 'T20_release_injected_reservation')?.action_result, undefined);
  assert.equal(report.step_results.filter((item) => item.action_type.startsWith('system.')).every((item) => item.action_result === undefined), true);
  assert.equal(report.step_results.filter((item) => !item.action_type.startsWith('system.')).every((item) => item.action_result !== undefined), true);

  assert.equal(typeof report.aliases.crop, 'string');
  assert.equal(typeof report.aliases.cabbage_lot, 'string');
  assert.equal(typeof report.aliases.cabbage_split_lot, 'string');
  assert.equal(typeof report.aliases.pickling_task, 'string');
  assert.equal(typeof report.aliases.pickled_cabbage_lot, 'string');
  assert.equal(typeof report.aliases.dish_lot, 'string');
  assert.equal(typeof report.aliases.reservation_test_lot, 'string');
  assert.equal(typeof report.aliases.injected_reservation, 'string');

  const task = report.state.save_file.processing_tasks.find((item) => item.task_id === report.aliases.pickling_task);
  assert.equal(task?.status, 'completed');
  if (task) contracts.assertProcessingTask(task);
  const pickledLot = report.state.save_file.inventory.find((item) => item.lot_id === report.aliases.pickled_cabbage_lot);
  assert.equal(pickledLot?.quantity.amount, 50, 'T13 should consume 250g from the 300g pickled cabbage lot and keep the remaining 50g reconciled');
  if (pickledLot) contracts.assertMaterialLot(pickledLot);

  const order = report.state.save_file.orders.find((item) => item.order_id === 'tavern_home_dish_001');
  assert.equal(order?.status, 'completed');
  assert.equal(order?.submitted_object_refs[0]?.object_id, report.aliases.dish_lot);
  assert.equal(typeof order?.result_summary?.match_score, 'number');
  assert.equal(typeof order?.result_summary?.reward_final, 'number');
  assert.equal(order?.result_summary?.result_key, 'OK_DEMAND_ACCEPTED');
  if (order) contracts.assertOrder(order);
  assert.equal(Number(report.state.save_file.player_state.money), 137);
  assert.deepEqual(report.state.save_file.player_state.reputation_map, { west_market_tavern: 1 });
  assert.equal(report.state.save_file.dish_lots.some((item) => item.dish_lot_id === report.aliases.dish_lot), false);
  assert.equal(report.state.save_file.storage_containers.some((container) => container.active_object_refs.some((ref) => ref.object_type === 'DishLot' && ref.object_id === report.aliases.dish_lot)), false);

  const reservation = report.state.save_file.reservations.find((item) => item.reservation_id === report.aliases.injected_reservation);
  assert.equal(reservation?.status, 'released');
  assert.equal(reservation?.target_ref.object_id, report.aliases.reservation_test_lot);
  if (reservation) contracts.assertReservation(reservation);
  const reservationLot = report.state.save_file.inventory.find((item) => item.lot_id === report.aliases.reservation_test_lot);
  assert.equal(reservationLot?.quantity.amount, 100);
  assert.equal(report.state.save_file.reservations.some((item) => item.status === 'active'), false);

  const failedResults = report.step_results.filter((item) => item.success === false).map((item) => item.action_result!);
  assert.equal(failedResults.every((result) => result.domain_events.length === 0), true);
  assert.equal(failedResults.every((result) => result.event_log_entries.length === 0), true);

  for (const result of report.step_results.flatMap((item) => item.action_result ? [item.action_result] : [])) {
    contracts.assertActionResult(result);
    for (const event of result.domain_events) contracts.assertDomainEvent(event);
  }
  contracts.assertSaveFile(report.state.save_file);
  new StorageAudit().assertReconciled(report.state.save_file);
});
