import type { GameState } from '../domain/types';
import { TransactionRunner } from '../transaction/TransactionRunner';
import { StorageReconciler } from '../storage/StorageReconciler';
import { ActionResultFactory } from './ActionResultFactory';
import { ActionHandlerRegistry } from './ActionHandlerRegistry';
import { FormalStage1AActionValidator } from './FormalStage1AActionValidator';
import type { ActionRequest, ActionResult, FormalStage1AActionType } from './ActionTypes';
import type { RuntimeContractValidator } from '../validation/RuntimeContractValidator';

const storageMutatingActions = new Set<string>([
  'plant_crop',
  'harvest_crop',
  'store_item',
  'split_lot',
  'start_processing',
  'collect_processing_result',
  'cook_dish',
  'submit_order'
]);

export class ActionPipeline {
  constructor(
    private readonly registry: ActionHandlerRegistry,
    private readonly validator: FormalStage1AActionValidator = new FormalStage1AActionValidator(),
    private readonly transactions: TransactionRunner = new TransactionRunner(),
    private readonly storageReconciler: StorageReconciler = new StorageReconciler(),
    private readonly results: ActionResultFactory = new ActionResultFactory(),
    private readonly contracts?: RuntimeContractValidator
  ) {}

  dispatch(state: GameState, request: ActionRequest): ActionResult {
    try {
      this.contracts?.assertActionRequest(request);
      this.validator.assertFormalAction(request);
      const formalRequest = request;
      if (formalRequest.preview_only === true) {
        throw new Error(`ERR_PREVIEW_ONLY_NOT_ALLOWED_IN_FORMAL_DISPATCH:${formalRequest.action_type}`);
      }
      const beforeEventCount = state.domain_events.length;
      const result = this.transactions.run(state, () => {
        const handler = this.registry.get(formalRequest.action_type as FormalStage1AActionType);
        const handled = handler.execute(state, formalRequest);
        if (handled.success && storageMutatingActions.has(formalRequest.action_type)) {
          this.storageReconciler.reconcile(state.save_file);
        }
        return handled;
      });
      const committedEvents = state.domain_events.slice(beforeEventCount);
      for (const event of committedEvents) this.contracts?.assertDomainEvent(event);
      const withEvents = this.results.withDomainEvents(result, committedEvents);
      this.contracts?.assertActionResult(withEvents);
      return withEvents;
    } catch (error) {
      const statusCode = error instanceof Error ? error.message.split(':')[0] || 'ERR_UNKNOWN' : 'ERR_UNKNOWN';
      const failure = this.results.failure(request, statusCode, { raw_error: error instanceof Error ? error.message : String(error) });
      this.contracts?.assertActionResult(failure);
      return failure;
    }
  }
}
