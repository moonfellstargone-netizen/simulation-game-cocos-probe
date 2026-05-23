import { CocosErrorPresenter } from '../errors/CocosErrorPresenter';
import type { MenuRenderSnapshot } from '../menu/MenuRenderSnapshot';
import type { SaveLoadRenderSnapshot } from '../save/SaveLoadRenderSnapshot';
import {
  cloneCocosUiShellSnapshot,
  type CocosUiShellOperation,
  type CocosUiShellRenderSnapshot,
} from './CocosUiShellRenderSnapshot';

function emptyMenuSnapshot(): MenuRenderSnapshot {
  return {
    view_model: null,
    selectable_view_model: null,
    last_preview_result: null,
    last_action_result: null,
    errors: []
  };
}

function emptySaveLoadSnapshot(): SaveLoadRenderSnapshot {
  return {
    view_model: null,
    selectable_view_model: null,
    last_save_result: null,
    last_load_result: null,
    errors: []
  };
}

export class CocosUiShellPresenter {
  private readonly errorPresenter = new CocosErrorPresenter();
  private snapshot: CocosUiShellRenderSnapshot = {
    lifecycle: {
      has_session: false,
      last_operation: null
    },
    menu: emptyMenuSnapshot(),
    save_load: emptySaveLoadSnapshot(),
    errors: []
  };

  renderLifecycle(hasSession: boolean, lastOperation: CocosUiShellOperation): void {
    this.snapshot.lifecycle = {
      has_session: hasSession,
      last_operation: lastOperation
    };
  }

  renderMenuSnapshot(snapshot: MenuRenderSnapshot): void {
    this.snapshot.menu = structuredClone(snapshot);
  }

  renderSaveLoadSnapshot(snapshot: SaveLoadRenderSnapshot): void {
    this.snapshot.save_load = structuredClone(snapshot);
  }

  renderError(error: unknown): void {
    this.snapshot.errors.push(this.errorPresenter.present(error));
  }

  clearShellErrors(): void {
    this.snapshot.errors = [];
  }

  currentSnapshot(): CocosUiShellRenderSnapshot {
    return cloneCocosUiShellSnapshot(this.snapshot);
  }
}
