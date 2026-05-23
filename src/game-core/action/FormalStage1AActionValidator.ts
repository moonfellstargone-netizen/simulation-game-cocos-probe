import type { ActionRequest, FormalStage1AActionRequest, FormalStage1AActionType } from './ActionTypes';
import { FORMAL_STAGE_1A_ACTION_TYPES, STAGE_1A_REQUIRED_PARAMETERS } from './FormalStage1AActionCatalog';

export class FormalStage1AActionValidator {
  readonly actionTypes: ReadonlySet<string> = new Set(FORMAL_STAGE_1A_ACTION_TYPES);

  assertFormalAction(request: ActionRequest): asserts request is FormalStage1AActionRequest {
    if (!this.actionTypes.has(request.action_type)) {
      throw new Error(`ERR_ACTION_NOT_IN_STAGE_1A_FORMAL_SCHEMA:${request.action_type}`);
    }
    if (!request.request_id || !request.actor_id || !request.idempotency_key) {
      throw new Error('ERR_ACTION_ENVELOPE_INCOMPLETE');
    }
    if (typeof request.created_time !== 'number') {
      throw new Error('ERR_ACTION_CREATED_TIME_INVALID');
    }
    if (request.parameters === null || typeof request.parameters !== 'object' || Array.isArray(request.parameters)) {
      throw new Error('ERR_ACTION_PARAMETERS_INVALID');
    }
    const keys = STAGE_1A_REQUIRED_PARAMETERS[request.action_type as FormalStage1AActionType];
    const params = request.parameters as Record<string, unknown>;
    for (const key of keys) {
      if (!(key in params)) {
        throw new Error(`ERR_ACTION_PARAMETER_MISSING:${request.action_type}:${key}`);
      }
    }
  }
}
