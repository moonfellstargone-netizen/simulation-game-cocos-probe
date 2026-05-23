import type { ConfigRepository, FacilityRef, Quantity, SaveFile, StorageRef } from '../../game-core';

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

export interface CocosCookableRecipeRoleOption {
  role: string;
  required: boolean;
  base_id: string | null;
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
}

export interface CocosOrderOption extends CocosSelectableOptionBase {
  demand_profile_id: string;
  status: string;
  quantity_required: Quantity;
  base_reward: number;
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
}

interface RecipeRequirement {
  base_id?: string;
  allowed_forms?: string[];
  min_quantity_g?: number;
  min_quantity_ml?: number;
  optional?: boolean;
}

export class CocosSelectableViewModel {
  constructor(private readonly configs: ConfigRepository) {}

  build(save: SaveFile): CocosSelectableViewModelData {
    const processingMethodIds = this.processingMethodIds();
    const activeRecipeIds = this.activeRecipeIds();
    const materialOptions = save.inventory.map((lot) => this.materialLotOption(save, lot.lot_id, processingMethodIds, activeRecipeIds));

    return {
      field_options: save.fields.map((field) => ({
        id: field.field_plot_id,
        label_key: `field.${field.definition_id}.name`,
        enabled: field.active_crop_ids.length === 0 && field.occupied_tiles === 0,
        reason_key: field.active_crop_ids.length === 0 && field.occupied_tiles === 0 ? null : 'ui.reason.field_occupied',
        definition_id: field.definition_id,
        location_id: field.location_id,
        occupied_tiles: field.occupied_tiles,
        active_crop_count: field.active_crop_ids.length
      })),
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
      cookable_recipe_options: activeRecipeIds.map((id) => this.recipeOption(save, id)),
      submittable_dish_lot_options: save.dish_lots.map((lot) => ({
        id: lot.dish_lot_id,
        recognized_dish_id: lot.recognized_dish_id ?? null,
        serving_count: lot.serving_count,
        storage_ref: { ...lot.storage_ref },
        enabled: true,
        reason_key: null
      })),
      order_options: save.orders.map((order) => ({
        id: order.order_id,
        label_key: `order.${order.demand_profile_id}.name`,
        enabled: ['available', 'accepted', 'submitted'].includes(order.status),
        reason_key: ['available', 'accepted', 'submitted'].includes(order.status) ? null : 'ui.reason.order_not_open',
        demand_profile_id: order.demand_profile_id,
        status: order.status,
        quantity_required: { ...order.quantity_required },
        base_reward: order.base_reward
      })),
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
      processing_facility_options: this.processingFacilityOptions(save, processingMethodIds)
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
    return requirements.some((requirement) => {
      if (typeof requirement.base_id === 'string' && requirement.base_id !== lot.base_id) return false;
      if (Array.isArray(requirement.allowed_base_ids) && !requirement.allowed_base_ids.includes(lot.base_id)) return false;
      if (typeof requirement.category === 'string' && requirement.category !== lot.category) return false;
      if (Array.isArray(requirement.allowed_forms) && !requirement.allowed_forms.includes(lot.current_form)) return false;
      if (typeof requirement.min_freshness === 'number' && Number(lot.property_profile.freshness ?? 0) < requirement.min_freshness) return false;
      return true;
    });
  }

  private recipeOption(save: SaveFile, recipeVariantId: string): CocosCookableRecipeOption {
    const recipe = this.recipeVariant(recipeVariantId);
    const requirements = this.recipeRequirements(recipe);
    const roles = Object.entries(requirements).map(([role, raw]) => {
      const requirement = raw as RecipeRequirement;
      const lotIds = save.inventory.filter((lot) => this.lotMatchesRecipeRequirement(lot, requirement)).map((lot) => lot.lot_id);
      return {
        role,
        required: requirement.optional !== true,
        base_id: typeof requirement.base_id === 'string' ? requirement.base_id : null,
        allowed_forms: Array.isArray(requirement.allowed_forms) ? [...requirement.allowed_forms] : [],
        min_quantity: this.minQuantity(requirement),
        lot_ids: lotIds
      };
    });
    const missing = roles.filter((role) => role.required && role.lot_ids.length === 0).map((role) => role.role);
    return {
      id: recipeVariantId,
      recipe_variant_id: recipeVariantId,
      label_key: typeof recipe.display_name_key === 'string' ? recipe.display_name_key : `recipe.${recipeVariantId}.name`,
      enabled: missing.length === 0,
      reason_key: missing.length === 0 ? null : 'ui.reason.recipe_missing_required_ingredients',
      dish_structure_id: this.requiredString(recipe, 'dish_structure_id', `recipe:${recipeVariantId}`),
      technique: this.requiredString(recipe, 'technique', `recipe:${recipeVariantId}`),
      roles,
      missing_required_roles: missing
    };
  }

  private compatibleRecipeRoles(lot: SaveFile['inventory'][number], recipeVariantId: string): string[] {
    const recipe = this.recipeVariant(recipeVariantId);
    return Object.entries(this.recipeRequirements(recipe))
      .filter(([, raw]) => this.lotMatchesRecipeRequirement(lot, raw as RecipeRequirement))
      .map(([role]) => role);
  }

  private lotMatchesRecipeRequirement(lot: SaveFile['inventory'][number], requirement: RecipeRequirement): boolean {
    if (typeof requirement.base_id === 'string' && requirement.base_id !== lot.base_id) return false;
    if (Array.isArray(requirement.allowed_forms) && !requirement.allowed_forms.includes(lot.current_form)) return false;
    const min = this.minQuantity(requirement);
    if (min !== null && lot.quantity.unit === min.unit && lot.quantity.amount < min.amount) return false;
    return true;
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

  private recipeRequirements(recipe: Record<string, unknown>): Record<string, unknown> {
    const requirements = recipe.ingredient_requirements;
    if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) throw new Error(`ERR_RECIPE_REQUIREMENTS_INVALID:${String(recipe.id ?? 'unknown')}`);
    return requirements as Record<string, unknown>;
  }

  private requiredString(record: Record<string, unknown>, key: string, source: string): string {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`ERR_REQUIRED_STRING_MISSING:${source}:${key}`);
    return value;
  }
}
