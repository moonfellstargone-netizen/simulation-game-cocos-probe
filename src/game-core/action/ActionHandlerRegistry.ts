import type { GameState } from '../domain/types';
import type { ActionResult, FormalStage1AActionRequest, FormalStage1AActionType } from './ActionTypes';

export interface ActionHandler<TRequest extends FormalStage1AActionRequest = FormalStage1AActionRequest> {
  readonly actionType: FormalStage1AActionType;
  execute(state: GameState, request: TRequest): ActionResult;
}

export class ActionHandlerRegistry {
  private readonly handlers = new Map<FormalStage1AActionType, ActionHandler>();

  register(handler: ActionHandler): void {
    if (this.handlers.has(handler.actionType)) {
      throw new Error(`ERR_ACTION_HANDLER_DUPLICATE:${handler.actionType}`);
    }
    this.handlers.set(handler.actionType, handler);
  }

  get(actionType: FormalStage1AActionType): ActionHandler {
    const handler = this.handlers.get(actionType);
    if (!handler) throw new Error(`ERR_ACTION_HANDLER_MISSING:${actionType}`);
    return handler;
  }
}
