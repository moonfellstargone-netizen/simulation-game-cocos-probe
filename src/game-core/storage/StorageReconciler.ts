import type { MaterialLot, Quantity, SaveFile, StorageContainer, StorageOccupantRef } from '../domain/types';
import { listStorageOccupants, toStorageOccupantRef, type StorageOccupant } from './StorageOccupant';

export class StorageReconciler {
  reconcile(save: SaveFile): void {
    const calculated = this.calculate(save, listStorageOccupants(save));
    for (const container of save.storage_containers) {
      const totals = calculated.get(container)!;
      container.active_object_refs = totals.refs;
      container.used_capacity = totals.used;
    }
  }

  // Check the proposed footprints through the same rules and ordering as reconcile,
  // without allocating an ID, changing SaveFile, or executing an action.
  assertMaterialSplit(save: SaveFile, source: MaterialLot, remainder: Quantity | null, split: Quantity): void {
    const materials: StorageOccupant[] = save.inventory.flatMap((lot): StorageOccupant[] => {
      if (lot !== source) return [{ object_type: 'MaterialLot', object_id: lot.lot_id, object: lot }];
      return remainder === null ? [] : [{ object_type: 'MaterialLot', object_id: lot.lot_id,
        object: { ...lot, storage_footprint: remainder } }];
    });
    materials.push({ object_type: 'MaterialLot', object_id: '', object: { ...source, storage_footprint: split } });
    const dishes: StorageOccupant[] = save.dish_lots.map(object => ({ object_type: 'DishLot', object_id: object.dish_lot_id, object }));
    this.calculate(save, [...materials, ...dishes]);
  }

  private calculate(save: SaveFile, occupants: StorageOccupant[]): Map<StorageContainer, { refs: StorageOccupantRef[]; used: number }> {
    const containers = new Map(save.storage_containers.map((container) => [container.container_id, container]));
    const totals = new Map(save.storage_containers.map((container) => [container, { refs: [] as StorageOccupantRef[], used: 0 }]));
    for (const occupant of occupants) {
      const storageRef = occupant.object.storage_ref;
      const container = containers.get(storageRef.container_id);
      if (!container) throw new Error(`ERR_STORAGE_CONTAINER_NOT_FOUND:${storageRef.container_id}`);
      const form = occupant.object_type === 'MaterialLot' ? occupant.object.current_form : occupant.object.storage_form;
      if (!container.supported_forms.includes(form)) {
        throw new Error(`ERR_STORAGE_FORM_NOT_SUPPORTED:${container.container_id}:${form}`);
      }
      if (occupant.object.storage_footprint.unit !== 'slot_weight') {
        throw new Error(`ERR_STORAGE_FOOTPRINT_UNIT_UNSUPPORTED:${occupant.object.storage_footprint.unit}`);
      }
      const total = totals.get(container)!;
      total.refs.push(toStorageOccupantRef(occupant));
      total.used += occupant.object.storage_footprint.amount;
    }
    for (const container of save.storage_containers) {
      if (container.capacity.unit !== 'slot_weight') {
        throw new Error(`ERR_STORAGE_CAPACITY_UNIT_UNSUPPORTED:${container.container_id}:${container.capacity.unit}`);
      }
      if (totals.get(container)!.used > container.capacity.amount) {
        throw new Error(`ERR_STORAGE_CAPACITY_OVERFLOW:${container.container_id}`);
      }
    }
    return totals;
  }
}
