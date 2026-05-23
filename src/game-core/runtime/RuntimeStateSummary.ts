import type { DomainEvent, SaveFile } from '../domain/types';

export interface RuntimeStateSummaryData {
  world_time: {
    absolute_minute: number;
    world_day: number;
    world_minute: number;
    season: string;
    weather: string;
  };
  player_state: {
    money: number;
    reputation_map: Record<string, unknown>;
  };
  inventory: {
    lot_count: number;
    lots: Array<{ lot_id: string; base_id: string; current_form: string; amount: number; unit: string }>;
  };
  dish_lots: {
    count: number;
    lots: Array<{ dish_lot_id: string; recognized_dish_id: string | null; serving_count: number }>;
  };
  processing_tasks: Array<{ task_id: string; method_id: string; status: string; current_stage: string }>;
  orders: Array<{ order_id: string; status: string; result_key: string | null; reward_final: number | null }>;
  storage_containers: Array<{ container_id: string; used_capacity: number; active_object_count: number }>;
  active_reservation_count: number;
  recent_domain_events: Array<{ event_id: string; event_type: string; world_time: number }>;
}

export class RuntimeStateSummary {
  build(save: SaveFile, domainEvents: DomainEvent[], recentEventLimit = 5): RuntimeStateSummaryData {
    const reputation = save.player_state.reputation_map;
    return {
      world_time: {
        absolute_minute: save.world_time.absolute_minute,
        world_day: save.world_time.world_day,
        world_minute: save.world_time.world_minute,
        season: save.world_time.season,
        weather: save.world_time.weather
      },
      player_state: {
        money: Number(save.player_state.money ?? 0),
        reputation_map: reputation && typeof reputation === 'object' && !Array.isArray(reputation) ? { ...reputation } : {}
      },
      inventory: {
        lot_count: save.inventory.length,
        lots: save.inventory.map((lot) => ({
          lot_id: lot.lot_id,
          base_id: lot.base_id,
          current_form: lot.current_form,
          amount: lot.quantity.amount,
          unit: lot.quantity.unit
        }))
      },
      dish_lots: {
        count: save.dish_lots.length,
        lots: save.dish_lots.map((lot) => ({
          dish_lot_id: lot.dish_lot_id,
          recognized_dish_id: lot.recognized_dish_id ?? null,
          serving_count: lot.serving_count
        }))
      },
      processing_tasks: save.processing_tasks.map((task) => ({
        task_id: task.task_id,
        method_id: task.method_id,
        status: task.status,
        current_stage: task.current_stage
      })),
      orders: save.orders.map((order) => ({
        order_id: order.order_id,
        status: order.status,
        result_key: order.result_summary?.result_key ?? null,
        reward_final: typeof order.result_summary?.reward_final === 'number' ? order.result_summary.reward_final : null
      })),
      storage_containers: save.storage_containers.map((container) => ({
        container_id: container.container_id,
        used_capacity: container.used_capacity,
        active_object_count: container.active_object_refs.length
      })),
      active_reservation_count: save.reservations.filter((reservation) => reservation.status === 'active').length,
      recent_domain_events: domainEvents.slice(-recentEventLimit).map((event) => ({
        event_id: event.event_id,
        event_type: event.event_type,
        world_time: event.world_time
      }))
    };
  }

  format(summary: RuntimeStateSummaryData): string {
    const orderLines = summary.orders.map((order) => `order ${order.order_id}: ${order.status}`).join('\n');
    const taskLines = summary.processing_tasks.map((task) => `task ${task.task_id}: ${task.status}/${task.current_stage}`).join('\n');
    const storageLines = summary.storage_containers.map((container) => `storage ${container.container_id}: used_capacity ${container.used_capacity}, active ${container.active_object_count}`).join('\n');
    return [
      `world minute: ${summary.world_time.absolute_minute}`,
      `money: ${summary.player_state.money}`,
      `reputation: ${JSON.stringify(summary.player_state.reputation_map)}`,
      `inventory lots: ${summary.inventory.lot_count}`,
      `dish lots: ${summary.dish_lots.count}`,
      `active reservations: ${summary.active_reservation_count}`,
      orderLines,
      taskLines,
      storageLines,
      `recent events: ${summary.recent_domain_events.map((event) => event.event_type).join(', ')}`
    ].filter((line) => line.length > 0).join('\n');
  }
}
