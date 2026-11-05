export interface PriorValidationStorage {
  read(slotId: string): Promise<string | null>;
  write(slotId: string, serialized: string): Promise<void>;
}

export interface PriorValidationHost {
  requireSession(): { load(slotId: string): Promise<unknown> };
  destroySession(): void;
}

const VALIDATION_SLOT = 'wechat_prior_validation';

// A separate public host owns the validation session. It never writes to platform storage.
export function createWechatPriorSaveValidator(
  createHost: (storage: PriorValidationStorage) => PriorValidationHost
): (serialized: string) => Promise<void> {
  return async (serialized: string): Promise<void> => {
    if (typeof serialized !== 'string') throw new Error('ERR_WECHAT_SAVE_NOT_STRING');
    const storage: PriorValidationStorage = {
      read: async slotId => slotId === VALIDATION_SLOT ? serialized : null,
      write: async () => { throw new Error('ERR_WECHAT_PRIOR_VALIDATION_WRITE_FORBIDDEN'); }
    };
    const host = createHost(storage);
    try {
      await host.requireSession().load(VALIDATION_SLOT);
    } finally {
      host.destroySession();
    }
  };
}
