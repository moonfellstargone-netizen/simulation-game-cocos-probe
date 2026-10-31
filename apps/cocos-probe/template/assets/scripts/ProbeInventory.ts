import type { ProbeCommand, ProbeMaterialOption, ProbeMenuSnapshot, ProbeStorageTargetOption } from './ProbeLifetime';

export interface ProbeInventoryView {
  readonly lotOptions: readonly ProbeMaterialOption[];
  readonly targetOptions: readonly ProbeStorageTargetOption[];
  readonly selectedLotId: string | null;
  readonly selectedTargetId: string | null;
  readonly canMove: boolean;
}

// Browsing and selection are local UI state. Formal preview owns form/capacity decisions.
export class ProbeInventory {
  private lots: readonly ProbeMaterialOption[] = [];
  private targets: readonly ProbeStorageTargetOption[] = [];
  private lotId: string | null = null;
  private targetId: string | null = null;

  refresh(menu: ProbeMenuSnapshot): void {
    this.lots = structuredClone(menu.selectable_view_model?.splittable_lot_options ?? []);
    this.targets = structuredClone(menu.selectable_view_model?.storage_target_options ?? []);
    if (!this.lots.some((lot) => lot.id === this.lotId)) this.lotId = null;
    if (!this.targets.some((target) => target.id === this.targetId)) this.targetId = null;
  }

  selectNextLot(): void {
    this.lotId = this.next(this.lots, this.lotId);
  }

  selectNextTarget(): void {
    this.targetId = this.next(this.targets, this.targetId);
  }

  moveCommand(): ProbeCommand | null {
    const lot = this.lots.find((item) => item.id === this.lotId);
    const target = this.targets.find((item) => item.id === this.targetId);
    if (!lot?.enabled || !target?.enabled || target.id === lot.storage_ref.container_id) return null;
    return { name: 'menu_confirm', selection: {
      action_type: 'store_item', source_lot_option_id: lot.id, target_storage_option_id: target.id
    } };
  }

  status(): ProbeInventoryView {
    return structuredClone({
      lotOptions: this.lots, targetOptions: this.targets,
      selectedLotId: this.lotId, selectedTargetId: this.targetId, canMove: this.moveCommand() !== null
    });
  }

  private next(options: readonly { readonly id: string }[], id: string | null): string | null {
    if (options.length === 0) return null;
    const index = options.findIndex((option) => option.id === id);
    return options[(index + 1) % options.length].id;
  }
}
