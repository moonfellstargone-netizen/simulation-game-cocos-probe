import type { ConfigRepository } from '../config/ConfigRepository';
import type { MaterialLot, ProcessingTask, Quantity, SaveFile } from '../domain/types';
import type { IdService } from '../id/IdService';
import { InventorySystem } from '../inventory/InventorySystem';
import { ProcessingConfigResolver, type ProcessingMethodConfig } from './ProcessingConfigResolver';

interface ProcessingInputRequest {
  lot_id: string;
  quantity: Quantity;
}

export class ProcessingSystem {
  private readonly inventory: InventorySystem;
  private readonly processingConfigs: ProcessingConfigResolver;

  constructor(private readonly configs: ConfigRepository, private readonly ids: IdService) {
    this.inventory = new InventorySystem(ids);
    this.processingConfigs = new ProcessingConfigResolver(configs);
  }

  startProcessing(save: SaveFile, methodId: string, inputLots: ProcessingInputRequest[], facilityRef: ProcessingTask['facility_ref']): ProcessingTask {
    const method = this.processingConfigs.resolveMethod(methodId);
    for (const input of inputLots) this.inventory.assertNoActiveReservation(save, input.lot_id, input.quantity);
    const inputRoles = this.resolveInputRoles(save, method, inputLots);
    const primaryInput = inputRoles.find((input) => input.role === 'primary');
    if (!primaryInput) throw new Error('ERR_PROCESSING_INPUT_MISSING');
    this.assertFacilityAllowed(method, facilityRef.definition_id);
    const environment = this.buildEnvironmentSnapshot(save, facilityRef.container_id);
    for (const input of inputLots) this.inventory.consume(save, input.lot_id, input.quantity);
    const expectedQuantity = { ...primaryInput.quantity };
    const task: ProcessingTask = {
      task_id: this.ids.next('task_processing'),
      method_id: methodId,
      input_lot_refs: inputRoles.map((input) => ({ lot_id: input.lot_id, quantity: { ...input.quantity }, reservation_id: null, role: input.role })),
      reserved_quantities: inputRoles.map((input) => ({ reservation_id: this.ids.next('res_consumed'), lot_id: input.lot_id, quantity: { ...input.quantity }, status: 'consumed' })),
      start_world_minute: save.world_time.absolute_minute,
      expected_finish_minute: save.world_time.absolute_minute + Number(method.process_duration_minutes ?? 0),
      facility_ref: { ...facilityRef },
      environment_snapshot: environment,
      current_stage: 'fermenting',
      status: 'active',
      progress: 0,
      risk_state: 'normal',
      preview_result: {
        expected_output_base_id: primaryInput.base_id,
        expected_quantity: expectedQuantity,
        risk_note_key: null
      },
      output_preview: {
        output_base_id: primaryInput.base_id,
        quantity: expectedQuantity,
        quality_grade: 'normal'
      },
      flags: []
    };
    save.processing_tasks.push(task);
    return task;
  }

  startPickling(save: SaveFile, methodId: string, inputLots: ProcessingInputRequest[], facilityRef: ProcessingTask['facility_ref']): ProcessingTask {
    return this.startProcessing(save, methodId, inputLots, facilityRef);
  }

  advanceProcessing(save: SaveFile): void {
    for (const task of save.processing_tasks) {
      if (task.status !== 'active') continue;
      const duration = Math.max(1, task.expected_finish_minute - task.start_world_minute);
      const elapsed = Math.max(0, save.world_time.absolute_minute - task.start_world_minute);
      task.progress = Math.min(100, Math.floor((elapsed / duration) * 100));
      if (save.world_time.absolute_minute >= task.expected_finish_minute) {
        task.status = 'ready_to_collect';
        task.current_stage = 'ready';
        task.progress = 100;
      }
    }
  }

  collect(save: SaveFile, taskId: string): MaterialLot {
    const task = save.processing_tasks.find((item) => item.task_id === taskId);
    if (!task) throw new Error(`ERR_PROCESSING_TASK_NOT_FOUND:${taskId}`);
    if (task.status === 'completed') throw new Error('ERR_PROCESSING_TASK_ALREADY_COMPLETED');
    if (task.status !== 'ready_to_collect') throw new Error('ERR_PROCESSING_TASK_NOT_READY');
    const method = this.processingConfigs.resolveMethod(task.method_id);
    const materialDef = this.configs.requiredDoc<Record<string, unknown>>('configs/materials/crops/cabbage.yaml');
    const outputBaseId = task.output_preview?.output_base_id ?? task.preview_result?.expected_output_base_id ?? 'cabbage';
    const quantity = task.output_preview?.quantity ?? task.preview_result?.expected_quantity;
    if (!quantity) throw new Error('ERR_PROCESSING_OUTPUT_PREVIEW_MISSING');
    const outputFormRules = method.output_form_rules ?? {};
    const outputForm = String(outputFormRules.success_form ?? 'pickled');
    const transformedProfile = this.buildOutputPropertyProfile(materialDef, method, task);
    const lot: MaterialLot = {
      lot_id: this.ids.next('lot_processed'),
      base_id: String(outputBaseId),
      category: String(materialDef.category ?? 'vegetable'),
      quantity: { amount: Number(quantity.amount), unit: quantity.unit },
      current_form: outputForm,
      property_profile: transformedProfile,
      source_ref: {
        source_type: 'processing',
        source_id: task.task_id,
        source_time: save.world_time.absolute_minute,
        source_actor: 'player',
        source_location: task.facility_ref.location_id,
        summary_key: method.event_log_rules?.completed_key ?? null
      },
      storage_ref: { location_id: 'home', storage_type: 'cellar', container_id: 'home_cellar_01' },
      created_time: save.world_time.absolute_minute,
      last_update_time: save.world_time.absolute_minute,
      schema_version: save.schema_version,
      rules_version: save.rules_version,
      flags: ['processed'],
      definition_ref: { type: 'material', id: String(outputBaseId), canonical_id: `base:${String(outputBaseId)}` },
      storage_footprint: { amount: Math.max(1, Math.ceil(Number(quantity.amount) / 100)), unit: 'slot_weight' },
      processing_history: [{
        history_id: this.ids.next('hist_processing'),
        operation_type: 'collect_processing_result',
        method_id: task.method_id,
        action_request_id: null,
        world_minute: save.world_time.absolute_minute,
        quantity: { amount: Number(quantity.amount), unit: quantity.unit },
        result_key: method.event_log_rules?.completed_key ?? null,
        notes: []
      }]
    };
    task.status = 'completed';
    task.current_stage = 'ready';
    task.progress = 100;
    save.inventory.push(lot);
    return lot;
  }

  private resolveInputRoles(save: SaveFile, method: ProcessingMethodConfig, inputLots: ProcessingInputRequest[]): Array<ProcessingInputRequest & { role: string; base_id: string; current_form: string }> {
    return inputLots.map((input) => {
      const lot = this.inventory.findMaterialLot(save, input.lot_id);
      const role = this.resolveInputRole(method, lot, input.quantity);
      return { ...input, role, base_id: lot.base_id, current_form: lot.current_form };
    });
  }

  private resolveInputRole(method: ProcessingMethodConfig, lot: MaterialLot, quantity: Quantity): string {
    const requirements = method.input_view_requirements ?? [];
    for (const rawRequirement of requirements) {
      const requirement = rawRequirement as Record<string, unknown>;
      const allowedBaseIds = Array.isArray(requirement.allowed_base_ids) ? requirement.allowed_base_ids : undefined;
      const allowedForms = Array.isArray(requirement.allowed_forms) ? requirement.allowed_forms : undefined;
      const categoryOk = typeof requirement.category !== 'string' || requirement.category === lot.category;
      const baseOk = typeof requirement.base_id === 'string' ? requirement.base_id === lot.base_id : !allowedBaseIds || allowedBaseIds.includes(lot.base_id);
      const formOk = !allowedForms || allowedForms.includes(lot.current_form);
      const minFreshness = typeof requirement.min_freshness === 'number' ? requirement.min_freshness : null;
      const freshnessOk = minFreshness === null || Number(lot.property_profile.freshness ?? 100) >= minFreshness;
      const minQuantityG = typeof requirement.min_quantity_g === 'number' ? requirement.min_quantity_g : null;
      const quantityOk = minQuantityG === null || (quantity.unit === 'g' && quantity.amount >= minQuantityG);
      if (categoryOk && baseOk && formOk && freshnessOk && quantityOk) {
        return requirement.base_id === 'salt' || lot.base_id === 'salt' ? 'salt' : 'primary';
      }
    }
    throw new Error(lot.base_id === 'cabbage' ? 'ERR_INVALID_LOT_STATE' : 'ERR_PROCESSING_INPUT_MISSING');
  }

  private assertFacilityAllowed(method: ProcessingMethodConfig, definitionId: string): void {
    const allowed = method.facility_requirements ?? [];
    if (allowed.length > 0 && !allowed.includes(definitionId)) throw new Error('ERR_PROCESSING_FACILITY_NOT_ALLOWED');
  }

  private buildEnvironmentSnapshot(save: SaveFile, containerId: string): ProcessingTask['environment_snapshot'] {
    const container = save.storage_containers.find((item) => item.container_id === containerId);
    if (!container) throw new Error(`ERR_STORAGE_CONTAINER_NOT_FOUND:${containerId}`);
    return {
      temperature_state: container.temperature_state ?? 'normal',
      humidity_state: container.humidity_state ?? 'normal',
      cleanliness: Number(container.cleanliness ?? 50),
      ventilation: container.ventilation ?? 'normal',
      season: save.world_time.season,
      weather: save.world_time.weather,
      container_id: container.container_id
    };
  }

  private buildOutputPropertyProfile(materialDef: Record<string, unknown>, method: ProcessingMethodConfig, task: ProcessingTask): Record<string, number | string | boolean> {
    const defaults = { ...(materialDef.property_defaults as Record<string, number | string | boolean>) };
    const transforms = method.property_transform_rules ?? {};
    const moistureReduction = Number(transforms.moisture_reduction_base ?? 18);
    const fermentationGain = Number(transforms.fermentation_gain_base ?? 35);
    const acidityGain = Number(transforms.acidity_gain_base ?? 12);
    const crunchLoss = Number(transforms.crunch_loss_base ?? 10);
    const saltInput = task.input_lot_refs.find((input) => input.role === 'salt');
    const primaryInput = task.input_lot_refs.find((input) => input.role === 'primary');
    const saltRatio = primaryInput && saltInput && primaryInput.quantity.unit === 'g' && saltInput.quantity.unit === 'g'
      ? saltInput.quantity.amount / Math.max(1, primaryInput.quantity.amount)
      : 0;
    const saltiness = Math.max(0, Math.min(100, saltRatio * 1000));
    return {
      ...defaults,
      moisture: Math.max(0, Number(defaults.moisture ?? 80) - moistureReduction),
      fermentation: Math.min(100, Number(defaults.fermentation ?? 0) + fermentationGain),
      acidity: Math.min(100, Number(defaults.acidity ?? 0) + acidityGain),
      crunch: Math.max(0, Number(defaults.crunch ?? 70) - crunchLoss),
      salinity: saltiness,
      freshness: Math.min(100, Number(defaults.freshness ?? 100) - 10),
      microbial_risk: Math.max(0, Number(defaults.microbial_risk ?? 0) + (task.environment_snapshot.cleanliness < 50 ? 15 : 5))
    };
  }
}
