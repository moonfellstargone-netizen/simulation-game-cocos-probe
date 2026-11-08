import type { SaveFile } from '../domain/types';
import { calculatePhysicalCapacity, type PhysicalOccupant, type PhysicalUnit, type PhysicalResult } from './PhysicalCapacity';
import type { PhysicalPolicyRegistry } from './PhysicalPolicyRegistry';
import type { StorageOccupant } from './StorageOccupant';

/** Both dimensions and the persisted policy must be present on every container, or absent everywhere. */
export function physicalPolicyId(save: SaveFile): string | null {
  const id = (save as SaveFile & { physical_capacity_policy_id?: unknown }).physical_capacity_policy_id;
  const physical = id !== undefined;
  if (physical && (typeof id !== 'string' || !id || id.trim() !== id)) throw new Error('ERR_PHYSICAL_POLICY_INVALID');
  for (const container of save.storage_containers) {
    const complete = container.capacity_limits !== undefined && container.used_capacity_limits !== undefined;
    const absent = container.capacity_limits === undefined && container.used_capacity_limits === undefined;
    if ((physical && !complete) || (!physical && !absent)) throw new Error('ERR_PHYSICAL_MODEL_MIXED');
  }
  return physical ? id as string : null;
}

export function calculateSavePhysicalCapacity(save: SaveFile, occupants: readonly StorageOccupant[], registry?: PhysicalPolicyRegistry,
  allowTemporaryIds = false): PhysicalResult | null {
  const id = physicalPolicyId(save);
  if (id === null) return null;
  if (!registry) throw new Error(`ERR_PHYSICAL_POLICY_MISSING:${id}`);
  const usedIds = new Set(occupants.map(item => JSON.stringify([item.object_type, item.object_id])));
  let serial = 0;
  const mapped: PhysicalOccupant[] = occupants.map(item => {
    let objectId = item.object_id;
    if (!objectId && allowTemporaryIds) {
      do { objectId = `__physical_preview_${++serial}`; } while (usedIds.has(JSON.stringify([item.object_type, objectId])));
      usedIds.add(JSON.stringify([item.object_type, objectId]));
    }
    const object = item.object;
    const definitionId = item.object_type === 'MaterialLot' ? item.object.base_id : item.object.recognized_dish_id;
    if (typeof definitionId !== 'string' || !definitionId) throw new Error('ERR_PHYSICAL_DEFINITION_MISSING');
    const quantity = item.object_type === 'MaterialLot' ? item.object.quantity : item.object.total_quantity;
    return { kind: item.object_type, id: objectId, definition_id: definitionId,
      form: item.object_type === 'MaterialLot' ? item.object.current_form : item.object.storage_form,
      quantity: { amount: quantity.amount, unit: quantity.unit as PhysicalUnit }, storage_ref: object.storage_ref };
  });
  return calculatePhysicalCapacity({ policy_id: id, policy: registry.resolve(id),
    containers: save.storage_containers.map(container => ({ id: container.container_id, location_id: container.location_id,
      storage_type: container.storage_type, supported_forms: container.supported_forms, limits: container.capacity_limits! })), occupants: mapped });
}
