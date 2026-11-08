import { WECHAT_BACKUP_SLOT_ID, WECHAT_SAVE_SLOT_ID } from './WechatSaveStoragePort';

// Match core's JSON-decimal arithmetic exactly; no floating-point tolerance.
// Compare digit strings directly so an inexact binary sum cannot validate a receipt.
function exactDecimalSum(values: readonly number[]): number | null {
  const decimal = (value: number): { digits: string; scale: number } | null => {
    if (!Number.isFinite(value) || value < 0) return null;
    const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
    const [integer, fraction = ''] = mantissa!.split('.');
    let digits = (integer! + fraction).replace(/^0+(?=\d)/, '');
    let scale = fraction.length - Number(exponentText ?? 0);
    if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
    while (scale > 0 && digits.endsWith('0')) { digits = digits.slice(0, -1); scale--; }
    return { digits: digits || '0', scale };
  };
  const parts = values.map(decimal);
  if (parts.some(part => !part)) return null;
  const scale = parts.reduce((max, part) => Math.max(max, part!.scale), 0);
  const aligned = (part: { digits: string; scale: number }) => (part.digits + '0'.repeat(scale - part.scale)).replace(/^0+(?=\d)/, '');
  let sum = '0';
  for (const part of parts) {
    const right = aligned(part!); const length = Math.max(sum.length, right.length);
    const leftPadded = sum.padStart(length, '0'); const rightPadded = right.padStart(length, '0');
    let carry = 0, digits = '';
    for (let i = length - 1; i >= 0; i--) { const n = Number(leftPadded[i]) + Number(rightPadded[i]) + carry; digits = String(n % 10) + digits; carry = Math.floor(n / 10); }
    sum = ((carry ? String(carry) : '') + digits).replace(/^0+(?=\d)/, '');
  }
  const amount = Number(`${sum}e-${scale}`); const result = decimal(amount);
  return result && result.scale <= scale && aligned(result) === sum ? amount : null;
}
function exactDecimalSumEquals(values: readonly number[], expected: number): boolean {
  const amount = exactDecimalSum(values);
  return amount !== null && amount === expected;
}

export interface WechatResources {
  readonly snapshot: unknown;
  readonly schemas: Record<string, unknown>;
  readonly buildId: string;
}

export interface CandidateIdentity {
  readonly schema: 'wechat-candidate/v1';
  readonly candidate_id: string;
  readonly source_commit: string;
  readonly short_commit: string;
  readonly version: string;
  readonly build_id: string;
}

export interface WechatHost {
  hasSession(): boolean;
  destroySession(): void;
  requireSession(): { getViewModel(): { readonly time_label: string }; getStorageCapacityDisplay?(targetId: string, lotId: string | null, gridCount: number): WechatCapacityDisplay };
}

export type WechatCapacityDisplay =
  | { readonly model: 'legacy_slot'; readonly used: number; readonly maximum: number }
  | { readonly model: 'physical'; readonly status: 'unavailable'; readonly reason: string }
  | { readonly model: 'physical'; readonly status: 'ready'; readonly used_mass_g: number; readonly maximum_mass_g: number;
      readonly remaining_mass_g: number; readonly used_volume_ml: number; readonly maximum_volume_ml: number; readonly remaining_volume_ml: number;
      readonly volume_grid: readonly number[]; readonly standard_cabbage_estimate?: number;
      readonly selection: { readonly status: 'unknown'; readonly reason: string } | { readonly status: 'already_in_target' }
        | { readonly status: 'ready'; readonly fit_prefix: number; readonly selected_total: number; readonly blocked_by: readonly ('mass' | 'volume')[]; readonly fit_by_visual_grid: readonly number[] } };

export interface WechatQuantity { readonly amount: number; readonly unit: string }
export interface WechatFieldOption { readonly id: string; readonly definition_id: string; readonly enabled: boolean; readonly occupied_tiles: number; readonly active_crop_count: number; readonly capacity_tiles: number; readonly available_tiles: number }
export interface WechatMaterialOption {
  readonly id: string; readonly enabled: boolean; readonly base_id: string; readonly current_form: string;
  readonly category?: string; readonly compatible_method_ids?: readonly string[];
  readonly quantity: WechatQuantity;
  readonly cabbage_pieces?: { readonly kind: 'whole'; readonly pieces: readonly { readonly id: string; readonly weight_g: number; readonly source_ref: { readonly source_type: string; readonly source_id: string; readonly source_time: number; readonly source_actor?: string; readonly source_location?: string | null; readonly summary_key?: string | null } }[] } | { readonly kind: 'cut' };
  readonly planting_policy?: { readonly max_seeds_per_tile: number; readonly per_seed_success_rate: number };
  readonly storage_ref: { readonly location_id: string; readonly storage_type: string; readonly container_id: string };
}
export interface WechatDishOption { readonly id: string; readonly recognized_dish_id: string | null; readonly serving_count: number; readonly storage_form?: string; readonly storage_ref: { readonly location_id: string; readonly storage_type: string; readonly container_id: string }; readonly enabled: boolean }
export interface WechatCropOption { readonly id: string; readonly enabled: boolean; readonly crop_base_id: string; readonly field_plot_id: string }
export interface WechatStorageOption {
  readonly id: string; readonly enabled: boolean; readonly location_id: string; readonly storage_type: string; readonly container_type?: string;
  readonly capacity: WechatQuantity; readonly used_capacity: number; readonly supported_forms: readonly string[];
}
export interface WechatProcessingRequirement {
  readonly requirement_index: number;
  readonly constraints: { readonly category: string | null; readonly base_id: string | null; readonly allowed_base_ids: readonly string[]; readonly allowed_forms: readonly string[]; readonly min_freshness: number | null };
  readonly min_quantity: WechatQuantity | null; readonly lot_ids: readonly string[];
}
export interface WechatProcessingMethod {
  readonly id: string; readonly label_key: string | null; readonly enabled: boolean;
  readonly input_requirements: readonly WechatProcessingRequirement[]; readonly compatible_facility_ids: readonly string[];
  readonly tool_requirements: readonly string[]; readonly time_cost_minutes: number; readonly process_duration_minutes: number;
}
export interface WechatProcessingFacility {
  readonly id: string; readonly enabled: boolean; readonly definition_id: string;
  readonly compatible_method_ids: readonly string[]; readonly container_id: string;
}
export interface WechatProcessingTask {
  readonly id: string; readonly enabled: boolean; readonly method_id: string; readonly status: string;
  readonly current_stage: string; readonly start_world_minute: number; readonly expected_finish_minute: number;
  readonly expected_output: { readonly base_id: string | null; readonly quantity: WechatQuantity | null } | null;
}
export type WechatProcessingSelection =
  | { readonly action_type: 'start_processing'; readonly method_id: string; readonly input_lots: { readonly lot_option_id: string; readonly quantity: WechatQuantity }[]; readonly facility_option_id: string }
  | { readonly action_type: 'collect_processing_result'; readonly task_option_id: string };
export interface WechatMenuSnapshot {
  readonly view_model: { readonly time_label: string } | null;
  readonly selectable_view_model: {
    readonly field_options: readonly WechatFieldOption[];
    readonly seed_lot_options: readonly WechatMaterialOption[];
    readonly harvestable_crop_options: readonly WechatCropOption[];
    readonly crop_status_options?: readonly { readonly id: string; readonly field_plot_id: string; readonly growth_stage: string; readonly lifecycle_status: string }[];
    readonly splittable_lot_options: readonly WechatMaterialOption[];
    readonly submittable_dish_lot_options?: readonly WechatDishOption[];
    readonly storage_target_options: readonly WechatStorageOption[];
    readonly processing_method_options: readonly WechatProcessingMethod[];
    readonly processable_lot_options: readonly WechatMaterialOption[];
    readonly processing_facility_options: readonly WechatProcessingFacility[];
    readonly processing_task_options: readonly WechatProcessingTask[];
    readonly collectable_task_options: readonly { readonly id: string; readonly enabled: boolean }[];
  } | null;
}

// Copy only the public fields needed by this screen. No platform clone API or SaveFile is used.
function copyMenu(value: WechatMenuSnapshot): WechatMenuSnapshot {
  const s = value.selectable_view_model;
  const material = (item: WechatMaterialOption): WechatMaterialOption => ({ id: item.id, enabled: item.enabled,
    base_id: item.base_id, current_form: item.current_form, quantity: { amount: item.quantity.amount, unit: item.quantity.unit },
    category: item.category, compatible_method_ids: [...(item.compatible_method_ids ?? [])],
    ...(item.cabbage_pieces ? { cabbage_pieces: item.cabbage_pieces.kind === 'whole' ? { kind: 'whole' as const, pieces: item.cabbage_pieces.pieces.map(piece => ({ id: piece.id, weight_g: piece.weight_g, source_ref: { ...piece.source_ref } })) } : { kind: 'cut' as const } } : {}),
    ...(item.planting_policy ? { planting_policy: { ...item.planting_policy } } : {}),
    storage_ref: { location_id: item.storage_ref.location_id, storage_type: item.storage_ref.storage_type, container_id: item.storage_ref.container_id } });
  return { view_model: value.view_model ? { time_label: value.view_model.time_label } : null,
    selectable_view_model: s ? {
      field_options: s.field_options.map(item => ({ id: item.id, definition_id: item.definition_id, enabled: item.enabled, occupied_tiles: item.occupied_tiles, active_crop_count: item.active_crop_count, capacity_tiles: item.capacity_tiles, available_tiles: item.available_tiles })),
      seed_lot_options: s.seed_lot_options.map(material),
      harvestable_crop_options: s.harvestable_crop_options.map(item => ({ id: item.id, enabled: item.enabled, crop_base_id: item.crop_base_id, field_plot_id: item.field_plot_id })),
      crop_status_options: (s.crop_status_options ?? []).map(item => ({ id: item.id, field_plot_id: item.field_plot_id,
        growth_stage: item.growth_stage, lifecycle_status: item.lifecycle_status })),
      splittable_lot_options: s.splittable_lot_options.map(material),
      ...(Array.isArray(s.submittable_dish_lot_options) ? { submittable_dish_lot_options: s.submittable_dish_lot_options.map(item => ({ id: item.id, recognized_dish_id: item.recognized_dish_id, serving_count: item.serving_count, storage_form: item.storage_form, storage_ref: { ...item.storage_ref }, enabled: item.enabled })) } : {}),
      storage_target_options: s.storage_target_options.map(item => ({ id: item.id, enabled: item.enabled, location_id: item.location_id,
        storage_type: item.storage_type, container_type: item.container_type, capacity: { amount: item.capacity.amount, unit: item.capacity.unit }, used_capacity: item.used_capacity,
        supported_forms: [...item.supported_forms] })),
      processing_method_options: (s.processing_method_options ?? []).map(item => ({ id: item.id, label_key: item.label_key, enabled: item.enabled,
        input_requirements: item.input_requirements.map(req => ({ requirement_index: req.requirement_index,
          constraints: { ...req.constraints, allowed_base_ids: [...req.constraints.allowed_base_ids], allowed_forms: [...req.constraints.allowed_forms] },
          min_quantity: req.min_quantity ? { ...req.min_quantity } : null, lot_ids: [...req.lot_ids] })),
        compatible_facility_ids: [...item.compatible_facility_ids], tool_requirements: [...item.tool_requirements],
        time_cost_minutes: item.time_cost_minutes, process_duration_minutes: item.process_duration_minutes })),
      processable_lot_options: (s.processable_lot_options ?? []).map(material),
      processing_facility_options: (s.processing_facility_options ?? []).map(item => ({ id: item.id, enabled: item.enabled,
        definition_id: item.definition_id, container_id: item.container_id, compatible_method_ids: [...item.compatible_method_ids] })),
      processing_task_options: (s.processing_task_options ?? []).map(item => ({ id: item.id, enabled: item.enabled,
        method_id: item.method_id, status: item.status, current_stage: item.current_stage,
        start_world_minute: item.start_world_minute, expected_finish_minute: item.expected_finish_minute,
        expected_output: item.expected_output ? { base_id: item.expected_output.base_id, quantity: item.expected_output.quantity ? { ...item.expected_output.quantity } : null } : null })),
      collectable_task_options: (s.collectable_task_options ?? []).map(item => ({ id: item.id, enabled: item.enabled }))
    } : null };
}

export interface WechatCommandResult {
  readonly command_result: {
    readonly command_name?: string;
    readonly status: string;
    readonly error_message?: string | null;
    readonly snapshot?: {
      readonly lifecycle?: { readonly has_session: boolean };
      readonly menu?: {
        readonly view_model?: WechatMenuSnapshot['view_model'];
        readonly selectable_view_model?: WechatMenuSnapshot['selectable_view_model'];
        readonly last_preview_result?: { readonly action_type: string; readonly success: boolean; readonly status_code: string } | null;
        readonly last_split_validation_result?: { readonly action_type: string; readonly success: boolean; readonly status_code: string } | null;
        readonly last_merge_validation_result?: { readonly action_type: string; readonly success: boolean; readonly status_code: string } | null;
        readonly last_processing_validation_result?: { readonly action_type: string; readonly success: boolean; readonly status_code: string } | null;
        readonly last_action_result?: { readonly success: boolean; readonly request_id?: string; readonly status_code?: string; readonly created_objects?: readonly { readonly object_type: string; readonly object_id: string; readonly summary?: { readonly quantity?: WechatQuantity; readonly status?: string; readonly split_role?: 'taken' | 'remaining'; readonly piece_count?: number } | null }[]; readonly updated_objects?: readonly { readonly object_type: string; readonly object_id: string; readonly summary?: { readonly quantity?: WechatQuantity; readonly status?: string; readonly split_role?: 'taken' | 'remaining'; readonly piece_count?: number } | null }[]; readonly consumed_resources?: readonly { readonly resource_type: string; readonly resource_id: string; readonly quantity: WechatQuantity }[] } | null;
      };
      readonly save_load?: {
        readonly last_save_result?: { readonly slot_id: string } | null;
        readonly last_load_result?: { readonly slot_id: string } | null;
      };
    };
  };
}

export type WechatCommand =
  | { readonly name: 'menu_confirm_merge_direct'; readonly selection: { readonly action_type: 'merge_lot'; readonly source_lot_option_id: string; readonly target_lot_option_id: string } }
  | { readonly name: 'menu_preview' | 'menu_confirm_split_direct'; readonly selection: { readonly action_type: 'split_lot'; readonly source_lot_option_id: string; readonly quantity: WechatQuantity } }
  | { readonly name: 'menu_preview' | 'menu_confirm_processing_direct'; readonly selection: WechatProcessingSelection }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'advance_time'; readonly minutes: 60 | 1440 } }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'plant_crop'; readonly field_option_id: string; readonly seed_lot_option_id: string; readonly seed_quantity: WechatQuantity; readonly seeds_per_tile?: number } }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'harvest_crop'; readonly crop_option_id: string } }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'store_item'; readonly source_lot_option_id: string; readonly target_storage_option_id: string } }
  | { readonly name: 'menu_confirm'; readonly selection: { readonly action_type: 'store_item'; readonly source_dish_lot_option_id: string; readonly target_storage_option_id: string } }
  | { readonly name: 'save'; readonly selection: { readonly slot_id: string } }
  | { readonly name: 'load'; readonly selection: { readonly slot_id: string } }
  | { readonly name: 'refresh' };

export interface WechatBinding {
  mount(): Promise<WechatCommandResult>;
  execute(command: WechatCommand): Promise<WechatCommandResult>;
  unmount(): Promise<unknown>;
}

export interface WechatProbeSnapshot {
  readonly phase: 'idle' | 'loading' | 'ready' | 'failed' | 'closed';
  readonly identity: Readonly<CandidateIdentity> | null;
  readonly has_session: boolean;
  readonly time_label: string | null;
  readonly busy: boolean;
  readonly visible: boolean;
  readonly accepted_commands: number;
  readonly completed_commands: number;
  readonly last_error: string | null;
  readonly menu: WechatMenuSnapshot | null;
  readonly split_preview: WechatSplitPreview | null;
  readonly split_result: WechatSplitResult | null;
  readonly merge_result?: { readonly sourceLotId: string; readonly targetLotId: string; readonly quantity: WechatQuantity } | null;
  readonly processing_preview: WechatProcessingPreview | null;
  readonly processing_result: WechatProcessingResult | null;
}

export interface WechatSplitPreview { readonly sourceLotId: string; readonly quantity: WechatQuantity; readonly success: boolean; readonly statusCode: string }
export interface WechatSplitResult { readonly sourceLotId: string; readonly newLotId: string; readonly quantity: WechatQuantity; readonly remainingQuantity: WechatQuantity | null; readonly pieceCount?: number; readonly remainingPieceCount?: number }
export interface WechatProcessingPreview { readonly actionType: WechatProcessingSelection['action_type']; readonly success: boolean; readonly statusCode: string }
export interface WechatProcessingResult { readonly actionType: WechatProcessingSelection['action_type']; readonly taskId: string; readonly lotId: string | null }

export function readCandidateIdentity(value: unknown): Readonly<CandidateIdentity> {
  if (!value || typeof value !== 'object') throw new Error('ERR_WECHAT_CANDIDATE_INVALID');
  const item = value as Record<string, unknown>;
  if (item.schema !== 'wechat-candidate/v1'
      || typeof item.candidate_id !== 'string' || !/^wechat-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(item.candidate_id)
      || typeof item.source_commit !== 'string' || !/^[a-f\d]{40}$/i.test(item.source_commit)
      || item.short_commit !== item.source_commit.slice(0, 12)
      || typeof item.version !== 'string' || !/^v\d+\.\d+\.\d+\.\d+$/.test(item.version)
      || typeof item.build_id !== 'string' || !item.build_id.startsWith('cocos_wechat_probe_')) {
    throw new Error('ERR_WECHAT_CANDIDATE_INVALID');
  }
  // Copy only the build identity. SaveFile fields and later caller mutations have no authority here.
  return Object.freeze({ schema: 'wechat-candidate/v1', candidate_id: item.candidate_id,
    source_commit: item.source_commit, short_commit: item.short_commit as string,
    version: item.version, build_id: item.build_id });
}

export class WechatProbeController {
  private phase: WechatProbeSnapshot['phase'] = 'idle';
  private identity: Readonly<CandidateIdentity> | null = null;
  private host: WechatHost | null = null;
  private binding: WechatBinding | null = null;
  private starting: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private disposed = false;
  private busy = false;
  private visible = true;
  private accepted = 0;
  private completed = 0;
  private error: string | null = null;
  private menu: WechatMenuSnapshot | null = null;
  private splitGeneration = 0;
  private splitPreview: WechatSplitPreview | null = null;
  private splitResult: WechatSplitResult | null = null;
  private mergeResult: { sourceLotId: string; targetLotId: string; quantity: WechatQuantity } | null = null;
  // This controller owns one Session/dispatcher. Loading replaces state, not its request sequence.
  private readonly observedMenuRequestIds = new Set<string>();
  private splitCommandInFlight: 'preview' | 'confirm' | null = null;
  private processingGeneration = 0;
  private processingPreview: WechatProcessingPreview | null = null;
  private processingResult: WechatProcessingResult | null = null;
  private processingCommandInFlight: 'preview' | 'confirm' | 'refresh' | null = null;

  constructor(private readonly options: {
    load: () => Promise<{ resources: WechatResources; identity: unknown }>;
    createHost: (resources: WechatResources) => WechatHost;
    createBinding: (host: WechatHost) => WechatBinding;
    prepareBackupRecovery?: () => Promise<void>;
    recoverValidatedBackup?: () => Promise<void>;
    cancelFirstFailedSave?: () => Promise<void>;
    onChange?: (snapshot: WechatProbeSnapshot) => void;
  }) {}

  snapshot(): WechatProbeSnapshot {
    const hasSession = this.host?.hasSession() ?? false;
    return Object.freeze({ phase: this.phase, identity: this.identity, has_session: hasSession,
      time_label: hasSession ? this.host!.requireSession().getViewModel().time_label : null,
      busy: this.busy, visible: this.visible, accepted_commands: this.accepted, completed_commands: this.completed,
      last_error: this.error, menu: this.menu ? copyMenu(this.menu) : null,
      split_preview: this.splitPreview ? { ...this.splitPreview, quantity: { ...this.splitPreview.quantity } } : null,
      split_result: this.splitResult ? { ...this.splitResult, quantity: { ...this.splitResult.quantity }, remainingQuantity: this.splitResult.remainingQuantity ? { ...this.splitResult.remainingQuantity } : null } : null,
      merge_result: this.mergeResult ? { ...this.mergeResult, quantity: { ...this.mergeResult.quantity } } : null,
      processing_preview: this.processingPreview ? { ...this.processingPreview } : null,
      processing_result: this.processingResult ? { ...this.processingResult } : null });
  }

  acceptMenuPatch(value: unknown): void {
    if (this.disposed) return;
    if (!value || typeof value !== 'object') throw new Error('ERR_WECHAT_MENU_PATCH_INVALID');
    const next = copyMenu(value as WechatMenuSnapshot);
    // A preview can emit its own identical menu patch before its receipt. Changed
    // public state invalidates the pending receipt; confirmation itself changes it.
    if (this.splitCommandInFlight !== 'confirm' && JSON.stringify(this.menu) !== JSON.stringify(next)) {
      this.invalidateSplitPreview();
    }
    if (this.processingCommandInFlight !== 'confirm' && this.processingCommandInFlight !== 'refresh' && JSON.stringify(this.menu) !== JSON.stringify(next)) {
      this.invalidateProcessingPreview();
    }
    this.menu = next;
    this.notify();
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('ERR_WECHAT_PROBE_CLOSED'));
    if (this.starting !== null) return this.starting;
    this.starting = this.startInternal();
    return this.starting;
  }

  async advance(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 60 } });
  }

  storageCapacityDisplay(targetId: string, lotId: string | null): WechatCapacityDisplay | null {
    if (!this.host?.hasSession()) return null;
    const session = this.host.requireSession();
    if (!session.getStorageCapacityDisplay) return null;
    try { return session.getStorageCapacityDisplay(targetId, lotId, 4); }
    catch { return { model: 'physical', status: 'unavailable', reason: 'ERR_PHYSICAL_DISPLAY' }; }
  }

  async advanceDay(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'advance_time', minutes: 1440 } });
  }

  async plant(fieldId: string, seedId: string, quantity: WechatQuantity, seedsPerTile?: number): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'plant_crop', field_option_id: fieldId,
      seed_lot_option_id: seedId, seed_quantity: { amount: quantity.amount, unit: quantity.unit },
      ...(seedsPerTile === undefined ? {} : { seeds_per_tile: seedsPerTile }) } });
  }

  async harvest(cropId: string): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'harvest_crop', crop_option_id: cropId } });
  }

  async moveDish(dishId: string, targetId: string): Promise<WechatProbeSnapshot> {
    const menu = this.menu?.selectable_view_model;
    const dishes = menu?.submittable_dish_lot_options; const targets = menu?.storage_target_options;
    const selected = dishes?.filter(item => item.id === dishId) ?? []; const destinations = targets?.filter(item => item.id === targetId) ?? [];
    if (!dishes || !targets || selected.length !== 1 || destinations.length !== 1 || !selected[0]!.enabled || !destinations[0]!.enabled
      || !selected[0]!.storage_form || !destinations[0]!.supported_forms.includes(selected[0]!.storage_form!)
      || selected[0]!.storage_ref.container_id === targetId) throw new Error('ERR_WECHAT_PROBE_ACTION_FAILED:ERR_MENU_OPTION_INVALID');
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'store_item', source_dish_lot_option_id: dishId, target_storage_option_id: targetId } });
  }

  async move(lotId: string, targetId: string): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm', selection: { action_type: 'store_item', source_lot_option_id: lotId, target_storage_option_id: targetId } });
  }

  invalidateSplitPreview(): void {
    this.splitGeneration++;
    this.splitPreview = null;
    this.splitResult = null;
    this.mergeResult = null;
    if (!this.disposed) this.notify();
  }

  async previewSplit(lotId: string, quantity: WechatQuantity): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_preview', selection: { action_type: 'split_lot', source_lot_option_id: lotId,
      quantity: { amount: quantity.amount, unit: quantity.unit } } });
  }

  async confirmSplit(lotId: string, quantity: WechatQuantity): Promise<WechatProbeSnapshot> {
    const lot = this.menu?.selectable_view_model?.splittable_lot_options.find(item => item.id === lotId && item.enabled);
    const requiredUnit = lot?.cabbage_pieces?.kind === 'whole' ? 'count' : lot?.quantity.unit;
    if (!lot || !quantity || !Number.isFinite(quantity.amount) || quantity.amount <= 0 || quantity.unit !== requiredUnit) {
      throw new Error('ERR_WECHAT_SPLIT_INPUT_INVALID');
    }
    return this.execute({ name: 'menu_confirm_split_direct', selection: { action_type: 'split_lot', source_lot_option_id: lotId,
      quantity: { amount: quantity.amount, unit: quantity.unit } } });
  }

  async confirmMerge(sourceLotId: string, targetLotId: string): Promise<WechatProbeSnapshot> {
    if (!sourceLotId || !targetLotId || sourceLotId === targetLotId) throw new Error('ERR_WECHAT_MERGE_INPUT_INVALID');
    return this.execute({ name: 'menu_confirm_merge_direct', selection: { action_type: 'merge_lot', source_lot_option_id: sourceLotId, target_lot_option_id: targetLotId } });
  }

  invalidateProcessingPreview(): void {
    this.processingGeneration++;
    this.processingPreview = null;
    this.processingResult = null;
    if (!this.disposed) this.notify();
  }

  async previewProcessing(selection: WechatProcessingSelection): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_preview', selection: this.copyProcessingSelection(selection) });
  }

  async confirmProcessing(selection: WechatProcessingSelection): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'menu_confirm_processing_direct', selection: this.copyProcessingSelection(selection) });
  }

  async refreshProcessingView(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'refresh' });
  }

  async refreshSplitView(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'refresh' });
  }

  private copyProcessingSelection(selection: WechatProcessingSelection): WechatProcessingSelection {
    if (selection.action_type === 'collect_processing_result') return { action_type: selection.action_type, task_option_id: selection.task_option_id };
    return { action_type: selection.action_type, method_id: selection.method_id, facility_option_id: selection.facility_option_id,
      input_lots: selection.input_lots.map(input => ({ lot_option_id: input.lot_option_id, quantity: { ...input.quantity } })) };
  }

  async save(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'save', selection: { slot_id: WECHAT_SAVE_SLOT_ID } });
  }

  async load(): Promise<WechatProbeSnapshot> {
    return this.execute({ name: 'load', selection: { slot_id: WECHAT_SAVE_SLOT_ID } });
  }

  async loadBackup(): Promise<WechatProbeSnapshot> {
    if (!this.options.prepareBackupRecovery || !this.options.recoverValidatedBackup) {
      throw new Error('ERR_WECHAT_BACKUP_RECOVERY_UNAVAILABLE');
    }
    return this.execute({ name: 'load', selection: { slot_id: WECHAT_BACKUP_SLOT_ID } });
  }

  async cancelFirstFailedSave(): Promise<WechatProbeSnapshot> {
    if (!this.options.cancelFirstFailedSave) throw new Error('ERR_WECHAT_FIRST_CANCEL_UNAVAILABLE');
    if (this.disposed || this.phase !== 'ready' || this.binding === null) throw new Error('ERR_WECHAT_PROBE_NOT_READY');
    if (!this.visible) throw new Error('ERR_WECHAT_PROBE_HIDDEN');
    if (this.busy) throw new Error('ERR_WECHAT_PROBE_BUSY');
    this.busy = true;
    this.invalidateSplitPreview();
    this.invalidateProcessingPreview();
    this.accepted++;
    this.error = null;
    this.notify();
    try {
      if (this.disposed) return this.snapshot();
      await this.options.cancelFirstFailedSave();
      if (!this.disposed) this.completed++;
    } catch (error) {
      if (!this.disposed) this.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (!this.disposed) { this.busy = false; this.notify(); }
    }
    return this.snapshot();
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) { this.invalidateSplitPreview(); this.invalidateProcessingPreview(); }
    this.notify();
  }

  private async execute(command: WechatCommand): Promise<WechatProbeSnapshot> {
    if (this.disposed || this.phase !== 'ready' || this.binding === null) throw new Error('ERR_WECHAT_PROBE_NOT_READY');
    if (!this.visible) throw new Error('ERR_WECHAT_PROBE_HIDDEN');
    if (this.busy) throw new Error('ERR_WECHAT_PROBE_BUSY');
    const dishMoveSelection = command.name === 'menu_confirm' && command.selection.action_type === 'store_item' && 'source_dish_lot_option_id' in command.selection ? command.selection : undefined;
    const dishMoveBefore = dishMoveSelection ? this.menu?.selectable_view_model?.submittable_dish_lot_options?.find(item => item.id === dishMoveSelection.source_dish_lot_option_id) : undefined;
    const splitBefore = command.name === 'menu_confirm_split_direct'
      ? this.menu?.selectable_view_model?.splittable_lot_options ?? [] : [];
    const mergeBefore = command.name === 'menu_confirm_merge_direct'
      ? this.menu?.selectable_view_model?.splittable_lot_options ?? [] : [];
    const processBefore = command.name === 'menu_confirm_processing_direct' ? this.menu?.selectable_view_model : null;
    this.busy = true;
    this.invalidateSplitPreview();
    this.invalidateProcessingPreview();
    const splitGeneration = this.splitGeneration;
    const processingGeneration = this.processingGeneration;
    this.splitCommandInFlight = command.name === 'menu_confirm_merge_direct' ? 'confirm'
      : (command.name === 'menu_preview' || command.name === 'menu_confirm_split_direct') && command.selection.action_type === 'split_lot'
      ? (command.name === 'menu_preview' ? 'preview' : 'confirm') : null;
    this.processingCommandInFlight = command.name === 'refresh' ? 'refresh' : (command.name === 'menu_preview' || command.name === 'menu_confirm_processing_direct')
      && (command.selection.action_type === 'start_processing' || command.selection.action_type === 'collect_processing_result')
      ? (command.name === 'menu_preview' ? 'preview' : 'confirm') : null;
    this.accepted++;
    this.error = null;
    this.notify();
    const backupRecovery = command.name === 'load' && command.selection.slot_id === WECHAT_BACKUP_SLOT_ID;
    let recovered = false;
    try {
      if (backupRecovery) {
        await this.options.prepareBackupRecovery!();
        if (this.disposed) return this.snapshot();
        try {
          await this.options.recoverValidatedBackup!();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`ERR_WECHAT_BACKUP_RECOVERY_INCOMPLETE:${reason}`);
        }
        recovered = true;
        if (this.disposed) return this.snapshot();
      }
      const actualCommand: WechatCommand = backupRecovery
        ? { name: 'load', selection: { slot_id: WECHAT_SAVE_SLOT_ID } } : command;
      let result: WechatCommandResult;
      try {
        result = await this.binding.execute(actualCommand);
      } catch (error) {
        if (actualCommand.name === 'menu_confirm_split_direct') {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`ERR_WECHAT_SPLIT_RESULT_UNCERTAIN:${reason}`);
        }
        if (actualCommand.name === 'menu_confirm_merge_direct') {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`ERR_WECHAT_MERGE_RESULT_UNCERTAIN:${reason}`);
        }
        if (actualCommand.name === 'menu_confirm_processing_direct') {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN:${reason}`);
        }
        if (actualCommand.name === 'menu_confirm') {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`ERR_WECHAT_ACTION_RESULT_UNCERTAIN:${reason}`);
        }
        throw error;
      }
      const current = result.command_result;
      const preview = current.snapshot?.menu?.last_preview_result;
      const previewValid = actualCommand.name === 'menu_preview' && preview?.action_type === actualCommand.selection.action_type && typeof preview.success === 'boolean'
        && typeof preview.status_code === 'string' && preview.status_code.length > 0;
      if (actualCommand.name === 'refresh' && !this.disposed) {
        const refreshed = current.snapshot?.menu;
        const selectable = refreshed?.selectable_view_model;
        if (current.status !== 'completed' || current.command_name !== 'refresh' || current.snapshot?.lifecycle?.has_session !== true
            || !selectable || !Array.isArray(selectable.submittable_dish_lot_options) || !Array.isArray(selectable.storage_target_options) || !Array.isArray(selectable.processing_task_options) || !Array.isArray(selectable.collectable_task_options)
            || !Array.isArray(selectable.processable_lot_options) || !Array.isArray(selectable.splittable_lot_options)
            || !Array.isArray(selectable.processing_method_options) || !Array.isArray(selectable.processing_facility_options)
            || processingGeneration !== this.processingGeneration || !this.visible) throw new Error('ERR_WECHAT_REFRESH_FAILED');
        this.menu = copyMenu({ view_model: refreshed.view_model ?? null, selectable_view_model: selectable });
        this.completed++;
      }
      if (!this.disposed && actualCommand.name === 'menu_confirm_split_direct') {
        // A failed shell command can occur after dispatch; it does not prove rollback.
        const validation = current.snapshot?.menu?.last_split_validation_result;
        const validationValid = validation?.action_type === 'split_lot' && typeof validation.success === 'boolean'
          && typeof validation.status_code === 'string' && validation.status_code.length > 0;
        if (current.status !== 'completed' || current.command_name !== actualCommand.name || !validationValid) {
          throw new Error(`ERR_WECHAT_SPLIT_RESULT_UNCERTAIN${current.error_message ? `:${current.error_message}` : ''}`);
        }
        const action = current.snapshot?.menu?.last_action_result;
        if (!validation!.success) {
          // A definite rejection must come from the pre-dispatch validator, with no action result.
          if (action !== null) throw new Error('ERR_WECHAT_SPLIT_RESULT_UNCERTAIN');
          throw new Error(`ERR_WECHAT_PROBE_ACTION_FAILED:${validation!.status_code}`);
        }
        if (action?.success === false) {
          // Post-dispatch checks can fail even after the transaction committed.
          throw new Error('ERR_WECHAT_SPLIT_RESULT_UNCERTAIN');
        }
        const selection = actualCommand.selection;
        const refs = action?.created_objects ?? [];
        const lots = this.menu?.selectable_view_model?.splittable_lot_options ?? [];
        const source = lots.find(item => item.id === selection.source_lot_option_id);
        const oldSource = splitBefore.find(item => item.id === selection.source_lot_option_id);
        const sourceUpdated = action?.updated_objects?.filter(item => item.object_type === 'MaterialLot') ?? [];
        const invalid = () => { throw new Error('ERR_WECHAT_SPLIT_RESULT_UNCERTAIN'); };
        if (action?.success !== true || !action.request_id || action.status_code !== 'OK' || this.observedMenuRequestIds.has(action.request_id)
          || !oldSource || refs.length === 0 || refs.some(ref => ref.object_type !== 'MaterialLot' || !ref.object_id
            || !ref.summary || (ref.summary.split_role !== 'taken' && ref.summary.split_role !== 'remaining'))
          || new Set(refs.map(ref => ref.object_id)).size !== refs.length
          || refs.some(ref => splitBefore.some(item => item.id === ref.object_id))
          || sourceUpdated.length !== 1 || sourceUpdated[0]!.object_id !== selection.source_lot_option_id
          || new Set(lots.map(item => item.id)).size !== lots.length) invalid();
        const resolved = refs.map(ref => ({ ref, lot: lots.find(item => item.id === ref.object_id) }));
        if (resolved.some(({ ref, lot }) => !lot || !ref.summary?.quantity
          || lot.quantity.amount !== ref.summary.quantity.amount || lot.quantity.unit !== ref.summary.quantity.unit
          || lot.base_id !== oldSource!.base_id || JSON.stringify(lot.storage_ref) !== JSON.stringify(oldSource!.storage_ref)
          || (lot.cabbage_pieces?.kind === 'whole' ? ref.summary.piece_count !== lot.cabbage_pieces.pieces.length
            : lot.cabbage_pieces?.kind === 'cut' ? ref.summary.piece_count !== 0 : ref.summary.piece_count !== undefined))) invalid();
        const taken = resolved.filter(item => item.ref.summary!.split_role === 'taken').map(item => item.lot!);
        const extraRemaining = resolved.filter(item => item.ref.summary!.split_role === 'remaining').map(item => item.lot!);
        const sourceSummary = sourceUpdated[0]!.summary;
        if (!taken.length || (source ? sourceSummary?.split_role !== 'remaining' || !sourceSummary.quantity
          || sourceSummary.quantity.amount !== source.quantity.amount || sourceSummary.quantity.unit !== source.quantity.unit
          || source.base_id !== oldSource!.base_id || JSON.stringify(source.storage_ref) !== JSON.stringify(oldSource!.storage_ref)
          || (source.cabbage_pieces?.kind === 'whole' ? sourceSummary.piece_count !== source.cabbage_pieces.pieces.length
            : source.cabbage_pieces?.kind === 'cut' ? sourceSummary.piece_count !== 0 : sourceSummary.piece_count !== undefined)
          : sourceSummary?.status !== 'consumed')) invalid();
        const remainingLots = [...(source ? [source] : []), ...extraRemaining];
        const allLots = [...taken, ...remainingLots];
        if (allLots.some(lot => lot.quantity.unit !== oldSource!.quantity.unit)
          || !exactDecimalSumEquals(allLots.map(lot => lot.quantity.amount), oldSource!.quantity.amount)) invalid();
        if (oldSource!.cabbage_pieces?.kind === 'whole') {
          if (selection.quantity.unit !== 'count' || !Number.isSafeInteger(selection.quantity.amount)) invalid();
          if (new Set(oldSource!.cabbage_pieces.pieces.map(piece => piece.id)).size !== oldSource!.cabbage_pieces.pieces.length
            || oldSource!.cabbage_pieces.pieces.some(piece => !piece.id || !Number.isFinite(piece.weight_g) || piece.weight_g <= 0)
            || !exactDecimalSumEquals(oldSource!.cabbage_pieces.pieces.map(piece => piece.weight_g), oldSource!.quantity.amount)) invalid();
          const selected = oldSource!.cabbage_pieces.pieces.slice(0, selection.quantity.amount);
          const rest = oldSource!.cabbage_pieces.pieces.slice(selection.quantity.amount);
          const pieceList = (items: WechatMaterialOption[]) => items.flatMap(item => item.cabbage_pieces?.kind === 'whole' ? [...item.cabbage_pieces.pieces] : []);
          if (allLots.some(item => item.cabbage_pieces?.kind !== 'whole')
            || allLots.some(item => item.current_form !== oldSource!.current_form)
            || selected.length !== selection.quantity.amount
            || JSON.stringify(pieceList(taken)) !== JSON.stringify(selected)
            || JSON.stringify(pieceList(remainingLots)) !== JSON.stringify(rest)) invalid();
        } else if (selection.quantity.unit !== oldSource!.quantity.unit
          || !exactDecimalSumEquals(taken.map(lot => lot.quantity.amount), selection.quantity.amount)
          || allLots.some(item => item.current_form !== oldSource!.current_form)) invalid();
        const takenAmount = exactDecimalSum(taken.map(lot => lot.quantity.amount));
        const remainingAmount = remainingLots.length ? exactDecimalSum(remainingLots.map(lot => lot.quantity.amount)) : null;
        if (takenAmount === null || (remainingLots.length > 0 && remainingAmount === null)) invalid();
        this.observedMenuRequestIds.add(action!.request_id!);
        const created = taken[0]!;
        this.completed++;
        if (splitGeneration === this.splitGeneration && this.visible) {
          this.splitResult = { sourceLotId: selection.source_lot_option_id, newLotId: created.id,
            quantity: { amount: takenAmount!, unit: created.quantity.unit },
            remainingQuantity: remainingLots.length ? { amount: remainingAmount!, unit: oldSource!.quantity.unit } : null,
            ...(oldSource!.cabbage_pieces?.kind === 'whole' ? { pieceCount: selection.quantity.amount, remainingPieceCount: oldSource!.cabbage_pieces.pieces.length - selection.quantity.amount } : {}) };
        }
      }
      if (!this.disposed && actualCommand.name === 'menu_confirm_merge_direct') {
        const validation = current.snapshot?.menu?.last_merge_validation_result;
        const action = current.snapshot?.menu?.last_action_result;
        if (current.status !== 'completed' || current.command_name !== actualCommand.name
          || validation?.action_type !== 'merge_lot' || typeof validation.success !== 'boolean' || !validation.status_code) throw new Error('ERR_WECHAT_MERGE_RESULT_UNCERTAIN');
        if (!validation.success) {
          if (action !== null) throw new Error('ERR_WECHAT_MERGE_RESULT_UNCERTAIN');
          throw new Error(`ERR_WECHAT_PROBE_ACTION_FAILED:${validation.status_code}`);
        }
        const s = actualCommand.selection;
        const oldSource = mergeBefore.find(item => item.id === s.source_lot_option_id);
        const oldTarget = mergeBefore.find(item => item.id === s.target_lot_option_id);
        const lots = this.menu?.selectable_view_model?.splittable_lot_options ?? [];
        const merged = lots.find(item => item.id === s.target_lot_option_id);
        const updates = action?.updated_objects?.filter(item => item.object_type === 'MaterialLot') ?? [];
        const sourceUpdate = updates.find(item => item.object_id === s.source_lot_option_id);
        const targetUpdate = updates.find(item => item.object_id === s.target_lot_option_id);
        if (action?.success !== true || !action.request_id || action.status_code !== 'OK' || this.observedMenuRequestIds.has(action.request_id)
          || !oldSource || !oldTarget || !merged || s.source_lot_option_id === s.target_lot_option_id
          || new Set(lots.map(item => item.id)).size !== lots.length || lots.some(item => item.id === s.source_lot_option_id)
          || updates.length !== 2 || !sourceUpdate || !targetUpdate || sourceUpdate.summary?.status !== 'merged'
          || !targetUpdate.summary?.quantity || targetUpdate.summary.quantity.amount !== merged.quantity.amount
          || targetUpdate.summary.quantity.unit !== merged.quantity.unit || oldSource.quantity.unit !== oldTarget.quantity.unit
          || merged.quantity.unit !== oldTarget.quantity.unit || !exactDecimalSumEquals([oldTarget.quantity.amount, oldSource.quantity.amount], merged.quantity.amount)
          || oldSource.base_id !== oldTarget.base_id || oldSource.current_form !== oldTarget.current_form
          || JSON.stringify(oldSource.storage_ref) !== JSON.stringify(oldTarget.storage_ref)
          || merged.base_id !== oldTarget.base_id || merged.current_form !== oldTarget.current_form
          || JSON.stringify(merged.storage_ref) !== JSON.stringify(oldTarget.storage_ref)
          || (action.created_objects?.length ?? 0) !== 0) throw new Error('ERR_WECHAT_MERGE_RESULT_UNCERTAIN');
        if (oldTarget.cabbage_pieces?.kind === 'whole' && oldSource.cabbage_pieces?.kind === 'whole') {
          const expectedPieces = [...oldTarget.cabbage_pieces.pieces, ...oldSource.cabbage_pieces.pieces];
          if (merged.cabbage_pieces?.kind !== 'whole' || new Set(expectedPieces.map(piece => piece.id)).size !== expectedPieces.length
            || expectedPieces.some(piece => !piece.id || !Number.isFinite(piece.weight_g) || piece.weight_g <= 0)
            || !exactDecimalSumEquals(expectedPieces.map(piece => piece.weight_g), merged.quantity.amount)
            || JSON.stringify(merged.cabbage_pieces.pieces) !== JSON.stringify(expectedPieces)) throw new Error('ERR_WECHAT_MERGE_RESULT_UNCERTAIN');
        } else if (oldTarget.cabbage_pieces?.kind !== oldSource.cabbage_pieces?.kind || merged.cabbage_pieces?.kind !== oldTarget.cabbage_pieces?.kind) throw new Error('ERR_WECHAT_MERGE_RESULT_UNCERTAIN');
        this.observedMenuRequestIds.add(action.request_id);
        this.completed++;
        if (splitGeneration === this.splitGeneration && this.visible) this.mergeResult = { sourceLotId: s.source_lot_option_id, targetLotId: s.target_lot_option_id, quantity: { ...merged.quantity } };
      }
      if (!this.disposed && actualCommand.name === 'menu_confirm_processing_direct') {
        const validation = current.snapshot?.menu?.last_processing_validation_result;
        const action = current.snapshot?.menu?.last_action_result;
        const selection = actualCommand.selection;
        if (current.status !== 'completed' || current.command_name !== actualCommand.name
            || validation?.action_type !== selection.action_type || typeof validation.success !== 'boolean'
            || typeof validation.status_code !== 'string' || !validation.status_code) {
          throw new Error('ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN');
        }
        if (!validation.success) {
          if (action !== null) throw new Error('ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN');
          throw new Error(`ERR_WECHAT_PROBE_ACTION_FAILED:${validation.status_code}`);
        }
        if (action?.success !== true || !processBefore) throw new Error('ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN');
        const after = this.menu?.selectable_view_model;
        let taskId: string;
        let lotId: string | null = null;
        if (selection.action_type === 'start_processing') {
          const created = action.created_objects?.filter(item => item.object_type === 'ProcessingTask') ?? [];
          const task = created.length === 1 ? after?.processing_task_options.find(item => item.id === created[0].object_id) : undefined;
          const consumed = action.consumed_resources ?? [];
          if (!task || processBefore.processing_task_options.some(item => item.id === task.id) || task.method_id !== selection.method_id
              || task.status !== 'active' || consumed.length !== selection.input_lots.length
              || selection.input_lots.some((input, i) => consumed[i]?.resource_type !== 'MaterialLot' || consumed[i]?.resource_id !== input.lot_option_id
                || consumed[i]?.quantity.amount !== input.quantity.amount || consumed[i]?.quantity.unit !== input.quantity.unit)) {
            throw new Error('ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN');
          }
          taskId = task.id;
        } else {
          const oldTask = processBefore.processing_task_options.find(item => item.id === selection.task_option_id);
          const task = after?.processing_task_options.find(item => item.id === selection.task_option_id);
          const created = action.created_objects?.filter(item => item.object_type === 'MaterialLot') ?? [];
          const lot = created.length === 1 ? after?.splittable_lot_options.find(item => item.id === created[0].object_id) : undefined;
          const updated = action.updated_objects?.filter(item => item.object_type === 'ProcessingTask' && item.object_id === selection.task_option_id) ?? [];
          if (!oldTask || oldTask.status !== 'ready_to_collect' || !task || task.status !== 'completed' || !lot
              || processBefore.splittable_lot_options.some(item => item.id === lot.id) || updated.length !== 1) {
            throw new Error('ERR_WECHAT_PROCESSING_RESULT_UNCERTAIN');
          }
          taskId = task.id; lotId = lot.id;
        }
        this.completed++;
        if (processingGeneration === this.processingGeneration && this.visible) this.processingResult = { actionType: selection.action_type, taskId, lotId };
      }
      if (actualCommand.name !== 'menu_confirm_split_direct' && actualCommand.name !== 'menu_confirm_merge_direct' && actualCommand.name !== 'menu_confirm_processing_direct' && actualCommand.name !== 'refresh') {
        if (actualCommand.name === 'menu_confirm' && !this.disposed) {
          const action = current.snapshot?.menu?.last_action_result;
          if (current.command_name !== actualCommand.name || preview?.action_type !== actualCommand.selection.action_type
              || typeof preview.success !== 'boolean' || typeof preview.status_code !== 'string' || !preview.status_code) {
            throw new Error('ERR_WECHAT_ACTION_RESULT_UNCERTAIN');
          }
          if (!preview.success && action == null) {
            if (dishMoveSelection) {
              const after = this.menu?.selectable_view_model?.submittable_dish_lot_options?.find(item => item.id === dishMoveSelection.source_dish_lot_option_id);
              if (!dishMoveBefore || JSON.stringify(after) !== JSON.stringify(dishMoveBefore)) throw new Error('ERR_WECHAT_ACTION_RESULT_UNCERTAIN');
            }
            throw new Error(`ERR_WECHAT_PROBE_ACTION_FAILED:${preview.status_code}`);
          }
          if (!preview.success || current.status !== 'completed' || typeof action?.success !== 'boolean'
              || typeof action.status_code !== 'string' || !action.status_code || typeof action.request_id !== 'string' || !action.request_id) {
            throw new Error('ERR_WECHAT_ACTION_RESULT_UNCERTAIN');
          }
          if (this.observedMenuRequestIds.has(action.request_id)) throw new Error('ERR_WECHAT_ACTION_RESULT_UNCERTAIN');
          this.observedMenuRequestIds.add(action.request_id);
          if (actualCommand.selection.action_type === 'store_item' && 'source_dish_lot_option_id' in actualCommand.selection) {
            const selection = actualCommand.selection;
            const after = this.menu?.selectable_view_model?.submittable_dish_lot_options?.find(item => item.id === selection.source_dish_lot_option_id);
            const updates = action.updated_objects?.filter(item => item.object_type === 'DishLot' && item.object_id === selection.source_dish_lot_option_id) ?? [];
            const target = this.menu?.selectable_view_model?.storage_target_options.find(item => item.id === selection.target_storage_option_id);
            const afterDishes = this.menu?.selectable_view_model?.submittable_dish_lot_options ?? [];
            const afterTargets = this.menu?.selectable_view_model?.storage_target_options ?? [];
            if (new Set(afterDishes.map(item => item.id)).size !== afterDishes.length || new Set(afterTargets.map(item => item.id)).size !== afterTargets.length
              || !dishMoveBefore || !after || !target || updates.length !== 1 || action.updated_objects?.length !== 1 || (action.created_objects?.length ?? 0) !== 0 || action.status_code !== 'OK' || after.storage_ref.location_id !== target.location_id || after.storage_ref.storage_type !== target.storage_type || after.storage_ref.container_id !== selection.target_storage_option_id
              || after.id !== dishMoveBefore.id || after.recognized_dish_id !== dishMoveBefore.recognized_dish_id || after.serving_count !== dishMoveBefore.serving_count || after.storage_form !== dishMoveBefore.storage_form)
              throw new Error('ERR_WECHAT_ACTION_RESULT_UNCERTAIN');
          }
          if (!action.success) throw new Error(`ERR_WECHAT_ACTION_RESULT_UNCERTAIN:${action.status_code}`);
        }
        const success = actualCommand.name === 'menu_preview'
          ? previewValid && current.command_name === actualCommand.name
          : actualCommand.name === 'menu_confirm'
            ? current.snapshot?.menu?.last_action_result?.success === true
            : actualCommand.name === 'save'
              ? current.snapshot?.save_load?.last_save_result?.slot_id === actualCommand.selection.slot_id
              : actualCommand.name === 'load' && current.snapshot?.save_load?.last_load_result?.slot_id === actualCommand.selection.slot_id;
        if (!this.disposed && (current.status !== 'completed' || !success)) {
          throw new Error(current.error_message ?? (actualCommand.name === 'menu_confirm'
            ? 'ERR_WECHAT_PROBE_ACTION_FAILED' : actualCommand.name === 'menu_preview'
              ? 'ERR_WECHAT_PROBE_PREVIEW_FAILED' : 'ERR_WECHAT_PROBE_STORAGE_FAILED'));
        }
        if (!this.disposed) {
          this.completed++;
          if (actualCommand.name === 'menu_preview' && actualCommand.selection.action_type === 'split_lot' && splitGeneration === this.splitGeneration && this.visible && previewValid) {
            const selection = actualCommand.selection;
            this.splitPreview = { sourceLotId: selection.source_lot_option_id, quantity: { ...selection.quantity },
              success: preview!.success, statusCode: preview!.status_code };
          }
          if (actualCommand.name === 'menu_preview' && actualCommand.selection.action_type !== 'split_lot'
              && processingGeneration === this.processingGeneration && this.visible && previewValid) {
            this.processingPreview = { actionType: actualCommand.selection.action_type, success: preview!.success, statusCode: preview!.status_code };
          }
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const result = recovered ? new Error(`ERR_WECHAT_BACKUP_RESTORED_RESULT_UNCERTAIN:${reason}`) : error;
      if (!this.disposed) this.error = result instanceof Error ? result.message : String(result);
      throw result;
    } finally {
      this.splitCommandInFlight = null;
      this.processingCommandInFlight = null;
      if (!this.disposed) { this.busy = false; this.notify(); }
    }
    return this.snapshot();
  }

  dispose(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.disposed = true;
    this.invalidateSplitPreview();
    this.invalidateProcessingPreview();
    this.menu = null;
    this.phase = 'closed';
    this.busy = false;
    const binding = this.binding;
    const host = this.host;
    this.binding = null;
    this.host = null;
    this.notify();
    this.closing = Promise.resolve().then(async () => {
      try { await binding?.unmount(); }
      finally { host?.destroySession(); }
    });
    return this.closing;
  }

  private async startInternal(): Promise<void> {
    this.phase = 'loading';
    this.notify();
    try {
      const loaded = await this.options.load();
      if (this.disposed) return;
      this.identity = readCandidateIdentity(loaded.identity);
      if (loaded.resources.buildId !== this.identity.build_id) throw new Error('ERR_WECHAT_CANDIDATE_BUILD_ID');
      const host = this.options.createHost(loaded.resources);
      if (this.disposed) { host.destroySession(); return; }
      this.host = host;
      const binding = this.options.createBinding(host);
      if (this.disposed) { await binding.unmount(); host.destroySession(); return; }
      this.binding = binding;
      const result = await binding.mount();
      if (this.disposed) return;
      if (result.command_result.status !== 'completed' || !host.hasSession()) throw new Error('ERR_WECHAT_PROBE_MOUNT_FAILED');
      this.phase = 'ready';
      this.notify();
    } catch (error) {
      if (this.disposed) return;
      const binding = this.binding;
      this.binding = null;
      try { await binding?.unmount(); }
      catch { /* Preserve the startup error while still destroying the half-initialized host. */ }
      finally { this.host?.destroySession(); this.host = null; }
      if (this.disposed) return;
      this.phase = 'failed';
      this.error = error instanceof Error ? error.message : String(error);
      this.notify();
      throw error;
    }
  }

  private notify(): void { this.options.onChange?.(this.snapshot()); }
}
