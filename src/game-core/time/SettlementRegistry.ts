import type { SaveFile } from '../domain/types';

export interface SettlementHandler {
  readonly id: string;
  settle(save: SaveFile, minutes: number): void;
}

export class SettlementRegistry {
  private readonly handlers: SettlementHandler[] = [];

  register(handler: SettlementHandler): void {
    if (this.handlers.some((item) => item.id === handler.id)) throw new Error(`ERR_SETTLEMENT_HANDLER_DUPLICATE:${handler.id}`);
    this.handlers.push(handler);
  }

  settle(save: SaveFile, minutes: number): void {
    for (const handler of this.handlers) {
      handler.settle(save, minutes);
    }
  }
}
