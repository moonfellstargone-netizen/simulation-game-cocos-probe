import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRequestBuilder, RuntimeStateSummary } from '../src/game-core/index';
import { buildRuntime, cloneForCompare } from './support/runtimeHarness';

test('ActionRequestBuilder fills formal ActionRequest envelope without reading or mutating SaveFile', () => {
  const { state } = buildRuntime();
  const before = cloneForCompare(state.save_file);
  const builder = new ActionRequestBuilder({ defaultActorId: 'player', requestPrefix: 'builder_req', idempotencyPrefix: 'builder_idem' });

  const request = builder.build('advance_time', { minutes: 30 }, { created_time: 123 });

  assert.equal(request.request_id, 'builder_req_001_advance_time');
  assert.equal(request.actor_id, 'player');
  assert.equal(request.action_type, 'advance_time');
  assert.equal(request.created_time, 123);
  assert.equal(request.idempotency_key, 'builder_idem_builder_req_001_advance_time');
  assert.deepEqual(request.parameters, { minutes: 30 });
  assert.deepEqual(state.save_file, before);
});

test('ActionRequestBuilder rejects system and non-formal action types', () => {
  const builder = new ActionRequestBuilder();
  assert.throws(() => builder.assertFormalActionType('system.start_new_game'), /ERR_DEV_RUNNER_SYSTEM_ACTION_FORBIDDEN/);
  assert.throws(() => builder.assertFormalActionType('debug_shortcut'), /ERR_DEV_RUNNER_ACTION_NOT_FORMAL/);
});

test('RuntimeStateSummary reads SaveFile without changing runtime state', () => {
  const { state } = buildRuntime();
  const before = cloneForCompare(state);
  const summary = new RuntimeStateSummary().build(state.save_file, state.domain_events);

  assert.equal(summary.world_time.absolute_minute, state.save_file.world_time.absolute_minute);
  assert.equal(summary.player_state.money, Number(state.save_file.player_state.money));
  assert.equal(summary.inventory.lot_count, state.save_file.inventory.length);
  assert.equal(summary.dish_lots.count, state.save_file.dish_lots.length);
  assert.deepEqual(state, before);
});
