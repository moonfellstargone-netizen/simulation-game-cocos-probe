import type { ActionResult } from '../game-core';
import type { CocosActionPreviewResult } from '../cocos-app/adapters/CocosActionPreviewer';
import type { CocosStateViewModelData } from '../cocos-app/view-models/CocosStateViewModel';
import type { CocosSelectableViewModelData } from '../cocos-app/view-models/CocosSelectableViewModel';

export interface CocosUiBindingPort {
  renderViewModel(viewModel: CocosStateViewModelData): void;
  renderSelectableViewModel(viewModel: CocosSelectableViewModelData): void;
  renderPreviewResult(result: CocosActionPreviewResult): void;
  renderActionResult(result: ActionResult): void;
  renderError(error: Error): void;
}

export class NullCocosUiBindingPort implements CocosUiBindingPort {
  renderViewModel(): void {}
  renderSelectableViewModel(): void {}
  renderPreviewResult(): void {}
  renderActionResult(): void {}
  renderError(): void {}
}
