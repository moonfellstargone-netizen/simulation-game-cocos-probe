import type { CocosSessionHost } from '../CocosSessionHost';
import { SaveLoadPresenter } from './SaveLoadPresenter';
import type { SaveLoadRenderSnapshot } from './SaveLoadRenderSnapshot';
import { SaveSlotBinding, type SaveSlotSelection } from './SaveSlotBinding';

export class SaveLoadInteractionController {
  private readonly slots = new SaveSlotBinding();

  constructor(
    private readonly host: CocosSessionHost,
    private readonly presenter: SaveLoadPresenter = new SaveLoadPresenter()
  ) {}

  refresh(): SaveLoadRenderSnapshot {
    const session = this.host.requireSession();
    this.presenter.renderViewModel(session.getViewModel());
    this.presenter.renderSelectableViewModel(session.getSelectableViewModel());
    return this.presenter.currentSnapshot();
  }

  async save(selection: SaveSlotSelection): Promise<SaveLoadRenderSnapshot> {
    try {
      this.presenter.clearTransientResults();
      const session = this.host.requireSession();
      const slotId = this.slots.buildSlot(selection);
      const result = await session.save(slotId);
      this.presenter.renderSaveResult(result);
      this.presenter.renderViewModel(session.getViewModel());
      this.presenter.renderSelectableViewModel(session.getSelectableViewModel());
      return this.presenter.currentSnapshot();
    } catch (error) {
      this.presenter.renderError(error);
      this.safeRefreshAfterError();
      return this.presenter.currentSnapshot();
    }
  }

  async load(selection: SaveSlotSelection): Promise<SaveLoadRenderSnapshot> {
    try {
      this.presenter.clearTransientResults();
      const session = this.host.requireSession();
      const slotId = this.slots.buildSlot(selection);
      const result = await session.load(slotId);
      this.presenter.renderLoadResult(result);
      this.presenter.renderViewModel(result.view_model);
      this.presenter.renderSelectableViewModel(session.getSelectableViewModel());
      return this.presenter.currentSnapshot();
    } catch (error) {
      this.presenter.renderError(error);
      this.safeRefreshAfterError();
      return this.presenter.currentSnapshot();
    }
  }

  private safeRefreshAfterError(): void {
    try {
      const session = this.host.requireSession();
      this.presenter.renderViewModel(session.getViewModel());
      this.presenter.renderSelectableViewModel(session.getSelectableViewModel());
    } catch {
      // Rendering the original error is enough when no session exists yet.
    }
  }
}
