import type { CocosUiShellOperation, CocosUiShellRenderSnapshot } from './CocosUiShellRenderSnapshot';

export type CocosUiShellSnapshotSection = 'lifecycle' | 'menu' | 'save_load' | 'errors';

export interface CocosUiShellSnapshotDiff {
  changed_sections: CocosUiShellSnapshotSection[];
  lifecycle_changed: boolean;
  menu_changed: boolean;
  save_load_changed: boolean;
  errors_changed: boolean;
  before_operation: CocosUiShellOperation | null;
  after_operation: CocosUiShellOperation | null;
}

const ORDERED_SECTIONS: CocosUiShellSnapshotSection[] = ['lifecycle', 'menu', 'save_load', 'errors'];

export function diffCocosUiShellSnapshots(
  before: CocosUiShellRenderSnapshot,
  after: CocosUiShellRenderSnapshot
): CocosUiShellSnapshotDiff {
  const changed = new Set<CocosUiShellSnapshotSection>();
  for (const section of ORDERED_SECTIONS) {
    if (stableSerialize(before[section]) !== stableSerialize(after[section])) {
      changed.add(section);
    }
  }

  return {
    changed_sections: ORDERED_SECTIONS.filter((section) => changed.has(section)),
    lifecycle_changed: changed.has('lifecycle'),
    menu_changed: changed.has('menu'),
    save_load_changed: changed.has('save_load'),
    errors_changed: changed.has('errors'),
    before_operation: before.lifecycle.last_operation,
    after_operation: after.lifecycle.last_operation
  };
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeForStableCompare(value));
}

function normalizeForStableCompare(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeForStableCompare(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForStableCompare(item)])
    );
  }
  return value;
}
