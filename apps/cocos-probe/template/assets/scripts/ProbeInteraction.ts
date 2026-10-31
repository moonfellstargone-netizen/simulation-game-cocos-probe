import type { ProbeCommand, ProbeCommandResult } from './ProbeLifetime';

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
    sequence: 0, name: null, status: 'idle', message: '可推进时间或本地保存',
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
      message: ({ menu_confirm: '正在推进时间', save: '正在本地保存', load: '正在读取本地存档' })[command.name],
      errorMessage: null, slotId: command.name === 'menu_confirm' ? null : command.selection.slot_id,
      worldMinute: null
    };
    try {
      this.publish();
      const result = await this.options.execute(command);
      const outcome = result.command_result;
      if (outcome.status !== 'completed' && outcome.status !== 'failed') {
        throw new Error('ERR_COCOS_PROBE_COMMAND_RESULT_INVALID');
      }
      const summary = command.name === 'save' ? outcome.snapshot?.save_load?.last_save_result
        : command.name === 'load' ? outcome.snapshot?.save_load?.last_load_result : null;
      if (outcome.status === 'completed' && command.name !== 'menu_confirm'
          && (!summary || summary.slot_id !== command.selection.slot_id || !Number.isFinite(summary.world_minute))) {
        throw new Error('ERR_COCOS_PROBE_SAVE_LOAD_SUMMARY_MISSING');
      }
      const errorMessage = outcome.status === 'failed' ? outcome.error_message ?? '操作未完成' : null;
      this.operation = {
        ...this.operation, status: outcome.status, errorMessage,
        message: errorMessage === null
          ? ({ menu_confirm: '已推进一小时', save: '本地保存成功', load: '已恢复本地存档' })[command.name]
          : errorMessage.startsWith('ERR_SAVE_SLOT_NOT_FOUND:') ? '暂无本地存档，请先保存' : '操作未完成，请重试',
        worldMinute: outcome.status === 'completed' ? summary?.world_minute ?? null : null
      };
      return result;
    } catch (error) {
      this.operation = {
        ...this.operation, status: 'failed', message: '操作异常，请重试',
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
