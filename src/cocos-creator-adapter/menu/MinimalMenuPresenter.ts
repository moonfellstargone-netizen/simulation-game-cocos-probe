import type { ActionResult } from '../../game-core';
import type { CocosActionPreviewResult } from '../../cocos-app/adapters/CocosActionPreviewer';
import type { CocosSelectableViewModelData } from '../../cocos-app/view-models/CocosSelectableViewModel';
import type { CocosStateViewModelData } from '../../cocos-app/view-models/CocosStateViewModel';
import { cloneMenuSnapshot, type MenuRenderSnapshot } from './MenuRenderSnapshot';

export class MinimalMenuPresenter {
  private snapshot: MenuRenderSnapshot = {
    view_model: null,
    selectable_view_model: null,
    last_preview_result: null,
    last_action_result: null,
    errors: []
  };

  renderViewModel(viewModel: CocosStateViewModelData): void {
    this.snapshot.view_model = structuredClone(viewModel);
  }

  renderSelectableViewModel(viewModel: CocosSelectableViewModelData): void {
    this.snapshot.selectable_view_model = structuredClone(viewModel);
  }

  renderPreviewResult(result: CocosActionPreviewResult): void {
    this.snapshot.last_preview_result = structuredClone(result);
  }

  renderActionResult(result: ActionResult): void {
    this.snapshot.last_action_result = structuredClone(result);
  }

  renderError(error: Error): void {
    this.snapshot.errors.push({ message: error.message });
  }

  clearTransientResults(): void {
    this.snapshot.last_preview_result = null;
    this.snapshot.last_action_result = null;
    this.snapshot.errors = [];
  }

  currentSnapshot(): MenuRenderSnapshot {
    return cloneMenuSnapshot(this.snapshot);
  }
}
