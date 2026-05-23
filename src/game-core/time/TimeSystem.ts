import type { SaveFile } from '../domain/types';
import { SettlementRegistry } from './SettlementRegistry';

export class TimeSystem {
  constructor(private readonly settlements: SettlementRegistry) {}

  advance(save: SaveFile, minutes: number): void {
    if (!Number.isInteger(minutes) || minutes <= 0) throw new Error('ERR_INVALID_TIME_ADVANCE');
    save.world_time.absolute_minute += minutes;
    save.world_time.world_minute = save.world_time.absolute_minute % 1440;
    save.world_time.world_day = Math.floor(save.world_time.absolute_minute / 1440) + 1;
    this.settlements.settle(save, minutes);
  }
}
