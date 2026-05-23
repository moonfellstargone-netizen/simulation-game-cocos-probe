import type { ActionResult, FormalStage1AActionType } from '../../game-core';
import {
  CocosActionDispatcher,
} from '../adapters/CocosActionDispatcher';
import { CocosRuntimeFacade } from '../adapters/CocosRuntimeFacade';
import type { CocosStateViewModelData } from '../view-models/CocosStateViewModel';
import type { CocosSelectableViewModelData } from '../view-models/CocosSelectableViewModel';
import type { CocosActionPreviewResult } from '../adapters/CocosActionPreviewer';
import type { ConfigRepository, GameState, RuntimeContractValidator, SaveStoragePort, SaveSlotWriteSummary } from '../../game-core';
import { GameRuntime, NewGameBuilder, SaveManager, StorageAudit } from '../../game-core';

export interface CocosActionSessionPort {
  dispatch<TParams>(actionType: FormalStage1AActionType, parameters: TParams): ActionResult;
}

export interface CocosAppRuntimeSessionOptions {
  buildId?: string;
  nowIso8601?: string;
}

export interface CocosAppRuntimeSessionSaveSummary extends SaveSlotWriteSummary {
  world_minute: number;
}

export interface CocosAppRuntimeSessionLoadSummary {
  slot_id: string;
  world_minute: number;
  view_model: CocosStateViewModelData;
}

export class CocosAppRuntimeSession {
  private readonly runtime: GameRuntime;
  private readonly saveManager = new SaveManager();
  private readonly audit = new StorageAudit();
  private readonly dispatcher: CocosActionDispatcher;
  private readonly facade: CocosRuntimeFacade;
  private state: GameState;

  constructor(
    private readonly configs: ConfigRepository,
    private readonly contracts: RuntimeContractValidator,
    private readonly storage: SaveStoragePort,
    private readonly options: CocosAppRuntimeSessionOptions = {}
  ) {
    this.runtime = new GameRuntime(this.configs, this.contracts);
    this.state = new NewGameBuilder(this.configs).buildStage1A({
      buildId: this.options.buildId ?? 'cocos_app_session_v0_0_2_22',
      nowIso8601: this.options.nowIso8601 ?? '2026-05-19T00:00:00.000Z'
    });
    this.dispatcher = new CocosActionDispatcher(this.runtime.pipeline, () => this.state);
    this.facade = new CocosRuntimeFacade(this.dispatcher, () => this.state, this.configs, this.contracts);
    this.validateSessionState('new_game');
  }

  dispatch<TParams>(actionType: FormalStage1AActionType, parameters: TParams): ActionResult {
    const result = this.facade.dispatch(actionType, parameters);
    this.validateSessionState('dispatch');
    return result;
  }

  getViewModel(): CocosStateViewModelData {
    return this.facade.getViewModel();
  }

  getSelectableViewModel(): CocosSelectableViewModelData {
    return this.facade.getSelectableViewModel();
  }

  preview<TParams>(actionType: FormalStage1AActionType, parameters: TParams): CocosActionPreviewResult {
    const result = this.facade.preview(actionType, parameters);
    this.validateSessionState('preview_after_no_side_effect');
    return result;
  }

  async save(slotId: string): Promise<CocosAppRuntimeSessionSaveSummary> {
    this.validateSessionState('save_before_serialize');
    const serialized = this.saveManager.serialize(this.state);
    await this.storage.write(slotId, serialized);
    return {
      slot_id: slotId,
      byte_length: serialized.length,
      world_minute: this.state.save_file.world_time.absolute_minute
    };
  }

  async load(slotId: string): Promise<CocosAppRuntimeSessionLoadSummary> {
    const serialized = await this.storage.read(slotId);
    if (serialized === null) throw new Error(`ERR_SAVE_SLOT_NOT_FOUND:${slotId}`);

    let candidate: GameState;
    try {
      candidate = this.saveManager.deserializeSaveFile(serialized);
      this.validateState(candidate, 'load_candidate_before_commit');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ERR_COCOS_SESSION_LOAD_REJECTED:${slotId}:${message}`);
    }

    this.state = candidate;
    this.validateSessionState('load_after_commit');
    return {
      slot_id: slotId,
      world_minute: this.state.save_file.world_time.absolute_minute,
      view_model: this.getViewModel()
    };
  }

  private validateSessionState(phase: string): void {
    this.validateState(this.state, phase);
  }

  private validateState(state: GameState, phase: string): void {
    try {
      this.contracts.assertSaveFile(state.save_file);
      this.audit.assertReconciled(state.save_file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ERR_COCOS_SESSION_VALIDATION_FAILED:${phase}:${message}`);
    }
  }
}
