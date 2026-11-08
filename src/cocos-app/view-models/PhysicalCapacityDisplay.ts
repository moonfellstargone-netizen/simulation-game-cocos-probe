import { calculatePhysicalCapacity, type PhysicalContainer, type PhysicalOccupant, type PhysicalPolicy, type PhysicalResult } from '../../game-core/storage/PhysicalCapacity';

export interface DisplayCabbagePiece {
  id: string;
  weight_g: number;
  /** Omit when the versioned policy estimates volume from this piece's weight. */
  volume_ml?: number;
}

export type CapacityDisplayInput =
  | { model: 'legacy_slot'; used: number; maximum: number }
  | { model: 'physical'; policy_id: string; policy: PhysicalPolicy; containers: readonly PhysicalContainer[];
      occupants: readonly PhysicalOccupant[]; target_id: string; grid_count: number; standard_cabbage_g?: number;
      /** Pieces must come from the selected source batch, not be inferred from its weight. */
      selection?: { lot_id: string; pieces?: readonly DisplayCabbagePiece[] } };

export type CapacityDisplaySelection =
  | { status: 'unknown'; reason: string }
  | { status: 'already_in_target' }
  | { status: 'ready'; fit_prefix: number; selected_total: number; blocked_by: readonly ('mass' | 'volume')[];
      /** Display-only allocation; cells share one container and impose no physical placement limits. */
      fit_by_visual_grid: readonly number[] };

export type CapacityDisplayResult =
  | { model: 'legacy_slot'; used: number; maximum: number }
  | { model: 'physical'; status: 'unavailable'; reason: string }
  | { model: 'physical'; status: 'ready'; used_mass_g: number; maximum_mass_g: number; remaining_mass_g: number;
      used_volume_ml: number; maximum_volume_ml: number; remaining_volume_ml: number;
      /** Each number is a visual fraction; no cell is a storage slot or item-placement constraint. */
      volume_grid: readonly number[]; selection: CapacityDisplaySelection; standard_cabbage_estimate?: number };

const errorCode = (error: unknown): string => error instanceof Error ? error.message.split(':')[0]! : 'ERR_PHYSICAL_DISPLAY';
const isCleanId = (value: string) => typeof value === 'string' && !!value && value.trim() === value;

/** Pure UI projection; simulated objects are local and do not allocate formal IDs or modify inputs. */
export function derivePhysicalCapacityDisplay(input: CapacityDisplayInput): CapacityDisplayResult {
  if (input.model === 'legacy_slot') return { model: 'legacy_slot', used: input.used, maximum: input.maximum };
  if (!Number.isInteger(input.grid_count) || input.grid_count <= 0 || input.grid_count > 100)
    return { model: 'physical', status: 'unavailable', reason: 'ERR_PHYSICAL_DISPLAY_GRID_INVALID' };
  const target = input.containers.find(container => container.id === input.target_id);
  if (!target) return { model: 'physical', status: 'unavailable', reason: 'ERR_PHYSICAL_DISPLAY_TARGET_MISSING' };
  const calculate = (occupants: readonly PhysicalOccupant[]) => calculatePhysicalCapacity({
    policy_id: input.policy_id, policy: input.policy, containers: input.containers, occupants
  });
  let current: PhysicalResult;
  try { current = calculate(input.occupants); }
  catch (error) { return { model: 'physical', status: 'unavailable', reason: errorCode(error) }; }
  if ([...current.containers.values()].some(container => container.overflow.length))
    return { model: 'physical', status: 'unavailable', reason: 'ERR_PHYSICAL_DISPLAY_EXISTING_OVERFLOW' };
  const used = current.containers.get(target.id)!;
  const percent = used.volume_ml / target.limits.volume_ml;
  const grid = Array.from({ length: input.grid_count }, (_, index) => Math.max(0, Math.min(1, percent * input.grid_count - index)));
  const result = {
    model: 'physical' as const, status: 'ready' as const,
    used_mass_g: used.mass_g, maximum_mass_g: target.limits.mass_g,
    remaining_mass_g: Number((target.limits.mass_g - used.mass_g).toFixed(3)),
    used_volume_ml: used.volume_ml, maximum_volume_ml: target.limits.volume_ml,
    remaining_volume_ml: Number((target.limits.volume_ml - used.volume_ml).toFixed(3)),
    volume_grid: grid
  };
  let standard_cabbage_estimate: number | undefined;
  const weight = input.standard_cabbage_g;
  if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0 && target.supported_forms.includes('fresh')) {
    try {
      // Reuse the formal physical calculation, with an ephemeral hypothetical
      // item only; this is an estimate and never modifies inventory or IDs.
      let id = '__standard_cabbage_estimate';
      const ids = new Set(input.occupants.map(item => item.id)); while (ids.has(id)) id += '_';
      const simulated = (count: number) => count === 0 ? current : calculate([...input.occupants, {
        kind: 'MaterialLot', id, definition_id: 'cabbage', form: 'fresh', quantity: { amount: count * weight, unit: 'g' },
        storage_ref: { container_id: target.id, location_id: target.location_id, storage_type: target.storage_type }
      }]);
      // Search for the first policy-calculated overflow, then bisect. The
      // cabbage mass coefficient need not be 1, and no gameplay cap is assumed.
      // If JS cannot represent another exact candidate quantity, stay unknown
      // instead of presenting an artificially truncated estimate.
      const maxSafeCount = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number.MAX_SAFE_INTEGER / weight));
      if (Number.isSafeInteger(maxSafeCount) && maxSafeCount >= 1) {
        let lo = 0, hi = 1, bounded = false;
        while (true) {
          const fits = simulated(hi).containers.get(target.id)!.overflow.length === 0;
          if (!fits) { bounded = true; break; }
          lo = hi;
          if (hi === maxSafeCount) break;
          hi = hi <= Math.floor(maxSafeCount / 2) ? hi * 2 : maxSafeCount;
        }
        if (bounded) {
          while (lo + 1 < hi) {
            const middle = lo + Math.floor((hi - lo) / 2);
            if (simulated(middle).containers.get(target.id)!.overflow.length === 0) lo = middle; else hi = middle;
          }
          standard_cabbage_estimate = lo;
        }
      }
    } catch { /* Unsupported or incomplete policy means estimate remains unknown. */ }
  }
  const withEstimate = standard_cabbage_estimate === undefined ? result : { ...result, standard_cabbage_estimate };
  if (!input.selection) return { ...withEstimate, selection: { status: 'unknown', reason: 'not_selected' } };
  const source = input.occupants.find(item => item.kind === 'MaterialLot' && item.id === input.selection!.lot_id);
  if (!source || source.definition_id !== 'cabbage' || source.form !== 'fresh' || source.quantity.unit !== 'g')
    return { ...withEstimate, selection: { status: 'unknown', reason: 'selected_batch_unavailable' } };
  if (source.storage_ref.container_id === target.id) return { ...withEstimate, selection: { status: 'already_in_target' } };
  const pieces = input.selection.pieces;
  if (!pieces || pieces.length === 0) return { ...withEstimate, selection: { status: 'unknown', reason: 'piece_count_unknown' } };
  const pieceIds = new Set<string>();
  for (const piece of pieces) {
    if (!isCleanId(piece.id) || pieceIds.has(piece.id) || !Number.isFinite(piece.weight_g) || piece.weight_g <= 0
        || (piece.volume_ml !== undefined && (!Number.isFinite(piece.volume_ml) || piece.volume_ml <= 0))) {
      return { ...withEstimate, selection: { status: 'unknown', reason: 'piece_data_invalid' } };
    }
    pieceIds.add(piece.id);
  }
  // Reuse the same rational engine to verify the piece masses exactly equal the source quantity.
  try {
    const checked = { ...source, pieces: pieces.map(piece => ({ mass_g: piece.weight_g, volume_ml: 1 })) };
    calculate(input.occupants.map(item => item === source ? checked : item));
  } catch { return { ...withEstimate, selection: { status: 'unknown', reason: 'piece_data_invalid' } }; }

  // Remove the original source batch and reconstruct its pieces across source and target.
  // Temporary names are local to this pure projection and never become saved IDs.
  const rest = input.occupants.filter(item => item !== source);
  const names = new Set(rest.filter(item => item.kind === 'MaterialLot').map(item => item.id));
  const projections = pieces.map((piece, index): PhysicalOccupant => {
    let name = `__capacity_display_${index}`;
    while (names.has(name)) name += '_';
    names.add(name);
    const individual = { ...source, id: name, quantity: { amount: piece.weight_g, unit: 'g' as const } };
    delete individual.pieces;
    return piece.volume_ml === undefined ? individual : { ...individual, pieces: [{ mass_g: piece.weight_g, volume_ml: piece.volume_ml }] };
  });
  const simulate = (count: number): PhysicalResult => calculate([...rest, ...projections.map((piece, index) => index < count
    ? { ...piece, storage_ref: { container_id: target.id, location_id: target.location_id, storage_type: target.storage_type } }
    : piece)]);
  try {
    // N=0 must equal the existing batch's contribution; do not invent incompatible piece volumes.
    const unchanged = simulate(0);
    for (const [id, value] of current.containers) {
      const next = unchanged.containers.get(id)!;
      if (value.mass_g !== next.mass_g || value.volume_ml !== next.volume_ml)
        return { ...withEstimate, selection: { status: 'unknown', reason: 'piece_volume_inconsistent' } };
    }
    let lower = 0, upper = pieces.length;
    while (lower < upper) {
      const middle = Math.ceil((lower + upper) / 2);
      if (simulate(middle).containers.get(target.id)!.overflow.length === 0) lower = middle;
      else upper = middle - 1;
    }
    const blocked = lower < pieces.length ? simulate(lower + 1).containers.get(target.id)!.overflow : [];
    const counts = Array.from({ length: input.grid_count }, () => 0);
    for (let count = 1; count <= lower; count++) {
      const volume = simulate(count).containers.get(target.id)!.volume_ml;
      const cell = Math.max(0, Math.min(input.grid_count - 1, Math.ceil(volume / target.limits.volume_ml * input.grid_count) - 1));
      counts[cell]!++;
    }
    return { ...withEstimate, selection: { status: 'ready', fit_prefix: lower, selected_total: pieces.length, blocked_by: blocked, fit_by_visual_grid: counts } };
  } catch (error) {
    return { ...withEstimate, selection: { status: 'unknown', reason: errorCode(error) } };
  }
}
