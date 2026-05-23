import type { ActionRequest, FormalStage1AActionType } from './ActionTypes';
import { isFormalStage1AActionType } from './FormalStage1AActionCatalog';

export interface ActionRequestBuilderOptions {
  defaultActorId?: string;
  requestPrefix?: string;
  idempotencyPrefix?: string;
}

export interface BuildActionRequestOptions {
  request_id?: string;
  actor_id?: string;
  created_time?: number;
  idempotency_key?: string;
}

export class ActionRequestBuilder {
  private nextSequence = 1;
  private readonly defaultActorId: string;
  private readonly requestPrefix: string;
  private readonly idempotencyPrefix: string;

  constructor(options: ActionRequestBuilderOptions = {}) {
    this.defaultActorId = options.defaultActorId ?? 'player';
    this.requestPrefix = options.requestPrefix ?? 'dev_req';
    this.idempotencyPrefix = options.idempotencyPrefix ?? 'dev_idem';
  }

  build<TParams>(actionType: FormalStage1AActionType, parameters: TParams, options: BuildActionRequestOptions = {}): ActionRequest<FormalStage1AActionType, TParams> {
    this.assertFormalActionType(actionType);
    const sequence = this.nextSequence++;
    const requestId = options.request_id ?? `${this.requestPrefix}_${String(sequence).padStart(3, '0')}_${actionType}`;
    return {
      request_id: requestId,
      actor_id: options.actor_id ?? this.defaultActorId,
      action_type: actionType,
      created_time: options.created_time ?? 0,
      idempotency_key: options.idempotency_key ?? `${this.idempotencyPrefix}_${requestId}`,
      parameters
    };
  }

  assertFormalActionType(actionType: string): asserts actionType is FormalStage1AActionType {
    if (actionType.startsWith('system.')) throw new Error(`ERR_DEV_RUNNER_SYSTEM_ACTION_FORBIDDEN:${actionType}`);
    if (!isFormalStage1AActionType(actionType)) throw new Error(`ERR_DEV_RUNNER_ACTION_NOT_FORMAL:${actionType}`);
  }
}
