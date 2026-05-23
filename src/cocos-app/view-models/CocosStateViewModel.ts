import type { RuntimeStateSummaryData } from '../../game-core';

export interface CocosStateViewModelData {
  time_label: string;
  money: number;
  reputation: Record<string, unknown>;
  inventory_lot_count: number;
  dish_lot_count: number;
  active_reservation_count: number;
  orders: Array<{ id: string; status: string; reward: number | null }>;
  processing_tasks: Array<{ id: string; status: string; stage: string }>;
  storage: Array<{ id: string; used_capacity: number; active_object_count: number }>;
  recent_events: string[];
}

export class CocosStateViewModel {
  fromSummary(summary: RuntimeStateSummaryData): CocosStateViewModelData {
    return {
      time_label: `day ${summary.world_time.world_day} minute ${summary.world_time.world_minute}`,
      money: summary.player_state.money,
      reputation: { ...summary.player_state.reputation_map },
      inventory_lot_count: summary.inventory.lot_count,
      dish_lot_count: summary.dish_lots.count,
      active_reservation_count: summary.active_reservation_count,
      orders: summary.orders.map((order) => ({ id: order.order_id, status: order.status, reward: order.reward_final })),
      processing_tasks: summary.processing_tasks.map((task) => ({ id: task.task_id, status: task.status, stage: task.current_stage })),
      storage: summary.storage_containers.map((container) => ({ id: container.container_id, used_capacity: container.used_capacity, active_object_count: container.active_object_count })),
      recent_events: summary.recent_domain_events.map((event) => event.event_type)
    };
  }
}
