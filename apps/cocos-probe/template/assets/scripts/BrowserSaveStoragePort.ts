export const BROWSER_SAVE_SLOT_ID = 'web_probe';
export const BROWSER_SAVE_STORAGE_KEY = 'qinglan.simulation-game.cocos-probe.save.web_probe';

export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// The outer adapter passes opaque strings through the existing SaveStoragePort shape.
// Resolve storage per operation: a blocked getter must not prevent the fresh session from starting.
export class BrowserSaveStoragePort {
  constructor(private readonly storage: () => BrowserStorage = () => globalThis.localStorage) {}

  async read(slotId: string): Promise<string | null> {
    this.assertSlot(slotId);
    return this.storage().getItem(BROWSER_SAVE_STORAGE_KEY);
  }

  async write(slotId: string, serializedSave: string): Promise<void> {
    this.assertSlot(slotId);
    this.storage().setItem(BROWSER_SAVE_STORAGE_KEY, serializedSave);
  }

  private assertSlot(slotId: string): void {
    if (slotId !== BROWSER_SAVE_SLOT_ID) throw new Error(`ERR_SAVE_SLOT_ID_UNSUPPORTED:${slotId}`);
  }
}
