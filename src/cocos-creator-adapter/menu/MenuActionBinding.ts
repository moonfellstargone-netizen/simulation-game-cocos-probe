import type { CocosActionDraft } from '../../cocos-app/adapters/CocosActionDraftBuilder';
import { CocosActionDraftBuilder } from '../../cocos-app/adapters/CocosActionDraftBuilder';
import type { CocosSelectableViewModelData, CocosCookableRecipeOption, CocosMaterialLotOption } from '../../cocos-app/view-models/CocosSelectableViewModel';
import type { FormalStage1AActionType, Quantity } from '../../game-core';

export type MenuActionSelection =
  | { action_type: 'plant_crop'; field_option_id: string; seed_lot_option_id: string; seed_quantity: Quantity }
  | { action_type: 'advance_time'; minutes: number }
  | { action_type: 'harvest_crop'; crop_option_id: string }
  | { action_type: 'split_lot'; source_lot_option_id: string; quantity: Quantity }
  | { action_type: 'start_processing'; method_id: string; input_lots: Array<{ lot_option_id: string; quantity: Quantity }>; facility_option_id: string }
  | { action_type: 'collect_processing_result'; task_option_id: string }
  | { action_type: 'cook_dish'; recipe_option_id: string; ingredient_options: Record<string, { lot_option_id: string; quantity: Quantity }>; operation_profile: Record<string, unknown>; target_storage_option_id?: string }
  | { action_type: 'submit_order'; order_option_id: string; dish_lot_option_ids: string[] };

export class MenuActionBinding {
  private readonly drafts = new CocosActionDraftBuilder();

  buildDraft(selectable: CocosSelectableViewModelData, selection: MenuActionSelection): CocosActionDraft<FormalStage1AActionType, unknown> {
    switch (selection.action_type) {
      case 'plant_crop': {
        const field = this.requiredEnabled(selectable.field_options, selection.field_option_id, 'field_option');
        const seed = this.requiredEnabled(selectable.seed_lot_options, selection.seed_lot_option_id, 'seed_lot_option');
        return this.drafts.plantCrop(field.id, seed.id, selection.seed_quantity);
      }
      case 'advance_time':
        return this.drafts.advanceTime(selection.minutes);
      case 'harvest_crop': {
        const crop = this.requiredEnabled(selectable.harvestable_crop_options, selection.crop_option_id, 'crop_option');
        return this.drafts.harvestCrop(crop.id);
      }
      case 'split_lot': {
        const lot = this.requiredEnabled(selectable.splittable_lot_options, selection.source_lot_option_id, 'source_lot_option');
        return this.drafts.splitLot(lot.id, selection.quantity);
      }
      case 'start_processing': {
        const facility = this.requiredEnabled(selectable.processing_facility_options, selection.facility_option_id, 'facility_option');
        if (!facility.compatible_method_ids.includes(selection.method_id)) throw new Error('ERR_MENU_FACILITY_METHOD_NOT_COMPATIBLE');
        const inputLots = selection.input_lots.map((input) => {
          const lot = this.requiredEnabled(selectable.processable_lot_options, input.lot_option_id, 'processable_lot_option');
          if (!lot.compatible_method_ids.includes(selection.method_id)) throw new Error('ERR_MENU_LOT_METHOD_NOT_COMPATIBLE');
          return { lot_id: lot.id, quantity: input.quantity };
        });
        return this.drafts.startProcessing(selection.method_id, inputLots, facility.facility_ref);
      }
      case 'collect_processing_result': {
        const task = this.requiredEnabled(selectable.collectable_task_options, selection.task_option_id, 'task_option');
        return this.drafts.collectProcessingResult(task.id);
      }
      case 'cook_dish': {
        const recipe = this.requiredEnabled(selectable.cookable_recipe_options, selection.recipe_option_id, 'recipe_option');
        const ingredients = this.buildRecipeIngredients(selectable, recipe, selection.ingredient_options);
        const target = selection.target_storage_option_id === undefined
          ? undefined
          : this.requiredEnabled(selectable.storage_target_options, selection.target_storage_option_id, 'storage_target_option');
        return this.drafts.cookDish(recipe.recipe_variant_id, ingredients, recipe.technique, selection.operation_profile, target === undefined ? undefined : {
          location_id: target.location_id,
          storage_type: target.storage_type,
          container_id: target.id
        });
      }
      case 'submit_order': {
        const order = this.requiredEnabled(selectable.order_options, selection.order_option_id, 'order_option');
        const submitted = selection.dish_lot_option_ids.map((id) => {
          const dish = this.requiredEnabled(selectable.submittable_dish_lot_options, id, 'dish_lot_option');
          return { object_type: 'DishLot', object_id: dish.id };
        });
        return this.drafts.submitOrder(order.id, submitted);
      }
    }
  }

  private buildRecipeIngredients(selectable: CocosSelectableViewModelData, recipe: CocosCookableRecipeOption, selected: Record<string, { lot_option_id: string; quantity: Quantity }>) {
    const ingredients: Record<string, { lot_id: string; quantity: Quantity }> = {};
    for (const role of recipe.roles) {
      const selection = selected[role.role];
      if (role.required && selection === undefined) throw new Error(`ERR_MENU_RECIPE_ROLE_MISSING:${role.role}`);
      if (selection === undefined) continue;
      const lot = this.requiredEnabled(selectable.splittable_lot_options, selection.lot_option_id, 'ingredient_lot_option');
      if (!role.lot_ids.includes(lot.id)) throw new Error(`ERR_MENU_RECIPE_LOT_NOT_COMPATIBLE:${role.role}`);
      ingredients[role.role] = { lot_id: lot.id, quantity: selection.quantity };
    }
    return ingredients;
  }

  private requiredEnabled<TOption extends { id: string; enabled: boolean }>(options: TOption[], id: string, label: string): TOption {
    if (typeof id !== 'string' || id.length === 0) throw new Error(`ERR_MENU_OPTION_ID_INVALID:${label}`);
    const option = options.find((item) => item.id === id);
    if (option === undefined) throw new Error(`ERR_MENU_OPTION_NOT_FOUND:${label}`);
    if (!option.enabled) throw new Error(`ERR_MENU_OPTION_DISABLED:${label}`);
    return option;
  }
}
