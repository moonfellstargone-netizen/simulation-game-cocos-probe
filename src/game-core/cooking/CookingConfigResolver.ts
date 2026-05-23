import type { ConfigRepository } from '../config/ConfigRepository';

export interface RoleIngredientRequirement {
  base_id?: string;
  allowed_base_ids?: string[];
  allowed_forms?: string[];
  min_quantity_g?: number;
  min_quantity_ml?: number;
  optional?: boolean;
}

export interface DishStructureConfig {
  id: string;
  display_name_key?: string;
  dish_family?: string;
  required_roles?: Record<string, RoleIngredientRequirement>;
  optional_roles?: Record<string, RoleIngredientRequirement>;
  technique_expectations?: {
    primary_action?: string;
    heat_level_preference?: string;
    time_preference_minutes?: { min?: number; ideal_min?: number; ideal_max?: number; max?: number };
  };
  flavor_targets?: Record<string, { min?: number; ideal_min?: number; ideal_max?: number; max?: number }>;
  classifier_rules?: Record<string, unknown>;
  defect_rules?: Record<string, { condition?: string }>;
  demand_tags?: string[];
}

export interface RecipeVariantConfig {
  id: string;
  dish_structure_id: string;
  display_name_key?: string;
  technique: string;
  facility_requirements?: string[];
  tool_requirements?: string[];
  resource_requirements?: Record<string, unknown>;
  ingredient_requirements?: Record<string, RoleIngredientRequirement>;
  operation_defaults?: Record<string, unknown>;
  output_estimate?: { serving_count?: number; total_quantity_g?: number };
  available_from_stage?: string;
}

export class RecipeConfigResolver {
  constructor(private readonly configs: ConfigRepository) {}

  resolveRecipeVariant(recipeVariantId: string): RecipeVariantConfig {
    for (const [path, document] of Object.entries(this.configs.loadStage1A().documents)) {
      if (!path.startsWith('configs/cooking/recipe_variants/')) continue;
      if (!document || typeof document !== 'object') continue;
      const recipe = document as Partial<RecipeVariantConfig>;
      if (recipe.id === recipeVariantId) return recipe as RecipeVariantConfig;
    }
    throw new Error(`ERR_RECIPE_NOT_FOUND:${recipeVariantId}`);
  }

  resolveDishStructure(dishStructureId: string): DishStructureConfig {
    for (const [path, document] of Object.entries(this.configs.loadStage1A().documents)) {
      if (!path.startsWith('configs/cooking/dish_structures/')) continue;
      if (!document || typeof document !== 'object') continue;
      const structure = document as Partial<DishStructureConfig>;
      if (structure.id === dishStructureId) return structure as DishStructureConfig;
    }
    throw new Error(`ERR_DISH_STRUCTURE_NOT_FOUND:${dishStructureId}`);
  }
}
