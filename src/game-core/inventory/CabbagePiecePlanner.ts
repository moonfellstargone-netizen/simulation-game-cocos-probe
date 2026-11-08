import type { CabbagePieces, MaterialInputSourceSnapshot, MaterialLot, Quantity } from '../domain/types';

type WholePiece = Extract<CabbagePieces, { kind: 'whole' }>['pieces'][number];
export interface CabbagePortion {
  quantity: Quantity;
  pieces: CabbagePieces;
}
export interface CabbageTakePlan {
  taken: CabbagePortion[];
  remaining: CabbagePortion[];
}

interface DecimalValue { digits: string; scale: number }

function trimLeading(digits: string): string { return digits.replace(/^0+(?=\d)/, ''); }

function decimal(value: number): DecimalValue {
  if (!Number.isFinite(value) || value < 0) throw new Error('ERR_CABBAGE_QUANTITY_INVALID');
  const [mantissa, exponentText] = value.toString().toLowerCase().split('e');
  const [integer, fraction = ''] = mantissa!.split('.');
  const exponent = Number(exponentText ?? 0);
  let digits = trimLeading(integer! + fraction);
  let scale = fraction.length - exponent;
  if (scale < 0) { digits += '0'.repeat(-scale); scale = 0; }
  while (scale > 0 && digits.endsWith('0')) { digits = digits.slice(0, -1); scale--; }
  return { digits: digits || '0', scale };
}

function aligned(a: DecimalValue, b: DecimalValue): [string, string, number] {
  const scale = Math.max(a.scale, b.scale);
  return [trimLeading(a.digits + '0'.repeat(scale - a.scale)), trimLeading(b.digits + '0'.repeat(scale - b.scale)), scale];
}

function represented(digits: string, scale: number): number {
  const value = Number(`${digits}e-${scale}`);
  if (!Number.isFinite(value)) throw new Error('ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
  const [actual, expected] = aligned(decimal(value), { digits, scale });
  if (actual !== expected) throw new Error('ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
  return value;
}

function addDigits(a: string, b: string): string {
  const length = Math.max(a.length, b.length);
  a = a.padStart(length, '0'); b = b.padStart(length, '0');
  let carry = 0, result = '';
  for (let index = length - 1; index >= 0; index--) {
    const sum = Number(a[index]) + Number(b[index]) + carry;
    result = String(sum % 10) + result; carry = Math.floor(sum / 10);
  }
  return trimLeading((carry ? String(carry) : '') + result);
}

function subtractDigits(a: string, b: string): string {
  a = trimLeading(a); b = trimLeading(b);
  if (a.length < b.length || (a.length === b.length && a < b)) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
  b = b.padStart(a.length, '0');
  let borrow = 0, result = '';
  for (let index = a.length - 1; index >= 0; index--) {
    let difference = Number(a[index]) - Number(b[index]) - borrow;
    borrow = difference < 0 ? 1 : 0;
    if (borrow) difference += 10;
    result = String(difference) + result;
  }
  return trimLeading(result);
}

/** Decimal arithmetic on the values actually serialized in JSON, with no implicit rounding. */
export function addCabbageWeight(a: number, b: number): number {
  const [left, right, scale] = aligned(decimal(a), decimal(b));
  return represented(addDigits(left, right), scale);
}

export function subtractCabbageWeight(a: number, b: number): number {
  const [left, right, scale] = aligned(decimal(a), decimal(b));
  return represented(subtractDigits(left, right), scale);
}

// Missing metadata belongs to a legacy lot: never infer a piece count from grams.
export function assertCabbagePieces(lot: MaterialLot): void {
  const state = lot.cabbage_pieces;
  if (!state) return;
  if (lot.base_id !== 'cabbage' || lot.quantity.unit !== 'g' || !Number.isFinite(lot.quantity.amount) || lot.quantity.amount <= 0) {
    throw new Error('ERR_CABBAGE_PIECES_INVALID');
  }
  if (state.kind === 'cut') {
    if (lot.current_form !== 'cut') throw new Error('ERR_CABBAGE_PIECES_INVALID');
    if (state.source_piece && (!state.source_piece.id || !Number.isFinite(state.source_piece.original_weight_g)
      || state.source_piece.original_weight_g < lot.quantity.amount || !state.source_piece.source_ref)) throw new Error('ERR_CABBAGE_PIECES_INVALID');
    return;
  }
  if (state.kind !== 'whole' || !Array.isArray(state.pieces) || !state.pieces.length) throw new Error('ERR_CABBAGE_PIECES_INVALID');
  const ids = new Set<string>();
  let weight = 0;
  for (const piece of state.pieces) {
    if (!piece || typeof piece.id !== 'string' || !piece.id || ids.has(piece.id)
      || !Number.isFinite(piece.weight_g) || piece.weight_g <= 0 || !piece.source_ref) throw new Error('ERR_CABBAGE_PIECES_INVALID');
    ids.add(piece.id);
    weight = addCabbageWeight(weight, piece.weight_g);
  }
  if (!Number.isFinite(weight) || weight !== lot.quantity.amount) throw new Error('ERR_CABBAGE_PIECES_WEIGHT_MISMATCH');
}

function whole(pieces: WholePiece[]): CabbagePortion[] {
  if (!pieces.length) return [];
  return [{ quantity: { amount: pieces.reduce((total, piece) => addCabbageWeight(total, piece.weight_g), 0), unit: 'g' },
    pieces: { kind: 'whole', pieces } }];
}

function cut(weight: number, source: WholePiece | undefined): CabbagePortion[] {
  return weight > 0 ? [{ quantity: { amount: weight, unit: 'g' }, pieces: { kind: 'cut',
    ...(source ? { source_piece: { id: source.id, original_weight_g: source.weight_g, source_ref: structuredClone(source.source_ref),
      ...(source.seed_lot_snapshot === undefined ? {} : { seed_lot_snapshot: structuredClone(source.seed_lot_snapshot) }) } } : {}) } }] : [];
}

/** Plan a deterministic left-to-right take without changing the source or allocating IDs. */
export function planWholeCabbageTake(lot: MaterialLot, requested: Quantity): CabbageTakePlan {
  assertCabbagePieces(lot);
  const state = lot.cabbage_pieces;
  if (!state || state.kind !== 'whole') throw new Error('ERR_CABBAGE_PIECE_COUNT_UNKNOWN');
  if (!Number.isFinite(requested.amount) || requested.amount <= 0) throw new Error('ERR_SPLIT_QUANTITY_INVALID');
  if (requested.unit === 'count') {
    if (!Number.isInteger(requested.amount)) throw new Error('ERR_SPLIT_QUANTITY_INVALID');
    if (requested.amount > state.pieces.length) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
    return { taken: whole(state.pieces.slice(0, requested.amount)), remaining: whole(state.pieces.slice(requested.amount)) };
  }
  if (requested.unit !== 'g') throw new Error('ERR_QUANTITY_UNIT_MISMATCH');
  if (requested.amount > lot.quantity.amount) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
  let need = requested.amount;
  const taken: WholePiece[] = [];
  const remaining: WholePiece[] = [];
  let takenCut = 0;
  let remainingCut = 0;
  let cutSource: WholePiece | undefined;
  for (const piece of state.pieces) {
    if (need <= 0) { remaining.push(piece); continue; }
    if (need >= piece.weight_g) {
      const next = subtractCabbageWeight(need, piece.weight_g);
      taken.push(piece);
      need = next;
      continue;
    }
    takenCut = need;
    cutSource = piece;
    remainingCut = subtractCabbageWeight(piece.weight_g, need);
    if (remainingCut <= 0 || addCabbageWeight(takenCut, remainingCut) !== piece.weight_g) throw new Error('ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
    need = 0;
  }
  if (need !== 0) throw new Error('ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
  return { taken: [...whole(taken), ...cut(takenCut, cutSource)], remaining: [...whole(remaining), ...cut(remainingCut, cutSource)] };
}

/** Preserve the exact individual origins consumed by a g-based action, including repeated inputs. */
export function describeWholeCabbageRange(lot: MaterialLot, offset: number, amount: number): NonNullable<MaterialInputSourceSnapshot['piece_portions']> {
  assertCabbagePieces(lot);
  if (lot.cabbage_pieces?.kind !== 'whole') throw new Error('ERR_CABBAGE_PIECE_COUNT_UNKNOWN');
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(amount) || amount <= 0
    || addCabbageWeight(offset, amount) > lot.quantity.amount) throw new Error('ERR_NOT_ENOUGH_RESOURCE');
  let skip = offset, remaining = amount;
  const result: NonNullable<MaterialInputSourceSnapshot['piece_portions']> = [];
  for (const piece of lot.cabbage_pieces.pieces) {
    if (remaining === 0) break;
    if (skip >= piece.weight_g) { skip = subtractCabbageWeight(skip, piece.weight_g); continue; }
    const available = subtractCabbageWeight(piece.weight_g, skip);
    const taken = Math.min(available, remaining);
    result.push({ piece_id: piece.id, original_weight_g: piece.weight_g, taken_weight_g: taken, source_ref: structuredClone(piece.source_ref),
      ...(piece.seed_lot_snapshot === undefined ? {} : { seed_lot_snapshot: structuredClone(piece.seed_lot_snapshot) }) });
    remaining = subtractCabbageWeight(remaining, taken);
    skip = 0;
  }
  if (remaining !== 0) throw new Error('ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE');
  return result;
}
