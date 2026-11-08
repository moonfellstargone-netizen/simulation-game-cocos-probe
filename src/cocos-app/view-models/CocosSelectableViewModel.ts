import type { ConfigRepository, FacilityRef, Order, Quantity, SaveFile, StorageRef } from '../../game-core';

export interface CocosSelectableOptionBase {
  id: string;
  label_key: string | null;
  enabled: boolean;
  reason_key: string | null;
}

export interface CocosFieldOption extends CocosSelectableOptionBase {
  definition_id: string;
  location_id: string;
  occupied_tiles: number;
  active_crop_count: number;
  capacity_tiles: number;
  available_tiles: number;
}

export interface CocosMaterialLotOption extends CocosSelectableOptionBase {
  base_id: string;
  category: string;
  current_form: string;
  quantity: Quantity;
  storage_ref: StorageRef;
  active_reservation_count: number;
  compatible_method_ids: string[];
  compatible_recipe_roles: Array<{ recipe_variant_id: string; role: string }>;
}

export interface CocosHarvestableCropOption extends CocosSelectableOptionBase {
  crop_base_id: string;
  field_plot_id: string;
  growth_stage: string;
  lifecycle_status: string;
  expected_harvest_minute: number;
}

export interface CocosCollectableTaskOption extends CocosSelectableOptionBase {
  method_id: string;
  status: string;
  current_stage: string;
  expected_finish_minute: number;
}

export interface CocosProcessingInputRequirementOption {
  requirement_index: number;
  constraints: {
    category: string | null;
    base_id: string | null;
    allowed_base_ids: string[];
    allowed_forms: string[];
    min_freshness: number | null;
  };
  min_quantity: Quantity | null;
  lot_ids: string[];
}

export interface CocosProcessingMethodOption extends CocosSelectableOptionBase {
  input_requirements: CocosProcessingInputRequirementOption[];
  compatible_facility_ids: string[];
  tool_requirements: string[];
  time_cost_minutes: number;
  process_duration_minutes: number;
}

export interface CocosProcessingTaskOption extends CocosCollectableTaskOption {
  start_world_minute: number;
  facility_ref: FacilityRef;
  expected_output: { base_id: string | null; quantity: Quantity | null } | null;
}

export interface CocosCookableRecipeRoleOption {
  role: string;
  required: boolean;
  base_id: string | null;
  allowed_base_ids: string[];
  allowed_forms: string[];
  min_quantity: Quantity | null;
  lot_ids: string[];
}

export interface CocosCookableRecipeOption extends CocosSelectableOptionBase {
  recipe_variant_id: string;
  dish_structure_id: string;
  technique: string;
  roles: CocosCookableRecipeRoleOption[];
  missing_required_roles: string[];
  tool_requirements: string[];
  facility_requirements: string[];
  operation_constraints: {
    heat_levels: string[];
    required_heat_level: string | null;
    active_minutes: { integer: true; min: number; max: number | null };
    time_preference_minutes: { min?: number; ideal_min?: number; ideal_max?: number; max?: number } | null;
    default_heat_level: string | null;
    time_cost_minutes: number | null;
    stamina_cost: number | null;
  };
  fuel: { base_id: string; enabled: boolean; cost: Quantity; current_quantity: Quantity } | null;
  output_estimate: { serving_count: number; total_quantity_g: number } | null;
}

export interface CocosOrderDemandRequirement {
  type: string;
  key: string;
  min_value?: number;
  max_value?: number;
  target_range?: number[];
  weight?: number;
  scoring_curve?: string;
  source_object_field?: string;
}

export interface CocosOrderDemandOption {
  display_name_key: string;
  accepted_object_types: string[];
  hard_requirements: CocosOrderDemandRequirement[];
  weighted_requirements: CocosOrderDemandRequirement[];
  forbidden_defects: string[];
  acceptable_defects: Record<string, string>;
  match_threshold: number;
}

export interface CocosOrderResultSummary {
  match_score: number | null;
  reward_final: number | null;
  submitted_count: number | null;
  result_key: string | null;
}

export interface CocosOrderOption extends CocosSelectableOptionBase {
  issuer_id: string;
  demand_profile_id: string;
  status: string;
  quantity_required: Quantity;
  base_reward: number;
  deadline_absolute_minute: number | null;
  minutes_until_deadline: number | null;
  demand: CocosOrderDemandOption | null;
  submitted_object_refs: Array<{ object_type: string; object_id: string }>;
  result_summary: CocosOrderResultSummary | null;
}

export interface CocosStorageTargetOption extends CocosSelectableOptionBase {
  location_id: string;
  storage_type: string;
  capacity: Quantity;
  used_capacity: number;
  supported_forms: string[];
}

export interface CocosProcessingFacilityOption extends CocosSelectableOptionBase {
  facility_id: string;
  definition_id: string;
  location_id: string;
  storage_type: string;
  container_id: string;
  compatible_method_ids: string[];
  facility_ref: FacilityRef;
}

export interface CocosSelectableViewModelData {
  field_options: CocosFieldOption[];
  seed_lot_options: CocosMaterialLotOption[];
  harvestable_crop_options: CocosHarvestableCropOption[];
  splittable_lot_options: CocosMaterialLotOption[];
  processable_lot_options: CocosMaterialLotOption[];
  collectable_task_options: CocosCollectableTaskOption[];
  processing_method_options: CocosProcessingMethodOption[];
  processing_task_options: CocosProcessingTaskOption[];
  cookable_recipe_options: CocosCookableRecipeOption[];
  submittable_dish_lot_options: Array<{ id: string; recognized_dish_id: string | null; serving_count: number; storage_ref: StorageRef; enabled: boolean; reason_key: string | null }>;
  order_options: CocosOrderOption[];
  storage_target_options: CocosStorageTargetOption[];
  processing_facility_options: CocosProcessingFacilityOption[];
}

interface ProcessingRequirement {
  category?: string;
  base_id?: string;
  allowed_base_ids?: string[];
  allowed_forms?: string[];
  min_freshness?: number;
  min_quantity_g?: number;
}

interface RecipeRequirement {
  base_id?: string;
  allowed_base_ids?: string[];
  allowed_forms?: string[];
  min_quantity_g?: number;
  min_quantity_ml?: number;
  optional?: boolean;
}

interface RecipeStructure {
  required_roles?: Record<string, RecipeRequirement>;
  optional_roles?: Record<string, RecipeRequirement>;
  technique_expectations?: {
    heat_level_preference?: string;
    time_preference_minutes?: { min?: number; ideal_min?: number; ideal_max?: number; max?: number };
  };
}

export class CocosSelectableViewModel {
  constructor(private readonly configs: ConfigRepository) {}

  build(save: SaveFile): CocosSelectableViewModelData {
    const processingMethodIds = this.processingMethodIds();
    const activeRecipeIds = this.activeRecipeIds();
    const materialOptions = save.inventory.map((lot) => this.materialLotOption(save, lot.lot_id, processingMethodIds, activeRecipeIds));
    const processingFacilities = this.processingFacilityOptions(save, processingMethodIds);
    const fieldDefinitions = this.configs.requiredDoc<{ field_plot_definitions: Record<string, { capacity_tiles: number }> }>('configs/farming/field_plots.yaml');

    return {
      field_options: save.fields.map((field) => {
        const capacity = fieldDefinitions.field_plot_definitions[field.definition_id]?.capacity_tiles;
        const available = Number.isSafeInteger(capacity) && capacity! > 0
          && Number.isSafeInteger(field.occupied_tiles) && field.occupied_tiles >= 0
          ? Math.max(0, capacity! - field.occupied_tiles) : 0;
        return {
          id: field.field_plot_id,
          label_key: `field.${field.definition_id}.name`,
          enabled: available > 0,
          reason_key: available > 0 ? null : 'ui.reason.field_occupied',
          definition_id: field.definition_id,
          location_id: field.location_id,
          occupied_tiles: field.occupied_tiles,
          active_crop_count: field.active_crop_ids.length,
          capacity_tiles: capacity ?? 0,
          available_tiles: available
        };
      }),
      seed_lot_options: materialOptions.filter((option) => option.category === 'seed' || option.current_form.includes('seed') || option.base_id.endsWith('_seed')),
      harvestable_crop_options: save.crop_instances.map((crop) => ({
        id: crop.crop_id,
        label_key: `crop.${crop.crop_base_id}.name`,
        enabled: crop.lifecycle_status === 'ready_to_harvest',
        reason_key: crop.lifecycle_status === 'ready_to_harvest' ? null : 'ui.reason.crop_not_ready',
        crop_base_id: crop.crop_base_id,
        field_plot_id: crop.field_plot_id,
        growth_stage: crop.growth_stage,
        lifecycle_status: crop.lifecycle_status,
        expected_harvest_minute: crop.expected_harvest_minute
      })).filter((option) => option.enabled),
      splittable_lot_options: materialOptions.filter((option) => option.quantity.amount > 0),
      processable_lot_options: materialOptions.filter((option) => option.compatible_method_ids.length > 0),
      collectable_task_options: save.processing_tasks.map((task) => ({
        id: task.task_id,
        label_key: `processing.${task.method_id}.name`,
        enabled: task.status === 'ready_to_collect',
        reason_key: task.status === 'ready_to_collect' ? null : 'ui.reason.processing_not_ready',
        method_id: task.method_id,
        status: task.status,
        current_stage: task.current_stage,
        expected_finish_minute: task.expected_finish_minute
      })).filter((option) => option.enabled),
      processing_method_options: processingMethodIds.map((id) => this.processingMethodOption(save, id, processingFacilities)),
      processing_task_options: save.processing_tasks.map((task) => this.processingTaskOption(task)),
      cookable_recipe_options: activeRecipeIds.map((id) => this.recipeOption(save, id)),
      submittable_dish_lot_options: save.dish_lots.map((lot) => ({
        id: lot.dish_lot_id,
        recognized_dish_id: lot.recognized_dish_id ?? null,
        serving_count: lot.serving_count,
        storage_ref: { ...lot.storage_ref },
        enabled: true,
        reason_key: null
      })),
      order_options: save.orders.map((order) => this.orderOption(save, order)),
      storage_target_options: save.storage_containers.map((container) => ({
        id: container.container_id,
        label_key: `storage.${container.container_id}.name`,
        enabled: container.used_capacity < container.capacity.amount,
        reason_key: container.used_capacity < container.capacity.amount ? null : 'ui.reason.storage_full',
        location_id: container.location_id,
        storage_type: container.storage_type,
        capacity: { ...container.capacity },
        used_capacity: container.used_capacity,
        supported_forms: [...container.supported_forms]
      })),
      processing_facility_options: processingFacilities
    };
  }

  private orderOption(save: SaveFile, order: Order): CocosOrderOption {
    const profile = Object.entries(this.configs.loadStage1A().documents).find(([path, document]) => {
      if (!path.startsWith('configs/demands/') || !document || typeof document !== 'object') return false;
      const candidate = document as { id?: string; demand_profile_id?: string };
      return candidate.id === order.demand_profile_id || candidate.demand_profile_id === order.demand_profile_id;
    })?.[1] as (Partial<CocosOrderDemandOption> & { match_threshold?: number }) | undefined;
    const demand: CocosOrderDemandOption | null = profile && typeof profile.display_name_key === 'string'
      && Array.isArray(profile.accepted_object_types) && typeof profile.match_threshold === 'number' ? {
        display_name_key: profile.display_name_key,
        accepted_object_types: [...profile.accepted_object_types],
        hard_requirements: structuredClone(profile.hard_requirements ?? []),
        weighted_requirements: structuredClone(profile.weighted_requirements ?? []),
        forbidden_defects: [...(profile.forbidden_defects ?? [])],
        acceptable_defects: { ...profile.acceptable_defects },
        match_threshold: order.match_threshold
      } : null;
    const deadline = typeof order.deadline_absolute_minute === 'number' ? order.deadline_absolute_minute : null;
    const enabled = demand !== null && ['available', 'accepted'].includes(order.status)
      && deadline !== null && save.world_time.absolute_minute <= deadline;
    const result = order.result_summary;
    return {
      id: order.order_id,
      label_key: demand?.display_name_key ?? null,
      enabled,
      reason_key: demand === null ? 'ui.reason.order_demand_unavailable' : enabled ? null : 'ui.reason.order_not_open',
      issuer_id: order.issuer_id,
      demand_profile_id: order.demand_profile_id,
      status: order.status,
      quantity_required: { ...order.quantity_required },
      base_reward: order.base_reward,
      deadline_absolute_minute: deadline,
      minutes_until_deadline: deadline === null ? null : deadline - save.world_time.absolute_minute,
      demand,
      submitted_object_refs: order.submitted_object_refs.map((ref) => ({ ...ref })),
      result_summary: result === null || result === undefined ? null : {
        match_score: typeof result.match_score === 'number' ? result.match_score : null,
        reward_final: typeof result.reward_final === 'number' ? result.reward_final : null,
        submitted_count: typeof result.submitted_count === 'number' ? result.submitted_count : null,
        result_key: result.result_key ?? null
      }
    };
  }

  private processingMethodOption(save: SaveFile, methodId: string, facilities: CocosProcessingFacilityOption[]): CocosProcessingMethodOption {
    const method = this.processingMethod(methodId);
    const requirements = Array.isArray(method.input_view_requirements) ? method.input_view_requirements as ProcessingRequirement[] : [];
    return {
      id: methodId,
      label_key: typeof method.display_name_key === 'string' ? method.display_name_key : `processing.${methodId}.name`,
      enabled: true,
      reason_key: null,
      input_requirements: requirements.map((requirement, requirementIndex) => ({
        requirement_index: requirementIndex,
        constraints: {
          category: typeof requirement.category === 'string' ? requirement.category : null,
          base_id: typeof requirement.base_id === 'string' ? requirement.base_id : null,
          allowed_base_ids: Array.isArray(requirement.allowed_base_ids) ? [...requirement.allowed_base_ids] : [],
          allowed_forms: Array.isArray(requirement.allowed_forms) ? [...requirement.allowed_forms] : [],
          min_freshness: typeof requirement.min_freshness === 'number' ? requirement.min_freshness : null
        },
        min_quantity: typeof requirement.min_quantity_g === 'number' ? { amount: requirement.min_quantity_g, unit: 'g' } : null,
        lot_ids: save.inventory.filter((lot) => this.lotMatchesProcessingRequirement(lot, requirement)).map((lot) => lot.lot_id)
      })),
      compatible_facility_ids: facilities.filter((facility) => facility.compatible_method_ids.includes(methodId)).map((facility) => facility.id),
      tool_requirements: Array.isArray(method.tool_requirements) ? [...method.tool_requirements] : [],
      time_cost_minutes: this.requiredNumber(method, 'time_cost_minutes', `processing:${methodId}`),
      process_duration_minutes: this.requiredNumber(method, 'process_duration_minutes', `processing:${methodId}`)
    };
  }

  private processingTaskOption(task: SaveFile['processing_tasks'][number]): CocosProcessingTaskOption {
    const expectedQuantity = task.output_preview?.quantity ?? task.preview_result?.expected_quantity;
    return {
      id: task.task_id,
      label_key: `processing.${task.method_id}.name`,
      enabled: task.status === 'ready_to_collect',
      reason_key: task.status === 'ready_to_collect' ? null : 'ui.reason.processing_not_ready',
      method_id: task.method_id,
      status: task.status,
      current_stage: task.current_stage,
      start_world_minute: task.start_world_minute,
      expected_finish_minute: task.expected_finish_minute,
      facility_ref: { ...task.facility_ref },
      expected_output: task.output_preview || task.preview_result ? {
        base_id: task.output_preview?.output_base_id ?? task.preview_result?.expected_output_base_id ?? null,
        quantity: expectedQuantity === undefined ? null : { ...expectedQuantity }
      } : null
    };
  }


  private processingFacilityOptions(save: SaveFile, processingMethodIds: string[]): CocosProcessingFacilityOption[] {
    return Object.values(save.facilities_state).flatMap((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const facility = raw as Record<string, unknown>;
      const facilityId = typeof facility.facility_id === 'string' ? facility.facility_id : null;
      const definitionId = typeof facility.definition_id === 'string' ? facility.definition_id : null;
      const containerId = typeof facility.container_id === 'string' ? facility.container_id : null;
      const storageType = typeof facility.storage_type === 'string' ? facility.storage_type : null;
      if (facilityId === null || definitionId === null || containerId === null || storageType === null) return [];
      const container = save.storage_containers.find((item) => item.container_id === containerId);
      if (container === undefined) return [];
      const compatibleMethodIds = processingMethodIds.filter((methodId) => this.methodAcceptsFacilityDefinition(methodId, definitionId));
      return [{
        id: facilityId,
        label_key: `facility.${definitionId}.name`,
        enabled: facility.status === 'available' && compatibleMethodIds.length > 0,
        reason_key: facility.status === 'available' ? null : 'ui.reason.facility_not_available',
        facility_id: facilityId,
        definition_id: definitionId,
        location_id: container.location_id,
        storage_type: storageType,
        container_id: containerId,
        compatible_method_ids: compatibleMethodIds,
        facility_ref: {
          location_id: container.location_id,
          storage_type: storageType,
          container_id: containerId,
          definition_id: definitionId,
          facility_id: facilityId
        }
      }];
    });
  }

  private methodAcceptsFacilityDefinition(methodId: string, definitionId: string): boolean {
    const method = this.processingMethod(methodId);
    return Array.isArray(method.facility_requirements) && method.facility_requirements.includes(definitionId);
  }

  private materialLotOption(save: SaveFile, lotId: string, processingMethodIds: string[], recipeVariantIds: string[]): CocosMaterialLotOption {
    const lot = save.inventory.find((item) => item.lot_id === lotId);
    if (!lot) throw new Error(`ERR_SELECTABLE_LOT_NOT_FOUND:${lotId}`);
    const activeReservationCount = save.reservations.filter((reservation) => reservation.status === 'active' && reservation.target_ref.object_type === 'MaterialLot' && reservation.target_ref.object_id === lot.lot_id).length;
    return {
      id: lot.lot_id,
      label_key: `material.${lot.base_id}.${lot.current_form}`,
      enabled: lot.quantity.amount > 0 && activeReservationCount === 0,
      reason_key: activeReservationCount > 0 ? 'ui.reason.lot_reserved' : lot.quantity.amount > 0 ? null : 'ui.reason.lot_empty',
      base_id: lot.base_id,
      category: lot.category,
      current_form: lot.current_form,
      quantity: { ...lot.quantity },
      storage_ref: { ...lot.storage_ref },
      active_reservation_count: activeReservationCount,
      compatible_method_ids: processingMethodIds.filter((methodId) => this.lotMatchesProcessingMethod(lot, methodId)),
      compatible_recipe_roles: recipeVariantIds.flatMap((recipeId) => this.compatibleRecipeRoles(lot, recipeId).map((role) => ({ recipe_variant_id: recipeId, role })))
    };
  }

  private processingMethodIds(): string[] {
    return Object.keys(this.configs.loadStage1A().documents)
      .filter((path) => path.startsWith('configs/processing/methods/') && path.endsWith('.yaml'))
      .map((path) => this.requiredString(this.configs.requiredDoc<Record<string, unknown>>(path), 'id', path));
  }

  private activeRecipeIds(): string[] {
    const active = this.configs.requiredDoc<Record<string, unknown>>('configs/active_stage_1A/stage_1A_active_config.yaml');
    return Array.isArray(active.active_recipe_variants) ? active.active_recipe_variants.filter((id): id is string => typeof id === 'string') : [];
  }

  private lotMatchesProcessingMethod(lot: SaveFile['inventory'][number], methodId: string): boolean {
    const method = this.processingMethod(methodId);
    const requirements = Array.isArray(method.input_view_requirements) ? method.input_view_requirements as ProcessingRequirement[] : [];
    return requirements.some((requirement) => this.lotMatchesProcessingRequirement(lot, requirement));
  }

  private lotMatchesProcessingRequirement(lot: SaveFile['inventory'][number], requirement: ProcessingRequirement): boolean {
    if (typeof requirement.base_id === 'string' && requirement.base_id !== lot.base_id) return false;
    if (Array.isArray(requirement.allowed_base_ids) && !requirement.allowed_base_ids.includes(lot.base_id)) return false;
    if (typeof requirement.category === 'string' && requirement.category !== lot.category) return false;
    if (Array.isArray(requirement.allowed_forms) && !requirement.allowed_forms.includes(lot.current_form)) return false;
    if (typeof requirement.min_freshness === 'number' && Number(lot.property_profile.freshness ?? 0) < requirement.min_freshness) return false;
    return true;
  }

  private recipeOption(save: SaveFile, recipeVariantId: string): CocosCookableRecipeOption {
    const recipe = this.recipeVariant(recipeVariantId);
    const structure = this.recipeStructure(recipe);
    const requirements = this.recipeRequirements(recipe, structure);
    const roles = Object.entries(requirements).map(([role, requirement]) => {
      const lotIds = save.inventory.filter((lot) => this.lotMatchesRecipeRequirement(lot, requirement) && this.recipeLotAvailable(save, lot)).map((lot) => lot.lot_id);
      return {
        role,
        required: requirement.optional !== true,
        base_id: typeof requirement.base_id === 'string' ? requirement.base_id : null,
        allowed_base_ids: [...(requirement.allowed_base_ids ?? (requirement.base_id ? [requirement.base_id] : []))],
        allowed_forms: Array.isArray(requirement.allowed_forms) ? [...requirement.allowed_forms] : [],
        min_quantity: this.minQuantity(requirement),
        lot_ids: lotIds
      };
    });
    const missing = roles.filter((role) => role.required && role.lot_ids.length === 0).map((role) => role.role);
    const defaults = recipe.operation_defaults as { heat_level?: string; time_cost_minutes?: number; stamina_cost?: number } | undefined;
    const preferences = structure.technique_expectations;
    const output = recipe.output_estimate as Record<string, unknown> | undefined;
    return {
      id: recipeVariantId,
      recipe_variant_id: recipeVariantId,
      label_key: typeof recipe.display_name_key === 'string' ? recipe.display_name_key : `recipe.${recipeVariantId}.name`,
      enabled: missing.length === 0,
      reason_key: missing.length === 0 ? null : 'ui.reason.recipe_missing_required_ingredients',
      dish_structure_id: this.requiredString(recipe, 'dish_structure_id', `recipe:${recipeVariantId}`),
      technique: this.requiredString(recipe, 'technique', `recipe:${recipeVariantId}`),
      roles,
      missing_required_roles: missing,
      tool_requirements: Array.isArray(recipe.tool_requirements) ? [...recipe.tool_requirements] : [],
      facility_requirements: Array.isArray(recipe.facility_requirements) ? [...recipe.facility_requirements] : [],
      operation_constraints: {
        // The formal Stage 1A Action schema fixes these structural constraints.
        // Configuration preferences below must not introduce an extra hard minimum.
        heat_levels: ['low', 'medium', 'high'],
        required_heat_level: preferences?.heat_level_preference ?? null,
        active_minutes: { integer: true, min: 1, max: preferences?.time_preference_minutes?.max ?? null },
        time_preference_minutes: preferences?.time_preference_minutes ? { ...preferences.time_preference_minutes } : null,
        default_heat_level: defaults?.heat_level ?? null,
        time_cost_minutes: defaults?.time_cost_minutes ?? null,
        stamina_cost: defaults?.stamina_cost ?? null
      },
      fuel: this.recipeFuel(save, recipe),
      output_estimate: output ? {
        serving_count: this.requiredNumber(output, 'serving_count', `recipe:${recipeVariantId}`),
        total_quantity_g: this.requiredNumber(output, 'total_quantity_g', `recipe:${recipeVariantId}`)
      } : null
    };
  }

  private compatibleRecipeRoles(lot: SaveFile['inventory'][number], recipeVariantId: string): string[] {
    const recipe = this.recipeVariant(recipeVariantId);
    return Object.entries(this.recipeRequirements(recipe))
      .filter(([, requirement]) => this.lotMatchesRecipeRequirement(lot, requirement))
      .map(([role]) => role);
  }

  private lotMatchesRecipeRequirement(lot: SaveFile['inventory'][number], requirement: RecipeRequirement): boolean {
    const allowedBaseIds = requirement.allowed_base_ids ?? (requirement.base_id ? [requirement.base_id] : undefined);
    if (allowedBaseIds && !allowedBaseIds.includes(lot.base_id)) return false;
    if (Array.isArray(requirement.allowed_forms) && !requirement.allowed_forms.includes(lot.current_form)) return false;
    const min = this.minQuantity(requirement);
    if (min !== null && (lot.quantity.unit !== min.unit || lot.quantity.amount < min.amount)) return false;
    return true;
  }

  private recipeLotAvailable(save: SaveFile, lot: SaveFile['inventory'][number]): boolean {
    return lot.quantity.amount > 0 && !save.reservations.some((reservation) => reservation.status === 'active'
      && reservation.target_ref.object_type === 'MaterialLot' && reservation.target_ref.object_id === lot.lot_id);
  }

  private recipeFuel(save: SaveFile, recipe: Record<string, unknown>): CocosCookableRecipeOption['fuel'] {
    const resources = recipe.resource_requirements as { fuel?: { base_id?: string; amount_bundle?: number; feature_flag?: string } } | undefined;
    const requirement = resources?.fuel;
    if (!requirement) return null;
    const baseId = requirement.base_id ?? 'firewood_basic';
    const fuel = save.fuel_state[baseId] as { quantity?: Quantity } | undefined;
    return {
      base_id: baseId,
      enabled: !requirement.feature_flag || save.feature_flags.flags[requirement.feature_flag] === true,
      cost: { amount: requirement.amount_bundle ?? 1, unit: 'bundle' },
      current_quantity: { amount: fuel?.quantity?.amount ?? 0, unit: fuel?.quantity?.unit ?? 'bundle' }
    };
  }

  private minQuantity(requirement: RecipeRequirement): Quantity | null {
    if (typeof requirement.min_quantity_g === 'number') return { amount: requirement.min_quantity_g, unit: 'g' };
    if (typeof requirement.min_quantity_ml === 'number') return { amount: requirement.min_quantity_ml, unit: 'ml' };
    return null;
  }

  private processingMethod(methodId: string): Record<string, unknown> {
    return this.configs.requiredDoc<Record<string, unknown>>(`configs/processing/methods/${methodId}.yaml`);
  }

  private recipeVariant(recipeVariantId: string): Record<string, unknown> {
    return this.configs.requiredDoc<Record<string, unknown>>(`configs/cooking/recipe_variants/${recipeVariantId}.yaml`);
  }

  private recipeStructure(recipe: Record<string, unknown>): RecipeStructure {
    const structureId = this.requiredString(recipe, 'dish_structure_id', `recipe:${String(recipe.id)}`);
    return this.configs.requiredDoc<RecipeStructure>(`configs/cooking/dish_structures/${structureId}.yaml`);
  }

  private recipeRequirements(recipe: Record<string, unknown>, structure = this.recipeStructure(recipe)): Record<string, RecipeRequirement> {
    const requirements = recipe.ingredient_requirements;
    if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) throw new Error(`ERR_RECIPE_REQUIREMENTS_INVALID:${String(recipe.id ?? 'unknown')}`);
    const structureRequirements = { ...structure.required_roles, ...structure.optional_roles };
    return Object.fromEntries(Object.entries(requirements).map(([role, requirement]) => [role, {
      ...structureRequirements[role], ...(requirement as RecipeRequirement)
    }]));
  }

  private requiredString(record: Record<string, unknown>, key: string, source: string): string {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`ERR_REQUIRED_STRING_MISSING:${source}:${key}`);
    return value;
  }

  private requiredNumber(record: Record<string, unknown>, key: string, source: string): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`ERR_REQUIRED_NUMBER_MISSING:${source}:${key}`);
    return value;
  }
}
