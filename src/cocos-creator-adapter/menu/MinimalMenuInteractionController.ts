import type { CocosSessionHost } from '../CocosSessionHost';
import { MenuActionBinding, type MenuActionSelection } from './MenuActionBinding';
import { MinimalMenuPresenter } from './MinimalMenuPresenter';
import type { MenuRenderSnapshot } from './MenuRenderSnapshot';

export class MinimalMenuInteractionController {
  private readonly binding = new MenuActionBinding();

  constructor(
    private readonly host: CocosSessionHost,
    private readonly presenter: MinimalMenuPresenter = new MinimalMenuPresenter()
  ) {}

  refresh(): MenuRenderSnapshot {
    const session = this.host.requireSession();
    this.presenter.renderViewModel(session.getViewModel());
    this.presenter.renderSelectableViewModel(session.getSelectableViewModel());
    return this.presenter.currentSnapshot();
  }

  preview(selection: MenuActionSelection): MenuRenderSnapshot {
    try {
      this.presenter.clearTransientResults();
      const session = this.host.requireSession();
      const selectable = session.getSelectableViewModel();
      this.presenter.renderSelectableViewModel(selectable);
      const draft = this.binding.buildDraft(selectable, selection);
      this.presenter.renderPreviewResult(session.preview(draft.action_type, draft.parameters));
      this.presenter.renderViewModel(session.getViewModel());
      return this.presenter.currentSnapshot();
    } catch (error) {
      this.presenter.renderError(this.toError(error));
      return this.presenter.currentSnapshot();
    }
  }

  confirm(selection: MenuActionSelection): MenuRenderSnapshot {
    try {
      this.presenter.clearTransientResults();
      const session = this.host.requireSession();
      const selectableBeforePreview = session.getSelectableViewModel();
      this.presenter.renderSelectableViewModel(selectableBeforePreview);
      const draft = this.binding.buildDraft(selectableBeforePreview, selection);
      const preview = session.preview(draft.action_type, draft.parameters);
      this.presenter.renderPreviewResult(preview);
      if (preview.success) {
        this.presenter.renderActionResult(session.dispatch(draft.action_type, draft.parameters));
      }
      this.presenter.renderViewModel(session.getViewModel());
      this.presenter.renderSelectableViewModel(session.getSelectableViewModel());
      return this.presenter.currentSnapshot();
    } catch (error) {
      this.presenter.renderError(this.toError(error));
      return this.presenter.currentSnapshot();
    }
  }

  confirmSplitDirect(selection: Extract<MenuActionSelection, { action_type: 'split_lot' }>): MenuRenderSnapshot {
    this.presenter.clearTransientResults();
    const session = this.host.requireSession();
    let parameters: { source_lot_id: string; quantity: typeof selection.quantity };
    try {
      if (selection.action_type !== 'split_lot') throw new Error('ERR_MENU_SPLIT_ACTION_INVALID');
      const selectable = session.getSelectableViewModel();
      this.presenter.renderSelectableViewModel(selectable);
      const draft = this.binding.buildDraft(selectable, selection);
      if (draft.action_type !== 'split_lot') throw new Error('ERR_MENU_SPLIT_ACTION_INVALID');
      parameters = draft.parameters as typeof parameters;
      session.validateSplit(parameters.source_lot_id, parameters.quantity);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.presenter.renderSplitValidation({ action_type: 'split_lot', success: false, status_code: message.split(':')[0] || 'ERR_UNKNOWN' });
      return this.presenter.currentSnapshot();
    }
    this.presenter.renderSplitValidation({ action_type: 'split_lot', success: true, status_code: 'OK' });
    try {
      this.presenter.renderActionResult(session.dispatch('split_lot', parameters));
      this.presenter.renderViewModel(session.getViewModel());
      this.presenter.renderSelectableViewModel(session.getSelectableViewModel());
    } catch (error) {
      this.presenter.renderError(this.toError(error));
    }
    return this.presenter.currentSnapshot();
  }

  currentSnapshot(): MenuRenderSnapshot {
    return this.presenter.currentSnapshot();
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
