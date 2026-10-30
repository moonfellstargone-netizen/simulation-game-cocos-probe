import type { CocosUiShellCommand, CocosUiShellCommandExecutionResult } from '../shell';
import { CocosUiShellCommandQueue, CocosUiShellController, diffCocosUiShellSnapshots, type CocosUiShellSnapshotDiff } from '../shell';
import type { CocosSceneBindingPort, CocosSceneBindingUpdate } from './CocosSceneBindingPort';
import { CocosSceneBindingSnapshotApplier } from './CocosSceneBindingSnapshotApplier';

export interface CocosSceneBindingCommandResult {
  readonly command_result: CocosUiShellCommandExecutionResult;
  readonly diff: CocosUiShellSnapshotDiff;
  readonly applied_updates: CocosSceneBindingUpdate[];
}

export class CocosSceneBindingController {
  private tail: Promise<void> = Promise.resolve();
  private needsResync = false;

  constructor(
    private readonly shell: CocosUiShellController,
    private readonly queue: CocosUiShellCommandQueue,
    private readonly port: CocosSceneBindingPort,
    private readonly applier: CocosSceneBindingSnapshotApplier = new CocosSceneBindingSnapshotApplier()
  ) {}

  static fromShell(shell: CocosUiShellController, port: CocosSceneBindingPort): CocosSceneBindingController {
    return new CocosSceneBindingController(shell, new CocosUiShellCommandQueue(shell), port);
  }

  async execute(command: CocosUiShellCommand): Promise<CocosSceneBindingCommandResult> {
    return await this.schedule(async () => {
      const before = this.shell.currentSnapshot();
      const commandResult = await this.queue.execute(command);
      const diff = diffCocosUiShellSnapshots(before, commandResult.snapshot);
      const updates = this.applier.createUpdates({
        before: this.needsResync ? null : before,
        after: commandResult.snapshot,
        diff
      });
      await this.applyUpdates(updates);
      return {
        command_result: commandResult,
        diff,
        applied_updates: structuredClone(updates)
      };
    });
  }

  async applyInitialSnapshot(): Promise<CocosSceneBindingUpdate[]> {
    return await this.schedule(async () => {
      const snapshot = this.shell.currentSnapshot();
      const updates = this.applier.createUpdates({ before: null, after: snapshot, diff: null });
      await this.applyUpdates(updates);
      return structuredClone(updates);
    });
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.tail.then(operation, operation);
    this.tail = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  private async applyUpdates(updates: CocosSceneBindingUpdate[]): Promise<void> {
    // A rejected batch may already have applied some sections; the next batch must resync all.
    this.needsResync = true;
    for (const update of updates) {
      await this.port.applySceneBindingUpdate(update);
    }
    this.needsResync = false;
  }
}
