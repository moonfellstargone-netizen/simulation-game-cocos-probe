import type { CocosSceneBindingSection, CocosSceneBindingUpdate } from '../scene';
import type { CocosUiShellOperation } from '../shell';

export type CocosComponentNodeBindingTarget = 'lifecycle_panel' | 'menu_panel' | 'save_load_panel' | 'error_panel';

export type CocosComponentNodeBindingPatchReason = 'initial_render' | 'changed_section';

export interface CocosComponentNodeBindingPatch {
  readonly sequence: number;
  readonly section: CocosSceneBindingSection;
  readonly target: CocosComponentNodeBindingTarget;
  readonly reason: CocosComponentNodeBindingPatchReason;
  readonly operation: CocosUiShellOperation | null;
  readonly visible: boolean;
  readonly payload: unknown;
}

export interface CocosComponentNodeBindingPort {
  applyNodeBindingPatch(patch: CocosComponentNodeBindingPatch): void | Promise<void>;
}

export class RecordingCocosComponentNodeBindingPort implements CocosComponentNodeBindingPort {
  private readonly patches: CocosComponentNodeBindingPatch[] = [];

  async applyNodeBindingPatch(patch: CocosComponentNodeBindingPatch): Promise<void> {
    this.patches.push(structuredClone(patch));
  }

  recordedPatches(): CocosComponentNodeBindingPatch[] {
    return structuredClone(this.patches);
  }

  clear(): void {
    this.patches.length = 0;
  }
}

const NODE_TARGET_BY_SECTION: Record<CocosSceneBindingSection, CocosComponentNodeBindingTarget> = {
  lifecycle: 'lifecycle_panel',
  menu: 'menu_panel',
  save_load: 'save_load_panel',
  errors: 'error_panel'
};

export function mapSceneSectionToNodeTarget(section: CocosSceneBindingSection): CocosComponentNodeBindingTarget {
  return NODE_TARGET_BY_SECTION[section];
}

export function createNodeBindingPatch(update: CocosSceneBindingUpdate): CocosComponentNodeBindingPatch {
  return {
    sequence: update.sequence,
    section: update.section,
    target: mapSceneSectionToNodeTarget(update.section),
    reason: update.reason,
    operation: update.operation,
    visible: isSectionVisible(update),
    payload: structuredClone(update.snapshot)
  };
}

function isSectionVisible(update: CocosSceneBindingUpdate): boolean {
  if (update.section !== 'errors') return true;
  return Array.isArray(update.snapshot) && update.snapshot.length > 0;
}
