import type { CocosUiShellRenderSnapshot, CocosUiShellSnapshotDiff } from '../shell';
import type { CocosSceneBindingSection, CocosSceneBindingUpdate } from './CocosSceneBindingPort';

const ORDERED_SECTIONS: CocosSceneBindingSection[] = ['lifecycle', 'menu', 'save_load', 'errors'];

export interface CocosSceneBindingPlanInput {
  readonly before: CocosUiShellRenderSnapshot | null;
  readonly after: CocosUiShellRenderSnapshot;
  readonly diff: CocosUiShellSnapshotDiff | null;
}

export class CocosSceneBindingSnapshotApplier {
  createUpdates(input: CocosSceneBindingPlanInput): CocosSceneBindingUpdate[] {
    const sections = input.before === null ? ORDERED_SECTIONS : input.diff?.changed_sections ?? [];
    const reason = input.before === null ? 'initial_render' : 'changed_section';
    return sections.map((section, index) => ({
      sequence: index,
      section,
      reason,
      operation: input.after.lifecycle.last_operation,
      snapshot: structuredClone(input.after[section])
    })) as CocosSceneBindingUpdate[];
  }
}
