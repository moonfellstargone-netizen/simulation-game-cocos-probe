export interface SaveStoragePort {
  write(slotId: string, serializedSave: string): Promise<void>;
  read(slotId: string): Promise<string | null>;
  delete?(slotId: string): Promise<void>;
}

export interface SaveSlotWriteSummary {
  slot_id: string;
  byte_length: number;
}

export class InMemorySaveStoragePort implements SaveStoragePort {
  private readonly slots = new Map<string, string>();

  async write(slotId: string, serializedSave: string): Promise<void> {
    this.assertSlotId(slotId);
    this.slots.set(slotId, serializedSave);
  }

  async read(slotId: string): Promise<string | null> {
    this.assertSlotId(slotId);
    return this.slots.get(slotId) ?? null;
  }

  async delete(slotId: string): Promise<void> {
    this.assertSlotId(slotId);
    this.slots.delete(slotId);
  }

  snapshot(): ReadonlyMap<string, string> {
    return new Map(this.slots);
  }

  private assertSlotId(slotId: string): void {
    if (!slotId.trim()) throw new Error('ERR_SAVE_SLOT_ID_REQUIRED');
  }
}
