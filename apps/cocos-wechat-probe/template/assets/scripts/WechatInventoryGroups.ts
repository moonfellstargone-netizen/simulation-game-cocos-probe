import type { WechatMaterialOption, WechatStorageOption, WechatDishOption } from './WechatProbeController';

export interface InventoryKindGroup {
  readonly baseId: string;
  readonly batches: readonly WechatMaterialOption[];
  readonly knownWholeCount: number;
  readonly unknownWholeBatches: number;
  readonly hasCountQuantity: boolean;
  readonly countQuantity: number | null;
}
export interface InventoryJarGroup {
  readonly target: WechatStorageOption;
  readonly batches: readonly WechatMaterialOption[];
  readonly legacy: boolean;
  readonly dishes: readonly WechatDishOption[];
}
export interface WechatInventoryGroups {
  readonly warehouse: readonly InventoryKindGroup[];
  readonly jars: readonly InventoryJarGroup[];
  readonly other: readonly WechatMaterialOption[];
  readonly warehouseBatchCount: number;
  readonly warehouseDishes: readonly WechatDishOption[];
  readonly otherDishes: readonly WechatDishOption[];
}

// Classification follows the formal container type. An old cellar is never
// silently converted into jars, and unknown containers remain visible.
export function groupWechatInventory(lots: readonly WechatMaterialOption[], targets: readonly WechatStorageOption[], dishes: readonly WechatDishOption[] = []): WechatInventoryGroups {
  const byId = new Map(targets.map(target => [target.id, target]));
  const warehouse = new Map<string, WechatMaterialOption[]>();
  const jars = targets.filter(target => target.container_type === 'cellar_jar' || target.container_type === 'cellar_container')
    .map(target => ({ target, batches: lots.filter(lot => lot.storage_ref.container_id === target.id), legacy: target.container_type === 'cellar_container', dishes: dishes.filter(dish => dish.storage_ref.container_id === target.id) }));
  const other: WechatMaterialOption[] = [];
  for (const lot of lots) {
    const target = byId.get(lot.storage_ref.container_id);
    if (target?.container_type === 'room_temp_container') {
      const group = warehouse.get(lot.base_id) ?? []; group.push(lot); warehouse.set(lot.base_id, group);
    } else if (!target || (target.container_type !== 'cellar_jar' && target.container_type !== 'cellar_container')) other.push(lot);
  }
  const groups = Array.from(warehouse, ([baseId, batches]): InventoryKindGroup => ({ baseId, batches,
    hasCountQuantity: batches.some(lot => lot.quantity.unit === 'count'),
    countQuantity: batches.filter(lot => lot.quantity.unit === 'count').reduce<number | null>((sum, lot) => sum !== null && Number.isSafeInteger(lot.quantity.amount) && lot.quantity.amount >= 0 && Number.isSafeInteger(sum + lot.quantity.amount) ? sum + lot.quantity.amount : null, 0),
    knownWholeCount: batches.reduce((sum, lot) => sum + (lot.cabbage_pieces?.kind === 'whole' ? lot.cabbage_pieces.pieces.length : 0), 0),
    unknownWholeBatches: batches.filter(lot => lot.base_id === 'cabbage' && lot.current_form === 'fresh' && !lot.cabbage_pieces).length }));
  const warehouseDishes = dishes.filter(dish => byId.get(dish.storage_ref.container_id)?.container_type === 'room_temp_container');
  const otherDishes = dishes.filter(dish => { const kind = byId.get(dish.storage_ref.container_id)?.container_type; return kind !== 'room_temp_container' && kind !== 'cellar_jar' && kind !== 'cellar_container'; });
  return { warehouse: groups, jars, other, warehouseDishes, otherDishes, warehouseBatchCount: groups.reduce((sum, group) => sum + group.batches.length, 0) + warehouseDishes.length };
}
