import type { DomainEvent, FacilityRef, Quantity, StorageOccupantRef, StorageRef, SubmittedObjectRef } from '../domain/types';

export type FormalStage1AActionType =
  | 'plant_crop'
  | 'advance_time'
  | 'harvest_crop'
  | 'store_item'
  | 'split_lot'
  | 'start_processing'
  | 'collect_processing_result'
  | 'cook_dish'
  | 'submit_order';

export interface ActionRequest<TType extends string = string, TParams = unknown> {
  request_id: string;
  actor_id: string;
  action_type: TType;
  created_time: number;
  idempotency_key: string;
  parameters: TParams;
  preview_only?: boolean;
  target_refs?: Array<{ object_type: string; object_id: string }>;
  context_ref?: Record<string, unknown>;
  desired_outcome?: Record<string, unknown> | null;
}

export interface PlantCropParams {
  field_plot_id: string;
  seed_lot_id: string;
  seed_quantity: Quantity;
}

export interface AdvanceTimeParams {
  minutes: number;
}

export interface HarvestCropParams {
  crop_id: string;
}

export interface StoreItemParams {
  object_ref: StorageOccupantRef;
  storage_ref: StorageRef;
}

export interface SplitLotParams {
  source_lot_id: string;
  quantity: Quantity;
}

export interface StartProcessingParams {
  method_id: string;
  input_lots: Array<{ lot_id: string; quantity: Quantity }>;
  facility_ref: FacilityRef;
}

export interface CollectProcessingResultParams {
  task_id: string;
}

export interface CookDishParams {
  recipe_variant_id: string;
  ingredients: Record<string, { lot_id: string; quantity: Quantity }>;
  technique: string;
  operation_profile: Record<string, unknown>;
  target_storage_ref?: StorageRef;
}

export interface SubmitOrderParams {
  order_id: string;
  submitted_object_refs: SubmittedObjectRef[];
}

export type FormalStage1AActionRequest =
  | ActionRequest<'plant_crop', PlantCropParams>
  | ActionRequest<'advance_time', AdvanceTimeParams>
  | ActionRequest<'harvest_crop', HarvestCropParams>
  | ActionRequest<'store_item', StoreItemParams>
  | ActionRequest<'split_lot', SplitLotParams>
  | ActionRequest<'start_processing', StartProcessingParams>
  | ActionRequest<'collect_processing_result', CollectProcessingResultParams>
  | ActionRequest<'cook_dish', CookDishParams>
  | ActionRequest<'submit_order', SubmitOrderParams>;

export interface MessageParam {
  key: string;
  value: string | number | boolean | null;
}

export interface ActionObjectRef {
  object_type: string;
  object_id: string;
  summary?: {
    display_name_key?: string;
    quantity?: Quantity;
    status?: string;
  } | null;
}

export interface ConsumedResourceRef {
  resource_type: string;
  resource_id: string;
  quantity: Quantity;
}

export interface EventLogEntry {
  message_key: string;
  params?: MessageParam[];
}

export interface ActionResultDebugTrace {
  steps?: string[];
  notes?: string[];
}

export interface ActionResult {
  request_id: string;
  success: boolean;
  status_code: string;
  message_key: string;
  message_params: MessageParam[];
  consumed_resources: ConsumedResourceRef[];
  created_objects: ActionObjectRef[];
  updated_objects: ActionObjectRef[];
  released_reservations: string[];
  domain_events: DomainEvent[];
  event_log_entries: EventLogEntry[];
  warnings: string[];
  preview_mismatch: boolean;
  debug_trace?: ActionResultDebugTrace | null;
}

export interface ActionContext {
  actor_id: string;
  build_id: string;
}
