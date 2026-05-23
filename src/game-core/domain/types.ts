export type ObjectType = 'MaterialLot' | 'DishLot' | 'CropInstance' | 'ProcessingTask' | 'Reservation' | 'Order' | string;
export type Unit = 'count' | 'g' | 'ml' | 'slot_weight' | 'serving' | 'bundle' | string;

export interface Quantity {
  amount: number;
  unit: Unit;
}

export interface StorageRef {
  location_id: string;
  storage_type: string;
  container_id: string;
}

export interface StorageOccupantRef {
  object_type: 'MaterialLot' | 'DishLot' | string;
  object_id: string;
}

export interface SubmittedObjectRef {
  object_type: 'DishLot' | string;
  object_id: string;
}

export interface SourceRef {
  source_type: string;
  source_id: string;
  source_time: number;
  source_actor?: string;
  source_location?: string | null;
  summary_key?: string | null;
}

export interface DefinitionRef {
  type: string;
  id: string;
  canonical_id: string;
}

export interface MaterialLot {
  lot_id: string;
  base_id: string;
  category: string;
  quantity: Quantity;
  current_form: string;
  property_profile: Record<string, number | string | boolean>;
  source_ref: SourceRef;
  storage_ref: StorageRef;
  created_time: number;
  last_update_time: number;
  schema_version: string;
  rules_version: string;
  flags: string[];
  definition_ref: DefinitionRef;
  storage_footprint: Quantity;
  lineage_summary?: Record<string, unknown>;
  processing_history?: Array<Record<string, unknown>>;
}

export interface TransformationHistoryEntry {
  operation_type: string;
  action_request_id?: string | null;
  world_minute: number;
  method_id?: string | null;
  notes?: string[];
}

export interface DishComponent {
  component_id: string;
  source_lot_id: string;
  base_id: string;
  role: 'main' | 'side' | 'seasoning' | 'liquid' | 'oil' | 'aromatic' | 'garnish';
  quantity_used: Quantity;
  component_profile: Record<string, number>;
  transformation_history?: TransformationHistoryEntry[];
  visible_description_key?: string | null;
}

export interface DishLot {
  dish_lot_id: string;
  recognized_dish_id?: string | null;
  components: DishComponent[];
  dish_profile: Record<string, number>;
  serving_count: number;
  total_quantity: Quantity;
  temperature_state?: 'hot' | 'warm' | 'cold';
  defects?: string[];
  suitability_tags: string[];
  source_ref: SourceRef;
  lineage_summary?: Record<string, unknown>;
  created_time: number;
  flags?: string[];
  storage_ref: StorageRef;
  storage_footprint: Quantity;
  last_update_time: number;
  decay_policy_id: string;
  freshness_state: 'fresh_hot' | 'warm' | 'cold' | 'stale' | 'spoiled';
  storage_form: 'cooked_dish' | 'dish';
}

export interface StorageContainer {
  container_id: string;
  location_id: string;
  storage_type: string;
  container_type: string;
  capacity: Quantity;
  used_capacity: number;
  temperature_state?: string;
  humidity_state?: string;
  ventilation?: string;
  cleanliness?: number;
  supported_forms: string[];
  flags: string[];
  active_object_refs: StorageOccupantRef[];
}

export interface FieldPlotState {
  field_plot_id: string;
  definition_id: string;
  location_id: string;
  occupied_tiles: number;
  active_crop_ids: string[];
}

export interface CropInstance {
  crop_id: string;
  crop_base_id: string;
  seed_lot_id: string | null;
  field_plot_id: string;
  planted_time: number;
  growth_stage: 'seed' | 'sprout' | 'growing' | 'mature' | 'withered' | string;
  lifecycle_status: 'active' | 'ready_to_harvest' | 'harvested' | 'removed' | 'failed' | string;
  growth_progress: number;
  expected_harvest_minute: number;
  health: number;
  season_context?: string | null;
  source_ref?: SourceRef;
  created_time?: number;
  last_update_time?: number;
  flags: string[];
}

export interface ProcessingTaskInputRef {
  lot_id: string;
  quantity: Quantity;
  reservation_id: string | null;
  role?: string | null;
}

export interface ProcessingReservedQuantity {
  reservation_id: string;
  lot_id: string;
  quantity: Quantity;
  status: 'reserved' | 'released' | 'consumed' | 'cancelled';
}

export interface FacilityRef extends StorageRef {
  definition_id: string;
  facility_id: string;
}

export interface ProcessingEnvironmentSnapshot {
  temperature_state: string;
  humidity_state: string;
  cleanliness: number;
  ventilation: string;
  season: string;
  weather: string;
  container_id: string;
}

export interface ProcessingPreviewResult {
  expected_output_base_id?: string | null;
  expected_quantity?: Quantity;
  risk_note_key?: string | null;
}

export interface ProcessingOutputPreview {
  output_base_id?: string | null;
  quantity?: Quantity;
  quality_grade?: string | null;
}

export interface ProcessingTask {
  task_id: string;
  method_id: string;
  input_lot_refs: ProcessingTaskInputRef[];
  reserved_quantities: ProcessingReservedQuantity[];
  start_world_minute: number;
  expected_finish_minute: number;
  facility_ref: FacilityRef;
  environment_snapshot: ProcessingEnvironmentSnapshot;
  current_stage: 'started' | 'fermenting' | 'drying' | 'ready' | 'risky' | 'failed' | string;
  status: 'active' | 'paused' | 'ready_to_collect' | 'completed' | 'cancelled' | 'failed' | string;
  progress?: number;
  risk_state?: string;
  preview_result?: ProcessingPreviewResult | null;
  output_preview?: ProcessingOutputPreview | null;
  flags?: string[];
}

export interface Reservation {
  reservation_id: string;
  actor_id: string;
  target_ref: StorageOccupantRef;
  quantity: Quantity;
  reason: string;
  created_time: number;
  expire_time: number | null;
  status: 'active' | 'consumed' | 'released' | 'expired' | 'cancelled' | string;
  source_action_id?: string | null;
  flags?: string[];
}

export interface Order {
  order_id: string;
  issuer_id: string;
  demand_profile_id: string;
  quantity_required: Quantity;
  base_reward: number;
  bonus_rules: unknown[];
  penalty_rules: unknown[];
  match_threshold: number;
  status: 'available' | 'accepted' | 'submitted' | 'completed' | 'failed' | 'expired' | 'cancelled' | string;
  submitted_object_refs: SubmittedObjectRef[];
  result_summary: { match_score?: number; reward_final?: number; submitted_count?: number; result_key?: string | null } | null;
  deadline_policy: string;
  notes?: string[];
  deadline_absolute_minute?: number;
}

export interface DomainEvent {
  event_id: string;
  event_type: string;
  world_time: number;
  source_action_id: string | null;
  actor_id: string | null;
  visibility: 'internal' | 'debug' | 'player_visible';
  payload: Record<string, unknown>;
  debug_only?: boolean;
}

export interface FeatureFlagsSnapshot {
  profile_id: string;
  merge_policy: 'override_core_feature_flags_by_key';
  source_config_hash: string;
  flags: Record<string, boolean>;
}

export interface TimeState {
  world_day: number;
  world_minute: number;
  absolute_minute: number;
  season: string;
  weather: string;
}

export interface SaveFile {
  save_version: string;
  game_version: string;
  schema_version: string;
  rules_version: string;
  config_version: string;
  content_pack_versions: Record<string, string>;
  created_with_build: string;
  last_saved_with_build: string;
  created_at_real_time: string;
  last_saved_at_real_time: string;
  world_time: TimeState;
  random_state: Record<string, unknown>;
  feature_flags: FeatureFlagsSnapshot;
  player_state: Record<string, unknown>;
  family_state: Record<string, unknown>;
  inventory: MaterialLot[];
  storage_containers: StorageContainer[];
  home_water: Record<string, unknown>;
  fields: FieldPlotState[];
  animals: unknown[];
  processing_tasks: ProcessingTask[];
  dish_lots: DishLot[];
  orders: Order[];
  npc_relations: Record<string, unknown>;
  story_flags: Record<string, unknown>;
  discovered_clues: unknown[];
  story_event_log: unknown[];
  story_choices: Record<string, unknown>;
  story_items_state: Record<string, unknown>;
  tools_state: Record<string, unknown>;
  facilities_state: Record<string, unknown>;
  fuel_state: Record<string, unknown>;
  event_log_summary: Record<string, unknown>;
  migration_history: unknown[];
  migration_warnings: unknown[];
  last_migration_at: string | null;
  debug_flags: string[];
  crop_instances: CropInstance[];
  reservations: Reservation[];
}

export interface GameState {
  save_file: SaveFile;
  domain_events: DomainEvent[];
}
