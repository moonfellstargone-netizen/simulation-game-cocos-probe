import type { ActionResult, ConfigRepository, FormalStage1AActionType, GameState, RuntimeContractValidator } from '../../game-core';
import { RuntimeStateSummary } from '../../game-core';
import type { CocosStateViewModelData } from '../view-models/CocosStateViewModel';
import { CocosStateViewModel } from '../view-models/CocosStateViewModel';
import type { CocosSelectableViewModelData } from '../view-models/CocosSelectableViewModel';
import { CocosSelectableViewModel } from '../view-models/CocosSelectableViewModel';
import { CocosActionDispatcher } from './CocosActionDispatcher';
import type { CocosActionPreviewResult } from './CocosActionPreviewer';
import { CocosActionPreviewer } from './CocosActionPreviewer';

export class CocosRuntimeFacade {
  private readonly summary = new RuntimeStateSummary();
  private readonly viewModel = new CocosStateViewModel();
  private readonly selectableViewModel: CocosSelectableViewModel;
  private readonly previewer: CocosActionPreviewer;

  constructor(
    private readonly dispatcher: CocosActionDispatcher,
    private readonly stateProvider: () => GameState,
    configs: ConfigRepository,
    contracts: RuntimeContractValidator
  ) {
    this.selectableViewModel = new CocosSelectableViewModel(configs);
    this.previewer = new CocosActionPreviewer(configs, contracts, this.stateProvider);
  }

  dispatch<TParams>(actionType: FormalStage1AActionType, parameters: TParams): ActionResult {
    return this.dispatcher.dispatchFromUi(actionType, parameters);
  }

  getViewModel(): CocosStateViewModelData {
    const state = this.stateProvider();
    return this.viewModel.fromSummary(this.summary.build(state.save_file, state.domain_events));
  }

  getSelectableViewModel(): CocosSelectableViewModelData {
    const state = this.stateProvider();
    return this.selectableViewModel.build(state.save_file);
  }

  preview<TParams>(actionType: FormalStage1AActionType, parameters: TParams): CocosActionPreviewResult {
    return this.previewer.preview(actionType, parameters);
  }
}
