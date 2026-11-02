import type { ProbeCommand, ProbeCommandResult, ProbeDishOption, ProbeMenuSnapshot, ProbeOrderOption } from './ProbeLifetime';
type Selection = Extract<import('./ProbeLifetime').ProbeMenuSelection, { action_type: 'submit_order' }>;
export interface ProbeOrdersView {
  readonly orderOptions: readonly ProbeOrderOption[]; readonly dishOptions: readonly ProbeDishOption[];
  readonly selectedOrderId: string | null; readonly selectedDishId: string | null;
  readonly money: number | null; readonly reputation: Readonly<Record<string, unknown>>;
  readonly inputError: string | null; readonly canPreview: boolean; readonly canSubmit: boolean;
  readonly preview: { readonly success: boolean; readonly statusCode: string } | null;
  readonly result: { readonly orderId: string; readonly dishLotId: string; readonly servingCount: number;
    readonly matchScore: number; readonly rewardMoney: number; readonly moneyAfter: number; readonly reputationDelta: Readonly<Record<string, number>> } | null;
}
interface Receipt { generation: number; signature: string; order: ProbeOrderOption; dish: ProbeDishOption;
  money: number; reputation: Record<string, unknown>; otherDishes: readonly ProbeDishOption[]; previousRequestId: string | null }

// Local selections and detached public observations only. DemandResolver owns matching and settlement.
export class ProbeOrders {
  private orders: readonly ProbeOrderOption[] = []; private dishes: readonly ProbeDishOption[] = [];
  private orderId: string | null = null; private dishId: string | null = null;
  private money: number | null = null; private reputation: Record<string, unknown> = {};
  private generation = 0; private requestId: string | null = null;
  private preview: ProbeOrdersView['preview'] = null; private result: ProbeOrdersView['result'] = null;
  private readonly receipts = new WeakMap<ProbeCommand, Receipt>();
  refresh(menu: ProbeMenuSnapshot): void {
    this.orders = structuredClone(menu.selectable_view_model?.order_options ?? []);
    this.dishes = structuredClone(menu.selectable_view_model?.submittable_dish_lot_options ?? []);
    this.money = typeof menu.view_model?.money === 'number' ? menu.view_model.money : null;
    this.reputation = structuredClone(menu.view_model?.reputation ?? {});
    this.requestId = menu.last_action_result?.request_id ?? null;
    if (!this.orders.some(order => order.id === this.orderId)) this.orderId = null;
    if (!this.dishes.some(dish => dish.id === this.dishId && dish.enabled)) this.dishId = null;
    // A public patch precedes its pending receipt; explicit player changes invalidate generations.
    this.preview = null; this.result = null;
  }
  selectNextOrder(): void { this.orderId = this.next(this.orders, this.orderId); this.invalidatePreview(); }
  selectNextDish(): void { this.dishId = this.next(this.dishes.filter(dish => dish.enabled), this.dishId); this.invalidatePreview(); }
  invalidatePreview(): void { this.generation++; this.preview = null; this.result = null; }
  previewCommand(): ProbeCommand | null { const selection = this.selection(); return selection ? this.command('menu_preview', selection) : null; }
  confirmCommand(): ProbeCommand | null { const selection = this.selection(); return this.preview?.success && selection ? this.command('menu_confirm', selection) : null; }
  status(): ProbeOrdersView {
    const valid = this.selection() !== null;
    return structuredClone({ orderOptions: this.orders, dishOptions: this.dishes, selectedOrderId: this.orderId, selectedDishId: this.dishId,
      money: this.money, reputation: this.reputation, inputError: this.inputError(), canPreview: valid, canSubmit: valid && this.preview?.success === true,
      preview: this.preview, result: this.result });
  }
  acceptOrderResult(command: ProbeCommand, result: ProbeCommandResult): void {
    const receipt = this.receipts.get(command); this.receipts.delete(command);
    if ((command.name !== 'menu_preview' && command.name !== 'menu_confirm') || command.selection.action_type !== 'submit_order') return;
    if (!receipt || receipt.generation !== this.generation || receipt.signature !== JSON.stringify(command.selection)) throw new Error('ERR_COCOS_PROBE_ORDER_RECEIPT_STALE');
    this.preview = null; this.result = null;
    const outcome = result.command_result;
    if (outcome.command_name !== command.name) throw new Error('ERR_COCOS_PROBE_ORDER_COMMAND_RESULT_MISMATCH');
    if (outcome.status === 'failed') { this.preview = { success: false, statusCode: outcome.error_message ?? 'ERR_ORDER_COMMAND_FAILED' }; return; }
    const menu = outcome.snapshot?.menu; const preview = menu?.last_preview_result;
    if (outcome.status !== 'completed' || preview?.action_type !== 'submit_order' || typeof preview.success !== 'boolean' || !preview.status_code) return;
    if (command.name === 'menu_preview') {
      if (receipt.signature === JSON.stringify(this.selection())) this.preview = { success: preview.success, statusCode: preview.status_code };
      return;
    }
    if (!preview.success) { this.preview = { success: false, statusCode: preview.status_code }; return; }
    const action = menu?.last_action_result;
    if (!action || typeof action.request_id !== 'string' || !action.request_id || typeof action.success !== 'boolean' || !action.status_code) return;
    if (!action.success) { this.preview = { success: false, statusCode: action.status_code }; return; }
    const order = this.orders.find(item => item.id === receipt.order.id); const summary = order?.result_summary;
    const consumed = action.consumed_resources?.filter(item => item.resource_type === 'DishLot') ?? [];
    const updated = action.updated_objects?.filter(item => item.object_type === 'Order') ?? [];
    const otherDishes = this.dishes.filter(item => item.id !== receipt.dish.id);
    const valid = action.request_id !== receipt.previousRequestId && action.request_id === this.requestId && order?.status === 'completed' && summary?.result_key === action.status_code
      && typeof summary.reward_final === 'number' && Number.isFinite(summary.reward_final)
      && typeof summary.match_score === 'number' && Number.isFinite(summary.match_score)
      && summary.submitted_count === receipt.dish.serving_count
      && consumed.length === 1 && consumed[0]!.resource_id === receipt.dish.id
      && updated.some(item => item.object_id === receipt.order.id)
      && order.submitted_object_refs.length === 1 && order.submitted_object_refs[0]!.object_type === 'DishLot' && order.submitted_object_refs[0]!.object_id === receipt.dish.id
      && !this.dishes.some(item => item.id === receipt.dish.id)
      && JSON.stringify(otherDishes) === JSON.stringify(receipt.otherDishes)
      && this.money !== null && Number.isFinite(this.money) && this.money - receipt.money === summary.reward_final;
    if (!valid) throw new Error('ERR_COCOS_PROBE_ORDER_RESULT_MISSING_OR_MISMATCHED');
    const reputationDelta: Record<string, number> = {};
    for (const key of new Set([...Object.keys(receipt.reputation), ...Object.keys(this.reputation)])) {
      const before = receipt.reputation[key] ?? 0; const after = this.reputation[key] ?? 0;
      if (typeof before === 'number' && typeof after === 'number' && Number.isFinite(before) && Number.isFinite(after) && before !== after) reputationDelta[key] = after - before;
    }
    this.result = { orderId: order!.id, dishLotId: receipt.dish.id, servingCount: receipt.dish.serving_count,
      matchScore: summary!.match_score!, rewardMoney: summary!.reward_final!, moneyAfter: this.money!, reputationDelta };
    this.generation++;
  }
  private inputError(): string | null {
    const order = this.orders.find(item => item.id === this.orderId);
    if (!order) return '请选择现有订单';
    if (!order.demand) return '订单需求配置不可用';
    if (!order.enabled) return '该订单当前不可提交';
    if (!this.dishes.some(dish => dish.id === this.dishId && dish.enabled)) return this.dishes.length ? '请选择真实菜品批次' : '暂无菜品，请先前往烹饪';
    if (this.money === null || !Number.isFinite(this.money)) return '当前结算数据不可用';
    return null;
  }
  private selection(): Selection | null { return this.inputError() === null ? { action_type: 'submit_order', order_option_id: this.orderId!, dish_lot_option_ids: [this.dishId!] } : null; }
  private command(name: 'menu_preview' | 'menu_confirm', selection: Selection): ProbeCommand {
    const command: ProbeCommand = { name, selection };
    this.receipts.set(command, { generation: this.generation, signature: JSON.stringify(selection), order: structuredClone(this.orders.find(item => item.id === selection.order_option_id)!),
      dish: structuredClone(this.dishes.find(item => item.id === selection.dish_lot_option_ids[0])!), money: this.money!, reputation: structuredClone(this.reputation),
      otherDishes: structuredClone(this.dishes.filter(item => item.id !== selection.dish_lot_option_ids[0])), previousRequestId: this.requestId }); return command;
  }
  private next(options: readonly { readonly id: string }[], id: string | null): string | null { return options[(options.findIndex(option => option.id === id) + 1) % options.length]?.id ?? null; }
}
