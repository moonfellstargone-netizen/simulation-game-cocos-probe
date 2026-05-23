import type { SaveFile, StorageOccupantRef, StorageRef } from '../domain/types';
import { StorageReconciler } from './StorageReconciler';

export class StorageSystem {
  constructor(private readonly reconciler: StorageReconciler) {}

  move(save: SaveFile, objectRef: StorageOccupantRef, target: StorageRef): void {
    const object = this.findOccupant(save, objectRef);
    const container = save.storage_containers.find((item) => item.container_id === target.container_id);
    if (!container) throw new Error(`ERR_STORAGE_CONTAINER_NOT_FOUND:${target.container_id}`);
    if (objectRef.object_type === 'MaterialLot') {
      if (!container.supported_forms.includes(object.current_form)) throw new Error('ERR_STORAGE_FORM_NOT_SUPPORTED');
      object.storage_ref = target;
    } else if (objectRef.object_type === 'DishLot') {
      if (!container.supported_forms.includes(object.storage_form)) throw new Error('ERR_STORAGE_FORM_NOT_SUPPORTED');
      object.storage_ref = target;
    } else {
      throw new Error(`ERR_STORAGE_OCCUPANT_TYPE_UNSUPPORTED:${objectRef.object_type}`);
    }
    this.reconciler.reconcile(save);
  }

  private findOccupant(save: SaveFile, objectRef: StorageOccupantRef): any {
    if (objectRef.object_type === 'MaterialLot') {
      const lot = save.inventory.find((item) => item.lot_id === objectRef.object_id);
      if (!lot) throw new Error(`ERR_MATERIAL_LOT_NOT_FOUND:${objectRef.object_id}`);
      return lot;
    }
    if (objectRef.object_type === 'DishLot') {
      const lot = save.dish_lots.find((item) => item.dish_lot_id === objectRef.object_id);
      if (!lot) throw new Error(`ERR_DISH_LOT_NOT_FOUND:${objectRef.object_id}`);
      return lot;
    }
    throw new Error(`ERR_STORAGE_OCCUPANT_TYPE_UNSUPPORTED:${objectRef.object_type}`);
  }
}
