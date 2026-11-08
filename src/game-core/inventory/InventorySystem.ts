import type { MaterialInputSourceSnapshot, MaterialLot, Quantity, SaveFile } from '../domain/types';
import type { ConfigRepository } from '../config/ConfigRepository';
import { QuantityService } from '../shared/quantity';
import type { IdService } from '../id/IdService';
import { ReservationGuard } from '../reservation/ReservationGuard';
import { StorageReconciler } from '../storage/StorageReconciler';
import { addCabbageWeight, assertCabbagePieces, describeWholeCabbageRange, planWholeCabbageTake, subtractCabbageWeight, type CabbagePortion } from './CabbagePiecePlanner';

type SourceGroup = { group_id: string; origin_lot_id: string; source_ref: MaterialLot['source_ref'];
  created_time: number; last_update_time: number; legacy_lineage?: Record<string, unknown> };

export class InventorySystem {
  private readonly quantity = new QuantityService();
  private readonly reservations = new ReservationGuard();
  constructor(private readonly ids: IdService, private readonly configs: ConfigRepository,
    private readonly storage: StorageReconciler = new StorageReconciler()) {}

  findMaterialLot(save: SaveFile, lotId: string): MaterialLot {
    const lot = save.inventory.find((item) => item.lot_id === lotId);
    if (!lot) throw new Error(`ERR_MATERIAL_LOT_NOT_FOUND:${lotId}`);
    return lot;
  }

  consume(save: SaveFile, lotId: string, required: Quantity): MaterialLot {
    const lot = this.findMaterialLot(save, lotId);
    this.reservations.assertNoActiveReservationForConsumption(save, lotId, required);
    if (lot.cabbage_pieces?.kind === 'whole') {
      if (required.unit === 'g' && required.amount === 0) return lot;
      const remaining = this.wholeConsumptionRemainder(lot, required);
      const retained = remaining.map((item, index) => {
        if (index === 0) item.lot_id = lot.lot_id;
        else item.lot_id = this.ids.next('lot_split');
        item.last_update_time = save.world_time.absolute_minute;
        return item;
      });
      save.inventory = [...save.inventory.filter(item => item.lot_id !== lotId), ...retained];
      return lot;
    }
    const { quantity, footprint } = this.consumptionResult(lot, required);
    lot.quantity = quantity;
    lot.storage_footprint = footprint;
    lot.last_update_time = save.world_time.absolute_minute;
    if (lot.quantity.amount === 0) {
      save.inventory = save.inventory.filter((item) => item.lot_id !== lotId);
    }
    return lot;
  }

  // Calculate sequential consumption without changing state or allocating IDs.
  // Repeated lots retain the existing order, including removal after full consumption.
  planConsumption(save: SaveFile, inputs: readonly { lot_id: string; quantity: Quantity }[]): MaterialLot[] {
    let inventory = save.inventory.slice();
    for (const input of this.planConsumptionInputs(save, inputs)) {
      const projected = { ...save, inventory };
      const lot = this.findMaterialLot(projected, input.lot_id);
      this.reservations.assertNoActiveReservationForConsumption(projected, input.lot_id, input.quantity);
      if (lot.cabbage_pieces?.kind === 'whole') {
        if (input.quantity.unit === 'g' && input.quantity.amount === 0) continue;
        const remaining = this.wholeConsumptionRemainder(lot, input.quantity);
        const used = new Set(inventory.map(item => item.lot_id));
        for (let index = 0; index < remaining.length; index++) {
          if (index === 0) remaining[index]!.lot_id = lot.lot_id;
          else {
            let id = '__cabbage_projection';
            while (used.has(id)) id += '_';
            remaining[index]!.lot_id = id;
            used.add(id);
          }
        }
        inventory = [...inventory.filter(item => item.lot_id !== input.lot_id), ...remaining];
        continue;
      }
      const { quantity, footprint } = this.consumptionResult(lot, input.quantity);
      inventory = quantity.amount === 0 ? inventory.filter(item => item.lot_id !== input.lot_id)
        : inventory.map(item => item !== lot ? item : { ...item, quantity, storage_footprint: footprint });
    }
    return inventory;
  }

  // A partial take can separate whole and cut portions into different lots. Within a single
  // action, repeated references to the original lot still address its original stock.
  // Validate each original request in order before coalescing same-lot gram inputs.
  planConsumptionInputs(save: SaveFile, inputs: readonly { lot_id: string; quantity: Quantity }[]): Array<{ lot_id: string; quantity: Quantity }> {
    const planned: Array<{ lot_id: string; quantity: Quantity }> = [];
    const gramInputs = new Map<string, { index: number }>();
    const remainingByLot = new Map<string, Quantity | null>();
    for (const input of inputs) {
      const lot = this.findMaterialLot(save, input.lot_id);
      const available = remainingByLot.has(lot.lot_id) ? remainingByLot.get(lot.lot_id) : lot.quantity;
      if (!available) throw new Error(`ERR_MATERIAL_LOT_NOT_FOUND:${lot.lot_id}`);
      this.assertNoActiveReservation(save, input.lot_id, input.quantity);
      if (!this.quantity.hasAtLeast(available, input.quantity)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
      const remaining = available.unit === 'g' && input.quantity.unit === 'g'
        ? { amount: subtractCabbageWeight(available.amount, input.quantity.amount), unit: 'g' }
        : this.quantity.subtract(available, input.quantity);
      remainingByLot.set(lot.lot_id, remaining.amount === 0 ? null : remaining);
      if (lot.quantity.unit !== 'g' || input.quantity.unit !== 'g') { planned.push(input); continue; }
      const previous = gramInputs.get(lot.lot_id);
      if (!previous) {
        gramInputs.set(lot.lot_id, { index: planned.length });
        planned.push({ lot_id: input.lot_id, quantity: { ...input.quantity } });
      } else {
        planned[previous.index]!.quantity.amount = addCabbageWeight(planned[previous.index]!.quantity.amount, input.quantity.amount);
      }
    }
    return planned;
  }

  captureConsumptionSources(save: SaveFile, inputs: readonly { lot_id: string; quantity: Quantity }[]): MaterialInputSourceSnapshot[] {
    const offsets = new Map<string, number>();
    return inputs.map(input => {
      const lot = this.findMaterialLot(save, input.lot_id);
      this.ensureSourceGroups(save, lot);
      const snapshot: MaterialInputSourceSnapshot = { source_ref: structuredClone(lot.source_ref),
        ...(lot.lineage_summary === undefined ? {} : { lineage_summary: structuredClone(lot.lineage_summary) }) };
      if (lot.cabbage_pieces?.kind === 'whole') {
        if (input.quantity.unit !== 'g') throw new Error('ERR_QUANTITY_UNIT_MISMATCH');
        const offset = offsets.get(lot.lot_id) ?? 0;
        if (input.quantity.amount > 0) snapshot.piece_portions = describeWholeCabbageRange(lot, offset, input.quantity.amount);
        offsets.set(lot.lot_id, addCabbageWeight(offset, input.quantity.amount));
      } else if (lot.cabbage_pieces?.kind === 'cut' && lot.cabbage_pieces.source_piece) {
        if (input.quantity.unit !== 'g') throw new Error('ERR_QUANTITY_UNIT_MISMATCH');
        const source = lot.cabbage_pieces.source_piece;
        if (input.quantity.amount > 0) snapshot.piece_portions = [{ piece_id: source.id, original_weight_g: source.original_weight_g,
          taken_weight_g: input.quantity.amount, source_ref: structuredClone(source.source_ref),
          ...(source.seed_lot_snapshot === undefined ? {} : { seed_lot_snapshot: structuredClone(source.seed_lot_snapshot) }) }];
      }
      return snapshot;
    });
  }

  private consumptionResult(lot: MaterialLot, required: Quantity): { quantity: Quantity; footprint: Quantity } {
    if (!this.quantity.hasAtLeast(lot.quantity, required)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    const originalAmount = lot.quantity.amount;
    const originalFootprint = { ...lot.storage_footprint };
    const quantity = this.quantity.subtract(lot.quantity, required);
    return { quantity, footprint: this.scaleFootprintForRemaining(originalFootprint, quantity.amount, originalAmount) };
  }

  private wholeConsumptionRemainder(source: MaterialLot, required: Quantity): MaterialLot[] {
    if (required.unit !== 'g') throw new Error('ERR_QUANTITY_UNIT_MISMATCH');
    const plan = planWholeCabbageTake(source, required);
    const rule = this.splitFootprintRule(source);
    return plan.remaining.map(part => ({ ...structuredClone(source),
      current_form: part.pieces.kind === 'cut' ? 'cut' : source.current_form,
      quantity: { ...part.quantity }, cabbage_pieces: structuredClone(part.pieces),
      storage_footprint: this.footprintFromDefinition(part.quantity.amount, rule) }));
  }

  assertNoActiveReservation(save: SaveFile, lotId: string, quantity: Quantity): void {
    this.reservations.assertNoActiveReservationForConsumption(save, lotId, quantity);
  }

  split(save: SaveFile, sourceLotId: string, splitQuantity: Quantity): { lots: MaterialLot[]; takenIds: string[] } {
    const selectedSource = this.findMaterialLot(save, sourceLotId);
    if (selectedSource.cabbage_pieces?.kind === 'whole') return this.splitWholeCabbage(save, selectedSource, splitQuantity);
    const { source, sourceRemainingAmount, splitFootprint, sourceFootprint } = this.planSplit(save, sourceLotId, splitQuantity);
    this.ensureSourceGroups(save, source);
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
    return { lots: [split], takenIds: [split.lot_id] };
  }

  assertCanSplit(save: SaveFile, sourceLotId: string, splitQuantity: Quantity): void {
    const source = this.findMaterialLot(save, sourceLotId);
    if (source.cabbage_pieces?.kind === 'whole') { this.planWholeSplit(save, source, splitQuantity); return; }
    this.planSplit(save, sourceLotId, splitQuantity);
  }

  assertCanMerge(save: SaveFile, sourceLotId: string, targetLotId: string): void {
    this.planMerge(save, sourceLotId, targetLotId);
  }

  merge(save: SaveFile, sourceLotId: string, targetLotId: string): MaterialLot {
    const target = this.planMerge(save, sourceLotId, targetLotId);
    const source = this.findMaterialLot(save, sourceLotId);
    const originalTarget = this.findMaterialLot(save, targetLotId);
    const targetGroups = this.ensureSourceGroups(save, originalTarget);
    const sourceGroups = this.ensureSourceGroups(save, source);
    target.lineage_summary = { ...(target.lineage_summary ?? {}), ordinary_source_groups: this.combineSourceGroups(targetGroups, sourceGroups) };
    delete target.lineage_summary.key_origins;
    save.inventory = save.inventory.flatMap(lot => lot.lot_id === sourceLotId ? [] : [lot.lot_id === targetLotId ? target : lot]);
    return target;
  }

  private planMerge(save: SaveFile, sourceLotId: string, targetLotId: string): MaterialLot {
    if (!sourceLotId || !targetLotId || sourceLotId === targetLotId) throw new Error('ERR_MERGE_LOTS_INVALID');
    const source = this.findMaterialLot(save, sourceLotId);
    const target = this.findMaterialLot(save, targetLotId);
    assertCabbagePieces(source);
    assertCabbagePieces(target);
    this.assertNoActiveReservation(save, sourceLotId, source.quantity);
    this.assertNoActiveReservation(save, targetLotId, target.quantity);
    // Existing processing tasks retain input IDs as historical evidence; do not strand them.
    if (save.processing_tasks.some(task => task.input_lot_refs.some(ref => ref.lot_id === sourceLotId)
        || task.reserved_quantities.some(ref => ref.lot_id === sourceLotId))
      || save.dish_lots.some(dish => dish.components.some(component => component.source_lot_id === sourceLotId))
      || save.reservations.some(reservation => reservation.target_ref.object_type === 'MaterialLot' && reservation.target_ref.object_id === sourceLotId)
      || save.crop_instances.some(crop => crop.seed_lot_id === sourceLotId)
      || save.inventory.some(lot => lot.lot_id !== sourceLotId && lot.source_ref.source_id === sourceLotId)) {
      throw new Error('ERR_MERGE_LOT_REFERENCED');
    }
    // Only explicitly ordinary flags may be merged; unknown flags fail closed.
    if (source.flags.some(flag => !['starter', 'processed'].includes(flag)) || target.flags.some(flag => !['starter', 'processed'].includes(flag))) {
      throw new Error('ERR_MERGE_LOT_PROTECTED');
    }
    const summary = (lot: MaterialLot) => {
      const value = lot.lineage_summary?.summary_text_key;
      return typeof value === 'string' && value.startsWith('event.processing.') ? value : null;
    };
    if (summary(source) && summary(target) && summary(source) !== summary(target)) throw new Error('ERR_MERGE_LOTS_INCOMPATIBLE');
    const ordinarySources = new Set(['farming', 'initial_world', 'inventory_split', 'processing']);
    const protectedSummary = (summary: Record<string, unknown> | undefined, groups: readonly SourceGroup[], allowProcessing = false): boolean => {
      if (!summary) return false;
      if (summary.compressed === true || summary.debug_trace_ref != null) return true;
      if (Array.isArray(summary.important_flags) && summary.important_flags.some(flag => !['inventory_split', 'inventory_merge'].includes(String(flag)))) return true;
      const summaryKey = summary.summary_text_key;
      if (summaryKey != null && !['lineage.inventory_split', 'lineage.inventory_merge'].includes(String(summaryKey))
        && !(allowProcessing && String(summaryKey).startsWith('event.processing.'))) return true;
      const origins = summary.key_origins;
      if (origins === undefined) return false;
      if (!Array.isArray(origins)) return true;
      return origins.some(origin => {
        if (!origin || typeof origin !== 'object') return true;
        const ref = (origin as { source_ref?: MaterialLot['source_ref'] }).source_ref;
        if (!ref || !ordinarySources.has(ref.source_type)) return true;
        if (ref.source_type === 'inventory_split' && !groups.some(group => group.origin_lot_id === ref.source_id)) return true;
        return false;
      });
    };
    const protectedSeed = (seed: MaterialLot | undefined): boolean => {
      if (!seed) return true; // Unknown seed provenance cannot be treated as ordinary.
      if (!ordinarySources.has(seed.source_ref.source_type) || seed.flags.some(flag => !['starter', 'processed'].includes(flag))) return true;
      const groups = this.existingSourceGroups(seed);
      if (seed.source_ref.source_type === 'inventory_split' && !groups.length) return true;
      if (protectedSummary(seed.lineage_summary, groups)) return true;
      return groups.some(group => !ordinarySources.has(group.source_ref.source_type)
        || (group.source_ref.source_type === 'inventory_split' && !groups.some(parent => parent.origin_lot_id === group.source_ref.source_id))
        || protectedSummary(group.legacy_lineage, groups, seed.flags.includes('processed')));
    };
    const protectedProcessing = (taskId: string, visited = new Set<string>()): boolean => {
      if (visited.has(taskId)) return true;
      visited.add(taskId);
      const task = save.processing_tasks.find(item => item.task_id === taskId);
      if (!task || !task.input_lot_refs.length) return true;
      return task.input_lot_refs.some(input => {
        const snapshot = input.source_snapshot;
        if (!snapshot || !ordinarySources.has(snapshot.source_ref.source_type)) return true;
        const groups = snapshot.lineage_summary?.ordinary_source_groups;
        if (!Array.isArray(groups) || !groups.length) return true;
        const known = groups as SourceGroup[];
        if (snapshot.source_ref.source_type === 'inventory_split' && !known.some(group => group.origin_lot_id === snapshot.source_ref.source_id)) return true;
        if (snapshot.source_ref.source_type === 'processing' && protectedProcessing(snapshot.source_ref.source_id, new Set(visited))) return true;
        if (protectedSummary(snapshot.lineage_summary, known, true)) return true;
        if (known.some(group => !ordinarySources.has(group.source_ref.source_type)
          || (group.source_ref.source_type === 'inventory_split' && !known.some(parent => parent.origin_lot_id === group.source_ref.source_id))
          || (group.source_ref.source_type === 'processing' && protectedProcessing(group.source_ref.source_id, new Set(visited)))
          || protectedSummary(group.legacy_lineage, known, true))) return true;
        return snapshot.piece_portions?.some(piece => protectedSeed(piece.seed_lot_snapshot)) ?? false;
      });
    };
    const hasProtectedLineage = (lot: MaterialLot): boolean => {
      if (!ordinarySources.has(lot.source_ref.source_type)) return true;
      if (lot.lineage_summary?.compressed === true || lot.lineage_summary?.debug_trace_ref != null) return true;
      const summary = lot.lineage_summary?.summary_text_key;
      if (summary != null && !['lineage.inventory_split', 'lineage.inventory_merge'].includes(String(summary))
        && !(lot.flags.includes('processed') && ['processing', 'inventory_split'].includes(lot.source_ref.source_type)
          && String(summary).startsWith('event.processing.'))) return true;
      const flags = lot.lineage_summary?.important_flags;
      if (Array.isArray(flags) && flags.some(flag => !['inventory_split', 'inventory_merge'].includes(String(flag)))) return true;
      const groups = this.existingSourceGroups(lot);
      if (lot.source_ref.source_type === 'inventory_split' && !groups.length) return true;
      if (lot.source_ref.source_type === 'processing' && protectedProcessing(lot.source_ref.source_id)) return true;
      if (protectedSummary(lot.lineage_summary, groups, lot.flags.includes('processed'))) return true;
      if (groups.some(group => !ordinarySources.has(group.source_ref.source_type)
        || (group.source_ref.source_type === 'inventory_split' && !groups.some(parent => parent.origin_lot_id === group.source_ref.source_id))
        || (group.source_ref.source_type === 'processing' && protectedProcessing(group.source_ref.source_id))
        || protectedSummary(group.legacy_lineage, groups, lot.flags.includes('processed')))) return true;
      if (lot.cabbage_pieces?.kind === 'whole' && lot.cabbage_pieces.pieces.some(piece => protectedSeed(piece.seed_lot_snapshot))) return true;
      if (lot.cabbage_pieces?.kind === 'cut' && protectedSeed(lot.cabbage_pieces.source_piece?.seed_lot_snapshot)) return true;
      return false;
    };
    if (hasProtectedLineage(source) || hasProtectedLineage(target)) throw new Error('ERR_MERGE_LOT_PROTECTED');
    const omitted = new Set(['lot_id', 'quantity', 'storage_footprint', 'source_ref', 'created_time', 'last_update_time', 'lineage_summary', 'cabbage_pieces', 'last_operation']);
    const comparable = (lot: MaterialLot): string => this.canonical(Object.fromEntries(Object.entries(lot).filter(([key]) => !omitted.has(key))));
    if (comparable(source) !== comparable(target) || source.quantity.unit !== target.quantity.unit
      || source.cabbage_pieces?.kind !== target.cabbage_pieces?.kind) throw new Error('ERR_MERGE_LOTS_INCOMPATIBLE');
    if (source.cabbage_pieces?.kind === 'cut' && target.cabbage_pieces?.kind === 'cut'
      && this.canonical(source.cabbage_pieces.source_piece) !== this.canonical(target.cabbage_pieces.source_piece)) {
      throw new Error('ERR_MERGE_LOTS_INCOMPATIBLE');
    }
    let amount: number;
    try { amount = addCabbageWeight(target.quantity.amount, source.quantity.amount); }
    catch { throw new Error('ERR_MERGE_QUANTITY_NOT_REPRESENTABLE'); }
    const merged = structuredClone(target);
    merged.quantity = { amount, unit: target.quantity.unit };
    merged.storage_footprint = this.footprintFromDefinition(amount, this.splitFootprintRule(target));
    if (source.cabbage_pieces?.kind === 'whole' && merged.cabbage_pieces?.kind === 'whole') {
      merged.cabbage_pieces.pieces.push(...structuredClone(source.cabbage_pieces.pieces));
    }
    const sourceGroups = this.existingSourceGroups(source);
    const targetGroups = this.existingSourceGroups(target);
    this.combineSourceGroups(targetGroups, sourceGroups);
    const sourceFlags = Array.isArray(source.lineage_summary?.important_flags) ? source.lineage_summary.important_flags.map(String) : [];
    const targetFlags = Array.isArray(target.lineage_summary?.important_flags) ? target.lineage_summary.important_flags.map(String) : [];
    merged.lineage_summary = {
      important_flags: [...new Set([...targetFlags, ...sourceFlags, 'inventory_merge'])],
      lineage_depth: Math.max(Number(target.lineage_summary?.lineage_depth ?? 0), Number(source.lineage_summary?.lineage_depth ?? 0)) + 1,
      compressed: false,
      summary_text_key: [target.lineage_summary?.summary_text_key, source.lineage_summary?.summary_text_key]
        .find(key => typeof key === 'string' && key.startsWith('event.processing.')) ?? 'lineage.inventory_merge',
      debug_trace_ref: null };
    merged.last_update_time = save.world_time.absolute_minute;
    merged.created_time = Math.min(target.created_time, source.created_time);
    assertCabbagePieces(merged);
    this.storage.assertMaterials(save, save.inventory.flatMap(lot => lot.lot_id === sourceLotId ? [] : [lot.lot_id === targetLotId ? merged : lot]));
    return merged;
  }

  private canonical(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(item => this.canonical(item)).join(',') + ']';
    if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + this.canonical(item)).join(',') + '}';
    return JSON.stringify(value) ?? 'undefined';
  }

  private existingSourceGroups(lot: MaterialLot): SourceGroup[] {
    const groups = lot.lineage_summary?.ordinary_source_groups;
    if (groups === undefined) return [];
    if (!Array.isArray(groups) || !groups.length) {
      throw new Error('ERR_SOURCE_GROUPS_INVALID');
    }
    return groups as SourceGroup[];
  }

  private combineSourceGroups(first: readonly SourceGroup[], second: readonly SourceGroup[]): SourceGroup[] {
    const result: SourceGroup[] = [], seen = new Map<string, string>();
    for (const group of [...first, ...second]) {
      if (!group || typeof group.group_id !== 'string' || !group.group_id) throw new Error('ERR_SOURCE_GROUPS_INVALID');
      const content = this.canonical(group);
      const previous = seen.get(group.group_id);
      if (previous !== undefined && previous !== content) throw new Error('ERR_SOURCE_GROUP_ID_CONFLICT');
      if (previous === undefined) { seen.set(group.group_id, content); result.push(structuredClone(group)); }
    }
    return result;
  }

  private ensureSourceGroups(save: SaveFile, lot: MaterialLot): SourceGroup[] {
    const existing = this.existingSourceGroups(lot);
    const legacyOrigins = lot.lineage_summary?.key_origins;
    if (existing.length && (!Array.isArray(legacyOrigins) || !legacyOrigins.length)) return this.combineSourceGroups(existing, []);
    const original = lot.lineage_summary === undefined ? undefined : existing.length
      ? { key_origins: structuredClone(legacyOrigins) } : structuredClone(lot.lineage_summary);
    let id: string;
    do { id = this.ids.next('source_group'); } while (JSON.stringify(save).includes(`"${id}"`));
    const group: SourceGroup = { group_id: id, origin_lot_id: lot.lot_id, source_ref: structuredClone(lot.source_ref),
      created_time: lot.created_time, last_update_time: lot.last_update_time,
      ...(original === undefined ? {} : { legacy_lineage: original }) };
    const groups = this.combineSourceGroups(existing, [group]);
    const summary: Record<string, unknown> = { ...(lot.lineage_summary ?? {}), ordinary_source_groups: groups };
    delete summary.key_origins;
    lot.lineage_summary = summary;
    return groups;
  }

  collectSourceGroups(snapshots: readonly (MaterialInputSourceSnapshot | undefined)[]): SourceGroup[] {
    let groups: SourceGroup[] = [];
    for (const snapshot of snapshots) {
      const value = snapshot?.lineage_summary?.ordinary_source_groups;
      if (value !== undefined && !Array.isArray(value)) throw new Error('ERR_SOURCE_GROUPS_INVALID');
      groups = this.combineSourceGroups(groups, (value ?? []) as SourceGroup[]);
    }
    return groups;
  }

  private planWholeSplit(save: SaveFile, source: MaterialLot, quantity: Quantity): { taken: MaterialLot[]; remaining: MaterialLot[] } {
    this.assertNoActiveReservation(save, source.lot_id, source.quantity);
    const plan = planWholeCabbageTake(source, quantity);
    const rule = this.splitFootprintRule(source);
    const portion = (part: CabbagePortion): MaterialLot => ({ ...structuredClone(source),
      current_form: part.pieces.kind === 'cut' ? 'cut' : source.current_form,
      quantity: { ...part.quantity }, cabbage_pieces: structuredClone(part.pieces),
      storage_footprint: this.footprintFromDefinition(part.quantity.amount, rule) });
    const taken = plan.taken.map(portion);
    const remaining = plan.remaining.map(portion);
    const projected = save.inventory.filter(item => item.lot_id !== source.lot_id);
    const used = new Set(save.inventory.map(item => item.lot_id));
    for (const candidate of [...remaining, ...taken]) {
      let id = '__cabbage_projection';
      while (used.has(id)) id += '_';
      used.add(id);
      projected.push({ ...candidate, lot_id: id });
    }
    this.storage.assertMaterials(save, projected);
    return { taken, remaining };
  }

  private splitWholeCabbage(save: SaveFile, source: MaterialLot, quantity: Quantity): { lots: MaterialLot[]; takenIds: string[] } {
    const plan = this.planWholeSplit(save, source, quantity);
    this.ensureSourceGroups(save, source);
    const created: MaterialLot[] = [];
    const stampNew = (lot: MaterialLot): MaterialLot => {
      lot.lot_id = this.ids.next('lot_split');
      lot.source_ref = { source_type: 'inventory_split', source_id: source.lot_id,
        source_time: save.world_time.absolute_minute, source_actor: 'player', source_location: source.storage_ref.location_id };
      lot.created_time = save.world_time.absolute_minute;
      lot.last_update_time = save.world_time.absolute_minute;
      lot.lineage_summary = this.buildSplitLineageSummary(source, source.lot_id);
      created.push(lot);
      return lot;
    };
    const remaining = plan.remaining.map((lot, index) => {
      lot.lineage_summary = this.buildSplitLineageSummary(source, source.lot_id);
      if (index > 0) return stampNew(lot);
      lot.lot_id = source.lot_id;
      lot.last_update_time = save.world_time.absolute_minute;
      return lot;
    });
    const taken = plan.taken.map(stampNew);
    save.inventory = [...save.inventory.filter(item => item.lot_id !== source.lot_id), ...remaining, ...taken];
    return { lots: [...taken, ...created.filter(item => !taken.includes(item))], takenIds: taken.map(item => item.lot_id) };
  }

  private planSplit(save: SaveFile, sourceLotId: string, splitQuantity: Quantity): {
    source: MaterialLot; sourceRemainingAmount: number; splitFootprint: Quantity; sourceFootprint: Quantity | null
  } {
    const source = this.findMaterialLot(save, sourceLotId);
    this.assertSplitQuantity(source.quantity);
    this.assertSplitQuantity(splitQuantity);
    if (!this.quantity.hasAtLeast(source.quantity, splitQuantity)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    this.assertNoActiveReservation(save, sourceLotId, splitQuantity);
    const originalAmount = source.quantity.amount;
    const sourceRemainingAmount = subtractCabbageWeight(originalAmount, splitQuantity.amount);
    if (!Number.isFinite(sourceRemainingAmount) || sourceRemainingAmount < 0 || sourceRemainingAmount >= originalAmount
      || ((source.quantity.unit === 'count' || Number.isInteger(splitQuantity.amount))
        && originalAmount - sourceRemainingAmount !== splitQuantity.amount)) {
      throw new Error('ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
    }
    const rule = this.splitFootprintRule(source);
    const splitFootprint = this.footprintFromDefinition(splitQuantity.amount, rule);
    const sourceFootprint = sourceRemainingAmount > 0 ? this.footprintFromDefinition(sourceRemainingAmount, rule) : null;
    const projected = save.inventory.filter(lot => lot.lot_id !== sourceLotId);
    if (sourceFootprint) projected.push({ ...source, quantity: { amount: sourceRemainingAmount, unit: source.quantity.unit }, storage_footprint: sourceFootprint });
    const ids = new Set(projected.map(lot => lot.lot_id));
    ids.add(sourceLotId);
    let projectedId = '__split_projection';
    while (ids.has(projectedId)) projectedId += '_';
    projected.push({ ...source, lot_id: projectedId, quantity: { ...splitQuantity }, storage_footprint: splitFootprint });
    this.storage.assertMaterials(save, projected);
    return { source, sourceRemainingAmount, splitFootprint, sourceFootprint };
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
    const previousFlags = Array.isArray(previous.important_flags) ? previous.important_flags : [];
    return {
      ordinary_source_groups: structuredClone(this.existingSourceGroups(source)),
      important_flags: previousFlags.map(String),
      lineage_depth: Number(previous.lineage_depth ?? 0) + 1,
      compressed: Boolean(previous.compressed ?? false),
      summary_text_key: typeof previous.summary_text_key === 'string' && previous.summary_text_key.startsWith('event.processing.')
        ? previous.summary_text_key : 'lineage.inventory_split',
      debug_trace_ref: previous.debug_trace_ref ?? null
    };
  }

  private scaleFootprintForRemaining(footprint: Quantity, remainingAmount: number, originalAmount: number): Quantity {
    if (footprint.unit !== 'slot_weight') return { ...footprint };
    if (remainingAmount <= 0) return { amount: 0, unit: 'slot_weight' };
    if (originalAmount <= 0) return { ...footprint };
    return { amount: Math.max(1, Math.ceil(footprint.amount * (remainingAmount / originalAmount))), unit: 'slot_weight' };
  }

}
