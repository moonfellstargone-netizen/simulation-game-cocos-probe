import type { ConfigRepository } from '../config/ConfigRepository';
import type { GameState } from '../domain/types';
import { GameRuntime } from '../runtime/GameRuntime';
import { NewGameBuilder } from '../save/NewGameBuilder';
import { StorageAudit } from '../storage/StorageAudit';
import type { RuntimeContractValidator } from '../validation/RuntimeContractValidator';
import type { ActionRequest, ActionResult, FormalStage1AActionType } from '../action/ActionTypes';
import { ActionRequestBuilder } from '../action/ActionRequestBuilder';
import { RuntimeStateSummary } from '../runtime/RuntimeStateSummary';

export interface Stage1AHeadlessRuntimeOptions {
  buildId?: string;
  nowIso8601?: string;
  actorId?: string;
}

export interface HeadlessDispatchResult {
  request: ActionRequest;
  result: ActionResult;
}

// Developer-only headless driver: every formal state change is delegated to the runtime ActionPipeline.
export class Stage1AHeadlessRuntime {
  readonly runtime: GameRuntime;
  readonly state: GameState;
  readonly requests: ActionRequestBuilder;
  readonly summaries = new RuntimeStateSummary();
  private readonly audit = new StorageAudit();

  constructor(
    private readonly configs: ConfigRepository,
    private readonly contracts: RuntimeContractValidator,
    private readonly options: Stage1AHeadlessRuntimeOptions = {}
  ) {
    this.requests = new ActionRequestBuilder({ defaultActorId: this.options.actorId ?? 'player' });
    this.runtime = new GameRuntime(this.configs, this.contracts);
    this.state = new NewGameBuilder(this.configs).buildStage1A({
      buildId: this.options.buildId ?? 'headless_runtime_v0_0_2_22',
      nowIso8601: this.options.nowIso8601 ?? '2026-05-19T00:00:00.000Z'
    });
    this.validateCurrentState();
  }

  dispatch<TParams>(actionType: FormalStage1AActionType, parameters: TParams): HeadlessDispatchResult {
    this.requests.assertFormalActionType(actionType);
    const request = this.requests.build(actionType, parameters, {
      created_time: this.state.save_file.world_time.absolute_minute
    });
    const result = this.runtime.pipeline.dispatch(this.state, request);
    this.validateCurrentState();
    return { request, result };
  }

  dispatchRequest(request: ActionRequest): ActionResult {
    this.requests.assertFormalActionType(request.action_type);
    const result = this.runtime.pipeline.dispatch(this.state, request);
    this.validateCurrentState();
    return result;
  }

  validateCurrentState(): void {
    this.contracts.assertSaveFile(this.state.save_file);
    this.audit.assertReconciled(this.state.save_file);
  }

  summary() {
    return this.summaries.build(this.state.save_file, this.state.domain_events);
  }

  summaryText(): string {
    return this.summaries.format(this.summary());
  }
}
