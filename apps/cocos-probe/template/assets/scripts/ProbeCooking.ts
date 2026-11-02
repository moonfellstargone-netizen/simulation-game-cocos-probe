import type { ProbeCommand, ProbeCommandResult, ProbeCookingRecipeOption, ProbeDishOption, ProbeMaterialOption,
  ProbeMenuSelection, ProbeMenuSnapshot, ProbeStorageTargetOption } from './ProbeLifetime';

export interface ProbeCookingInputSelection { readonly role: string; readonly lotId: string | null; readonly quantityText: string }
type CookingSelection = Extract<ProbeMenuSelection, { action_type: 'cook_dish' }>;
export interface ProbeCookingView {
  readonly recipeOptions: readonly ProbeCookingRecipeOption[];
  readonly lotOptions: readonly ProbeMaterialOption[];
  readonly targetOptions: readonly ProbeStorageTargetOption[];
  readonly dishOptions: readonly ProbeDishOption[];
  readonly selectedRecipeId: string | null;
  readonly selectedRole: string | null;
  readonly inputSelections: readonly ProbeCookingInputSelection[];
  readonly selectedTargetId: string | null;
  readonly heatLevel: string | null;
  readonly activeMinutesText: string;
  readonly currentInputLotOptions: readonly ProbeMaterialOption[];
  readonly currentInputQuantityText: string;
  readonly currentInputUnit: string | null;
  readonly inputError: string | null;
  readonly canPreview: boolean;
  readonly canCook: boolean;
  readonly preview: { readonly success: boolean; readonly statusCode: string } | null;
  readonly result: { readonly dishLotId: string; readonly servingCount: number; readonly recognizedDishId: string | null; readonly storageRef: ProbeDishOption['storage_ref'] } | null;
}

// Public options and local choices only; formal cooking owns validation and state changes.
export class ProbeCooking {
  private recipes: readonly ProbeCookingRecipeOption[] = [];
  private lots: readonly ProbeMaterialOption[] = [];
  private targets: readonly ProbeStorageTargetOption[] = [];
  private dishes: readonly ProbeDishOption[] = [];
  private recipeId: string | null = null;
  private role: string | null = null;
  private inputs: ProbeCookingInputSelection[] = [];
  private targetId: string | null = null;
  private heat: string | null = null;
  private minutes = '';
  private generation = 0;
  private preview: ProbeCookingView['preview'] = null;
  private result: ProbeCookingView['result'] = null;
  private readonly receipts = new WeakMap<ProbeCommand, { generation: number; signature: string; previousDishIds: string[] }>();

  refresh(menu: ProbeMenuSnapshot): void {
    this.recipes = structuredClone(menu.selectable_view_model?.cookable_recipe_options ?? []);
    this.lots = structuredClone(menu.selectable_view_model?.splittable_lot_options ?? []);
    this.targets = structuredClone(menu.selectable_view_model?.storage_target_options ?? []);
    this.dishes = structuredClone(menu.selectable_view_model?.submittable_dish_lot_options ?? []);
    const recipe = this.recipe();
    if (!recipe) { this.recipeId = null; this.role = null; this.inputs = []; this.heat = null; this.minutes = ''; }
    else {
      this.inputs = recipe.roles.map((role) => {
        const old = this.inputs.find((item) => item.role === role.role);
        return old && role.lot_ids.includes(old.lotId ?? '') && this.lots.some((lot) => lot.id === old.lotId && lot.enabled)
          ? { ...old } : { role: role.role, lotId: null, quantityText: '' };
      });
      if (!recipe.roles.some((item) => item.role === this.role)) this.role = recipe.roles[0]?.role ?? null;
      if (!recipe.operation_constraints.heat_levels.includes(this.heat ?? '')) this.heat = null;
    }
    if (!this.targets.some((target) => target.id === this.targetId && target.enabled)) this.targetId = null;
    // A public menu patch arrives before its pending receipt; preserve that receipt.
    this.preview = null; this.result = null;
  }

  selectNextRecipe(): void {
    const next = this.next(this.recipes, this.recipeId); this.invalidatePreview();
    if (next === this.recipeId) return;
    this.recipeId = next; this.role = this.recipe()?.roles[0]?.role ?? null;
    this.inputs = this.recipe()?.roles.map((role) => ({ role: role.role, lotId: null, quantityText: '' })) ?? [];
    this.heat = null; this.minutes = '';
  }
  selectNextRole(): void {
    const roles = this.recipe()?.roles ?? []; const index = roles.findIndex((item) => item.role === this.role);
    this.role = roles[(index + 1) % roles.length]?.role ?? null; this.invalidatePreview();
  }
  selectNextLot(): void {
    const input = this.currentInput(); if (!input) return;
    const lotId = this.next(this.currentLots().filter((lot) => lot.enabled), input.lotId);
    this.inputs = this.inputs.map((item) => item === input ? { ...item, lotId, quantityText: '' } : item); this.invalidatePreview();
  }
  clearRole(): void {
    this.inputs = this.inputs.map((item) => item.role === this.role ? { ...item, lotId: null, quantityText: '' } : item); this.invalidatePreview();
  }
  setInputQuantity(text: string): void {
    const input = this.currentInput(); if (!input || input.quantityText === text) return;
    this.inputs = this.inputs.map((item) => item === input ? { ...item, quantityText: text } : item); this.invalidatePreview();
  }
  selectNextHeat(): void {
    const options = this.recipe()?.operation_constraints.heat_levels ?? []; const index = options.indexOf(this.heat ?? '');
    this.heat = options[(index + 1) % options.length] ?? null; this.invalidatePreview();
  }
  setActiveMinutes(text: string): void { if (this.minutes !== text) { this.minutes = text; this.invalidatePreview(); } }
  selectNextStorage(): void { this.targetId = this.next(this.targets.filter((target) => target.enabled), this.targetId); this.invalidatePreview(); }
  invalidatePreview(): void { this.generation++; this.preview = null; this.result = null; }
  previewCommand(): ProbeCommand | null { const selection = this.selection(); return selection ? this.command('menu_preview', selection) : null; }
  confirmCommand(): ProbeCommand | null { const selection = this.selection(); return this.preview?.success && selection ? this.command('menu_confirm', selection) : null; }

  acceptCookingResult(command: ProbeCommand, result: ProbeCommandResult): void {
    const receipt = this.receipts.get(command); this.receipts.delete(command);
    if ((command.name !== 'menu_preview' && command.name !== 'menu_confirm') || command.selection.action_type !== 'cook_dish'
      || !receipt || receipt.generation !== this.generation || receipt.signature !== JSON.stringify(command.selection)) return;
    this.preview = null; this.result = null;
    const outcome = result.command_result;
    if (outcome.command_name !== command.name) return;
    if (outcome.status === 'failed') {
      this.preview = { success: false, statusCode: outcome.error_message ?? 'ERR_COOKING_COMMAND_FAILED' }; return;
    }
    const menu = outcome.snapshot?.menu; const preview = menu?.last_preview_result;
    if (outcome.status !== 'completed' || !preview || preview.action_type !== 'cook_dish'
      || typeof preview.success !== 'boolean' || typeof preview.status_code !== 'string' || !preview.status_code) return;
    if (command.name === 'menu_preview') {
      if (receipt.signature === JSON.stringify(this.selection())) this.preview = { success: preview.success, statusCode: preview.status_code };
      return;
    }
    if (!preview.success) { this.preview = { success: false, statusCode: preview.status_code }; return; }
    const action = menu?.last_action_result;
    if (!action || typeof action.request_id !== 'string' || !action.request_id || typeof action.success !== 'boolean'
      || typeof action.status_code !== 'string' || !action.status_code) return;
    if (!action.success) { this.preview = { success: false, statusCode: action.status_code }; return; }
    const created = action.created_objects.filter((item) => item.object_type === 'DishLot');
    const dish = created.length === 1 ? this.dishes.find((item) => item.id === created[0]!.object_id && !receipt.previousDishIds.includes(item.id)) : undefined;
    if (!dish) throw new Error('ERR_COCOS_PROBE_COOKING_RESULT_MISSING_OR_MISMATCHED');
    this.result = { dishLotId: dish.id, servingCount: dish.serving_count, recognizedDishId: dish.recognized_dish_id, storageRef: { ...dish.storage_ref } };
    this.inputs = this.inputs.map((input) => ({ ...input, quantityText: '' })); this.generation++;
  }
  status(): ProbeCookingView {
    const current = this.currentInput(); const lot = this.lots.find((lot) => lot.id === current?.lotId); const selection = this.selection();
    return structuredClone({ recipeOptions: this.recipes, lotOptions: this.lots, targetOptions: this.targets, dishOptions: this.dishes,
      selectedRecipeId: this.recipeId, selectedRole: this.role, inputSelections: this.inputs, selectedTargetId: this.targetId,
      heatLevel: this.heat, activeMinutesText: this.minutes, currentInputLotOptions: this.currentLots(),
      currentInputQuantityText: current?.quantityText ?? '', currentInputUnit: lot?.quantity.unit ?? null,
      inputError: this.inputError(), canPreview: selection !== null, canCook: selection !== null && this.preview?.success === true, preview: this.preview, result: this.result });
  }
  private recipe(): ProbeCookingRecipeOption | undefined { return this.recipes.find((item) => item.id === this.recipeId); }
  private currentInput(): ProbeCookingInputSelection | undefined { return this.inputs.find((item) => item.role === this.role); }
  private currentLots(): readonly ProbeMaterialOption[] {
    const ids = this.recipe()?.roles.find((item) => item.role === this.role)?.lot_ids ?? [];
    return this.lots.filter((lot) => ids.includes(lot.id));
  }
  private inputError(): string | null {
    const recipe = this.recipe(); if (!recipe) return '请选择配方';
    if (!recipe.operation_constraints.heat_levels.includes(this.heat ?? '')) return '请明确选择火候';
    const minutes = this.minutes.trim();
    if (!/^\d+$/.test(minutes) || !Number.isSafeInteger(Number(minutes)) || Number(minutes) < recipe.operation_constraints.active_minutes.min) return '请填写正整数操作分钟数';
    if (!this.targets.some((target) => target.id === this.targetId && target.enabled)) return '请选择目标储存位置';
    let count = 0;
    for (const input of this.inputs) {
      if (input.lotId === null && !input.quantityText.trim()) continue;
      const lot = this.lots.find((lot) => lot.id === input.lotId); const role = recipe.roles.find((role) => role.role === input.role);
      if (!lot?.enabled || !role?.lot_ids.includes(lot.id)) return '请重新选择材料批次';
      const text = input.quantityText.trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text)) || Number(text) <= 0) return '请填写大于0的有效材料数量';
      count++;
    }
    return count ? null : '请选料并填写数量';
  }
  private selection(): CookingSelection | null {
    if (this.inputError() !== null) return null;
    return { action_type: 'cook_dish', recipe_option_id: this.recipeId!,
      ingredient_options: Object.fromEntries(this.inputs.filter((input) => input.lotId !== null).map((input) => [input.role, { lot_option_id: input.lotId!,
        quantity: { amount: Number(input.quantityText.trim()), unit: this.lots.find((lot) => lot.id === input.lotId)!.quantity.unit } }])),
      operation_profile: { heat_level: this.heat!, active_minutes: Number(this.minutes.trim()) }, target_storage_option_id: this.targetId! };
  }
  private command(name: 'menu_preview' | 'menu_confirm', selection: CookingSelection): ProbeCommand {
    const command: ProbeCommand = { name, selection };
    this.receipts.set(command, { generation: this.generation, signature: JSON.stringify(selection), previousDishIds: this.dishes.map((dish) => dish.id) }); return command;
  }
  private next(options: readonly { readonly id: string }[], id: string | null): string | null {
    return options[(options.findIndex((item) => item.id === id) + 1) % options.length]?.id ?? null;
  }
}
