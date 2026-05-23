import type { CocosSelectableViewModelData } from '../../cocos-app/view-models/CocosSelectableViewModel';
import type { CocosStateViewModelData } from '../../cocos-app/view-models/CocosStateViewModel';
import type { CocosAppRuntimeSessionLoadSummary, CocosAppRuntimeSessionSaveSummary } from '../../cocos-app/runtime/CocosAppRuntimeSession';
import type { CocosPresentedError } from '../errors/CocosErrorPresenter';

export interface SaveLoadRenderSnapshot {
  view_model: CocosStateViewModelData | null;
  selectable_view_model: CocosSelectableViewModelData | null;
  last_save_result: CocosAppRuntimeSessionSaveSummary | null;
  last_load_result: CocosAppRuntimeSessionLoadSummary | null;
  errors: CocosPresentedError[];
}

export function cloneSaveLoadSnapshot(snapshot: SaveLoadRenderSnapshot): SaveLoadRenderSnapshot {
  return structuredClone(snapshot);
}
