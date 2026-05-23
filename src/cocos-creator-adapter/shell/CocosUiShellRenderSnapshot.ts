import type { CocosPresentedError } from '../errors/CocosErrorPresenter';
import type { MenuRenderSnapshot } from '../menu/MenuRenderSnapshot';
import type { SaveLoadRenderSnapshot } from '../save/SaveLoadRenderSnapshot';

export type CocosUiShellOperation =
  | 'create_session'
  | 'destroy_session'
  | 'refresh'
  | 'menu_preview'
  | 'menu_confirm'
  | 'save'
  | 'load';

export interface CocosUiShellLifecycleSnapshot {
  has_session: boolean;
  last_operation: CocosUiShellOperation | null;
}

export interface CocosUiShellRenderSnapshot {
  lifecycle: CocosUiShellLifecycleSnapshot;
  menu: MenuRenderSnapshot;
  save_load: SaveLoadRenderSnapshot;
  errors: CocosPresentedError[];
}

export function cloneCocosUiShellSnapshot(snapshot: CocosUiShellRenderSnapshot): CocosUiShellRenderSnapshot {
  return structuredClone(snapshot);
}
