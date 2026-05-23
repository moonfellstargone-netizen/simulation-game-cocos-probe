import type { ConfigRepository } from '../config/ConfigRepository';
import type { CropInstance, MaterialLot, Quantity, SaveFile, StorageRef } from '../domain/types';
import type { IdService } from '../id/IdService';
import { InventorySystem } from '../inventory/InventorySystem';

export class FarmingSystem {
  private readonly inventory: InventorySystem;

  constructor(private readonly configs: ConfigRepository, private readonly ids: IdService) {
    this.inventory = new InventorySystem(ids);
  }

  plantCrop(save: SaveFile, fieldPlotId: string, seedLotId: string, seedQuantity: Quantity): CropInstance {
    const seed = this.inventory.findMaterialLot(save, seedLotId);
    const seedDef = this.configs.requiredDoc<Record<string, unknown>>('configs/farming/seeds/cabbage_seed.yaml');
    if (seed.base_id !== seedDef.id) throw new Error('ERR_INVALID_PROPAGATION_MATERIAL');
    if (seed.current_form !== 'dry_seed') throw new Error('ERR_INVALID_LOT_STATE');
    const field = save.fields.find((item) => item.field_plot_id === fieldPlotId);
    if (!field) throw new Error(`ERR_FIELD_NOT_FOUND:${fieldPlotId}`);
    if (field.active_crop_ids.length > 0) throw new Error('ERR_FIELD_OCCUPIED');
    this.inventory.consume(save, seedLotId, seedQuantity);
    const growthProfile = this.configs.requiredDoc<Record<string, unknown>>('configs/farming/growth_profiles/cabbage_growth_basic.yaml');
    const duration = Number(growthProfile.base_growth_duration_minutes ?? 4320);
    const expectedHarvestMinute = save.world_time.absolute_minute + Math.ceil(duration / 0.85 / 0.95);
    const crop: CropInstance = {
      crop_id: this.ids.next('crop'),
      crop_base_id: String(seedDef.crop_base_id),
      seed_lot_id: seedLotId,
      field_plot_id: fieldPlotId,
      planted_time: save.world_time.absolute_minute,
      growth_stage: 'seed',
      lifecycle_status: 'active',
      growth_progress: 0,
      expected_harvest_minute: expectedHarvestMinute,
      health: 100,
      season_context: save.world_time.season,
      source_ref: {
        source_type: 'farming',
        source_id: seedLotId,
        source_time: save.world_time.absolute_minute,
        source_actor: 'player',
        source_location: fieldPlotId
      },
      created_time: save.world_time.absolute_minute,
      last_update_time: save.world_time.absolute_minute,
      flags: []
    };
    save.crop_instances.push(crop);
    field.active_crop_ids.push(crop.crop_id);
    field.occupied_tiles += 1;
    return crop;
  }

  advanceGrowth(save: SaveFile, minutes: number): void {
    for (const crop of save.crop_instances) {
      if (crop.lifecycle_status !== 'active') continue;
      const totalDuration = Math.max(1, crop.expected_harvest_minute - crop.planted_time);
      const elapsed = Math.max(0, save.world_time.absolute_minute - crop.planted_time);
      const progress = Math.min(100, Math.floor((elapsed / totalDuration) * 100));
      crop.growth_progress = progress;
      crop.growth_stage = this.growthStageFor(progress);
      crop.last_update_time = save.world_time.absolute_minute;
      if (progress >= 100) crop.lifecycle_status = 'ready_to_harvest';
    }
  }

  harvest(save: SaveFile, cropId: string): MaterialLot {
    const crop = save.crop_instances.find((item) => item.crop_id === cropId);
    if (!crop) throw new Error(`ERR_CROP_NOT_FOUND:${cropId}`);
    if (crop.lifecycle_status !== 'ready_to_harvest') throw new Error('ERR_CROP_NOT_MATURE');
    const field = save.fields.find((item) => item.field_plot_id === crop.field_plot_id);
    if (!field) throw new Error(`ERR_FIELD_NOT_FOUND:${crop.field_plot_id}`);
    const materialDef = this.configs.requiredDoc<Record<string, unknown>>('configs/materials/crops/cabbage.yaml');
    const growthProfile = this.configs.requiredDoc<Record<string, unknown>>('configs/farming/growth_profiles/cabbage_growth_basic.yaml');
    const harvestRule = growthProfile.harvest_rule as Record<string, unknown>;
    const storageRef: StorageRef = { location_id: 'home', storage_type: 'room_temp', container_id: 'home_room_temp_01' };
    const quantity = Number(harvestRule.default_quantity_g ?? 1200);
    const footprintRule = materialDef.storage_footprint_rule as Record<string, Record<string, number | string>>;
    const baseQuantity = footprintRule.base_quantity;
    const footprint = footprintRule.footprint;
    if (!baseQuantity || !footprint) throw new Error('ERR_STORAGE_FOOTPRINT_RULE_INVALID');
    const lot: MaterialLot = {
      lot_id: this.ids.next('lot_harvest'),
      base_id: String(harvestRule.output_base_id ?? 'cabbage'),
      category: String(materialDef.category ?? 'vegetable'),
      quantity: { amount: quantity, unit: 'g' },
      current_form: String(harvestRule.output_form ?? 'fresh'),
      property_profile: { ...(materialDef.property_defaults as Record<string, number | string | boolean>) },
      source_ref: {
        source_type: 'farming',
        source_id: crop.crop_id,
        source_time: save.world_time.absolute_minute,
        source_actor: 'player',
        source_location: crop.field_plot_id
      },
      storage_ref: storageRef,
      created_time: save.world_time.absolute_minute,
      last_update_time: save.world_time.absolute_minute,
      schema_version: save.schema_version,
      rules_version: save.rules_version,
      flags: [],
      definition_ref: { type: 'material', id: 'cabbage', canonical_id: 'base:cabbage' },
      storage_footprint: {
        amount: Math.ceil(quantity / Number(baseQuantity.amount) * Number(footprint.amount)),
        unit: 'slot_weight'
      }
    };
    crop.lifecycle_status = 'harvested';
    crop.growth_stage = 'mature';
    crop.last_update_time = save.world_time.absolute_minute;
    field.active_crop_ids = field.active_crop_ids.filter((id) => id !== cropId);
    field.occupied_tiles = Math.max(0, field.occupied_tiles - 1);
    save.inventory.push(lot);
    return lot;
  }

  private growthStageFor(progress: number): CropInstance['growth_stage'] {
    if (progress >= 100) return 'mature';
    if (progress >= 60) return 'growing';
    if (progress >= 20) return 'sprout';
    return 'seed';
  }
}
