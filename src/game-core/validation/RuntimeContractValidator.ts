import type { ActionRequest, ActionResult } from '../action/ActionTypes';
import type { DishLot, DomainEvent, MaterialInputSourceSnapshot, MaterialLot, Order, ProcessingTask, Quantity, Reservation, SaveFile } from '../domain/types';
import { RuntimeSchemaValidator } from './RuntimeSchemaValidator';
import { addCabbageWeight, assertCabbagePieces } from '../inventory/CabbagePiecePlanner';

function assertSourceSnapshot(snapshot: MaterialInputSourceSnapshot | undefined, quantity: Quantity): void {
  if (!snapshot?.piece_portions) return;
  if (quantity.unit !== 'g' || !Number.isFinite(quantity.amount) || quantity.amount <= 0) throw new Error('ERR_INPUT_PIECE_SOURCE_INVALID');
  const ids = new Set<string>();
  let total = 0;
  for (const piece of snapshot.piece_portions) {
    if (!piece.piece_id || ids.has(piece.piece_id) || !Number.isFinite(piece.original_weight_g)
      || !Number.isFinite(piece.taken_weight_g) || piece.original_weight_g <= 0 || piece.taken_weight_g <= 0
      || piece.taken_weight_g > piece.original_weight_g) throw new Error('ERR_INPUT_PIECE_SOURCE_INVALID');
    ids.add(piece.piece_id);
    total = addCabbageWeight(total, piece.taken_weight_g);
  }
  if (total !== quantity.amount) throw new Error('ERR_INPUT_PIECE_SOURCE_WEIGHT_MISMATCH');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}

function assertSnapshotGroup(inputs: readonly { source_snapshot?: MaterialInputSourceSnapshot; quantity: Quantity }[]): void {
  const pieces = new Map<string, { weight: number; taken: number; source: string; seed?: string }>();
  for (const input of inputs) {
    assertSourceSnapshot(input.source_snapshot, input.quantity);
    for (const piece of input.source_snapshot?.piece_portions ?? []) {
      const previous = pieces.get(piece.piece_id);
      if (previous && (previous.weight !== piece.original_weight_g || previous.source !== canonical(piece.source_ref))) {
        throw new Error('ERR_INPUT_PIECE_SOURCE_INVALID');
      }
      const seed = piece.seed_lot_snapshot === undefined ? undefined : canonical(piece.seed_lot_snapshot);
      if (previous?.seed !== undefined && seed !== undefined && previous.seed !== seed) throw new Error('ERR_CABBAGE_SEED_SOURCE_CONFLICT');
      const taken = addCabbageWeight(previous?.taken ?? 0, piece.taken_weight_g);
      if (taken > piece.original_weight_g) throw new Error('ERR_INPUT_PIECE_SOURCE_WEIGHT_MISMATCH');
      const knownSeed = previous?.seed ?? seed;
      pieces.set(piece.piece_id, { weight: piece.original_weight_g, taken, source: canonical(piece.source_ref), ...(knownSeed === undefined ? {} : { seed: knownSeed }) });
    }
  }
}

const CONTRACT_SCHEMA_IDS = {
  actionRequest: 'action_request.schema.json',
  actionResult: 'action_result.schema.json',
  domainEvent: 'domain_event.schema.json',
  saveFile: 'save_file.schema.json',
  processingTask: 'processing_task.schema.json',
  materialLot: 'material_lot.schema.json',
  dishLot: 'dish_lot.schema.json',
  order: 'order.schema.json',
  reservation: 'reservation.schema.json'
} as const;

export class RuntimeContractValidator {
  constructor(private readonly schemas: RuntimeSchemaValidator) {}

  assertReady(): void {
    this.schemas.assertSchemasAvailable(Object.values(CONTRACT_SCHEMA_IDS));
  }

  assertActionRequest(request: ActionRequest): ActionRequest {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.actionRequest, request);
  }

  assertActionResult(result: ActionResult): ActionResult {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.actionResult, result);
  }

  assertDomainEvent(event: DomainEvent): DomainEvent {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.domainEvent, event);
  }

  assertSaveFile(save: SaveFile): SaveFile {
    this.schemas.assertValid(CONTRACT_SCHEMA_IDS.saveFile, save);
    const sourceGroups = new Map<string, string>();
    const pieceSeeds = new Map<string, string>();
    const checkPieceSeed = (pieceId: string, seed: MaterialLot | undefined): void => {
      if (seed === undefined) return;
      const value = canonical(seed), previous = pieceSeeds.get(pieceId);
      if (previous !== undefined && previous !== value) throw new Error('ERR_CABBAGE_SEED_SOURCE_CONFLICT');
      pieceSeeds.set(pieceId, value);
    };
    const checkSummary = (summary: Record<string, unknown> | undefined): void => {
      const groups = summary?.ordinary_source_groups;
      if (groups === undefined) return;
      if (!Array.isArray(groups) || !groups.length) throw new Error('ERR_SOURCE_GROUPS_INVALID');
      for (const group of groups as Array<{ group_id: string }>) {
        const value = canonical(group), previous = sourceGroups.get(group.group_id);
        if (previous !== undefined && previous !== value) throw new Error('ERR_SOURCE_GROUP_ID_CONFLICT');
        sourceGroups.set(group.group_id, value);
      }
    };
    const checkSeed = (seed: MaterialLot | undefined, expectedId?: string | null): void => {
      if (!seed) return;
      if (seed.base_id !== 'cabbage_seed' || seed.definition_ref.type !== 'seed' || seed.quantity.unit !== 'count'
        || seed.cabbage_pieces !== undefined || (expectedId != null && seed.lot_id !== expectedId)) throw new Error('ERR_SEED_SOURCE_SNAPSHOT_INVALID');
      checkSummary(seed.lineage_summary);
    };
    const checkInput = (snapshot: MaterialInputSourceSnapshot | undefined): void => {
      checkSummary(snapshot?.lineage_summary);
      for (const piece of snapshot?.piece_portions ?? []) {
        checkSeed(piece.seed_lot_snapshot);
        checkPieceSeed(piece.piece_id, piece.seed_lot_snapshot);
      }
    };
    const pieceIds = new Map<string, { weight: number; total: number; whole: boolean; source: string }>();
    for (const lot of save.inventory) {
      checkSummary(lot.lineage_summary);
      assertCabbagePieces(lot);
      if (lot.cabbage_pieces?.kind === 'whole') for (const piece of lot.cabbage_pieces.pieces) {
        checkSeed(piece.seed_lot_snapshot);
        checkPieceSeed(piece.id, piece.seed_lot_snapshot);
        if (pieceIds.has(piece.id)) throw new Error('ERR_CABBAGE_PIECE_DUPLICATE');
        pieceIds.set(piece.id, { weight: piece.weight_g, total: piece.weight_g, whole: true, source: canonical(piece.source_ref) });
      }
      if (lot.cabbage_pieces?.kind === 'cut' && lot.cabbage_pieces.source_piece) {
        const piece = lot.cabbage_pieces.source_piece;
        checkSeed(piece.seed_lot_snapshot);
        checkPieceSeed(piece.id, piece.seed_lot_snapshot);
        const previous = pieceIds.get(piece.id);
        if (previous && (previous.whole || previous.weight !== piece.original_weight_g || previous.source !== canonical(piece.source_ref))) {
          throw new Error('ERR_CABBAGE_PIECE_DUPLICATE');
        }
        const total = addCabbageWeight(previous?.total ?? 0, lot.quantity.amount);
        if (total > piece.original_weight_g) throw new Error('ERR_CABBAGE_PIECE_WEIGHT_MISMATCH');
        pieceIds.set(piece.id, { weight: piece.original_weight_g, total, whole: false, source: canonical(piece.source_ref) });
      }
    }
    for (const crop of save.crop_instances) {
      checkSeed(crop.seed_lot_snapshot, crop.seed_lot_id);
      checkPieceSeed(crop.crop_id, crop.seed_lot_snapshot);
    }
    for (const task of save.processing_tasks) {
      assertSnapshotGroup(task.input_lot_refs);
      for (const input of task.input_lot_refs) checkInput(input.source_snapshot);
    }
    for (const dish of save.dish_lots) {
      checkSummary(dish.lineage_summary);
      for (const component of dish.components) checkInput(component.source_snapshot);
      assertSnapshotGroup(dish.components.map(component => ({
      ...(component.source_snapshot === undefined ? {} : { source_snapshot: component.source_snapshot }), quantity: component.quantity_used })));
    }
    return save;
  }

  assertProcessingTask(task: ProcessingTask): ProcessingTask {
    this.schemas.assertValid(CONTRACT_SCHEMA_IDS.processingTask, task);
    assertSnapshotGroup(task.input_lot_refs);
    return task;
  }

  assertMaterialLot(lot: MaterialLot): MaterialLot {
    this.schemas.assertValid(CONTRACT_SCHEMA_IDS.materialLot, lot);
    assertCabbagePieces(lot);
    return lot;
  }

  assertDishLot(lot: DishLot): DishLot {
    this.schemas.assertValid(CONTRACT_SCHEMA_IDS.dishLot, lot);
    assertSnapshotGroup(lot.components.map(component => ({
      ...(component.source_snapshot === undefined ? {} : { source_snapshot: component.source_snapshot }), quantity: component.quantity_used })));
    return lot;
  }

  assertOrder(order: Order): Order {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.order, order);
  }

  assertReservation(reservation: Reservation): Reservation {
    return this.schemas.assertValid(CONTRACT_SCHEMA_IDS.reservation, reservation);
  }
}
