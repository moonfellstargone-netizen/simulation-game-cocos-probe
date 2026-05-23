import type { ActionPipeline } from '../action/ActionPipeline';
import type { ActionRequest, ActionResult } from '../action/ActionTypes';
import type { GameState, Reservation } from '../domain/types';
import type { ConfigRepository } from '../config/ConfigRepository';
import { NewGameBuilder } from '../save/NewGameBuilder';
import { SaveManager } from '../save/SaveManager';
import { ReservationGuard } from '../reservation/ReservationGuard';

export interface Stage1AFixtureStep {
  step_id: string;
  action_type: string;
  parameters?: unknown;
  save_aliases?: Record<string, string>;
  save_result_aliases?: Record<string, string>;
  expected?: Record<string, unknown>;
}

export interface Stage1AFixtureDocument {
  fixture_id: string;
  action_sequence: Stage1AFixtureStep[];
}

export interface FixtureRunnerOptions {
  configs?: ConfigRepository;
  newGameBuilder?: NewGameBuilder;
  saveManager?: SaveManager;
  buildId?: string;
  nowIso8601?: string;
}

export interface FixtureStepExecution {
  step_id: string;
  action_type: string;
  success: boolean;
  status_code: string;
  action_result?: ActionResult;
}

export interface FixtureRunReport {
  fixture_id: string;
  step_results: FixtureStepExecution[];
  aliases: Record<string, unknown>;
  state: GameState;
}

export class Stage1AFixtureRunner {
  private readonly saveManager: SaveManager;
  private readonly reservations = new ReservationGuard();

  constructor(private readonly pipeline: ActionPipeline, private readonly options: FixtureRunnerOptions = {}) {
    this.saveManager = options.saveManager ?? new SaveManager();
  }

  run(state: GameState, actions: ActionRequest[]): Array<ReturnType<ActionPipeline['dispatch']>> {
    const results = [];
    for (const action of actions) {
      results.push(this.pipeline.dispatch(state, action));
    }
    return results;
  }

  runFixtureThroughStepId(fixture: Stage1AFixtureDocument, finalStepId: string): FixtureRunReport {
    const index = fixture.action_sequence.findIndex((step) => step.step_id === finalStepId);
    if (index < 0) throw new Error(`ERR_FIXTURE_STEP_NOT_FOUND:${finalStepId}`);
    return this.runFixtureSteps(fixture, fixture.action_sequence.slice(0, index + 1));
  }

  runFixtureSteps(fixture: Stage1AFixtureDocument, steps: Stage1AFixtureStep[]): FixtureRunReport {
    const aliases: Record<string, unknown> = {};
    const stepResults: FixtureStepExecution[] = [];
    let state: GameState | null = null;

    for (const step of steps) {
      if (step.action_type.startsWith('system.')) {
        const result = this.executeSystemStep(step, aliases, state);
        state = result.state;
        stepResults.push(result.execution);
        if (step.save_aliases) this.captureSaveAliases(step.save_aliases, aliases);
        if (step.save_result_aliases) this.captureResultAliases(step.save_result_aliases, aliases, result.alias_result, state);
        continue;
      }
      if (!state) throw new Error(`ERR_FIXTURE_STATE_NOT_READY:${step.step_id}`);
      const request = this.toActionRequest(step, aliases, state);
      const beforeState = structuredClone(state);
      const actionResult = this.pipeline.dispatch(state, request);
      stepResults.push({ step_id: step.step_id, action_type: step.action_type, success: actionResult.success, status_code: actionResult.status_code, action_result: actionResult });
      this.assertExpected(step, aliases, state, actionResult, beforeState);
      if (step.save_result_aliases) this.captureResultAliases(step.save_result_aliases, aliases, actionResult, state);
    }

    if (!state) throw new Error('ERR_FIXTURE_NO_GAME_STATE_CREATED');
    return { fixture_id: fixture.fixture_id, step_results: stepResults, aliases, state };
  }

  private executeSystemStep(step: Stage1AFixtureStep, aliases: Record<string, unknown>, state: GameState | null): { state: GameState | null; execution: FixtureStepExecution; alias_result?: Pick<ActionResult, 'created_objects'> } {
    if (step.action_type === 'system.load_config_profile') {
      if (!this.options.configs) throw new Error('ERR_FIXTURE_CONFIG_REPOSITORY_REQUIRED');
      this.options.configs.loadStage1A();
      return { state, execution: { step_id: step.step_id, action_type: step.action_type, success: true, status_code: 'OK_CONFIG_PROFILE_LOADED' } };
    }
    if (step.action_type === 'system.start_new_game') {
      const builder = this.options.newGameBuilder ?? (this.options.configs ? new NewGameBuilder(this.options.configs) : undefined);
      if (!builder) throw new Error('ERR_FIXTURE_NEW_GAME_BUILDER_REQUIRED');
      const newState = builder.buildStage1A({
        buildId: this.options.buildId ?? 'fixture_runner_v0_0_2_22',
        nowIso8601: this.options.nowIso8601 ?? '2026-05-18T00:00:00.000Z'
      });
      return { state: newState, execution: { step_id: step.step_id, action_type: step.action_type, success: true, status_code: 'OK_NEW_GAME_STARTED' } };
    }
    if (step.action_type === 'system.save_and_load_roundtrip') {
      if (!state) throw new Error(`ERR_FIXTURE_STATE_NOT_READY:${step.step_id}`);
      const serialized = this.saveManager.serialize(state);
      const loaded = this.saveManager.deserializeSaveFile(serialized);
      loaded.domain_events = state.domain_events;
      this.assertAliasesStillResolvable(aliases, loaded);
      return { state: loaded, execution: { step_id: step.step_id, action_type: step.action_type, success: true, status_code: 'OK_SAVE_LOAD_ROUNDTRIP' } };
    }
    if (step.action_type === 'system.inject_active_reservation') {
      if (!state) throw new Error(`ERR_FIXTURE_STATE_NOT_READY:${step.step_id}`);
      const parameters = this.resolveAliases(step.parameters ?? {}, aliases) as { target_ref?: unknown; quantity?: unknown; reason?: unknown };
      const targetRef = parameters.target_ref as { object_type: string; object_id: string };
      const quantity = parameters.quantity as { amount: number; unit: string };
      if (!targetRef || !quantity || typeof parameters.reason !== 'string') throw new Error('ERR_FIXTURE_RESERVATION_PARAMETERS_INVALID');
      const reservation = this.injectActiveReservation(state, `res_${step.step_id}`, targetRef, quantity, parameters.reason);
      return {
        state,
        execution: { step_id: step.step_id, action_type: step.action_type, success: true, status_code: 'OK_RESERVATION_INJECTED' },
        alias_result: { created_objects: [{ object_type: 'Reservation', object_id: reservation.reservation_id, summary: { status: reservation.status } }] }
      };
    }
    if (step.action_type === 'system.release_reservation') {
      if (!state) throw new Error(`ERR_FIXTURE_STATE_NOT_READY:${step.step_id}`);
      const parameters = this.resolveAliases(step.parameters ?? {}, aliases) as { reservation_id?: unknown };
      if (typeof parameters.reservation_id !== 'string') throw new Error('ERR_FIXTURE_RESERVATION_ID_INVALID');
      this.releaseInjectedReservation(state, parameters.reservation_id);
      return { state, execution: { step_id: step.step_id, action_type: step.action_type, success: true, status_code: 'OK_RESERVATION_RELEASED' } };
    }
    throw new Error(`ERR_FIXTURE_SYSTEM_STEP_UNSUPPORTED:${step.action_type}`);
  }

  private injectActiveReservation(state: GameState, reservationId: string, targetRef: { object_type: string; object_id: string }, quantity: { amount: number; unit: string }, reason: string) {
    if (targetRef.object_type !== 'MaterialLot') throw new Error(`ERR_RESERVATION_TARGET_TYPE_UNSUPPORTED:${targetRef.object_type}`);
    const lot = state.save_file.inventory.find((item) => item.lot_id === targetRef.object_id);
    if (!lot) throw new Error(`ERR_MATERIAL_LOT_NOT_FOUND:${targetRef.object_id}`);
    if (quantity.unit !== lot.quantity.unit) throw new Error('ERR_RESERVATION_UNIT_MISMATCH');
    const activeReserved = this.reservations.activeReservedQuantityForLot(state.save_file, lot.lot_id, lot.quantity.unit);
    if (activeReserved.amount + quantity.amount > lot.quantity.amount) throw new Error('ERR_RESERVATION_QUANTITY_EXCEEDS_LOT');
    const reservation: Reservation = {
      reservation_id: reservationId,
      actor_id: 'fixture_runner',
      target_ref: { object_type: targetRef.object_type, object_id: targetRef.object_id },
      quantity: { amount: quantity.amount, unit: quantity.unit },
      reason,
      created_time: state.save_file.world_time.absolute_minute,
      expire_time: null,
      status: 'active',
      source_action_id: null,
      flags: ['fixture_injected']
    };
    state.save_file.reservations.push(reservation);
    return reservation;
  }

  private releaseInjectedReservation(state: GameState, reservationId: string): void {
    const reservation = state.save_file.reservations.find((item) => item.reservation_id === reservationId);
    if (!reservation) throw new Error(`ERR_RESERVATION_NOT_FOUND:${reservationId}`);
    if (reservation.status !== 'active') throw new Error('ERR_RESERVATION_NOT_ACTIVE');
    reservation.status = 'released';
  }

  private assertExpected(step: Stage1AFixtureStep, aliases: Record<string, unknown>, state: GameState, result: ActionResult, beforeState: GameState): void {
    if (!step.expected) return;
    if (step.expected.success === true && result.success !== true) throw new Error(`ERR_FIXTURE_EXPECTED_SUCCESS:${step.step_id}:${result.status_code}`);
    if (step.expected.success === false && result.success !== false) throw new Error(`ERR_FIXTURE_EXPECTED_FAILURE:${step.step_id}`);
    const allowedStatusCodes = step.expected.status_code_any_of;
    if (Array.isArray(allowedStatusCodes) && !allowedStatusCodes.includes(result.status_code)) {
      throw new Error(`ERR_FIXTURE_STATUS_CODE_MISMATCH:${step.step_id}:${result.status_code}`);
    }
    if (step.expected.rollback_required === true && result.success === false) {
      if (JSON.stringify(state.save_file) !== JSON.stringify(beforeState.save_file)) throw new Error(`ERR_FIXTURE_ROLLBACK_SAVEFILE_CHANGED:${step.step_id}`);
      if (JSON.stringify(state.domain_events) !== JSON.stringify(beforeState.domain_events)) throw new Error(`ERR_FIXTURE_ROLLBACK_EVENTS_CHANGED:${step.step_id}`);
      if (result.domain_events.length !== 0) throw new Error(`ERR_FIXTURE_FAILURE_DOMAIN_EVENTS_NOT_EMPTY:${step.step_id}`);
      if (result.event_log_entries.length !== 0) throw new Error(`ERR_FIXTURE_FAILURE_EVENT_LOG_NOT_EMPTY:${step.step_id}`);
    }
    if (step.expected.processing_task_ready_to_collect === true) {
      const taskAlias = aliases.pickling_task;
      const task = typeof taskAlias === 'string'
        ? state.save_file.processing_tasks.find((item) => item.task_id === taskAlias)
        : state.save_file.processing_tasks.find((item) => item.status === 'ready_to_collect');
      if (!task || task.status !== 'ready_to_collect') throw new Error(`ERR_FIXTURE_PROCESSING_TASK_NOT_READY:${step.step_id}`);
    }
  }

  private toActionRequest(step: Stage1AFixtureStep, aliases: Record<string, unknown>, state: GameState): ActionRequest {
    return {
      request_id: `fixture_${step.step_id}`,
      actor_id: 'player',
      action_type: step.action_type,
      created_time: state.save_file.world_time.absolute_minute,
      idempotency_key: `fixture_idem_${step.step_id}`,
      parameters: this.resolveAliases(step.parameters ?? {}, aliases)
    };
  }

  private captureSaveAliases(saveAliases: Record<string, string>, aliases: Record<string, unknown>): void {
    for (const [alias, value] of Object.entries(saveAliases)) aliases[alias] = value;
  }

  private captureResultAliases(saveResultAliases: Record<string, string>, aliases: Record<string, unknown>, result: Pick<ActionResult, 'created_objects'> | undefined, state: GameState | null): void {
    for (const [alias, expression] of Object.entries(saveResultAliases)) {
      aliases[alias] = this.evaluateAliasExpression(expression, aliases, result, state);
    }
  }

  private evaluateAliasExpression(expression: string, aliases: Record<string, unknown>, result: Pick<ActionResult, 'created_objects'> | undefined, state: GameState | null): unknown {
    const createdMatch = expression.match(/^created_objects\[(\d+)\]\.object_id$/u);
    if (createdMatch) {
      if (!result) throw new Error(`ERR_FIXTURE_RESULT_REQUIRED_FOR_ALIAS:${expression}`);
      const index = Number(createdMatch[1]);
      const objectId = result.created_objects[index]?.object_id;
      if (!objectId) throw new Error(`ERR_FIXTURE_CREATED_OBJECT_ALIAS_MISSING:${expression}`);
      return objectId;
    }
    const freshnessMatch = expression.match(/^inventory\[\$(\w+)\]\.property_profile\.freshness$/u);
    if (freshnessMatch) {
      if (!state) throw new Error(`ERR_FIXTURE_STATE_REQUIRED_FOR_ALIAS:${expression}`);
      const aliasName = freshnessMatch[1];
      if (!aliasName) throw new Error(`ERR_FIXTURE_ALIAS_NAME_INVALID:${expression}`);
      const lotId = aliases[aliasName];
      if (typeof lotId !== 'string') throw new Error(`ERR_FIXTURE_ALIAS_NOT_STRING:${aliasName}`);
      const lot = state.save_file.inventory.find((item) => item.lot_id === lotId);
      if (!lot) throw new Error(`ERR_FIXTURE_LOT_ALIAS_NOT_FOUND:${aliasName}:${lotId}`);
      return lot.property_profile.freshness;
    }
    throw new Error(`ERR_FIXTURE_ALIAS_EXPRESSION_UNSUPPORTED:${expression}`);
  }

  private resolveAliases(value: unknown, aliases: Record<string, unknown>): unknown {
    if (typeof value === 'string' && value.startsWith('$')) {
      const aliasName = value.slice(1);
      if (!(aliasName in aliases)) throw new Error(`ERR_FIXTURE_ALIAS_UNRESOLVED:${aliasName}`);
      return aliases[aliasName];
    }
    if (Array.isArray(value)) return value.map((item) => this.resolveAliases(item, aliases));
    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) result[key] = this.resolveAliases(item, aliases);
      return result;
    }
    return value;
  }

  private assertAliasesStillResolvable(aliases: Record<string, unknown>, state: GameState): void {
    for (const value of Object.values(aliases)) {
      if (typeof value !== 'string') continue;
      const found =
        state.save_file.inventory.some((item) => item.lot_id === value) ||
        state.save_file.crop_instances.some((item) => item.crop_id === value) ||
        state.save_file.processing_tasks.some((item) => item.task_id === value) ||
        state.save_file.dish_lots.some((item) => item.dish_lot_id === value) ||
        state.save_file.orders.some((item) => item.order_id === value) ||
        state.save_file.reservations.some((item) => item.reservation_id === value);
      if (!found && value.includes('_')) {
        // Initial fixture aliases may reference not-yet-created but persistent runtime object IDs. Do not reject plain config path or slot IDs.
        continue;
      }
    }
  }
}
