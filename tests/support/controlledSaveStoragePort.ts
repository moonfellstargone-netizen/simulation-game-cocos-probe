import { InMemorySaveStoragePort, type SaveStoragePort } from '../../src/game-core';

type StorageOperation = 'read' | 'write';

interface DeferredOperation {
  enter(): void;
  outcome: Promise<Error | null>;
}

export interface PendingStorageOperation {
  entered: Promise<void>;
  resume(): void;
  reject(error: Error): void;
}

// Failures happen before delegating to memory; this makes no durability claim for real storage.
export class ControlledSaveStoragePort implements SaveStoragePort {
  readonly operations: string[] = [];
  private readonly memory = new InMemorySaveStoragePort();
  private readonly deferred: Partial<Record<StorageOperation, DeferredOperation>> = {};

  failNext(operation: StorageOperation, error: Error): void {
    this.deferNext(operation).reject(error);
  }

  deferNext(operation: StorageOperation): PendingStorageOperation {
    if (this.deferred[operation]) throw new Error(`A ${operation} operation is already deferred`);
    let enter!: () => void;
    let finish!: (error: Error | null) => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const outcome = new Promise<Error | null>((resolve) => { finish = resolve; });
    this.deferred[operation] = { enter, outcome };
    return { entered, resume: () => finish(null), reject: (error) => finish(error) };
  }

  async write(slotId: string, serializedSave: string): Promise<void> {
    this.operations.push(`write:${slotId}`);
    await this.before('write');
    await this.memory.write(slotId, serializedSave);
  }

  async read(slotId: string): Promise<string | null> {
    this.operations.push(`read:${slotId}`);
    await this.before('read');
    return await this.memory.read(slotId);
  }

  private async before(operation: StorageOperation): Promise<void> {
    const deferred = this.deferred[operation];
    if (!deferred) return;
    delete this.deferred[operation];
    deferred.enter();
    const error = await deferred.outcome;
    if (error) throw error;
  }
}

export async function captureSerializedSession(
  session: { save(slotId: string): Promise<unknown> },
  storage: SaveStoragePort,
  slotId: string
): Promise<string> {
  await session.save(slotId);
  const serialized = await storage.read(slotId);
  if (serialized === null) throw new Error(`Healthy session capture did not write ${slotId}`);
  return serialized;
}
