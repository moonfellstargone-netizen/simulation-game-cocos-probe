import type { ConfigRepository } from '../config/ConfigRepository';
import { DeterministicIdService } from '../id/IdService';
import { DomainEventBus } from '../events/DomainEventBus';
import { ActionResultFactory } from '../action/ActionResultFactory';
import { ActionHandlerRegistry } from '../action/ActionHandlerRegistry';
import { ActionPipeline } from '../action/ActionPipeline';
import { FarmingSystem } from '../farming/FarmingSystem';
import { InventorySystem } from '../inventory/InventorySystem';
import { StorageReconciler } from '../storage/StorageReconciler';
import { StorageSystem } from '../storage/StorageSystem';
import { ProcessingSystem } from '../processing/ProcessingSystem';
import { CookingSystem } from '../cooking/CookingSystem';
import { DemandResolver } from '../demand/DemandResolver';
import { SettlementRegistry } from '../time/SettlementRegistry';
import { TimeSystem } from '../time/TimeSystem';
import type { DomainEvent, GameState, StorageOccupantRef, StorageRef } from '../domain/types';
import type { ActionHandler } from '../action/ActionHandlerRegistry';
import type { FormalStage1AActionRequest } from '../action/ActionTypes';
import type { RuntimeContractValidator } from '../validation/RuntimeContractValidator';

export class GameRuntime {
  readonly ids = new DeterministicIdService();
  readonly events = new DomainEventBus(this.ids);
  readonly results = new ActionResultFactory();
  readonly storageReconciler = new StorageReconciler();
  readonly demand: DemandResolver;
  readonly settlements = new SettlementRegistry();
  readonly registry = new ActionHandlerRegistry();
  readonly storage: StorageSystem;
  readonly farming: FarmingSystem;
  readonly inventory: InventorySystem;
  readonly processing: ProcessingSystem;
  readonly cooking: CookingSystem;
  readonly time: TimeSystem;
  readonly pipeline: ActionPipeline;

  constructor(private readonly configs: ConfigRepository, private readonly contracts?: RuntimeContractValidator) {
    this.storage = new StorageSystem(this.storageReconciler);
    this.farming = new FarmingSystem(this.configs, this.ids);
    this.inventory = new InventorySystem(this.ids);
    this.processing = new ProcessingSystem(this.configs, this.ids);
    this.cooking = new CookingSystem(this.configs, this.ids);
    this.demand = new DemandResolver(this.configs);
    this.time = new TimeSystem(this.settlements);
    this.registerSettlementHandlers();
    this.registerActionHandlers();
    this.pipeline = new ActionPipeline(this.registry, undefined, undefined, undefined, undefined, this.contracts);
  }

  private registerSettlementHandlers(): void {
    this.settlements.register({
      id: 'crop_growth',
      settle: (save, minutes) => this.farming.advanceGrowth(save, minutes)
    });
    this.settlements.register({
      id: 'processing_task_progress',
      settle: (save) => this.processing.advanceProcessing(save)
    });
    this.settlements.register({
      id: 'storage_decay_minimal_stage_1A',
      settle: (save, minutes) => {
        const days = minutes / 1440;
        for (const lot of save.inventory) {
          if (lot.base_id !== 'cabbage' || !['fresh', 'cut', 'pickled'].includes(lot.current_form)) continue;
          const container = save.storage_containers.find((item) => item.container_id === lot.storage_ref.container_id);
          const lossPerDay = container?.storage_type === 'cellar' ? 5 : 12;
          const current = Number(lot.property_profile.freshness ?? 100);
          lot.property_profile.freshness = Math.max(0, current - lossPerDay * days);
          lot.last_update_time = save.world_time.absolute_minute;
        }
      }
    });
    this.settlements.register({
      id: 'order_deadline_minimal_stage_1A',
      settle: (save) => {
        for (const order of save.orders) {
          if (order.status === 'available' && typeof order.deadline_absolute_minute === 'number' && save.world_time.absolute_minute > order.deadline_absolute_minute) {
            order.status = 'failed';
          }
        }
      }
    });
  }

  private appendEvent(state: GameState, request: FormalStage1AActionRequest, eventType: DomainEvent['event_type'], payload: Record<string, unknown>, visibility: DomainEvent['visibility'] = 'internal'): DomainEvent {
    return this.events.append(state, {
      event_type: eventType,
      world_time: state.save_file.world_time.absolute_minute,
      source_action_id: request.request_id,
      actor_id: request.actor_id,
      visibility,
      payload
    });
  }

  private registerActionHandlers(): void {
    const handlers: ActionHandler[] = [
      {
        actionType: 'plant_crop',
        execute: (state, request) => {
          if (request.action_type !== 'plant_crop') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const crop = this.farming.plantCrop(state.save_file, request.parameters.field_plot_id, request.parameters.seed_lot_id, request.parameters.seed_quantity);
          this.appendEvent(state, request, 'farming.crop_planted', {
            crop_id: crop.crop_id,
            field_plot_id: crop.field_plot_id,
            crop_base_id: crop.crop_base_id
          });
          return this.results.success(request, {
            created_objects: [{ object_type: 'CropInstance', object_id: crop.crop_id, summary: { status: crop.lifecycle_status } }],
            updated_objects: [
              { object_type: 'MaterialLot', object_id: request.parameters.seed_lot_id, summary: { quantity: request.parameters.seed_quantity } },
              { object_type: 'FieldPlotState', object_id: request.parameters.field_plot_id, summary: { status: 'occupied' } }
            ],
            consumed_resources: [{ resource_type: 'MaterialLot', resource_id: request.parameters.seed_lot_id, quantity: request.parameters.seed_quantity }],
            event_log_entries: [{ message_key: 'event_log.farming.crop_planted', params: [{ key: 'crop_id', value: crop.crop_id }] }]
          });
        }
      },
      {
        actionType: 'advance_time',
        execute: (state, request) => {
          if (request.action_type !== 'advance_time') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const from = state.save_file.world_time.absolute_minute;
          this.time.advance(state.save_file, request.parameters.minutes);
          this.appendEvent(state, request, 'time.advanced', {
            minutes: request.parameters.minutes,
            from_absolute_minute: from,
            to_absolute_minute: state.save_file.world_time.absolute_minute,
            triggered_summary: []
          });
          return this.results.success(request, { event_log_entries: [{ message_key: 'event_log.time.advanced', params: [{ key: 'minutes', value: request.parameters.minutes }] }] });
        }
      },
      {
        actionType: 'harvest_crop',
        execute: (state, request) => {
          if (request.action_type !== 'harvest_crop') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const cropBefore = state.save_file.crop_instances.find((item) => item.crop_id === request.parameters.crop_id);
          const lot = this.farming.harvest(state.save_file, request.parameters.crop_id);
          this.appendEvent(state, request, 'farming.crop_harvested', {
            crop_id: request.parameters.crop_id,
            field_plot_id: cropBefore?.field_plot_id ?? '',
            crop_base_id: cropBefore?.crop_base_id ?? null,
            created_lot_refs: [{ object_type: 'MaterialLot', object_id: lot.lot_id }]
          });
          return this.results.success(request, {
            created_objects: [{ object_type: 'MaterialLot', object_id: lot.lot_id, summary: { quantity: lot.quantity } }],
            updated_objects: [
              { object_type: 'CropInstance', object_id: request.parameters.crop_id, summary: { status: 'harvested' } },
              { object_type: 'FieldPlotState', object_id: lot.source_ref.source_location ?? 'unknown', summary: { status: 'available' } },
              { object_type: 'StorageContainer', object_id: lot.storage_ref.container_id }
            ],
            event_log_entries: [{ message_key: 'event_log.farming.crop_harvested', params: [{ key: 'lot_id', value: lot.lot_id }] }]
          });
        }
      },
      {
        actionType: 'store_item',
        execute: (state, request) => {
          if (request.action_type !== 'store_item') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const from = this.storageRefOf(state, request.parameters.object_ref);
          this.storage.move(state.save_file, request.parameters.object_ref, request.parameters.storage_ref);
          this.appendEvent(state, request, 'storage.item_moved', {
            object_ref: request.parameters.object_ref,
            from_storage_ref: from,
            to_storage_ref: request.parameters.storage_ref
          });
          return this.results.success(request, { updated_objects: [request.parameters.object_ref] });
        }
      },
      {
        actionType: 'split_lot',
        execute: (state, request) => {
          if (request.action_type !== 'split_lot') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const split = this.inventory.split(state.save_file, request.parameters.source_lot_id, request.parameters.quantity);
          const sourceAfterSplit = state.save_file.inventory.find((item) => item.lot_id === request.parameters.source_lot_id);
          this.appendEvent(state, request, 'inventory.lot_created', {
            lot_id: split.lot_id,
            base_id: split.base_id,
            quantity: split.quantity
          });
          if (sourceAfterSplit) {
            this.appendEvent(state, request, 'inventory.lot_updated', {
              lot_id: sourceAfterSplit.lot_id,
              base_id: sourceAfterSplit.base_id,
              quantity: sourceAfterSplit.quantity
            });
          }
          return this.results.success(request, {
            created_objects: [{ object_type: 'MaterialLot', object_id: split.lot_id, summary: { quantity: split.quantity } }],
            updated_objects: [
              { object_type: 'MaterialLot', object_id: request.parameters.source_lot_id, summary: sourceAfterSplit ? { quantity: sourceAfterSplit.quantity } : { status: 'consumed' } },
              { object_type: 'StorageContainer', object_id: split.storage_ref.container_id }
            ],
            event_log_entries: [{ message_key: 'event_log.inventory.lot_split', params: [{ key: 'source_lot_id', value: request.parameters.source_lot_id }, { key: 'new_lot_id', value: split.lot_id }] }]
          });
        }
      },
      {
        actionType: 'start_processing',
        execute: (state, request) => {
          if (request.action_type !== 'start_processing') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const task = this.processing.startProcessing(state.save_file, request.parameters.method_id, request.parameters.input_lots, request.parameters.facility_ref);
          this.appendEvent(state, request, 'processing.task_started', {
            task_id: task.task_id,
            method_id: task.method_id,
            input_lot_refs: task.input_lot_refs.map((input) => ({ lot_id: input.lot_id, quantity: input.quantity }))
          });
          return this.results.success(request, {
            created_objects: [{ object_type: 'ProcessingTask', object_id: task.task_id, summary: { status: task.status } }],
            updated_objects: [
              ...request.parameters.input_lots.map((input) => ({ object_type: 'MaterialLot', object_id: input.lot_id })),
              { object_type: 'StorageContainer', object_id: request.parameters.facility_ref.container_id }
            ],
            consumed_resources: request.parameters.input_lots.map((input) => ({ resource_type: 'MaterialLot', resource_id: input.lot_id, quantity: input.quantity })),
            event_log_entries: [{ message_key: 'event_log.processing.task_started', params: [{ key: 'task_id', value: task.task_id }] }]
          });
        }
      },
      {
        actionType: 'collect_processing_result',
        execute: (state, request) => {
          if (request.action_type !== 'collect_processing_result') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const taskBefore = state.save_file.processing_tasks.find((item) => item.task_id === request.parameters.task_id);
          const lot = this.processing.collect(state.save_file, request.parameters.task_id);
          this.appendEvent(state, request, 'processing.task_completed', {
            task_id: request.parameters.task_id,
            method_id: taskBefore?.method_id ?? null,
            output_object_refs: [{ object_type: 'MaterialLot', object_id: lot.lot_id }]
          });
          return this.results.success(request, {
            created_objects: [{ object_type: 'MaterialLot', object_id: lot.lot_id, summary: { quantity: lot.quantity } }],
            updated_objects: [
              { object_type: 'ProcessingTask', object_id: request.parameters.task_id, summary: { status: 'completed' } },
              { object_type: 'StorageContainer', object_id: lot.storage_ref.container_id }
            ],
            event_log_entries: [{ message_key: 'event_log.processing.task_completed', params: [{ key: 'task_id', value: request.parameters.task_id }, { key: 'lot_id', value: lot.lot_id }] }]
          });
        }
      },
      {
        actionType: 'cook_dish',
        execute: (state, request) => {
          if (request.action_type !== 'cook_dish') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const dish = this.cooking.cook(state.save_file, request.parameters.recipe_variant_id, request.parameters.ingredients, request.parameters.technique, request.parameters.operation_profile, request.parameters.target_storage_ref);
          this.appendEvent(state, request, 'cooking.dish_created', {
            dish_lot_id: dish.dish_lot_id,
            recognized_dish_id: dish.recognized_dish_id,
            serving_count: dish.serving_count
          });
          return this.results.success(request, {
            created_objects: [{ object_type: 'DishLot', object_id: dish.dish_lot_id, summary: { quantity: dish.total_quantity } }],
            updated_objects: [
              ...Object.values(request.parameters.ingredients).map((input) => ({ object_type: 'MaterialLot', object_id: input.lot_id })),
              { object_type: 'StorageContainer', object_id: dish.storage_ref.container_id }
            ],
            consumed_resources: Object.values(request.parameters.ingredients).map((input) => ({ resource_type: 'MaterialLot', resource_id: input.lot_id, quantity: input.quantity })),
            event_log_entries: [{ message_key: 'event_log.cooking.dish_created', params: [{ key: 'dish_lot_id', value: dish.dish_lot_id }] }]
          });
        }
      },
      {
        actionType: 'submit_order',
        execute: (state, request) => {
          if (request.action_type !== 'submit_order') throw new Error('ERR_HANDLER_ACTION_MISMATCH');
          const submittedRefs = request.parameters.submitted_object_refs;
          const dishRef = submittedRefs.find((ref) => ref.object_type === 'DishLot');
          const resolution = this.demand.submitOrder(state.save_file, request.parameters.order_id, submittedRefs);
          this.appendEvent(state, request, 'order.submitted', {
            order_id: request.parameters.order_id,
            submitted_object_refs: submittedRefs
          });
          this.appendEvent(state, request, 'order.completed', {
            order_id: request.parameters.order_id,
            submitted_object_refs: submittedRefs
          });
          return this.results.success(request, {
            status_code: resolution.reason_code,
            updated_objects: [
              { object_type: 'Order', object_id: request.parameters.order_id, summary: { status: 'completed' } },
              { object_type: 'PlayerState', object_id: 'player', summary: { status: 'money_updated' } },
              { object_type: 'StorageContainer', object_id: 'home_room_temp_01' }
            ],
            consumed_resources: dishRef ? [{ resource_type: 'DishLot', resource_id: dishRef.object_id, quantity: { amount: 1, unit: 'serving' } }] : [],
            event_log_entries: [{ message_key: 'event_log.order.completed', params: [{ key: 'order_id', value: request.parameters.order_id }, { key: 'match_score', value: resolution.match_score }] }]
          });
        }
      }
    ];

    for (const handler of handlers) this.registry.register(handler);
  }

  private storageRefOf(state: GameState, objectRef: StorageOccupantRef): StorageRef {
    if (objectRef.object_type === 'MaterialLot') {
      const lot = state.save_file.inventory.find((item) => item.lot_id === objectRef.object_id);
      if (!lot) throw new Error(`ERR_MATERIAL_LOT_NOT_FOUND:${objectRef.object_id}`);
      return { ...lot.storage_ref };
    }
    if (objectRef.object_type === 'DishLot') {
      const lot = state.save_file.dish_lots.find((item) => item.dish_lot_id === objectRef.object_id);
      if (!lot) throw new Error(`ERR_DISH_LOT_NOT_FOUND:${objectRef.object_id}`);
      return { ...lot.storage_ref };
    }
    throw new Error(`ERR_STORAGE_OCCUPANT_TYPE_UNSUPPORTED:${objectRef.object_type}`);
  }
}
