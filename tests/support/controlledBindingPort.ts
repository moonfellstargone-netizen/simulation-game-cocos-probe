export interface BindingGate {
  readonly entered: Promise<void>;
  resume(): void;
  reject(error: Error): void;
}

interface PendingBinding<T> {
  readonly section: T | undefined;
  readonly entered: () => void;
  readonly completion: Promise<void>;
}

// Test-only controls pause before a section is applied; no elapsed-time assumptions.
export class ControlledBindingPort<T extends { section: string }> {
  private readonly pending: PendingBinding<T['section']>[] = [];
  private readonly applied: T[] = [];
  private readonly current = new Map<T['section'], T>();

  pauseNext(section?: T['section']): BindingGate {
    let entered!: () => void;
    let resume!: () => void;
    let reject!: (error: Error) => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const completion = new Promise<void>((resolve, rejectPromise) => {
      resume = resolve;
      reject = rejectPromise;
    });
    this.pending.push({ section, entered, completion });
    return { entered: enteredPromise, resume, reject };
  }

  async apply(update: T): Promise<void> {
    const index = this.pending.findIndex((control) => control.section === undefined || control.section === update.section);
    if (index !== -1) {
      const [control] = this.pending.splice(index, 1);
      control!.entered();
      await control!.completion;
    }
    const copy = structuredClone(update);
    this.applied.push(copy);
    this.current.set(copy.section, copy);
  }

  recordedUpdates(): T[] {
    return structuredClone(this.applied);
  }

  latest(section: T['section']): T | undefined {
    const value = this.current.get(section);
    return value === undefined ? undefined : structuredClone(value);
  }

  clearHistory(): void {
    this.applied.length = 0;
  }
}

// Flush already scheduled promise jobs while a manual gate remains closed.
export async function settleBindingTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
