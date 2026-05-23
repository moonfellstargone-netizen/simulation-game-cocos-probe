import type { CocosSessionHost } from '../CocosSessionHost';
import { MinimalMenuInteractionController, type MenuActionSelection } from '../menu';
import { SaveLoadInteractionController, type SaveSlotSelection } from '../save';
import { CocosUiShellPresenter } from './CocosUiShellPresenter';
import type { CocosUiShellOperation, CocosUiShellRenderSnapshot } from './CocosUiShellRenderSnapshot';

export class CocosUiShellController {
  constructor(
    private readonly host: CocosSessionHost,
    private readonly menu: MinimalMenuInteractionController = new MinimalMenuInteractionController(host),
    private readonly saveLoad: SaveLoadInteractionController = new SaveLoadInteractionController(host),
    private readonly presenter: CocosUiShellPresenter = new CocosUiShellPresenter()
  ) {}

  createSession(): CocosUiShellRenderSnapshot {
    return this.runShellOperation('create_session', () => {
      if (!this.host.hasSession()) this.host.createSession();
      this.refreshControllers();
    });
  }

  destroySession(): CocosUiShellRenderSnapshot {
    return this.runShellOperation('destroy_session', () => {
      this.host.destroySession();
    });
  }

  refresh(): CocosUiShellRenderSnapshot {
    return this.runShellOperation('refresh', () => {
      this.refreshControllers();
    });
  }

  previewMenu(selection: MenuActionSelection): CocosUiShellRenderSnapshot {
    return this.runShellOperation('menu_preview', () => {
      this.presenter.renderMenuSnapshot(this.menu.preview(selection));
    });
  }

  confirmMenu(selection: MenuActionSelection): CocosUiShellRenderSnapshot {
    return this.runShellOperation('menu_confirm', () => {
      const menuSnapshot = this.menu.confirm(selection);
      this.presenter.renderMenuSnapshot(menuSnapshot);
      this.presenter.renderSaveLoadSnapshot(this.saveLoad.refresh());
    });
  }

  async save(selection: SaveSlotSelection): Promise<CocosUiShellRenderSnapshot> {
    return await this.runAsyncShellOperation('save', async () => {
      this.presenter.renderSaveLoadSnapshot(await this.saveLoad.save(selection));
      this.presenter.renderMenuSnapshot(this.menu.refresh());
    });
  }

  async load(selection: SaveSlotSelection): Promise<CocosUiShellRenderSnapshot> {
    return await this.runAsyncShellOperation('load', async () => {
      this.presenter.renderSaveLoadSnapshot(await this.saveLoad.load(selection));
      this.presenter.renderMenuSnapshot(this.menu.refresh());
    });
  }

  currentSnapshot(): CocosUiShellRenderSnapshot {
    return this.presenter.currentSnapshot();
  }

  private refreshControllers(): void {
    this.presenter.renderMenuSnapshot(this.menu.refresh());
    this.presenter.renderSaveLoadSnapshot(this.saveLoad.refresh());
  }

  private runShellOperation(operation: CocosUiShellOperation, action: () => void): CocosUiShellRenderSnapshot {
    this.presenter.clearShellErrors();
    try {
      action();
    } catch (error) {
      this.presenter.renderError(error);
    }
    this.presenter.renderLifecycle(this.host.hasSession(), operation);
    return this.presenter.currentSnapshot();
  }

  private async runAsyncShellOperation(operation: CocosUiShellOperation, action: () => Promise<void>): Promise<CocosUiShellRenderSnapshot> {
    this.presenter.clearShellErrors();
    try {
      await action();
    } catch (error) {
      this.presenter.renderError(error);
    }
    this.presenter.renderLifecycle(this.host.hasSession(), operation);
    return this.presenter.currentSnapshot();
  }
}
