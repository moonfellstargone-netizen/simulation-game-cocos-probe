import type { CocosSceneBindingPort, CocosSceneBindingUpdate } from '../scene';
import { createNodeBindingPatch, type CocosComponentNodeBindingPort, type CocosComponentNodeBindingPatch } from './CocosComponentNodeBindingPort';

export interface CocosComponentNodeBindingApplyResult {
  readonly patch: CocosComponentNodeBindingPatch;
}

export class CocosComponentNodeBindingAdapter implements CocosSceneBindingPort {
  constructor(private readonly nodePort: CocosComponentNodeBindingPort) {}

  async applySceneBindingUpdate(update: CocosSceneBindingUpdate): Promise<void> {
    await this.apply(update);
  }

  async apply(update: CocosSceneBindingUpdate): Promise<CocosComponentNodeBindingApplyResult> {
    const patch = createNodeBindingPatch(update);
    await this.nodePort.applyNodeBindingPatch(patch);
    return { patch: structuredClone(patch) };
  }
}
