import type { CocosSelectableViewModelData } from '../../cocos-app/view-models/CocosSelectableViewModel';
import type { CocosStateViewModelData } from '../../cocos-app/view-models/CocosStateViewModel';
import type { CocosAppRuntimeSessionLoadSummary, CocosAppRuntimeSessionSaveSummary } from '../../cocos-app/runtime/CocosAppRuntimeSession';
import { CocosErrorPresenter } from '../errors/CocosErrorPresenter';
import { cloneSaveLoadSnapshot, type SaveLoadRenderSnapshot } from './SaveLoadRenderSnapshot';

export class SaveLoadPresenter {
  private readonly errors = new CocosErrorPresenter();
  private snapshot: SaveLoadRenderSnapshot = {
    view_model: null,
    selectable_view_model: null,
    last_save_result: null,
    last_load_result: null,
    errors: []
  };

  renderViewModel(viewModel: CocosStateViewModelData): void {
    this.snapshot.view_model = structuredClone(viewModel);
  }

  renderSelectableViewModel(viewModel: CocosSelectableViewModelData): void {
    this.snapshot.selectable_view_model = structuredClone(viewModel);
  }

  renderSaveResult(result: CocosAppRuntimeSessionSaveSummary): void {
    this.snapshot.last_save_result = structuredClone(result);
  }

  renderLoadResult(result: CocosAppRuntimeSessionLoadSummary): void {
    this.snapshot.last_load_result = structuredClone(result);
  }

  renderError(error: unknown): void {
    this.snapshot.errors.push(this.errors.present(error));
  }

  clearTransientResults(): void {
    this.snapshot.last_save_result = null;
    this.snapshot.last_load_result = null;
    this.snapshot.errors = [];
  }

  currentSnapshot(): SaveLoadRenderSnapshot {
    return cloneSaveLoadSnapshot(this.snapshot);
  }
}
