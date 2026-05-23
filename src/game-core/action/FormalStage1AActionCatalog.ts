import type { FormalStage1AActionType } from './ActionTypes';

export const FORMAL_STAGE_1A_ACTION_TYPES = [
  'plant_crop',
  'advance_time',
  'harvest_crop',
  'store_item',
  'split_lot',
  'start_processing',
  'collect_processing_result',
  'cook_dish',
  'submit_order'
] as const satisfies readonly FormalStage1AActionType[];

export const FORMAL_STAGE_1A_ACTION_TYPE_SET: ReadonlySet<string> = new Set(FORMAL_STAGE_1A_ACTION_TYPES);

export const STAGE_1A_REQUIRED_PARAMETERS = {
  plant_crop: ['field_plot_id', 'seed_lot_id', 'seed_quantity'],
  advance_time: ['minutes'],
  harvest_crop: ['crop_id'],
  store_item: ['object_ref', 'storage_ref'],
  split_lot: ['source_lot_id', 'quantity'],
  start_processing: ['method_id', 'input_lots', 'facility_ref'],
  collect_processing_result: ['task_id'],
  cook_dish: ['recipe_variant_id', 'ingredients', 'technique', 'operation_profile'],
  submit_order: ['order_id', 'submitted_object_refs']
} as const satisfies Record<FormalStage1AActionType, readonly string[]>;

export function isFormalStage1AActionType(actionType: string): actionType is FormalStage1AActionType {
  return FORMAL_STAGE_1A_ACTION_TYPE_SET.has(actionType);
}
