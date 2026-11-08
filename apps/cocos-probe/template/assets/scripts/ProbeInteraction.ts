import type { ProbeBusinessResult, ProbeCommand, ProbeCommandResult } from './ProbeLifetime';

export interface ProbeOperation {
  readonly sequence: number;
  readonly name: ProbeCommand['name'] | null;
  readonly status: 'idle' | 'running' | 'completed' | 'failed';
  readonly message: string;
  readonly errorMessage: string | null;
  readonly slotId: string | null;
  readonly worldMinute: number | null;
}

export interface ProbeInteractionView {
  readonly busy: boolean;
  readonly operation: ProbeOperation;
}

export interface ProbeInteractionOptions {
  isAvailable(): boolean;
  execute(command: ProbeCommand): Promise<ProbeCommandResult>;
  onChange(view: ProbeInteractionView): void;
}

// This gate owns input admission and feedback only. The existing component queue owns execution order.
export class ProbeInteraction {
  private busy = false;
  private operation: ProbeOperation = {
    sequence: 0, name: null, status: 'idle', message: '请选择地块和种子后播种',
    errorMessage: null, slotId: null, worldMinute: null
  };

  constructor(private readonly options: ProbeInteractionOptions) {}

  status(): ProbeInteractionView {
    return { busy: this.busy, operation: { ...this.operation } };
  }

  async execute(command: ProbeCommand): Promise<ProbeCommandResult | null> {
    if (this.busy || !this.options.isAvailable()) return null;
    this.busy = true;
    this.operation = {
      sequence: this.operation.sequence + 1, name: command.name, status: 'running',
      message: runningMessage(command),
      errorMessage: null, slotId: command.name === 'save' || command.name === 'load' ? command.selection.slot_id : null,
      worldMinute: null
    };
    try {
      this.publish();
      const result = await this.options.execute(command);
      const outcome = result.command_result;
      if (outcome.status !== 'completed' && outcome.status !== 'failed') {
        throw new Error('ERR_COCOS_PROBE_COMMAND_RESULT_INVALID');
      }
      if (outcome.command_name !== undefined && outcome.command_name !== command.name) {
        throw new Error('ERR_COCOS_PROBE_COMMAND_RESULT_MISMATCH');
      }
      const summary = command.name === 'save' ? outcome.snapshot?.save_load?.last_save_result
        : command.name === 'load' ? outcome.snapshot?.save_load?.last_load_result : null;
      if (outcome.status === 'completed' && (command.name === 'save' || command.name === 'load')
          && (!summary || summary.slot_id !== command.selection.slot_id || !Number.isFinite(summary.world_minute))) {
        throw new Error('ERR_COCOS_PROBE_SAVE_LOAD_SUMMARY_MISSING');
      }
      let errorMessage = outcome.status === 'failed' ? outcome.error_message ?? '操作未完成' : null;
      if (command.name === 'menu_confirm_split_direct') {
        const validation = outcome.snapshot?.menu?.last_split_validation_result;
        const action = outcome.snapshot?.menu?.last_action_result;
        if (outcome.status !== 'completed' || outcome.command_name !== command.name || validation?.action_type !== 'split_lot'
          || typeof validation.success !== 'boolean' || typeof validation.status_code !== 'string' || !validation.status_code) throw new Error('ERR_WEB_SPLIT_RESULT_UNCERTAIN');
        if (!validation.success) {
          if (action !== null) throw new Error('ERR_WEB_SPLIT_RESULT_UNCERTAIN');
          errorMessage = validation.status_code;
        } else if (!action || !validBusinessResult(action) || !action.success || !action.request_id) {
          throw new Error('ERR_WEB_SPLIT_RESULT_UNCERTAIN');
        }
      }
      if (outcome.status === 'completed' && (command.name === 'menu_preview' || command.name === 'menu_confirm')) {
        const menu = outcome.snapshot?.menu;
        const preview = menu?.last_preview_result;
        if (!preview || preview.action_type !== command.selection.action_type || !validBusinessResult(preview)) {
          throw new Error('ERR_COCOS_PROBE_ACTION_SUMMARY_MISSING_OR_MISMATCHED');
        }
        if (!preview.success) {
          errorMessage = preview.status_code;
        } else if (command.name === 'menu_confirm') {
          const action = menu?.last_action_result;
          if (!action || !validBusinessResult(action) || typeof action.request_id !== 'string' || action.request_id.length === 0) {
            throw new Error('ERR_COCOS_PROBE_ACTION_SUMMARY_MISSING_OR_MISMATCHED');
          }
          if (!action.success) errorMessage = action.status_code;
        }
      }
      this.operation = {
        ...this.operation, status: errorMessage === null ? 'completed' : 'failed', errorMessage,
        message: errorMessage === null
          ? completedMessage(command) : failureMessage(errorMessage),
        worldMinute: errorMessage === null ? summary?.world_minute ?? null : null
      };
      return result;
    } catch (error) {
      this.operation = {
        ...this.operation, status: 'failed', message: error instanceof Error && error.message.startsWith('ERR_WEB_SPLIT_RESULT_UNCERTAIN') ? '拆分结果待确认，请先核对库存' : '操作异常，请重试',
        errorMessage: error instanceof Error ? error.message : String(error), worldMinute: null
      };
      throw error;
    } finally {
      this.busy = false;
      this.publish();
    }
  }

  private publish(): void {
    if (this.options.isAvailable()) this.options.onChange(this.status());
  }
}

function validBusinessResult(result: ProbeBusinessResult): boolean {
  return typeof result.success === 'boolean' && typeof result.status_code === 'string' && result.status_code.length > 0;
}

function runningMessage(command: ProbeCommand): string {
  if (command.name === 'refresh') return '正在核对库存';
  if (command.name === 'save') return '正在本地保存';
  if (command.name === 'load') return '正在读取本地存档';
  if (command.name === 'menu_preview') return command.selection.action_type === 'cook_dish' ? '正在校验烹饪选择'
    : command.selection.action_type === 'submit_order' ? '正在校验订单与菜品'
    : command.selection.action_type === 'start_processing' ? '正在校验加工输入' : '正在校验拆分数量';
  return ({ plant_crop: '正在播种', advance_time: '正在推进时间', harvest_crop: '正在收获', store_item: '正在转移整批物料', split_lot: '正在拆分批次', start_processing: '正在加工开工', collect_processing_result: '正在领取加工产物', cook_dish: '正在烹饪', submit_order: '正在提交订单' })[command.selection.action_type];
}

function completedMessage(command: ProbeCommand): string {
  if (command.name === 'refresh') return '库存已核对，请检查后重新选择';
  if (command.name === 'save') return '本地保存成功';
  if (command.name === 'load') return '已恢复本地存档';
  if (command.name === 'menu_preview') return '本次校验通过，尚未执行';
  if (command.selection.action_type === 'plant_crop') return '播种成功';
  if (command.selection.action_type === 'harvest_crop') return '收获成功';
  if (command.selection.action_type === 'store_item') return '整批转移成功';
  if (command.selection.action_type === 'split_lot') return '拆分成功';
  if (command.selection.action_type === 'start_processing') return '加工开工成功';
  if (command.selection.action_type === 'collect_processing_result') return '加工产物领取成功';
  if (command.selection.action_type === 'cook_dish') return '烹饪成功';
  if (command.selection.action_type === 'submit_order') return '订单结算完成';
  return command.selection.minutes === 60 ? '已推进一小时'
    : command.selection.minutes === 1440 ? '已推进一天' : `已推进${command.selection.minutes}分钟`;
}

function failureMessage(code: string): string {
  if (code === 'ERR_ORDER_NOT_AVAILABLE') return '订单已超时或当前不可提交';
  if (code.startsWith('ERR_DEMAND_')) return '菜品不符合当前需求，请调整选择';
  if (code.startsWith('ERR_MENU_RECIPE_ROLE_MISSING:')) return '必需食材角色尚未选择';
  if (code === 'ERR_NOT_ENOUGH_FUEL') return '燃料不足，请保留当前材料';
  if (code.startsWith('ERR_COOKING_')) return '烹饪选择不符合当前配方，请调整后预览';
  if (code.startsWith('ERR_SAVE_SLOT_NOT_FOUND:')) return '暂无本地存档，请先保存';
  if (code === 'ERR_NOT_ENOUGH_RESOURCE') return '资源不足，请调整数量';
  if (code === 'ERR_FIELD_OCCUPIED') return '地块已占用，请重新选择';
  if (code === 'ERR_FIELD_CAPACITY_EXCEEDED') return '土地空位不足，请减少播种数量';
  if (code === 'ERR_PLANT_QUANTITY_INVALID') return '播种数量须为正整数粒';
  if (code === 'ERR_SEEDS_PER_TILE_INVALID') return '每位须为1至3粒，总粒数须与播种位数对应';
  if (code === 'ERR_CROP_NOT_MATURE') return '作物尚未成熟';
  if (code.startsWith('ERR_STORAGE_FORM_NOT_SUPPORTED')) return '该位置不支持这种物料形态';
  if (code.startsWith('ERR_STORAGE_CAPACITY_OVERFLOW')) return '储存容量不足，请选择其他位置';
  if (code.startsWith('ERR_MENU_OPTION_')) return '选择已失效，请重新选择';
  if (code === 'ERR_SPLIT_QUANTITY_INVALID') return '拆分数量无效，件数请填写整数';
  if (code === 'ERR_SPLIT_QUANTITY_NOT_REPRESENTABLE') return '该数量无法安全拆分，请调整数量';
  if (code.startsWith('ERR_ALREADY_RESERVED')) return '这批材料暂不可拆分';
  if (code === 'ERR_PROCESSING_INPUT_MISSING') return '加工所需材料缺失或数量不足';
  if (code === 'ERR_PROCESSING_TASK_NOT_READY') return '加工尚未完成，请正常推进时间';
  if (code === 'ERR_PROCESSING_TASK_ALREADY_COMPLETED') return '该加工任务已领取';
  if (code === 'ERR_INVALID_LOT_STATE') return '材料当前状态不适合加工';
  if (code === 'ERR_PROCESSING_FACILITY_NOT_ALLOWED' || code === 'ERR_MENU_FACILITY_METHOD_NOT_COMPATIBLE') return '请选择兼容的加工设施';
  return '操作未完成，请重试';
}
