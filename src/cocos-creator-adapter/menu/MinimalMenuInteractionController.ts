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

  currentSnapshot(): MenuRenderSnapshot {
    return this.presenter.currentSnapshot();
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
