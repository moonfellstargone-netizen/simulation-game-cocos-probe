import type { SaveFile, StorageContainer } from '../domain/types';
import { listStorageOccupants, toStorageOccupantRef } from './StorageOccupant';

export class StorageReconciler {
  reconcile(save: SaveFile): void {
    const containers = new Map(save.storage_containers.map((container) => [container.container_id, container]));
    for (const container of save.storage_containers) {
      container.active_object_refs = [];
      container.used_capacity = 0;
    }
    for (const occupant of listStorageOccupants(save)) {
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
      container.active_object_refs.push(toStorageOccupantRef(occupant));
      container.used_capacity += occupant.object.storage_footprint.amount;
    }
    for (const container of save.storage_containers) {
      if (container.capacity.unit !== 'slot_weight') {
        throw new Error(`ERR_STORAGE_CAPACITY_UNIT_UNSUPPORTED:${container.container_id}:${container.capacity.unit}`);
      }
      if (container.used_capacity > container.capacity.amount) {
        throw new Error(`ERR_STORAGE_CAPACITY_OVERFLOW:${container.container_id}`);
      }
    }
  }
}
