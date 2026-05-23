import type { Quantity, Reservation, SaveFile } from '../domain/types';
import { QuantityService } from '../shared/quantity';

export class ReservationGuard {
  private readonly quantity = new QuantityService();

  activeReservationsForLot(save: SaveFile, lotId: string): Reservation[] {
    return save.reservations.filter((reservation) =>
      reservation.status === 'active' &&
      reservation.target_ref.object_type === 'MaterialLot' &&
      reservation.target_ref.object_id === lotId
    );
  }

  activeReservedQuantityForLot(save: SaveFile, lotId: string, unit: string): Quantity {
    const reservations = this.activeReservationsForLot(save, lotId);
    return reservations.reduce<Quantity>((total, reservation) => {
      if (reservation.quantity.unit !== unit) throw new Error('ERR_RESERVATION_UNIT_MISMATCH');
      return this.quantity.add(total, reservation.quantity);
    }, { amount: 0, unit });
  }

  assertNoActiveReservationForConsumption(save: SaveFile, lotId: string, requested: Quantity): void {
    const lot = save.inventory.find((item) => item.lot_id === lotId);
    if (!lot) throw new Error(`ERR_MATERIAL_LOT_NOT_FOUND:${lotId}`);
    const activeReserved = this.activeReservedQuantityForLot(save, lotId, requested.unit);
    if (activeReserved.amount > 0 && requested.amount > 0) throw new Error('ERR_ALREADY_RESERVED');
  }

  assertReservationIntegrity(save: SaveFile): void {
    for (const reservation of save.reservations) {
      if (reservation.status !== 'active') continue;
      if (reservation.target_ref.object_type !== 'MaterialLot') throw new Error(`ERR_RESERVATION_TARGET_TYPE_UNSUPPORTED:${reservation.target_ref.object_type}`);
      const lot = save.inventory.find((item) => item.lot_id === reservation.target_ref.object_id);
      if (!lot) throw new Error(`ERR_RESERVATION_TARGET_MISSING:${reservation.reservation_id}:${reservation.target_ref.object_id}`);
      if (reservation.quantity.unit !== lot.quantity.unit) throw new Error(`ERR_RESERVATION_UNIT_MISMATCH:${reservation.reservation_id}`);
      const total = this.activeReservedQuantityForLot(save, lot.lot_id, lot.quantity.unit);
      if (total.amount > lot.quantity.amount) throw new Error(`ERR_RESERVATION_QUANTITY_EXCEEDS_LOT:${lot.lot_id}`);
    }
  }

}
