export interface SaveSlotSelection {
  slot_id: string;
}

export class SaveSlotBinding {
  buildSlot(selection: SaveSlotSelection): string {
    const slotId = selection.slot_id.trim();
    if (slotId.length === 0) throw new Error('ERR_SAVE_SLOT_ID_REQUIRED');
    if (!/^[a-zA-Z0-9_.:-]+$/.test(slotId)) throw new Error('ERR_SAVE_SLOT_ID_UNSUPPORTED');
    return slotId;
  }
}
