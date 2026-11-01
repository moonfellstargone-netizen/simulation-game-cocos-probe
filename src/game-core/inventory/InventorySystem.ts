import type { MaterialLot, Quantity, SaveFile } from '../domain/types';
import type { ConfigRepository } from '../config/ConfigRepository';
import { QuantityService } from '../shared/quantity';
import type { IdService } from '../id/IdService';
import { ReservationGuard } from '../reservation/ReservationGuard';

export class InventorySystem {
  private readonly quantity = new QuantityService();
  private readonly reservations = new ReservationGuard();

  constructor(private readonly ids: IdService, private readonly configs: ConfigRepository) {}

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
    const source = this.findMaterialLot(save, sourceLotId);
    this.assertSplitQuantity(source.quantity);
    this.assertSplitQuantity(splitQuantity);
    if (!this.quantity.hasAtLeast(source.quantity, splitQuantity)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    this.assertNoActiveReservation(save, sourceLotId, splitQuantity);
    const originalAmount = source.quantity.amount;
    const sourceRemainingAmount = originalAmount - splitQuantity.amount;
    if (!Number.isFinite(sourceRemainingAmount) || sourceRemainingAmount < 0 || sourceRemainingAmount >= originalAmount
      || (source.quantity.unit === 'count' && originalAmount - sourceRemainingAmount !== splitQuantity.amount)) {
      throw new Error('ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
    }
    const rule = this.splitFootprintRule(source);
    const splitFootprint = this.footprintFromDefinition(splitQuantity.amount, rule);
    const sourceFootprint = sourceRemainingAmount > 0 ? this.footprintFromDefinition(sourceRemainingAmount, rule) : null;
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
    if (sourceRemainingAmount === 0) {
      save.inventory = save.inventory.filter((lot) => lot.lot_id !== sourceLotId);
    } else {
      source.quantity = { amount: sourceRemainingAmount, unit: source.quantity.unit };
      source.storage_footprint = sourceFootprint!;
      source.last_update_time = save.world_time.absolute_minute;
    }
    save.inventory.push(split);
    return split;
  }

  private assertSplitQuantity(quantity: Quantity): void {
    if (!quantity || !Number.isFinite(quantity.amount) || quantity.amount <= 0
      || (quantity.unit === 'count' && !Number.isInteger(quantity.amount))) {
      throw new Error('ERR_SPLIT_QUANTITY_INVALID');
    }
  }

  private splitFootprintRule(source: MaterialLot): { base: number; footprint: number } {
    const prefix = source.definition_ref.type === 'material' ? 'configs/materials/'
      : source.definition_ref.type === 'seed' ? 'configs/farming/seeds/' : null;
    if (!prefix || source.definition_ref.id !== source.base_id || source.definition_ref.canonical_id !== `base:${source.base_id}`) {
      throw new Error('ERR_STORAGE_DEFINITION_REF_INVALID');
    }
    const definitions = Object.entries(this.configs.loadStage1A().documents)
      .filter(([path]) => path.startsWith(prefix))
      .map(([, value]) => this.record(value))
      .filter((value) => value?.id === source.base_id);
    if (definitions.length !== 1) throw new Error('ERR_STORAGE_DEFINITION_NOT_UNIQUE');
    const definition = definitions[0]!;
    const forms = this.record(definition.forms);
    if (typeof definition.category !== 'string' || !definition.category.trim() || definition.category.trim() !== definition.category
      || definition.category !== source.category || !forms || !source.current_form.trim()
      || source.current_form.trim() !== source.current_form || !Object.hasOwn(forms, source.current_form)) {
      throw new Error('ERR_STORAGE_DEFINITION_INVALID');
    }
    const rule = this.record(definition.storage_footprint_rule);
    const base = this.record(rule?.base_quantity);
    const footprint = this.record(rule?.footprint);
    if (!base || !footprint || typeof base.amount !== 'number' || !Number.isFinite(base.amount) || base.amount <= 0
      || typeof footprint.amount !== 'number' || !Number.isFinite(footprint.amount) || footprint.amount <= 0
      || footprint.unit !== 'slot_weight' || base.unit !== source.quantity.unit
      || (base.unit === 'count' && !Number.isInteger(base.amount))) {
      throw new Error('ERR_STORAGE_FOOTPRINT_RULE_INVALID');
    }
    return { base: base.amount, footprint: footprint.amount };
  }

  private footprintFromDefinition(amount: number, rule: { base: number; footprint: number }): Quantity {
    const raw = amount / rule.base * rule.footprint;
    if (!Number.isFinite(raw)) throw new Error('ERR_STORAGE_FOOTPRINT_RULE_INVALID');
    return { amount: Math.max(1, Math.ceil(raw)), unit: 'slot_weight' };
  }

  private record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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

}
