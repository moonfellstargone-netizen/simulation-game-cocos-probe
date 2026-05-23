import type { Quantity, SaveFile, StorageOccupantRef } from '../domain/types';
import { listStorageOccupants } from './StorageOccupant';

export interface StorageAuditIssue {
  code: string;
  container_id?: string;
  object_type?: string;
  object_id?: string;
  reservation_id?: string;
  expected?: number;
  actual?: number;
}

export interface StorageAuditReport {
  ok: boolean;
  issues: StorageAuditIssue[];
}

export class StorageAudit {
  audit(save: SaveFile): StorageAuditReport {
    const issues: StorageAuditIssue[] = [];
    const containers = new Map(save.storage_containers.map((container) => [container.container_id, container]));
    const liveOccupants = listStorageOccupants(save);
    const liveByKey = new Map(liveOccupants.map((item) => [this.keyOf({ object_type: item.object_type, object_id: item.object_id }), item]));
    const expectedRefsByContainer = new Map<string, StorageOccupantRef[]>();
    const expectedCapacityByContainer = new Map<string, number>();

    for (const occupant of liveOccupants) {
      const ref = { object_type: occupant.object_type, object_id: occupant.object_id };
      const container = containers.get(occupant.object.storage_ref.container_id);
      if (!container) {
        issues.push({ code: 'ERR_STORAGE_REF_CONTAINER_MISSING', object_type: ref.object_type, object_id: ref.object_id, container_id: occupant.object.storage_ref.container_id });
        continue;
      }
      const form = occupant.object_type === 'MaterialLot' ? occupant.object.current_form : occupant.object.storage_form;
      if (!container.supported_forms.includes(form)) {
        issues.push({ code: 'ERR_STORAGE_FORM_NOT_SUPPORTED', object_type: ref.object_type, object_id: ref.object_id, container_id: container.container_id });
      }
      const refs = expectedRefsByContainer.get(container.container_id) ?? [];
      refs.push(ref);
      expectedRefsByContainer.set(container.container_id, refs);
      expectedCapacityByContainer.set(container.container_id, (expectedCapacityByContainer.get(container.container_id) ?? 0) + occupant.object.storage_footprint.amount);
    }

    const seenRefKeys = new Set<string>();
    for (const container of save.storage_containers) {
      const expectedRefs = expectedRefsByContainer.get(container.container_id) ?? [];
      const expectedKeys = new Set(expectedRefs.map((ref) => this.keyOf(ref)));
      const actualKeys = new Set(container.active_object_refs.map((ref) => this.keyOf(ref)));
      for (const actualRef of container.active_object_refs) {
        const key = this.keyOf(actualRef);
        if (seenRefKeys.has(key)) {
          issues.push({ code: 'ERR_STORAGE_OBJECT_DUPLICATE_REF', container_id: container.container_id, object_type: actualRef.object_type, object_id: actualRef.object_id });
        }
        seenRefKeys.add(key);
        if (!liveByKey.has(key)) {
          issues.push({ code: 'ERR_STORAGE_GHOST_REF', container_id: container.container_id, object_type: actualRef.object_type, object_id: actualRef.object_id });
        }
        if (!expectedKeys.has(key)) {
          issues.push({ code: 'ERR_STORAGE_REF_IN_WRONG_CONTAINER', container_id: container.container_id, object_type: actualRef.object_type, object_id: actualRef.object_id });
        }
      }
      for (const expectedRef of expectedRefs) {
        const key = this.keyOf(expectedRef);
        if (!actualKeys.has(key)) {
          issues.push({ code: 'ERR_STORAGE_REF_MISSING_FROM_CONTAINER', container_id: container.container_id, object_type: expectedRef.object_type, object_id: expectedRef.object_id });
        }
      }
      const expectedCapacity = expectedCapacityByContainer.get(container.container_id) ?? 0;
      if (container.used_capacity !== expectedCapacity) {
        issues.push({ code: 'ERR_STORAGE_USED_CAPACITY_MISMATCH', container_id: container.container_id, expected: expectedCapacity, actual: container.used_capacity });
      }
      if (container.used_capacity > container.capacity.amount) {
        issues.push({ code: 'ERR_STORAGE_CAPACITY_OVERFLOW', container_id: container.container_id, expected: container.capacity.amount, actual: container.used_capacity });
      }
    }

    this.auditActiveReservations(save, liveByKey, issues);

    return { ok: issues.length === 0, issues };
  }

  assertReconciled(save: SaveFile): void {
    const report = this.audit(save);
    if (!report.ok) throw new Error(`ERR_STORAGE_AUDIT_FAILED:${JSON.stringify(report.issues)}`);
  }

  private auditActiveReservations(save: SaveFile, liveByKey: Map<string, unknown>, issues: StorageAuditIssue[]): void {
    const activeByTarget = new Map<string, { amount: number; unit: string; reservation_ids: string[] }>();
    const lotById = new Map(save.inventory.map((lot) => [lot.lot_id, lot]));
    for (const reservation of save.reservations) {
      if (reservation.status !== 'active') continue;
      const key = this.keyOf(reservation.target_ref);
      if (!liveByKey.has(key)) {
        issues.push({ code: 'ERR_RESERVATION_TARGET_MISSING', reservation_id: reservation.reservation_id, object_type: reservation.target_ref.object_type, object_id: reservation.target_ref.object_id });
        continue;
      }
      if (reservation.target_ref.object_type !== 'MaterialLot') {
        issues.push({ code: 'ERR_RESERVATION_TARGET_TYPE_UNSUPPORTED', reservation_id: reservation.reservation_id, object_type: reservation.target_ref.object_type, object_id: reservation.target_ref.object_id });
        continue;
      }
      const aggregate = activeByTarget.get(key) ?? { amount: 0, unit: reservation.quantity.unit, reservation_ids: [] };
      if (aggregate.unit !== reservation.quantity.unit) {
        issues.push({ code: 'ERR_RESERVATION_UNIT_MISMATCH', reservation_id: reservation.reservation_id, object_type: reservation.target_ref.object_type, object_id: reservation.target_ref.object_id });
        continue;
      }
      aggregate.amount += reservation.quantity.amount;
      aggregate.reservation_ids.push(reservation.reservation_id);
      activeByTarget.set(key, aggregate);
    }

    for (const [key, aggregate] of activeByTarget) {
      const [, objectId] = key.split(':');
      const lot = objectId ? lotById.get(objectId) : undefined;
      if (!lot) {
        issues.push({ code: 'ERR_RESERVATION_TARGET_MISSING', object_type: 'MaterialLot', object_id: objectId ?? key });
        continue;
      }
      if (lot.quantity.unit !== aggregate.unit) {
        issues.push({ code: 'ERR_RESERVATION_UNIT_MISMATCH', object_type: 'MaterialLot', object_id: lot.lot_id });
        continue;
      }
      if (aggregate.amount > lot.quantity.amount) {
        issues.push({ code: 'ERR_RESERVATION_QUANTITY_EXCEEDS_LOT', object_type: 'MaterialLot', object_id: lot.lot_id, expected: lot.quantity.amount, actual: aggregate.amount });
      }
    }
  }

  private keyOf(ref: StorageOccupantRef): string {
    return `${ref.object_type}:${ref.object_id}`;
  }
}
