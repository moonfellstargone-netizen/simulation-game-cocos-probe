import type { CocosUiShellOperation, CocosUiShellRenderSnapshot } from '../shell';

export type CocosSceneBindingSection = 'lifecycle' | 'menu' | 'save_load' | 'errors';

export type CocosSceneBindingUpdateReason = 'initial_render' | 'changed_section';

export type CocosSceneBindingSectionSnapshot<S extends CocosSceneBindingSection = CocosSceneBindingSection> =
  S extends 'lifecycle'
    ? CocosUiShellRenderSnapshot['lifecycle']
    : S extends 'menu'
      ? CocosUiShellRenderSnapshot['menu']
      : S extends 'save_load'
        ? CocosUiShellRenderSnapshot['save_load']
        : CocosUiShellRenderSnapshot['errors'];

export interface CocosSceneBindingUpdate<S extends CocosSceneBindingSection = CocosSceneBindingSection> {
  readonly sequence: number;
  readonly section: S;
  readonly reason: CocosSceneBindingUpdateReason;
  readonly operation: CocosUiShellOperation | null;
  readonly snapshot: CocosSceneBindingSectionSnapshot<S>;
}

export interface CocosSceneBindingPort {
  applySceneBindingUpdate(update: CocosSceneBindingUpdate): void | Promise<void>;
}

export class RecordingCocosSceneBindingPort implements CocosSceneBindingPort {
  private readonly updates: CocosSceneBindingUpdate[] = [];

  async applySceneBindingUpdate(update: CocosSceneBindingUpdate): Promise<void> {
    this.updates.push(structuredClone(update));
  }

  recordedUpdates(): CocosSceneBindingUpdate[] {
    return structuredClone(this.updates);
  }

  clear(): void {
    this.updates.length = 0;
  }
}
