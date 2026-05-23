import type { ActionResult, Quantity, StorageOccupantRef, StorageRef } from '../../game-core';
import type { CocosActionSessionPort } from '../runtime/CocosAppRuntimeSession';

export class InventoryMenuController {
  constructor(private readonly session: CocosActionSessionPort) {}

  requestMove(objectRef: StorageOccupantRef, storageRef: StorageRef): ActionResult {
    return this.session.dispatch('store_item', {
      object_ref: objectRef,
      storage_ref: storageRef
    });
  }

  requestSplit(sourceLotId: string, quantity: Quantity): ActionResult {
    return this.session.dispatch('split_lot', {
      source_lot_id: sourceLotId,
      quantity
    });
  }
}
