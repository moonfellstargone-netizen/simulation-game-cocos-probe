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
    const before = this.shell.currentSnapshot();
    const commandResult = await this.queue.execute(command);
    const diff = diffCocosUiShellSnapshots(before, commandResult.snapshot);
    const updates = this.applier.createUpdates({ before, after: commandResult.snapshot, diff });
    for (const update of updates) {
      await this.port.applySceneBindingUpdate(update);
    }
    return {
      command_result: commandResult,
      diff,
      applied_updates: structuredClone(updates)
    };
  }

  async applyInitialSnapshot(): Promise<CocosSceneBindingUpdate[]> {
    const snapshot = this.shell.currentSnapshot();
    const updates = this.applier.createUpdates({ before: null, after: snapshot, diff: null });
    for (const update of updates) {
      await this.port.applySceneBindingUpdate(update);
    }
    return structuredClone(updates);
  }
}
