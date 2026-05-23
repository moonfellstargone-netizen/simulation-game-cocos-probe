import type { CocosSessionHost } from '../CocosSessionHost';
import { CocosSceneBindingController, type CocosSceneBindingCommandResult, type CocosSceneBindingUpdate } from '../scene';
import { CocosUiShellController, type CocosUiShellCommand } from '../shell';
import { CocosComponentNodeBindingAdapter } from './CocosComponentNodeBindingAdapter';
import type { CocosComponentNodeBindingPort } from './CocosComponentNodeBindingPort';

export interface QinglanUiSceneProbeComponentOptions {
  readonly shell?: CocosUiShellController;
}

export class QinglanUiSceneProbeComponent {
  private readonly shell: CocosUiShellController;
  private readonly sceneBinding: CocosSceneBindingController;

  constructor(
    host: CocosSessionHost,
    nodeBindingPort: CocosComponentNodeBindingPort,
    options: QinglanUiSceneProbeComponentOptions = {}
  ) {
    this.shell = options.shell ?? new CocosUiShellController(host);
    this.sceneBinding = CocosSceneBindingController.fromShell(this.shell, new CocosComponentNodeBindingAdapter(nodeBindingPort));
  }

  async mount(): Promise<CocosSceneBindingCommandResult> {
    return await this.sceneBinding.execute({ name: 'create_session' });
  }

  async refresh(): Promise<CocosSceneBindingCommandResult> {
    return await this.sceneBinding.execute({ name: 'refresh' });
  }

  async execute(command: CocosUiShellCommand): Promise<CocosSceneBindingCommandResult> {
    return await this.sceneBinding.execute(command);
  }

  async applyInitialSnapshot(): Promise<CocosSceneBindingUpdate[]> {
    return await this.sceneBinding.applyInitialSnapshot();
  }

  async unmount(): Promise<CocosSceneBindingCommandResult> {
    return await this.sceneBinding.execute({ name: 'destroy_session' });
  }
}
