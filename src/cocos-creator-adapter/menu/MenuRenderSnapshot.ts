import type { ActionResult } from '../../game-core';
import type { CocosActionPreviewResult } from '../../cocos-app/adapters/CocosActionPreviewer';
import type { CocosSelectableViewModelData } from '../../cocos-app/view-models/CocosSelectableViewModel';
import type { CocosStateViewModelData } from '../../cocos-app/view-models/CocosStateViewModel';

export interface MenuErrorSnapshot {
  message: string;
}

export interface MenuRenderSnapshot {
  view_model: CocosStateViewModelData | null;
  selectable_view_model: CocosSelectableViewModelData | null;
  last_preview_result: CocosActionPreviewResult | null;
  last_action_result: ActionResult | null;
  errors: MenuErrorSnapshot[];
}

export function cloneMenuSnapshot(snapshot: MenuRenderSnapshot): MenuRenderSnapshot {
  return structuredClone(snapshot);
}
