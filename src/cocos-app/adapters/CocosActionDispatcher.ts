import type { ActionRequest, ActionResult, FormalStage1AActionType, GameState } from '../../game-core';
import { ActionPipeline, ActionRequestBuilder } from '../../game-core';

export interface UiRequestIdFactory {
  next(prefix: string): string;
}

export class LocalSequentialUiRequestIdFactory implements UiRequestIdFactory {
  private cursor = 0;
  next(prefix: string): string {
    this.cursor += 1;
    return `${prefix}_${String(this.cursor).padStart(6, '0')}`;
  }
}

export interface CocosDispatchEnvelopeOptions {
  actor_id?: string;
  request_id?: string;
  idempotency_key?: string;
}

export class CocosActionDispatcher {
  private readonly requests: ActionRequestBuilder;

  constructor(
    private readonly pipeline: ActionPipeline,
    private readonly stateProvider: () => GameState,
    private readonly requestIds: UiRequestIdFactory = new LocalSequentialUiRequestIdFactory(),
    private readonly actorId = 'player'
  ) {
    this.requests = new ActionRequestBuilder({ defaultActorId: this.actorId, requestPrefix: 'cocos_req', idempotencyPrefix: 'cocos_idem' });
  }

  dispatchFromUi<TParams>(action_type: FormalStage1AActionType, parameters: TParams, options: CocosDispatchEnvelopeOptions = {}): ActionResult {
    this.requests.assertFormalActionType(action_type);
    const state = this.stateProvider();
    const request = this.buildRequest(action_type, parameters, state, options);
    return this.pipeline.dispatch(state, request);
  }

  dispatchRequest(request: ActionRequest): ActionResult {
    this.requests.assertFormalActionType(request.action_type);
    return this.pipeline.dispatch(this.stateProvider(), request);
  }

  private buildRequest<TParams>(action_type: FormalStage1AActionType, parameters: TParams, state: GameState, options: CocosDispatchEnvelopeOptions): ActionRequest<FormalStage1AActionType, TParams> {
    const requestId = options.request_id ?? this.requestIds.next(action_type);
    return this.requests.build(action_type, parameters, {
      request_id: requestId,
      actor_id: options.actor_id ?? this.actorId,
      created_time: state.save_file.world_time.absolute_minute,
      idempotency_key: options.idempotency_key ?? this.requestIds.next(`idem_${action_type}`)
    });
  }
}
