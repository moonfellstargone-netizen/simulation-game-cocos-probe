import type { ActionResult, ConfigRepository, FormalStage1AActionType, GameState, RuntimeContractValidator } from '../../game-core';
import { ActionRequestBuilder, GameRuntime, StorageAudit } from '../../game-core';

export interface CocosActionPreviewResult {
  action_type: FormalStage1AActionType;
  success: boolean;
  status_code: string;
  message_key: string;
  message_params: ActionResult['message_params'];
  warnings: string[];
  preview_mismatch: boolean;
  effect_counts: {
    consumed_resources: number;
    created_objects: number;
    updated_objects: number;
    released_reservations: number;
  };
  side_effect_contract: {
    save_file_changed: false;
    domain_events_written: 0;
    event_log_entries_written: 0;
    real_id_sequence_consumed: false;
  };
}

export class CocosActionPreviewer {
  private readonly requests: ActionRequestBuilder = new ActionRequestBuilder({ defaultActorId: 'player', requestPrefix: 'preview_req', idempotencyPrefix: 'preview_idem' });
  private readonly audit = new StorageAudit();

  constructor(
    private readonly configs: ConfigRepository,
    private readonly contracts: RuntimeContractValidator,
    private readonly stateProvider: () => GameState
  ) {}

  preview<TParams>(actionType: FormalStage1AActionType, parameters: TParams): CocosActionPreviewResult {
    this.requests.assertFormalActionType(actionType);
    const source = this.stateProvider();
    const clonedState = structuredClone(source);
    const previewRuntime = new GameRuntime(this.configs, this.contracts);
    const request = this.requests.build(actionType, parameters, {
      request_id: `preview_${actionType}`,
      actor_id: 'player',
      created_time: clonedState.save_file.world_time.absolute_minute,
      idempotency_key: `preview_${actionType}_idempotency`
    });

    const simulated = previewRuntime.pipeline.dispatch(clonedState, request);
    this.contracts.assertSaveFile(source.save_file);
    this.audit.assertReconciled(source.save_file);

    return {
      action_type: actionType,
      success: simulated.success,
      status_code: simulated.status_code,
      message_key: simulated.message_key,
      message_params: [...simulated.message_params],
      warnings: [...simulated.warnings],
      preview_mismatch: simulated.preview_mismatch,
      effect_counts: {
        consumed_resources: simulated.consumed_resources.length,
        created_objects: simulated.created_objects.length,
        updated_objects: simulated.updated_objects.length,
        released_reservations: simulated.released_reservations.length
      },
      side_effect_contract: {
        save_file_changed: false,
        domain_events_written: 0,
        event_log_entries_written: 0,
        real_id_sequence_consumed: false
      }
    };
  }
}
