import type { ConfigRepository } from '../config/ConfigRepository';
import type { DishComponent, DishLot, MaterialLot, Quantity, SaveFile, StorageRef } from '../domain/types';
import type { IdService } from '../id/IdService';
import { InventorySystem } from '../inventory/InventorySystem';
import { RecipeConfigResolver, type DishStructureConfig, type RecipeVariantConfig, type RoleIngredientRequirement } from './CookingConfigResolver';

interface IngredientInput {
  lot_id: string;
  quantity: Quantity;
}

type OperationProfile = Record<string, unknown>;

export class CookingSystem {
  private readonly inventory: InventorySystem;
  private readonly recipeConfigs: RecipeConfigResolver;

  constructor(private readonly configs: ConfigRepository, private readonly ids: IdService) {
    this.inventory = new InventorySystem(ids);
    this.recipeConfigs = new RecipeConfigResolver(configs);
  }

  cook(save: SaveFile, recipeVariantId: string, ingredients: Record<string, IngredientInput>, technique: string, operationProfile: OperationProfile, targetStorageRef?: StorageRef): DishLot {
    const recipe = this.recipeConfigs.resolveRecipeVariant(recipeVariantId);
    const structure = this.recipeConfigs.resolveDishStructure(recipe.dish_structure_id);
    this.assertTechnique(recipe, structure, technique);
    this.assertOperationProfile(structure, operationProfile);

    const resolvedInputs = this.resolveIngredientInputs(save, recipe, structure, ingredients);
    for (const input of resolvedInputs) this.inventory.consume(save, input.input.lot_id, input.input.quantity);
    this.consumeFuelIfEnabled(save, recipe);

    const dishProfile = this.buildDishProfile(resolvedInputs, structure, operationProfile);
    const defects = this.detectDefects(dishProfile, structure);
    const servingCount = Number(recipe.output_estimate?.serving_count ?? 1);
    const totalQuantityG = Number(recipe.output_estimate?.total_quantity_g ?? resolvedInputs.reduce((sum, item) => sum + this.toGramEstimate(item.input.quantity), 0));
    const dish: DishLot = {
      dish_lot_id: this.ids.next('dish'),
      recognized_dish_id: structure.id,
      components: resolvedInputs.map((item) => this.toDishComponent(save, item.role, item.lot, item.input.quantity, recipeVariantId)),
      dish_profile: dishProfile,
      serving_count: servingCount,
      total_quantity: { amount: totalQuantityG, unit: 'g' },
      temperature_state: 'hot',
      defects,
      suitability_tags: this.buildSuitabilityTags(structure, defects),
      source_ref: {
        source_type: 'cooking',
        source_id: recipeVariantId,
        source_time: save.world_time.absolute_minute,
        source_actor: 'player',
        source_location: 'home',
        summary_key: recipe.display_name_key ?? null
      },
      lineage_summary: {
        key_origins: resolvedInputs.map((item) => ({
          origin_type: 'MaterialLot',
          origin_id: item.input.lot_id,
          source_ref: item.lot.source_ref,
          note_key: item.role
        })),
        important_flags: ['cooked_dish', ...this.buildSuitabilityTags(structure, defects)],
        lineage_depth: 1,
        compressed: false,
        summary_text_key: recipe.display_name_key ?? null,
        debug_trace_ref: null
      },
      created_time: save.world_time.absolute_minute,
      flags: ['cooked_dish'],
      storage_ref: targetStorageRef ?? this.defaultDishStorageRef(),
      storage_footprint: { amount: Math.max(1, Math.ceil(totalQuantityG / 250)), unit: 'slot_weight' },
      last_update_time: save.world_time.absolute_minute,
      decay_policy_id: 'cooked_dish_room_temp_stage_1A',
      freshness_state: 'fresh_hot',
      storage_form: 'cooked_dish'
    };
    save.dish_lots.push(dish);
    return dish;
  }

  private assertTechnique(recipe: RecipeVariantConfig, structure: DishStructureConfig, technique: string): void {
    if (technique !== recipe.technique) throw new Error('ERR_COOKING_TECHNIQUE_MISMATCH');
    const requiredTechnique = structure.classifier_rules?.required_technique ?? structure.technique_expectations?.primary_action;
    if (typeof requiredTechnique === 'string' && requiredTechnique !== technique) throw new Error('ERR_COOKING_TECHNIQUE_MISMATCH');
  }

  private assertOperationProfile(structure: DishStructureConfig, operationProfile: OperationProfile): void {
    const heatLevel = operationProfile.heat_level;
    if (typeof heatLevel !== 'string') throw new Error('ERR_COOKING_OPERATION_PROFILE_INVALID');
    const preferredHeat = structure.technique_expectations?.heat_level_preference;
    if (preferredHeat && heatLevel !== preferredHeat) throw new Error('ERR_COOKING_TECHNIQUE_MISMATCH');
    const minutes = Number(operationProfile.active_minutes);
    const timeRange = structure.technique_expectations?.time_preference_minutes;
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('ERR_COOKING_OPERATION_PROFILE_INVALID');
    if (typeof timeRange?.max === 'number' && minutes > timeRange.max) throw new Error('ERR_COOKING_OPERATION_PROFILE_INVALID');
  }

  private resolveIngredientInputs(save: SaveFile, recipe: RecipeVariantConfig, structure: DishStructureConfig, ingredients: Record<string, IngredientInput>): Array<{ role: string; input: IngredientInput; lot: MaterialLot; requirement: RoleIngredientRequirement }> {
    const recipeRequirements = recipe.ingredient_requirements ?? {};
    const structureRequirements = { ...(structure.required_roles ?? {}), ...(structure.optional_roles ?? {}) };
    const knownRoles = new Set([...Object.keys(recipeRequirements), ...Object.keys(structureRequirements)]);
    const resolved: Array<{ role: string; input: IngredientInput; lot: MaterialLot; requirement: RoleIngredientRequirement }> = [];

    for (const [role, requirement] of Object.entries(recipeRequirements)) {
      const structureRequirement = structureRequirements[role] ?? {};
      const merged = { ...structureRequirement, ...requirement };
      const input = ingredients[role];
      if (!input) {
        if (merged.optional === true) continue;
        throw new Error('ERR_COOKING_INGREDIENT_MISSING');
      }
      const lot = this.inventory.findMaterialLot(save, input.lot_id);
      this.assertIngredientMatches(role, lot, input.quantity, merged);
      resolved.push({ role, input, lot: { ...lot, property_profile: { ...lot.property_profile } }, requirement: merged });
    }

    for (const [role, input] of Object.entries(ingredients)) {
      if (knownRoles.has(role)) continue;
      const lot = this.inventory.findMaterialLot(save, input.lot_id);
      throw new Error(lot ? 'ERR_COOKING_INGREDIENT_ROLE_UNSUPPORTED' : `ERR_MATERIAL_LOT_NOT_FOUND:${input.lot_id}`);
    }
    return resolved;
  }

  private assertIngredientMatches(role: string, lot: MaterialLot, quantity: Quantity, requirement: RoleIngredientRequirement): void {
    const allowedBaseIds = requirement.allowed_base_ids ?? (requirement.base_id ? [requirement.base_id] : undefined);
    if (allowedBaseIds && !allowedBaseIds.includes(lot.base_id)) throw new Error('ERR_INVALID_LOT_STATE');
    if (requirement.allowed_forms && !requirement.allowed_forms.includes(lot.current_form)) throw new Error('ERR_INVALID_LOT_STATE');
    if (typeof requirement.min_quantity_g === 'number' && (quantity.unit !== 'g' || quantity.amount < requirement.min_quantity_g)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    if (typeof requirement.min_quantity_ml === 'number' && (quantity.unit !== 'ml' || quantity.amount < requirement.min_quantity_ml)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    if (role === 'oil' && quantity.unit !== 'ml') throw new Error('ERR_QUANTITY_UNIT_MISMATCH');
  }

  private toDishComponent(save: SaveFile, role: string, lot: MaterialLot, quantity: Quantity, recipeVariantId: string): DishComponent {
    return {
      component_id: this.ids.next('dish_component'),
      source_lot_id: lot.lot_id,
      base_id: lot.base_id,
      role: this.normalizeComponentRole(role),
      quantity_used: { ...quantity },
      component_profile: this.pickComponentProfile(lot.property_profile),
      transformation_history: [{
        operation_type: 'cook_dish',
        action_request_id: null,
        world_minute: save.world_time.absolute_minute,
        method_id: recipeVariantId,
        notes: [`role:${role}`, `form:${lot.current_form}`]
      }],
      visible_description_key: null
    };
  }

  private normalizeComponentRole(role: string): DishComponent['role'] {
    if (['main', 'side', 'oil', 'aromatic', 'garnish', 'liquid', 'seasoning'].includes(role)) return role as DishComponent['role'];
    return 'seasoning';
  }

  private buildDishProfile(resolvedInputs: Array<{ role: string; input: IngredientInput; lot: MaterialLot }>, structure: DishStructureConfig, operationProfile: OperationProfile): Record<string, number> {
    const main = resolvedInputs.find((item) => item.role === 'main');
    const side = resolvedInputs.find((item) => item.role === 'side');
    const oil = resolvedInputs.find((item) => item.role === 'oil');
    const saltiness = this.clamp(Number(main?.lot.property_profile.salinity ?? 0) * 0.6 + Number(side?.lot.property_profile.salinity ?? 0) * 0.35 + Number(oil?.lot.property_profile.salinity ?? 0) * 0.05);
    const oiliness = this.clamp(Number(side?.lot.property_profile.oiliness ?? 0) * 0.55 + Number(oil?.lot.property_profile.oiliness ?? 0) * 0.35 + 10);
    const mainMoisture = Number(main?.lot.property_profile.moisture ?? 65);
    const heatModifier = operationProfile.heat_level === 'high' ? 15 : operationProfile.heat_level === 'medium' ? 8 : 3;
    const wateriness = this.clamp(mainMoisture - heatModifier);
    const safetyRisk = this.clamp(Math.max(...resolvedInputs.map((item) => Number(item.lot.property_profile.safety_risk ?? 0)), 0));
    const crunch = this.clamp(Number(main?.lot.property_profile.crunch ?? 55) - 8);
    const smokyAroma = this.clamp(Number(side?.lot.property_profile.smoky_aroma ?? 0));
    const heatLevel = operationProfile.heat_level === 'high' ? 80 : operationProfile.heat_level === 'medium' ? 50 : 25;
    return {
      saltiness,
      oiliness,
      wateriness,
      safety_risk: safetyRisk,
      freshness: Math.min(...resolvedInputs.map((item) => Number(item.lot.property_profile.freshness ?? 100))),
      cleanliness: Math.min(...resolvedInputs.map((item) => Number(item.lot.property_profile.cleanliness ?? 70))),
      microbial_risk: Math.max(...resolvedInputs.map((item) => Number(item.lot.property_profile.microbial_risk ?? 0)), 0),
      crunch,
      smoky_aroma: smokyAroma,
      aroma: this.clamp(smokyAroma * 0.4 + Number(oil?.lot.property_profile.aroma ?? 0) * 0.25 + 25),
      heat_level: heatLevel,
      doneness: this.clamp(Number(operationProfile.active_minutes ?? 8) * 9),
      texture_balance: this.clamp(100 - Math.abs(wateriness - Number(structure.flavor_targets?.wateriness?.max ?? 55))),
      defect_score: 0
    };
  }

  private detectDefects(dishProfile: Record<string, number>, structure: DishStructureConfig): string[] {
    const defects: string[] = [];
    const waterMax = Number(structure.flavor_targets?.wateriness?.max ?? 65);
    const saltMax = Number(structure.flavor_targets?.saltiness?.max ?? 78);
    const oilMax = Number(structure.flavor_targets?.oiliness?.max ?? 85);
    if (Number(dishProfile.wateriness ?? 0) > waterMax) defects.push('watery_dish');
    if (Number(dishProfile.saltiness ?? 0) > saltMax) defects.push('too_salty');
    if (Number(dishProfile.oiliness ?? 0) > oilMax) defects.push('greasy');
    if (Number(dishProfile.safety_risk ?? 0) > 25) defects.push('unsafe');
    dishProfile.defect_score = defects.length * 20;
    return defects;
  }

  private buildSuitabilityTags(structure: DishStructureConfig, defects: string[]): string[] {
    const tags = new Set<string>(structure.demand_tags ?? []);
    if (structure.dish_family) tags.add(structure.dish_family);
    if (!defects.includes('unsafe')) tags.add('safe_to_serve');
    return [...tags];
  }

  private pickComponentProfile(profile: MaterialLot['property_profile']): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(profile)) {
      if (typeof value === 'number') result[key] = this.clamp(value);
    }
    return result;
  }

  private toGramEstimate(quantity: Quantity): number {
    if (quantity.unit === 'g') return quantity.amount;
    if (quantity.unit === 'ml') return quantity.amount;
    if (quantity.unit === 'serving') return quantity.amount * 200;
    return quantity.amount;
  }

  private defaultDishStorageRef(): StorageRef {
    return { location_id: 'home', storage_type: 'room_temp', container_id: 'home_room_temp_01' };
  }

  private consumeFuelIfEnabled(save: SaveFile, recipe: RecipeVariantConfig): void {
    const fuelRequirement = recipe.resource_requirements?.fuel as { base_id?: string; amount_bundle?: number; feature_flag?: string } | undefined;
    if (!fuelRequirement) return;
    const featureFlag = fuelRequirement.feature_flag;
    if (featureFlag && save.feature_flags.flags[featureFlag] !== true) return;
    const fuelId = fuelRequirement.base_id ?? 'firewood_basic';
    const fuel = save.fuel_state[fuelId] as Record<string, unknown> | undefined;
    if (!fuel) throw new Error('ERR_NOT_ENOUGH_FUEL');
    const quantity = fuel.quantity as { amount?: number; unit?: string } | undefined;
    const amount = Number(quantity?.amount ?? 0);
    const required = Number(fuelRequirement.amount_bundle ?? 1);
    if (amount < required) throw new Error('ERR_NOT_ENOUGH_FUEL');
    fuel.quantity = { amount: amount - required, unit: quantity?.unit ?? 'bundle' };
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }
}
