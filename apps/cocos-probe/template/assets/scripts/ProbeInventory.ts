import type { ProbeCommand, ProbeCommandResult, ProbeMaterialOption, ProbeMenuSnapshot, ProbeQuantity, ProbeStorageTargetOption } from './ProbeLifetime';

export interface ProbeSplitResult {
  readonly sourceLotId: string;
  readonly newLotId: string;
  readonly quantity: ProbeQuantity;
  readonly remainingQuantity: ProbeQuantity | null;
}

export interface ProbeInventoryView {
  readonly lotOptions: readonly ProbeMaterialOption[];
  readonly targetOptions: readonly ProbeStorageTargetOption[];
  readonly selectedLotId: string | null;
  readonly selectedTargetId: string | null;
  readonly canMove: boolean;
  readonly splitQuantityText: string;
  readonly splitUnit: string | null;
  readonly splitInputError: string | null;
  readonly canPreviewSplit: boolean;
  readonly canConfirmSplit: boolean;
  readonly splitPreview: { readonly success: boolean; readonly statusCode: string } | null;
  readonly splitResult: ProbeSplitResult | null;
}

// Browsing and selection are local UI state. Formal preview owns form/capacity decisions.
export class ProbeInventory {
  private lots: readonly ProbeMaterialOption[] = [];
  private targets: readonly ProbeStorageTargetOption[] = [];
  private lotId: string | null = null;
  private targetId: string | null = null;
  private splitQuantityText = '';
  private splitPreview: ProbeInventoryView['splitPreview'] = null;
  private splitResult: ProbeSplitResult | null = null;
  private splitGeneration = 0;
  private readonly splitReceipts = new WeakMap<ProbeCommand, { generation: number; sourceLotId: string; quantity: ProbeQuantity }>();

  refresh(menu: ProbeMenuSnapshot): void {
    this.lots = structuredClone(menu.selectable_view_model?.splittable_lot_options ?? []);
    this.targets = structuredClone(menu.selectable_view_model?.storage_target_options ?? []);
    if (!this.lots.some((lot) => lot.id === this.lotId)) { this.lotId = null; this.splitQuantityText = ''; }
    if (!this.targets.some((target) => target.id === this.targetId)) this.targetId = null;
    // Component menu patches arrive before the pending command's result is returned.
    // Clear old feedback here; only that command's receipt may publish a new preview.
    this.splitPreview = null;
    this.splitResult = null;
  }

  selectNextLot(): void {
    const next = this.next(this.lots, this.lotId);
    if (next !== this.lotId) { this.splitQuantityText = ''; this.invalidateSplitPreview(); }
    this.lotId = next;
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

  setSplitQuantity(text: string): void {
    if (this.splitQuantityText !== text) { this.splitQuantityText = text; this.invalidateSplitPreview(); }
  }

  invalidateSplitPreview(): void {
    this.splitGeneration += 1;
    this.splitPreview = null;
    this.splitResult = null;
  }

  splitPreviewCommand(): ProbeCommand | null {
    return this.splitCommand('menu_preview');
  }

  splitConfirmCommand(): ProbeCommand | null {
    return this.splitPreview?.success ? this.splitCommand('menu_confirm') : null;
  }

  acceptSplitResult(command: ProbeCommand, result: ProbeCommandResult): void {
    if ((command.name !== 'menu_preview' && command.name !== 'menu_confirm') || command.selection.action_type !== 'split_lot') return;
    const receipt = this.splitReceipts.get(command);
    this.splitReceipts.delete(command);
    if (!receipt || receipt.generation !== this.splitGeneration) return;
    const outcome = result.command_result;
    const menu = outcome.snapshot?.menu;
    const preview = menu?.last_preview_result;
    if (outcome.status !== 'completed' || outcome.command_name !== command.name || !preview || preview.action_type !== 'split_lot'
      || typeof preview.success !== 'boolean' || typeof preview.status_code !== 'string' || preview.status_code.length === 0) return;
    if (command.name === 'menu_preview') {
      const current = this.splitQuantity();
      if (!current || this.lotId !== receipt.sourceLotId || current.amount !== receipt.quantity.amount || current.unit !== receipt.quantity.unit) return;
      this.splitPreview = { success: preview.success, statusCode: preview.status_code };
      return;
    }
    const action = menu?.last_action_result;
    if (!preview.success) { this.splitPreview = { success: false, statusCode: preview.status_code }; return; }
    if (!action || typeof action.success !== 'boolean' || typeof action.status_code !== 'string' || action.status_code.length === 0) return;
    if (!action.success) { this.splitPreview = { success: false, statusCode: action.status_code }; return; }
    const created = action.created_objects.find((item) => item.object_type === 'MaterialLot');
    const newLot = this.lots.find((item) => item.id === created?.object_id);
    if (!newLot || newLot.id === receipt.sourceLotId || newLot.quantity.amount !== receipt.quantity.amount || newLot.quantity.unit !== receipt.quantity.unit) return;
    const source = this.lots.find((item) => item.id === receipt.sourceLotId);
    this.splitResult = { sourceLotId: receipt.sourceLotId, newLotId: newLot.id, quantity: { ...newLot.quantity },
      remainingQuantity: source ? { ...source.quantity } : null };
    this.splitQuantityText = '';
    this.splitPreview = null;
    this.splitGeneration += 1;
  }

  private splitCommand(name: 'menu_preview' | 'menu_confirm'): ProbeCommand | null {
    const quantity = this.splitQuantity();
    if (!quantity || this.lotId === null) return null;
    const command: ProbeCommand = { name, selection: { action_type: 'split_lot', source_lot_option_id: this.lotId, quantity } };
    this.splitReceipts.set(command, { generation: this.splitGeneration, sourceLotId: this.lotId, quantity: { ...quantity } });
    return command;
  }

  private splitInputError(): string | null {
    const source = this.lots.find((item) => item.id === this.lotId);
    if (!source) return '请选择来源批次';
    if (!source.enabled) return '这批材料暂不可拆分';
    const text = this.splitQuantityText.trim();
    if (!text) return '请输入拆分数量';
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text))) return '请输入有效数字';
    if (Number(text) <= 0) return '拆分数量必须大于0';
    return null;
  }

  private splitQuantity(): ProbeQuantity | null {
    if (this.splitInputError() !== null) return null;
    return { amount: Number(this.splitQuantityText.trim()), unit: this.lots.find((item) => item.id === this.lotId)!.quantity.unit };
  }

  status(): ProbeInventoryView {
    return structuredClone({
      lotOptions: this.lots, targetOptions: this.targets,
      selectedLotId: this.lotId, selectedTargetId: this.targetId, canMove: this.moveCommand() !== null,
      splitQuantityText: this.splitQuantityText, splitUnit: this.lots.find((item) => item.id === this.lotId)?.quantity.unit ?? null,
      splitInputError: this.splitInputError(), canPreviewSplit: this.splitQuantity() !== null,
      canConfirmSplit: this.splitQuantity() !== null && this.splitPreview?.success === true,
      splitPreview: this.splitPreview, splitResult: this.splitResult
    });
  }

  private next(options: readonly { readonly id: string }[], id: string | null): string | null {
    if (options.length === 0) return null;
    const index = options.findIndex((option) => option.id === id);
    return options[(index + 1) % options.length].id;
  }
}
