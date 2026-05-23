import type { FormalStage1AActionType } from '../game-core';
import type { CocosActionPreviewResult } from '../cocos-app/adapters/CocosActionPreviewer';
import type { CocosAppRuntimeSessionLoadSummary, CocosAppRuntimeSessionSaveSummary } from '../cocos-app/runtime/CocosAppRuntimeSession';
import type { CocosLifecyclePort } from './CocosLifecyclePort';
import type { CocosSessionHost } from './CocosSessionHost';
import { NullCocosUiBindingPort, type CocosUiBindingPort } from './CocosUiBindingPort';

export class QinglanSessionProbeComponent implements CocosLifecyclePort {
  constructor(
    private readonly host: CocosSessionHost,
    private readonly binding: CocosUiBindingPort = new NullCocosUiBindingPort()
  ) {}

  onLoad(): void {
    try {
      this.host.createSession();
    } catch (error) {
      this.binding.renderError(this.toError(error));
      throw error;
    }
  }

  start(): void {
    try {
      const session = this.host.requireSession();
      this.binding.renderViewModel(session.getViewModel());
      this.binding.renderSelectableViewModel(session.getSelectableViewModel());
    } catch (error) {
      this.binding.renderError(this.toError(error));
      throw error;
    }
  }

  preview<TParams>(actionType: FormalStage1AActionType, parameters: TParams): CocosActionPreviewResult {
    try {
      const result = this.host.requireSession().preview(actionType, parameters);
      this.binding.renderPreviewResult(result);
      return result;
    } catch (error) {
      this.binding.renderError(this.toError(error));
      throw error;
    }
  }

  dispatch<TParams>(actionType: FormalStage1AActionType, parameters: TParams) {
    try {
      const result = this.host.requireSession().dispatch(actionType, parameters);
      this.binding.renderActionResult(result);
      this.binding.renderViewModel(this.host.requireSession().getViewModel());
      this.binding.renderSelectableViewModel(this.host.requireSession().getSelectableViewModel());
      return result;
    } catch (error) {
      this.binding.renderError(this.toError(error));
      throw error;
    }
  }

  async save(slotId: string): Promise<CocosAppRuntimeSessionSaveSummary> {
    try {
      return await this.host.requireSession().save(slotId);
    } catch (error) {
      this.binding.renderError(this.toError(error));
      throw error;
    }
  }

  async load(slotId: string): Promise<CocosAppRuntimeSessionLoadSummary> {
    try {
      const loaded = await this.host.requireSession().load(slotId);
      this.binding.renderViewModel(loaded.view_model);
      this.binding.renderSelectableViewModel(this.host.requireSession().getSelectableViewModel());
      return loaded;
    } catch (error) {
      this.binding.renderError(this.toError(error));
      throw error;
    }
  }

  onDestroy(): void {
    this.host.destroySession();
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
