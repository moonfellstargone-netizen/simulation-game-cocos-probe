import type {
  ProbeCommand, ProbeCommandResult, ProbeMaterialOption, ProbeMenuSelection, ProbeMenuSnapshot,
  ProbeProcessingFacilityOption, ProbeProcessingMethodOption, ProbeProcessingTaskOption, ProbeQuantity
} from './ProbeLifetime';

export interface ProbeProcessingInputSelection {
  readonly requirementIndex: number;
  readonly lotId: string | null;
  readonly quantityText: string;
}

export interface ProbeProcessingView {
  readonly methodOptions: readonly ProbeProcessingMethodOption[];
  readonly lotOptions: readonly ProbeMaterialOption[];
  readonly facilityOptions: readonly ProbeProcessingFacilityOption[];
  readonly taskOptions: readonly ProbeProcessingTaskOption[];
  readonly selectedMethodId: string | null;
  readonly selectedRequirementIndex: number | null;
  readonly inputSelections: readonly ProbeProcessingInputSelection[];
  readonly selectedFacilityId: string | null;
  readonly selectedTaskId: string | null;
  readonly currentInputLotOptions: readonly ProbeMaterialOption[];
  readonly currentInputQuantityText: string;
  readonly currentInputUnit: string | null;
  readonly inputError: string | null;
  readonly canPreview: boolean;
  readonly canStart: boolean;
  readonly canCollect: boolean;
  readonly preview: { readonly success: boolean; readonly statusCode: string } | null;
  readonly startResult: { readonly taskId: string; readonly methodId: string } | null;
  readonly collectResult: { readonly taskId: string; readonly lotId: string; readonly quantity: ProbeQuantity } | null;
}

type ProcessingSelection = Extract<ProbeMenuSelection, { action_type: 'start_processing' | 'collect_processing_result' }>;

// Selection and feedback only: requirements and eligible identities are copied
// from public options; matching, minimum amounts and transactions stay upstream.
export class ProbeProcessing {
  private methods: readonly ProbeProcessingMethodOption[] = [];
  private lots: readonly ProbeMaterialOption[] = [];
  private facilities: readonly ProbeProcessingFacilityOption[] = [];
  private tasks: readonly ProbeProcessingTaskOption[] = [];
  private collectable: readonly { readonly id: string; readonly enabled: boolean }[] = [];
  private allLots: readonly ProbeMaterialOption[] = [];
  private methodId: string | null = null;
  private requirementIndex: number | null = null;
  private inputs: ProbeProcessingInputSelection[] = [];
  private facilityId: string | null = null;
  private taskId: string | null = null;
  private generation = 0;
  private preview: ProbeProcessingView['preview'] = null;
  private startResult: ProbeProcessingView['startResult'] = null;
  private collectResult: ProbeProcessingView['collectResult'] = null;
  private readonly receipts = new WeakMap<ProbeCommand, { generation: number; signature: string; selection: ProcessingSelection }>();

  refresh(menu: ProbeMenuSnapshot): void {
    const selectable = menu.selectable_view_model;
    this.methods = structuredClone(selectable?.processing_method_options ?? []);
    this.lots = structuredClone(selectable?.processable_lot_options ?? []);
    this.allLots = structuredClone(selectable?.splittable_lot_options ?? []);
    this.facilities = structuredClone(selectable?.processing_facility_options ?? []);
    this.tasks = structuredClone(selectable?.processing_task_options ?? []);
    this.collectable = structuredClone(selectable?.collectable_task_options ?? []);
    const method = this.method();
    if (!method) { this.methodId = null; this.requirementIndex = null; this.inputs = []; this.facilityId = null; }
    else {
      this.inputs = method.input_requirements.map((requirement) => {
        const old = this.inputs.find((input) => input.requirementIndex === requirement.requirement_index);
        return old && requirement.lot_ids.includes(old.lotId ?? '') && this.lots.some((lot) => lot.id === old.lotId)
          ? { ...old } : { requirementIndex: requirement.requirement_index, lotId: null, quantityText: '' };
      });
      if (!method.input_requirements.some((item) => item.requirement_index === this.requirementIndex)) this.requirementIndex = method.input_requirements[0]?.requirement_index ?? null;
      if (!this.facilities.some((item) => item.id === this.facilityId && method.compatible_facility_ids.includes(item.id))) this.facilityId = null;
    }
    if (!this.tasks.some((item) => item.id === this.taskId)) this.taskId = null;
    // A menu patch precedes the pending receipt. Clear old feedback without
    // invalidating the receipt for that same operation.
    this.preview = null; this.startResult = null; this.collectResult = null;
  }

  selectNextMethod(): void {
    const next = this.next(this.methods.filter((item) => item.enabled), this.methodId);
    this.invalidatePreview();
    if (next === this.methodId) return;
    this.methodId = next;
    const method = this.method();
    this.inputs = method?.input_requirements.map((item) => ({ requirementIndex: item.requirement_index, lotId: null, quantityText: '' })) ?? [];
    this.requirementIndex = method?.input_requirements[0]?.requirement_index ?? null;
    if (!method?.compatible_facility_ids.includes(this.facilityId ?? '')) this.facilityId = null;
  }

  selectNextInput(): void {
    const requirements = this.method()?.input_requirements ?? [];
    const index = requirements.findIndex((item) => item.requirement_index === this.requirementIndex);
    this.requirementIndex = requirements[(index + 1) % requirements.length]?.requirement_index ?? null;
    this.invalidatePreview();
  }

  selectNextLot(): void {
    const input = this.currentInput();
    if (!input) return;
    const lotId = this.next(this.currentLots().filter((item) => item.enabled), input.lotId);
    this.inputs = this.inputs.map((item) => item.requirementIndex === this.requirementIndex ? { ...item, lotId, quantityText: '' } : item);
    this.invalidatePreview();
  }

  setInputQuantity(text: string): void {
    const input = this.currentInput();
    if (!input || input.quantityText === text) return;
    this.inputs = this.inputs.map((item) => item === input ? { ...item, quantityText: text } : item);
    this.invalidatePreview();
  }

  selectNextFacility(): void {
    const method = this.method();
    this.facilityId = this.next(this.facilities.filter((item) => item.enabled && method?.compatible_facility_ids.includes(item.id)), this.facilityId);
    this.invalidatePreview();
  }

  selectNextTask(): void {
    this.taskId = this.next(this.tasks, this.taskId);
    this.invalidatePreview();
  }

  invalidatePreview(): void {
    this.generation++;
    this.preview = null; this.startResult = null; this.collectResult = null;
  }

  startPreviewCommand(): ProbeCommand | null {
    const selection = this.startSelection();
    return selection ? this.command('menu_preview', selection) : null;
  }

  startConfirmCommand(): ProbeCommand | null {
    const selection = this.startSelection();
    return this.preview?.success && selection ? this.command('menu_confirm', selection) : null;
  }

  collectCommand(): ProbeCommand | null {
    if (!this.taskId || !this.tasks.some((item) => item.id === this.taskId && item.enabled)
      || !this.collectable.some((item) => item.id === this.taskId && item.enabled)) return null;
    this.invalidatePreview();
    return this.command('menu_confirm', { action_type: 'collect_processing_result', task_option_id: this.taskId });
  }

  acceptProcessingResult(command: ProbeCommand, result: ProbeCommandResult): void {
    if ((command.name !== 'menu_preview' && command.name !== 'menu_confirm')
      || (command.selection.action_type !== 'start_processing' && command.selection.action_type !== 'collect_processing_result')) return;
    const receipt = this.receipts.get(command);
    this.receipts.delete(command);
    if (!receipt || receipt.generation !== this.generation || receipt.signature !== JSON.stringify(command.selection)) return;
    const outcome = result.command_result;
    const menu = outcome.snapshot?.menu;
    const preview = menu?.last_preview_result;
    if (outcome.status !== 'completed' || outcome.command_name !== command.name || !preview
      || preview.action_type !== receipt.selection.action_type || typeof preview.success !== 'boolean'
      || typeof preview.status_code !== 'string' || !preview.status_code) return;
    if (command.name === 'menu_preview') {
      if (receipt.signature !== JSON.stringify(this.startSelection())) return;
      this.preview = { success: preview.success, statusCode: preview.status_code };
      return;
    }
    if (!preview.success) { this.preview = { success: false, statusCode: preview.status_code }; return; }
    const action = menu?.last_action_result;
    if (!action || typeof action.request_id !== 'string' || !action.request_id || typeof action.success !== 'boolean'
      || typeof action.status_code !== 'string' || !action.status_code) return;
    if (!action.success) { this.preview = { success: false, statusCode: action.status_code }; return; }
    const selection = receipt.selection;
    if (selection.action_type === 'start_processing') {
      const created = action.created_objects.find((item) => item.object_type === 'ProcessingTask');
      const task = this.tasks.find((item) => item.id === created?.object_id && item.method_id === selection.method_id);
      if (!task) return;
      this.startResult = { taskId: task.id, methodId: task.method_id };
      this.taskId = task.id;
      this.inputs = this.inputs.map((input) => ({ ...input, quantityText: '' }));
    } else {
      const created = action.created_objects.find((item) => item.object_type === 'MaterialLot');
      const lot = this.allLots.find((item) => item.id === created?.object_id);
      const task = this.tasks.find((item) => item.id === selection.task_option_id && item.status === 'completed');
      if (!lot || !task) return;
      this.collectResult = { taskId: task.id, lotId: lot.id, quantity: { ...lot.quantity } };
    }
    this.preview = null;
    this.generation++;
  }

  status(): ProbeProcessingView {
    const current = this.currentInput();
    const lot = this.lots.find((item) => item.id === current?.lotId);
    const selection = this.startSelection();
    return structuredClone({ methodOptions: this.methods, lotOptions: this.lots, facilityOptions: this.facilities, taskOptions: this.tasks,
      selectedMethodId: this.methodId, selectedRequirementIndex: this.requirementIndex, inputSelections: this.inputs,
      selectedFacilityId: this.facilityId, selectedTaskId: this.taskId,
      currentInputLotOptions: this.currentLots(), currentInputQuantityText: current?.quantityText ?? '', currentInputUnit: lot?.quantity.unit ?? null,
      inputError: this.inputError(), canPreview: selection !== null, canStart: selection !== null && this.preview?.success === true,
      canCollect: this.tasks.some((item) => item.id === this.taskId && item.enabled) && this.collectable.some((item) => item.id === this.taskId && item.enabled),
      preview: this.preview, startResult: this.startResult, collectResult: this.collectResult });
  }

  private method(): ProbeProcessingMethodOption | undefined { return this.methods.find((item) => item.id === this.methodId); }
  private currentInput(): ProbeProcessingInputSelection | undefined { return this.inputs.find((item) => item.requirementIndex === this.requirementIndex); }
  private currentLots(): readonly ProbeMaterialOption[] {
    const ids = this.method()?.input_requirements.find((item) => item.requirement_index === this.requirementIndex)?.lot_ids ?? [];
    return this.lots.filter((item) => ids.includes(item.id));
  }

  private inputError(): string | null {
    const method = this.method();
    if (!method?.enabled) return '请选择加工方法';
    if (!this.facilities.some((item) => item.id === this.facilityId && item.enabled && method.compatible_facility_ids.includes(item.id))) return '请选择可用加工设施';
    let count = 0;
    for (const input of this.inputs) {
      if (input.lotId === null && !input.quantityText.trim()) continue;
      const lot = this.lots.find((item) => item.id === input.lotId);
      const requirement = method.input_requirements.find((item) => item.requirement_index === input.requirementIndex);
      if (!lot?.enabled || !requirement?.lot_ids.includes(lot.id)) return '请重新选择材料批次';
      const text = input.quantityText.trim();
      if (!text) return '请填写所选材料的数量';
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text))) return '请输入有效数字';
      if (Number(text) <= 0) return '加工数量必须大于0';
      count++;
    }
    return count > 0 ? null : '请选择材料并填写数量';
  }

  private startSelection(): Extract<ProcessingSelection, { action_type: 'start_processing' }> | null {
    if (this.inputError() !== null) return null;
    return { action_type: 'start_processing', method_id: this.methodId!, facility_option_id: this.facilityId!,
      input_lots: this.inputs.filter((input) => input.lotId !== null).map((input) => ({ lot_option_id: input.lotId!,
        quantity: { amount: Number(input.quantityText.trim()), unit: this.lots.find((lot) => lot.id === input.lotId)!.quantity.unit } })) };
  }

  private command(name: 'menu_preview' | 'menu_confirm', selection: ProcessingSelection): ProbeCommand {
    const command: ProbeCommand = { name, selection };
    this.receipts.set(command, { generation: this.generation, signature: JSON.stringify(selection), selection: structuredClone(selection) });
    return command;
  }

  private next(options: readonly { readonly id: string }[], id: string | null): string | null {
    return options.length ? options[(options.findIndex((item) => item.id === id) + 1) % options.length]?.id ?? null : null;
  }
}
