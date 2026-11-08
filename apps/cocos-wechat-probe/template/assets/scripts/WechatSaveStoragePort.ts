export const WECHAT_SAVE_SLOT_ID = 'wechat_probe';
export const WECHAT_BACKUP_SLOT_ID = 'wechat_probe_backup';
export const WECHAT_SAVE_STORAGE_KEY = 'qinglan.simulation-game.cocos-wechat-probe.save.wechat_probe';
export const WECHAT_SAVE_BACKUP_KEY = 'qinglan.simulation-game.cocos-wechat-probe.save.wechat_probe.backup';
export const WECHAT_SAVE_TRANSACTION_KEY = 'qinglan.simulation-game.cocos-wechat-probe.save.wechat_probe.transaction';
const FIRST_SAVE_MARKER = 'wechat-save-first/v1';
const PRIOR_SAVE_MARKER = 'wechat-save-with-prior/v1';

/** A validated platform storage object, acquired only when the player requests an operation. */
export interface WechatPlatformStorage {
  readonly length: number;
  key(index: number): string | null | undefined;
  getItem(key: string): unknown;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class WechatSaveStoragePort {
  private commitUncertain = false;
  private firstCancelMainDeletionVerified = false;
  private firstCancelMainDeletionStorage: WechatPlatformStorage | null = null;
  private firstCancelWitness: { storage: WechatPlatformStorage; value: string | null } | null = null;
  private firstSaveUncertain: { storage: WechatPlatformStorage; value: string; deletionAttempted: boolean } | null = null;
  private priorSaveUncertain: { storage: WechatPlatformStorage; backup: string } | null = null;
  private lastBackupRead: string | null = null;

  constructor(private readonly storage: () => WechatPlatformStorage,
    private readonly validatePrior: (serialized: string) => Promise<void>) {}

  async read(slotId: string): Promise<string | null> {
    if (slotId === WECHAT_BACKUP_SLOT_ID) {
      this.lastBackupRead = null;
      const backup = this.readFrom(this.storage(), WECHAT_SAVE_BACKUP_KEY);
      this.lastBackupRead = backup;
      return backup;
    }
    this.assertSlot(slotId);
    try {
      const storage = this.storage();
      this.assertNoPendingRecovery(storage);
      return this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY);
    } catch (error) {
      // A platform failure must not impersonate the Session's null-slot error.
      const message = error instanceof Error ? error.message : String(error);
      if (message === `ERR_SAVE_SLOT_NOT_FOUND:${WECHAT_SAVE_SLOT_ID}`) throw new Error('ERR_WECHAT_STORAGE_READ_FAILED');
      throw error;
    }
  }

  async readBackup(slotId: string): Promise<string | null> {
    this.assertSlot(slotId);
    return this.read(WECHAT_BACKUP_SLOT_ID);
  }

  async assertBackupRecoveryAvailable(): Promise<void> {
    const storage = this.storage();
    const marker = this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY);
    const backup = this.readFrom(storage, WECHAT_SAVE_BACKUP_KEY);
    this.assertBackupMarker(storage, marker, backup);
  }

  async write(slotId: string, serializedSave: string): Promise<void> {
    this.assertSlot(slotId);
    if (typeof serializedSave !== 'string') throw new Error('ERR_WECHAT_SAVE_NOT_STRING');
    const storage = this.storage();
    this.assertNoPendingRecovery(storage);
    // Fail before writing if storage cannot be enumerated or an existing value cannot be read.
    const oldSave = this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY);
    if (oldSave === null && this.readFrom(storage, WECHAT_SAVE_BACKUP_KEY) !== null) {
      throw new Error('ERR_WECHAT_SAVE_BACKUP_CONFLICT');
    }
    if (oldSave !== null) {
      await this.validatePrior(oldSave);
      this.assertNoPendingRecovery(storage);
      if (this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY) !== oldSave) throw new Error('ERR_WECHAT_SAVE_PRIOR_CHANGED');
      this.writeAndVerify(storage, WECHAT_SAVE_BACKUP_KEY, oldSave);
    }
    this.writeAndVerify(storage, WECHAT_SAVE_TRANSACTION_KEY, oldSave === null ? FIRST_SAVE_MARKER : PRIOR_SAVE_MARKER);
    this.writeAndVerify(storage, WECHAT_SAVE_STORAGE_KEY, serializedSave);
    if (oldSave === null) this.firstSaveUncertain = { storage, value: serializedSave, deletionAttempted: false };
    else this.priorSaveUncertain = { storage, backup: oldSave };
    this.clearMarker(storage);
  }

  // Call only after the same backup bytes have been accepted by the public Session load path.
  private async finishBackupRecovery(expectedBackup: string, storage: WechatPlatformStorage): Promise<void> {
    if (typeof expectedBackup !== 'string') throw new Error('ERR_WECHAT_SAVE_NOT_STRING');
    const marker = this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY);
    const backup = this.readFrom(storage, WECHAT_SAVE_BACKUP_KEY);
    this.assertBackupMarker(storage, marker, backup);
    if (backup !== expectedBackup) throw new Error('ERR_WECHAT_SAVE_BACKUP_CHANGED');
    if (marker === null) this.writeAndVerify(storage, WECHAT_SAVE_TRANSACTION_KEY, PRIOR_SAVE_MARKER);
    this.writeAndVerify(storage, WECHAT_SAVE_STORAGE_KEY, backup);
    this.priorSaveUncertain = { storage, backup };
    this.clearMarker(storage);
  }

  // The caller must first verify that the public Session load of the backup completed successfully.
  async finishBackupRecoveryAfterValidatedRead(): Promise<void> {
    const backup = this.lastBackupRead;
    this.lastBackupRead = null;
    if (backup === null) throw new Error('ERR_WECHAT_SAVE_BACKUP_READ_REQUIRED');
    const storage = this.storage();
    const marker = this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY);
    const before = this.readFrom(storage, WECHAT_SAVE_BACKUP_KEY);
    this.assertBackupMarker(storage, marker, before);
    if (before !== backup) throw new Error('ERR_WECHAT_SAVE_BACKUP_CHANGED');
    await this.validatePrior(backup);
    if (this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY) !== marker) throw new Error('ERR_WECHAT_SAVE_MARKER_CHANGED');
    if (this.readFrom(storage, WECHAT_SAVE_BACKUP_KEY) !== backup) throw new Error('ERR_WECHAT_SAVE_BACKUP_CHANGED');
    await this.finishBackupRecovery(backup, storage);
  }

  private assertBackupMarker(storage: WechatPlatformStorage, marker: string | null, backup: string | null): void {
    if (marker !== null && marker !== PRIOR_SAVE_MARKER) throw new Error('ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED');
    if (marker === null && !this.commitUncertain) throw new Error('ERR_WECHAT_SAVE_RECOVERY_NOT_PENDING');
    if (backup === null) throw new Error('ERR_WECHAT_SAVE_BACKUP_MISSING');
    if (marker === null && (!this.priorSaveUncertain || this.priorSaveUncertain.storage !== storage || this.priorSaveUncertain.backup !== backup)) {
      throw new Error('ERR_WECHAT_SAVE_RECOVERY_NOT_ALLOWED');
    }
  }

  async assertFirstFailedSaveCancelable(): Promise<void> {
    const storage = this.storage();
    this.assertFirstWitnessIntegrity(storage);
    this.assertFirstCancelWitness(storage);
    this.assertFirstCancelStorage(storage);
    if (this.firstCancelMainDeletionVerified) this.assertFirstCancelRetry(storage);
    else if (this.firstSaveUncertain && !this.firstSaveUncertain.deletionAttempted) this.assertFirstSaveWitness(storage);
    else this.assertFirstCancelable(storage);
  }

  // Explicit user action only: this discards a possibly partial first save, with no prior backup.
  async cancelFirstFailedSave(): Promise<void> {
    const storage = this.storage();
    this.assertFirstWitnessIntegrity(storage);
    this.assertFirstCancelWitness(storage);
    this.assertFirstCancelStorage(storage);
    if (this.firstCancelMainDeletionVerified) {
      const marker = this.assertFirstCancelRetry(storage);
      if (marker === null) {
        this.commitUncertain = false;
        this.firstCancelMainDeletionVerified = false;
        this.firstCancelMainDeletionStorage = null;
        this.firstCancelWitness = null;
        this.firstSaveUncertain = null;
      } else {
        this.clearMarker(storage);
      }
      return;
    }
    if (this.firstSaveUncertain && !this.firstSaveUncertain.deletionAttempted) {
      const marker = this.assertFirstSaveWitness(storage);
      if (marker === null) {
        try {
          this.writeAndVerify(storage, WECHAT_SAVE_TRANSACTION_KEY, FIRST_SAVE_MARKER);
        } catch (error) {
          this.commitUncertain = true;
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`ERR_WECHAT_SAVE_COMMIT_UNCERTAIN:${message}`);
        }
        this.assertFirstSaveWitness(storage);
      }
    } else {
      this.assertFirstCancelable(storage);
    }
    try {
      if (!this.firstCancelWitness) this.firstCancelWitness = { storage, value: this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY) };
      if (this.firstSaveUncertain) this.firstSaveUncertain.deletionAttempted = true;
      storage.removeItem(WECHAT_SAVE_STORAGE_KEY);
      if (this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY) !== null) throw new Error('main still present');
    } catch (error) {
      this.commitUncertain = true;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ERR_WECHAT_SAVE_COMMIT_UNCERTAIN:${message}`);
    }
    try {
      this.assertFirstCancelable(storage);
    } catch (error) {
      this.commitUncertain = true;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ERR_WECHAT_SAVE_COMMIT_UNCERTAIN:${message}`);
    }
    this.firstCancelMainDeletionVerified = true;
    this.firstCancelMainDeletionStorage = storage;
    this.clearMarker(storage);
  }

  private assertFirstCancelWitness(storage: WechatPlatformStorage): void {
    const witness = this.firstCancelWitness;
    if (!witness) return;
    if (witness.storage !== storage) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    const current = this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY);
    if (current !== null && current !== witness.value) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
  }

  private assertFirstCancelStorage(storage: WechatPlatformStorage): void {
    if (this.firstCancelMainDeletionVerified && this.firstCancelMainDeletionStorage !== storage) {
      throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    }
  }

  private assertFirstWitnessIntegrity(storage: WechatPlatformStorage): void {
    const witness = this.firstSaveUncertain;
    if (!witness) return;
    if (witness.storage !== storage) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    const current = this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY);
    if (current !== null && current !== witness.value) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
  }

  private assertFirstSaveWitness(storage: WechatPlatformStorage): string | null {
    const witness = this.firstSaveUncertain;
    if (!this.commitUncertain || !witness || witness.storage !== storage) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    const marker = this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY);
    if (marker !== null && marker !== FIRST_SAVE_MARKER) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    if (this.readFrom(storage, WECHAT_SAVE_BACKUP_KEY) !== null) throw new Error('ERR_WECHAT_SAVE_BACKUP_CONFLICT');
    if (this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY) !== witness.value) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    return marker;
  }

  private assertFirstCancelRetry(storage: WechatPlatformStorage): string | null {
    const marker = this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY);
    if (marker !== null && marker !== FIRST_SAVE_MARKER) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    if (this.readFrom(storage, WECHAT_SAVE_BACKUP_KEY) !== null) throw new Error('ERR_WECHAT_SAVE_BACKUP_CONFLICT');
    if (this.readFrom(storage, WECHAT_SAVE_STORAGE_KEY) !== null) throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    return marker;
  }

  private assertFirstCancelable(storage: WechatPlatformStorage): void {
    if (this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY) !== FIRST_SAVE_MARKER) {
      throw new Error('ERR_WECHAT_SAVE_FIRST_CANCEL_NOT_ALLOWED');
    }
    if (this.readFrom(storage, WECHAT_SAVE_BACKUP_KEY) !== null) throw new Error('ERR_WECHAT_SAVE_BACKUP_CONFLICT');
  }

  private assertNoPendingRecovery(storage: WechatPlatformStorage): void {
    if (this.commitUncertain || this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY) !== null) {
      throw new Error('ERR_WECHAT_SAVE_RECOVERY_REQUIRED');
    }
  }

  private clearMarker(storage: WechatPlatformStorage): void {
    try {
      storage.removeItem(WECHAT_SAVE_TRANSACTION_KEY);
      if (this.readFrom(storage, WECHAT_SAVE_TRANSACTION_KEY) !== null) throw new Error('marker still present');
      this.commitUncertain = false;
      this.firstCancelMainDeletionVerified = false;
      this.firstCancelMainDeletionStorage = null;
      this.firstCancelWitness = null;
      this.firstSaveUncertain = null;
      this.priorSaveUncertain = null;
    } catch (error) {
      this.commitUncertain = true;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`ERR_WECHAT_SAVE_COMMIT_UNCERTAIN:${message}`);
    }
  }

  private writeAndVerify(storage: WechatPlatformStorage, key: string, value: string): void {
    storage.setItem(key, value);
    if (this.readFrom(storage, key) !== value) throw new Error('ERR_WECHAT_SAVE_VERIFY_FAILED');
  }

  private readFrom(storage: WechatPlatformStorage, targetKey: string): string | null {
    const length = storage.length;
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('ERR_WECHAT_STORAGE_ENUM_INVALID');
    let found = false;
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (typeof key !== 'string') throw new Error('ERR_WECHAT_STORAGE_ENUM_INVALID');
      if (key === targetKey) found = true;
    }
    if (!found) return null;
    const value = storage.getItem(targetKey);
    if (typeof value !== 'string') throw new Error('ERR_WECHAT_SAVE_NOT_STRING');
    return value;
  }

  private assertSlot(slotId: string): void {
    if (slotId !== WECHAT_SAVE_SLOT_ID) throw new Error(`ERR_SAVE_SLOT_ID_UNSUPPORTED:${slotId}`);
  }
}
