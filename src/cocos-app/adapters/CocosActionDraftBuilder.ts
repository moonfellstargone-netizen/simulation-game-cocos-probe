import type {
  AdvanceTimeParams,
  CollectProcessingResultParams,
  CookDishParams,
  FormalStage1AActionType,
  HarvestCropParams,
  PlantCropParams,
  Quantity,
  SplitLotParams,
  StartProcessingParams,
  StorageOccupantRef,
  StorageRef,
  StoreItemParams,
  SubmitOrderParams,
  SubmittedObjectRef
} from '../../game-core';

export interface CocosActionDraft<TType extends FormalStage1AActionType, TParams> {
  action_type: TType;
  parameters: TParams;
}

export class CocosActionDraftBuilder {
  plantCrop(field_plot_id: string, seed_lot_id: string, seed_quantity: Quantity): CocosActionDraft<'plant_crop', PlantCropParams> {
    this.assertId(field_plot_id, 'field_plot_id');
    this.assertId(seed_lot_id, 'seed_lot_id');
    this.assertPositiveQuantity(seed_quantity, 'seed_quantity');
    return { action_type: 'plant_crop', parameters: { field_plot_id, seed_lot_id, seed_quantity: { ...seed_quantity } } };
  }

  advanceTime(minutes: number): CocosActionDraft<'advance_time', AdvanceTimeParams> {
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('ERR_DRAFT_MINUTES_INVALID');
    return { action_type: 'advance_time', parameters: { minutes } };
  }

  harvestCrop(crop_id: string): CocosActionDraft<'harvest_crop', HarvestCropParams> {
    this.assertId(crop_id, 'crop_id');
    return { action_type: 'harvest_crop', parameters: { crop_id } };
  }

  storeItem(object_ref: StorageOccupantRef, storage_ref: StorageRef): CocosActionDraft<'store_item', StoreItemParams> {
    this.assertId(object_ref.object_id, 'object_ref.object_id');
    this.assertId(storage_ref.container_id, 'storage_ref.container_id');
    return { action_type: 'store_item', parameters: { object_ref: { ...object_ref }, storage_ref: { ...storage_ref } } };
  }

  splitLot(source_lot_id: string, quantity: Quantity): CocosActionDraft<'split_lot', SplitLotParams> {
    this.assertId(source_lot_id, 'source_lot_id');
    this.assertPositiveQuantity(quantity, 'quantity');
    return { action_type: 'split_lot', parameters: { source_lot_id, quantity: { ...quantity } } };
  }

  startProcessing(method_id: string, input_lots: StartProcessingParams['input_lots'], facility_ref: StartProcessingParams['facility_ref']): CocosActionDraft<'start_processing', StartProcessingParams> {
    this.assertId(method_id, 'method_id');
    if (!Array.isArray(input_lots) || input_lots.length === 0) throw new Error('ERR_DRAFT_INPUT_LOTS_EMPTY');
    for (const input of input_lots) {
      this.assertId(input.lot_id, 'input_lots.lot_id');
      this.assertPositiveQuantity(input.quantity, 'input_lots.quantity');
    }
    this.assertId(facility_ref.container_id, 'facility_ref.container_id');
    this.assertId(facility_ref.definition_id, 'facility_ref.definition_id');
    this.assertId(facility_ref.facility_id, 'facility_ref.facility_id');
    return {
      action_type: 'start_processing',
      parameters: {
        method_id,
        input_lots: input_lots.map((input) => ({ lot_id: input.lot_id, quantity: { ...input.quantity } })),
        facility_ref: { ...facility_ref }
      }
    };
  }

  collectProcessingResult(task_id: string): CocosActionDraft<'collect_processing_result', CollectProcessingResultParams> {
    this.assertId(task_id, 'task_id');
    return { action_type: 'collect_processing_result', parameters: { task_id } };
  }

  cookDish(recipe_variant_id: string, ingredients: CookDishParams['ingredients'], technique: string, operation_profile: Record<string, unknown>, target_storage_ref?: StorageRef): CocosActionDraft<'cook_dish', CookDishParams> {
    this.assertId(recipe_variant_id, 'recipe_variant_id');
    this.assertId(technique, 'technique');
    const clonedIngredients: CookDishParams['ingredients'] = {};
    for (const [role, ingredient] of Object.entries(ingredients)) {
      this.assertId(role, 'ingredient_role');
      this.assertId(ingredient.lot_id, 'ingredients.lot_id');
      this.assertPositiveQuantity(ingredient.quantity, 'ingredients.quantity');
      clonedIngredients[role] = { lot_id: ingredient.lot_id, quantity: { ...ingredient.quantity } };
    }
    const parameters: CookDishParams = {
      recipe_variant_id,
      ingredients: clonedIngredients,
      technique,
      operation_profile: { ...operation_profile }
    };
    if (target_storage_ref !== undefined) parameters.target_storage_ref = { ...target_storage_ref };
    return { action_type: 'cook_dish', parameters };
  }

  submitOrder(order_id: string, submitted_object_refs: SubmittedObjectRef[]): CocosActionDraft<'submit_order', SubmitOrderParams> {
    this.assertId(order_id, 'order_id');
    if (!Array.isArray(submitted_object_refs) || submitted_object_refs.length === 0) throw new Error('ERR_DRAFT_SUBMITTED_REFS_EMPTY');
    for (const ref of submitted_object_refs) this.assertId(ref.object_id, 'submitted_object_refs.object_id');
    return { action_type: 'submit_order', parameters: { order_id, submitted_object_refs: submitted_object_refs.map((ref) => ({ ...ref })) } };
  }

  private assertId(value: string, field: string): void {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`ERR_DRAFT_ID_INVALID:${field}`);
  }

  private assertPositiveQuantity(quantity: Quantity, field: string): void {
    if (!quantity || typeof quantity !== 'object' || typeof quantity.unit !== 'string' || !Number.isFinite(quantity.amount) || quantity.amount <= 0) {
      throw new Error(`ERR_DRAFT_QUANTITY_INVALID:${field}`);
    }
  }
}
