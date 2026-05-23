import type { DishLot, MaterialLot, Quantity, SaveFile, StorageOccupantRef, StorageRef } from '../domain/types';

export type StorageOccupant =
  | { object_type: 'MaterialLot'; object_id: string; object: MaterialLot }
  | { object_type: 'DishLot'; object_id: string; object: DishLot };

export interface StorageOccupantAdapter<TObject> {
  object_type: 'MaterialLot' | 'DishLot';
  idOf(object: TObject): string;
  storageRefOf(object: TObject): StorageRef;
  setStorageRef(object: TObject, storageRef: StorageRef): void;
  storageFootprintOf(object: TObject): Quantity;
  storageFormOf(object: TObject): string;
}

export const materialLotAdapter: StorageOccupantAdapter<MaterialLot> = {
  object_type: 'MaterialLot',
  idOf: (object) => object.lot_id,
  storageRefOf: (object) => object.storage_ref,
  setStorageRef: (object, storageRef) => { object.storage_ref = storageRef; },
  storageFootprintOf: (object) => object.storage_footprint,
  storageFormOf: (object) => object.current_form
};

export const dishLotAdapter: StorageOccupantAdapter<DishLot> = {
  object_type: 'DishLot',
  idOf: (object) => object.dish_lot_id,
  storageRefOf: (object) => object.storage_ref,
  setStorageRef: (object, storageRef) => { object.storage_ref = storageRef; },
  storageFootprintOf: (object) => object.storage_footprint,
  storageFormOf: (object) => object.storage_form
};

export function listStorageOccupants(save: SaveFile): StorageOccupant[] {
  return [
    ...save.inventory.map((object) => ({ object_type: 'MaterialLot' as const, object_id: object.lot_id, object })),
    ...save.dish_lots.map((object) => ({ object_type: 'DishLot' as const, object_id: object.dish_lot_id, object }))
  ];
}

export function toStorageOccupantRef(occupant: StorageOccupant): StorageOccupantRef {
  return { object_type: occupant.object_type, object_id: occupant.object_id };
}
