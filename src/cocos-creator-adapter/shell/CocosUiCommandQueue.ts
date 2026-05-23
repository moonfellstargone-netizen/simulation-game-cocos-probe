import type { MenuActionSelection } from '../menu';
import type { SaveSlotSelection } from '../save';
import type { CocosUiShellController } from './CocosUiShellController';
import type { CocosUiShellRenderSnapshot } from './CocosUiShellRenderSnapshot';

export type CocosUiShellCommandName =
  | 'create_session'
  | 'destroy_session'
  | 'refresh'
  | 'menu_preview'
  | 'menu_confirm'
  | 'save'
  | 'load';

export type CocosUiShellCommand =
  | { name: 'create_session' }
  | { name: 'destroy_session' }
  | { name: 'refresh' }
  | { name: 'menu_preview'; selection: MenuActionSelection }
  | { name: 'menu_confirm'; selection: MenuActionSelection }
  | { name: 'save'; selection: SaveSlotSelection }
  | { name: 'load'; selection: SaveSlotSelection };

export type CocosUiShellCommandStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface CocosUiShellCommandExecutionResult {
  command_name: CocosUiShellCommandName;
  status: Exclude<CocosUiShellCommandStatus, 'idle' | 'running'>;
  snapshot: CocosUiShellRenderSnapshot;
  error_message: string | null;
}

export class CocosUiShellCommandQueue {
  private tail: Promise<void> = Promise.resolve();
  private currentStatus: CocosUiShellCommandStatus = 'idle';
  private lastResult: CocosUiShellCommandExecutionResult | null = null;

  constructor(private readonly controller: CocosUiShellController) {}

  status(): CocosUiShellCommandStatus {
    return this.currentStatus;
  }

  lastExecutionResult(): CocosUiShellCommandExecutionResult | null {
    return this.lastResult === null ? null : structuredClone(this.lastResult);
  }

  enqueue(command: CocosUiShellCommand): Promise<CocosUiShellCommandExecutionResult> {
    const run = async () => await this.runCommand(command);
    const scheduled = this.tail.then(run, run);
    this.tail = scheduled.then(
      () => undefined,
      () => undefined
    );
    return scheduled;
  }

  async execute(command: CocosUiShellCommand): Promise<CocosUiShellCommandExecutionResult> {
    return await this.enqueue(command);
  }

  private async runCommand(command: CocosUiShellCommand): Promise<CocosUiShellCommandExecutionResult> {
    this.currentStatus = 'running';
    let snapshot: CocosUiShellRenderSnapshot;
    try {
      snapshot = await this.invokeController(command);
    } catch (error) {
      snapshot = this.controller.currentSnapshot();
      const result = this.finish(command.name, 'failed', snapshot, error instanceof Error ? error.message : String(error));
      return result;
    }

    const errorMessage = firstSnapshotErrorMessage(snapshot);
    const result = this.finish(command.name, errorMessage === null ? 'completed' : 'failed', snapshot, errorMessage);
    return result;
  }

  private finish(
    commandName: CocosUiShellCommandName,
    status: Exclude<CocosUiShellCommandStatus, 'idle' | 'running'>,
    snapshot: CocosUiShellRenderSnapshot,
    errorMessage: string | null
  ): CocosUiShellCommandExecutionResult {
    this.currentStatus = status;
    const result: CocosUiShellCommandExecutionResult = {
      command_name: commandName,
      status,
      snapshot,
      error_message: errorMessage
    };
    this.lastResult = structuredClone(result);
    return result;
  }

  private async invokeController(command: CocosUiShellCommand): Promise<CocosUiShellRenderSnapshot> {
    switch (command.name) {
      case 'create_session':
        return this.controller.createSession();
      case 'destroy_session':
        return this.controller.destroySession();
      case 'refresh':
        return this.controller.refresh();
      case 'menu_preview':
        return this.controller.previewMenu(command.selection);
      case 'menu_confirm':
        return this.controller.confirmMenu(command.selection);
      case 'save':
        return await this.controller.save(command.selection);
      case 'load':
        return await this.controller.load(command.selection);
    }
  }
}

function firstSnapshotErrorMessage(snapshot: CocosUiShellRenderSnapshot): string | null {
  const shellError = snapshot.errors[0]?.message;
  if (shellError) return shellError;
  const menuError = snapshot.menu.errors[0]?.message;
  if (menuError) return menuError;
  const saveLoadError = snapshot.save_load.errors[0]?.message;
  if (saveLoadError) return saveLoadError;
  return null;
}
