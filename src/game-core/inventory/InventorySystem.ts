import type { MaterialLot, Quantity, SaveFile } from '../domain/types';
import { QuantityService } from '../shared/quantity';
import type { IdService } from '../id/IdService';
import { ReservationGuard } from '../reservation/ReservationGuard';

export class InventorySystem {
  private readonly quantity = new QuantityService();
  private readonly reservations = new ReservationGuard();

  constructor(private readonly ids: IdService) {}

  findMaterialLot(save: SaveFile, lotId: string): MaterialLot {
    const lot = save.inventory.find((item) => item.lot_id === lotId);
    if (!lot) throw new Error(`ERR_MATERIAL_LOT_NOT_FOUND:${lotId}`);
    return lot;
  }

  consume(save: SaveFile, lotId: string, required: Quantity): MaterialLot {
    const lot = this.findMaterialLot(save, lotId);
    this.reservations.assertNoActiveReservationForConsumption(save, lotId, required);
    if (!this.quantity.hasAtLeast(lot.quantity, required)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    const originalAmount = lot.quantity.amount;
    const originalFootprint = { ...lot.storage_footprint };
    lot.quantity = this.quantity.subtract(lot.quantity, required);
    lot.storage_footprint = this.scaleFootprintForRemaining(originalFootprint, lot.quantity.amount, originalAmount);
    lot.last_update_time = save.world_time.absolute_minute;
    if (lot.quantity.amount === 0) {
      save.inventory = save.inventory.filter((item) => item.lot_id !== lotId);
    }
    return lot;
  }

  assertNoActiveReservation(save: SaveFile, lotId: string, quantity: Quantity): void {
    this.reservations.assertNoActiveReservationForConsumption(save, lotId, quantity);
  }

  split(save: SaveFile, sourceLotId: string, splitQuantity: Quantity): MaterialLot {
    this.assertNoActiveReservation(save, sourceLotId, splitQuantity);
    const source = this.findMaterialLot(save, sourceLotId);
    if (!this.quantity.hasAtLeast(source.quantity, splitQuantity)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    const originalAmount = source.quantity.amount;
    const originalFootprint = { ...source.storage_footprint };
    const sourceRemainingAmount = originalAmount - splitQuantity.amount;
    const sourceFootprint = this.scaleFootprintForRemaining(originalFootprint, sourceRemainingAmount, originalAmount);
    const splitFootprint = this.scaleFootprintForSplit(originalFootprint, sourceFootprint, splitQuantity.amount, originalAmount);
    source.quantity = this.quantity.subtract(source.quantity, splitQuantity);
    source.storage_footprint = sourceFootprint;
    source.last_update_time = save.world_time.absolute_minute;
    const split: MaterialLot = {
      ...structuredClone(source),
      lot_id: this.ids.next('lot_split'),
      quantity: { ...splitQuantity },
      storage_footprint: splitFootprint,
      source_ref: {
        source_type: 'inventory_split',
        source_id: sourceLotId,
        source_time: save.world_time.absolute_minute,
        source_actor: 'player',
        source_location: source.storage_ref.location_id
      },
      created_time: save.world_time.absolute_minute,
      last_update_time: save.world_time.absolute_minute,
      lineage_summary: this.buildSplitLineageSummary(source, sourceLotId)
    };
    if (split.storage_footprint.amount <= 0) split.storage_footprint.amount = 1;
    save.inventory.push(split);
    return split;
  }

  private buildSplitLineageSummary(source: MaterialLot, sourceLotId: string): Record<string, unknown> {
    const previous = source.lineage_summary ?? {};
    const previousOrigins = Array.isArray(previous.key_origins) ? previous.key_origins : [];
    const previousFlags = Array.isArray(previous.important_flags) ? previous.important_flags : [];
    return {
      key_origins: [
        ...previousOrigins,
        { origin_type: 'MaterialLot', origin_id: sourceLotId, source_ref: source.source_ref, note_key: 'inventory_split' }
      ],
      important_flags: [...new Set([...previousFlags.map(String), 'inventory_split'])],
      lineage_depth: Number(previous.lineage_depth ?? 0) + 1,
      compressed: Boolean(previous.compressed ?? false),
      summary_text_key: 'lineage.inventory_split',
      debug_trace_ref: null
    };
  }

  private scaleFootprintForRemaining(footprint: Quantity, remainingAmount: number, originalAmount: number): Quantity {
    if (footprint.unit !== 'slot_weight') return { ...footprint };
    if (remainingAmount <= 0) return { amount: 0, unit: 'slot_weight' };
    if (originalAmount <= 0) return { ...footprint };
    return { amount: Math.max(1, Math.ceil(footprint.amount * (remainingAmount / originalAmount))), unit: 'slot_weight' };
  }

  private scaleFootprintForSplit(originalFootprint: Quantity, sourceFootprint: Quantity, splitAmount: number, originalAmount: number): Quantity {
    if (originalFootprint.unit !== 'slot_weight') return { ...originalFootprint };
    if (originalAmount <= 0) return { amount: 1, unit: 'slot_weight' };
    const proportional = Math.max(1, Math.ceil(originalFootprint.amount * (splitAmount / originalAmount)));
    const remainingByDifference = Math.max(1, originalFootprint.amount - sourceFootprint.amount);
    return { amount: Math.max(proportional, remainingByDifference), unit: 'slot_weight' };
  }
}
