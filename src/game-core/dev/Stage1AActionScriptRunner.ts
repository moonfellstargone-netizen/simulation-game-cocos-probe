import type { ActionResult, FormalStage1AActionType } from '../action/ActionTypes';
import type { Stage1AHeadlessRuntime } from './Stage1AHeadlessRuntime';

export interface DevScriptStepResult {
  action_type: FormalStage1AActionType;
  success: boolean;
  status_code: string;
  result: ActionResult;
}

export interface Stage1ADevScriptReport {
  step_results: DevScriptStepResult[];
  refs: Record<string, string>;
}

export class Stage1AActionScriptRunner {
  runCoreLoop(runtime: Stage1AHeadlessRuntime): Stage1ADevScriptReport {
    const refs: Record<string, string> = {
      seed_lot: 'seed_cabbage_initial_001',
      salt_lot: 'salt_initial_001',
      bacon_lot: 'bacon_initial_001',
      oil_lot: 'oil_initial_001'
    };
    const stepResults: DevScriptStepResult[] = [];

    const plant = this.dispatch(runtime, stepResults, 'plant_crop', {
      field_plot_id: 'field_plot_01',
      seed_lot_id: refs.seed_lot,
      seed_quantity: { amount: 1, unit: 'count' }
    });
    refs.crop = this.singleCreatedObjectId(plant, 'CropInstance');

    this.dispatch(runtime, stepResults, 'advance_time', { minutes: 5400 });

    const harvest = this.dispatch(runtime, stepResults, 'harvest_crop', { crop_id: refs.crop });
    refs.cabbage_lot = this.singleCreatedObjectId(harvest, 'MaterialLot');

    const split = this.dispatch(runtime, stepResults, 'split_lot', {
      source_lot_id: refs.cabbage_lot,
      quantity: { amount: 300, unit: 'g' }
    });
    refs.cabbage_split_lot = this.singleCreatedObjectId(split, 'MaterialLot');

    const startProcessing = this.dispatch(runtime, stepResults, 'start_processing', {
      method_id: 'pickling_cabbage_basic',
      input_lots: [
        { lot_id: refs.cabbage_split_lot, quantity: { amount: 300, unit: 'g' } },
        { lot_id: refs.salt_lot, quantity: { amount: 15, unit: 'g' } }
      ],
      facility_ref: {
        location_id: 'home',
        storage_type: 'pickling_jar',
        container_id: 'pickling_jar_basic_01',
        definition_id: 'pickling_jar_basic',
        facility_id: 'pickling_jar_basic_01'
      }
    });
    refs.pickling_task = this.singleCreatedObjectId(startProcessing, 'ProcessingTask');

    this.dispatch(runtime, stepResults, 'advance_time', { minutes: 2880 });

    const collect = this.dispatch(runtime, stepResults, 'collect_processing_result', { task_id: refs.pickling_task });
    refs.pickled_cabbage_lot = this.singleCreatedObjectId(collect, 'MaterialLot');

    const cook = this.dispatch(runtime, stepResults, 'cook_dish', {
      recipe_variant_id: 'bacon_cabbage_basic',
      ingredients: {
        main: { lot_id: refs.pickled_cabbage_lot, quantity: { amount: 250, unit: 'g' } },
        side: { lot_id: refs.bacon_lot, quantity: { amount: 50, unit: 'g' } },
        oil: { lot_id: refs.oil_lot, quantity: { amount: 10, unit: 'ml' } }
      },
      technique: 'stir_fry',
      operation_profile: { heat_level: 'high', active_minutes: 8 },
      target_storage_ref: { location_id: 'home', storage_type: 'room_temp', container_id: 'home_room_temp_01' }
    });
    refs.dish_lot = this.singleCreatedObjectId(cook, 'DishLot');

    this.dispatch(runtime, stepResults, 'submit_order', {
      order_id: 'tavern_home_dish_001',
      submitted_object_refs: [{ object_type: 'DishLot', object_id: refs.dish_lot }]
    });

    return { step_results: stepResults, refs };
  }

  private dispatch<TParams>(runtime: Stage1AHeadlessRuntime, stepResults: DevScriptStepResult[], actionType: FormalStage1AActionType, parameters: TParams): ActionResult {
    const { result } = runtime.dispatch(actionType, parameters);
    stepResults.push({ action_type: actionType, success: result.success, status_code: result.status_code, result });
    if (!result.success) throw new Error(`ERR_DEV_SCRIPT_ACTION_FAILED:${actionType}:${result.status_code}`);
    return result;
  }

  private singleCreatedObjectId(result: ActionResult, expectedObjectType: string): string {
    const found = result.created_objects.find((item) => item.object_type === expectedObjectType);
    if (!found) throw new Error(`ERR_DEV_SCRIPT_CREATED_OBJECT_MISSING:${expectedObjectType}`);
    return found.object_id;
  }
}
