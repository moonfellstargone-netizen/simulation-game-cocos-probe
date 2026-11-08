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
  readonly splitNeedsReview: boolean;
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
  private splitNeedsReview = false;
  private splitGeneration = 0;
  private readonly splitActionIds = new Set<string>();
  private readonly splitReceipts = new WeakMap<ProbeCommand, { generation: number; sourceLotId: string; quantity: ProbeQuantity; source: ProbeMaterialOption; beforeIds: readonly string[]; beforeLots: readonly ProbeMaterialOption[]; beforeTargets: readonly ProbeStorageTargetOption[] }>();

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

  resetSplitDraft(): void { this.splitQuantityText = ''; this.invalidateSplitPreview(); }

  invalidateSplitPreview(): void {
    this.splitGeneration += 1;
    this.splitPreview = null;
    this.splitResult = null;
  }

  splitPreviewCommand(): ProbeCommand | null {
    return this.splitNeedsReview ? null : this.splitCommand('menu_preview');
  }

  splitConfirmCommand(): ProbeCommand | null {
    return this.splitNeedsReview ? null : this.splitCommand('menu_confirm_split_direct');
  }

  markSplitUncertain(): void { this.splitNeedsReview = true; this.invalidateSplitPreview(); }

  acceptSplitReview(result: ProbeCommandResult): boolean {
    const outcome = result.command_result;
    const lots = outcome.snapshot?.menu?.selectable_view_model?.splittable_lot_options;
    if (!this.splitNeedsReview || outcome.status !== 'completed' || outcome.command_name !== 'refresh'
      || outcome.snapshot?.lifecycle?.has_session !== true || !Array.isArray(lots)
      || lots.some(item => !item.id) || new Set(lots.map(item => item.id)).size !== lots.length
      || JSON.stringify(lots) !== JSON.stringify(this.lots)) return false;
    this.splitNeedsReview = false;
    this.splitQuantityText = '';
    this.invalidateSplitPreview();
    return true;
  }

  acceptSplitResult(command: ProbeCommand, result: ProbeCommandResult): void {
    if ((command.name !== 'menu_preview' && command.name !== 'menu_confirm_split_direct') || command.selection.action_type !== 'split_lot') return;
    if (command.name === 'menu_confirm_split_direct') this.splitNeedsReview = true;
    const receipt = this.splitReceipts.get(command);
    this.splitReceipts.delete(command);
    if (!receipt || receipt.generation !== this.splitGeneration) return;
    const outcome = result.command_result;
    const menu = outcome.snapshot?.menu;
    const preview = menu?.last_preview_result;
    if (outcome.status !== 'completed' || outcome.command_name !== command.name) return;
    if (command.name === 'menu_preview') {
      if (!preview || preview.action_type !== 'split_lot' || typeof preview.success !== 'boolean' || typeof preview.status_code !== 'string' || !preview.status_code) return;
      const current = this.splitQuantity();
      if (!current || this.lotId !== receipt.sourceLotId || current.amount !== receipt.quantity.amount || current.unit !== receipt.quantity.unit) return;
      this.splitPreview = { success: preview.success, statusCode: preview.status_code };
      return;
    }
    const action = menu?.last_action_result;
    const validation = menu?.last_split_validation_result;
    if (validation?.action_type !== 'split_lot' || typeof validation.success !== 'boolean' || typeof validation.status_code !== 'string' || !validation.status_code) return;
    if (!validation.success) {
      // A forged or incomplete refusal must not hide a committed mutation.
      // Only unlock when the public inventory and storage capacities still match
      // the exact snapshot captured when the player submitted this command.
      if (action !== null || validation.status_code === 'OK'
        || JSON.stringify(this.lots) !== JSON.stringify(receipt.beforeLots)
        || JSON.stringify(this.targets) !== JSON.stringify(receipt.beforeTargets)) return;
      this.splitNeedsReview = false;
      this.splitPreview = { success: false, statusCode: validation.status_code };
      return;
    }
    if (!action || typeof action.success !== 'boolean' || typeof action.status_code !== 'string' || action.status_code.length === 0) return;
    if (!action.success) { this.splitPreview = { success: false, statusCode: action.status_code }; return; }
    if (action.status_code !== 'OK' || !action.request_id || this.splitActionIds.has(action.request_id)) return;
    const createdLots = action.created_objects.filter((item) => item.object_type === 'MaterialLot');
    if (createdLots.length !== 1 || action.created_objects.length !== 1 || createdLots[0]?.summary?.split_role !== 'taken') return;
    const created = createdLots[0];
    if (new Set(this.lots.map(item => item.id)).size !== this.lots.length) return;
    const newLot = this.lots.find((item) => item.id === created?.object_id);
    const source = this.lots.find((item) => item.id === receipt.sourceLotId);
    const sourceUpdates = action.updated_objects?.filter(item => item.object_type === 'MaterialLot') ?? [];
    if (sourceUpdates.length !== 1 || sourceUpdates[0]!.object_id !== receipt.sourceLotId
      || (source ? sourceUpdates[0]!.summary?.split_role !== 'remaining'
        || sourceUpdates[0]!.summary?.quantity?.amount !== source.quantity.amount
        || sourceUpdates[0]!.summary?.quantity?.unit !== source.quantity.unit
        || source.base_id !== receipt.source.base_id || source.current_form !== receipt.source.current_form
        || JSON.stringify(source.storage_ref) !== JSON.stringify(receipt.source.storage_ref)
        : sourceUpdates[0]!.summary?.status !== 'consumed')) return;
    if (!newLot || receipt.beforeIds.includes(newLot.id) || !created?.summary?.quantity
      || newLot.quantity.amount !== created.summary.quantity.amount || newLot.quantity.unit !== created.summary.quantity.unit
      || newLot.base_id !== receipt.source.base_id || newLot.current_form !== receipt.source.current_form
      || JSON.stringify(newLot.storage_ref) !== JSON.stringify(receipt.source.storage_ref)
      || newLot.quantity.unit !== receipt.source.quantity.unit
      || newLot.quantity.amount + (source?.quantity.amount ?? 0) !== receipt.source.quantity.amount) return;
    if (receipt.source.cabbage_pieces?.kind === 'whole') {
      const pieces = receipt.source.cabbage_pieces.pieces;
      if (receipt.quantity.unit !== 'count' || !Number.isInteger(receipt.quantity.amount)
        || receipt.quantity.amount > pieces.length || newLot.cabbage_pieces?.kind !== 'whole'
        || created.summary.piece_count !== receipt.quantity.amount
        || new Set(pieces.map(piece => piece.id)).size !== pieces.length
        || pieces.some(piece => !piece.id || !Number.isFinite(piece.weight_g) || piece.weight_g <= 0)
        || pieces.reduce((sum, piece) => sum + piece.weight_g, 0) !== receipt.source.quantity.amount
        || newLot.cabbage_pieces.pieces.reduce((sum, piece) => sum + piece.weight_g, 0) !== newLot.quantity.amount
        || JSON.stringify(newLot.cabbage_pieces.pieces) !== JSON.stringify(pieces.slice(0, receipt.quantity.amount))
        || (source ? source.cabbage_pieces?.kind !== 'whole' || JSON.stringify(source.cabbage_pieces.pieces) !== JSON.stringify(pieces.slice(receipt.quantity.amount))
          : receipt.quantity.amount !== pieces.length)) return;
    } else if (newLot.quantity.amount !== receipt.quantity.amount || newLot.quantity.unit !== receipt.quantity.unit) return;
    this.splitActionIds.add(action.request_id);
    this.splitNeedsReview = false;
    this.splitResult = { sourceLotId: receipt.sourceLotId, newLotId: newLot.id, quantity: { ...newLot.quantity },
      remainingQuantity: source ? { ...source.quantity } : null };
    this.splitQuantityText = '';
    this.splitPreview = null;
    this.splitGeneration += 1;
  }

  private splitCommand(name: 'menu_preview' | 'menu_confirm_split_direct'): ProbeCommand | null {
    const quantity = this.splitQuantity();
    if (!quantity || this.lotId === null) return null;
    const command: ProbeCommand = { name, selection: { action_type: 'split_lot', source_lot_option_id: this.lotId, quantity } };
    const source = this.lots.find((item) => item.id === this.lotId)!;
    this.splitReceipts.set(command, { generation: this.splitGeneration, sourceLotId: this.lotId, quantity: { ...quantity }, source: structuredClone(source), beforeIds: this.lots.map(lot => lot.id), beforeLots: structuredClone(this.lots), beforeTargets: structuredClone(this.targets) });
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
    const source = this.lots.find((item) => item.id === this.lotId)!;
    return { amount: Number(this.splitQuantityText.trim()), unit: source.cabbage_pieces?.kind === 'whole' ? 'count' : source.quantity.unit };
  }

  status(): ProbeInventoryView {
    return structuredClone({
      lotOptions: this.lots, targetOptions: this.targets,
      selectedLotId: this.lotId, selectedTargetId: this.targetId, canMove: this.moveCommand() !== null,
      splitQuantityText: this.splitQuantityText, splitUnit: this.lots.find((item) => item.id === this.lotId)?.cabbage_pieces?.kind === 'whole' ? 'count' : this.lots.find((item) => item.id === this.lotId)?.quantity.unit ?? null,
      splitInputError: this.splitInputError(), canPreviewSplit: this.splitNeedsReview || this.splitQuantity() !== null,
      canConfirmSplit: !this.splitNeedsReview && this.splitQuantity() !== null,
      splitPreview: this.splitPreview, splitResult: this.splitResult, splitNeedsReview: this.splitNeedsReview
    });
  }

  private next(options: readonly { readonly id: string }[], id: string | null): string | null {
    if (options.length === 0) return null;
    const index = options.findIndex((option) => option.id === id);
    return options[(index + 1) % options.length].id;
  }
}
