import type { ActionResult, Quantity } from '../../game-core';
import type { CocosActionSessionPort } from '../runtime/CocosAppRuntimeSession';

export class FieldMenuController {
  constructor(private readonly session: CocosActionSessionPort) {}

  requestPlantCabbage(fieldPlotId: string, seedLotId: string, seedQuantity: Quantity = { amount: 1, unit: 'count' }): ActionResult {
    return this.session.dispatch('plant_crop', {
      field_plot_id: fieldPlotId,
      seed_lot_id: seedLotId,
      seed_quantity: seedQuantity
    });
  }

  requestHarvest(cropId: string): ActionResult {
    return this.session.dispatch('harvest_crop', { crop_id: cropId });
  }
}
