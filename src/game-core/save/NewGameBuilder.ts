import type { ConfigRepository } from '../config/ConfigRepository';
import type { GameState, SaveFile } from '../domain/types';
import { deepClone } from '../shared/deepClone';
import { FeatureFlagService } from '../feature/FeatureFlagService';
import { StorageReconciler } from '../storage/StorageReconciler';

export interface NewGameBuilderOptions {
  buildId: string;
  nowIso8601: string;
  randomSeed?: string;
}

export class NewGameBuilder {
  private readonly featureFlags: FeatureFlagService;
  private readonly storageReconciler = new StorageReconciler();

  constructor(private readonly configs: ConfigRepository) {
    this.featureFlags = new FeatureFlagService(configs);
  }

  buildStage1A(options: NewGameBuilderOptions): GameState {
    const stage = this.configs.loadStage1A();
    const versions = this.versionBundle();
    const initial = stage.initialWorld;
    const save: SaveFile = {
      save_version: 'save.stage1.v1',
      game_version: String(versions.game_version),
      schema_version: String(initial.schema_version),
      rules_version: String(initial.rules_version),
      config_version: String(initial.config_version),
      content_pack_versions: deepClone(versions.content_pack_versions as Record<string, string>),
      created_with_build: options.buildId,
      last_saved_with_build: options.buildId,
      created_at_real_time: options.nowIso8601,
      last_saved_at_real_time: options.nowIso8601,
      world_time: deepClone(initial.world_time as SaveFile['world_time']),
      random_state: { seed: options.randomSeed ?? 'stage1_fixed_seed', streams: {} },
      feature_flags: this.featureFlags.buildSnapshot('stage_1A'),
      player_state: deepClone(initial.player_state as Record<string, unknown>),
      family_state: deepClone(initial.family_state as Record<string, unknown>),
      inventory: deepClone(initial.initial_inventory as SaveFile['inventory']),
      storage_containers: deepClone(initial.storage_containers as SaveFile['storage_containers']),
      home_water: deepClone(initial.home_water as Record<string, unknown>),
      fields: deepClone(initial.fields as SaveFile['fields']),
      animals: [],
      processing_tasks: [],
      dish_lots: [],
      orders: deepClone(initial.initial_orders as SaveFile['orders']),
      npc_relations: {},
      story_flags: deepClone(initial.story_flags as Record<string, unknown>),
      discovered_clues: [],
      story_event_log: [],
      story_choices: {},
      story_items_state: {},
      tools_state: this.loadToolStateMap(initial.initial_tools_ref as string),
      facilities_state: this.loadFacilityStateMap(initial.initial_facilities_ref as string),
      fuel_state: this.loadFuelStateMap(initial.initial_fuel_ref as string),
      event_log_summary: {
        last_event_id: null,
        total_event_count: 0,
        compressed_until_absolute_minute: 0,
        channels: {}
      },
      migration_history: [],
      migration_warnings: [],
      last_migration_at: null,
      debug_flags: [],
      crop_instances: [],
      reservations: []
    };
    this.storageReconciler.reconcile(save);
    return { save_file: save, domain_events: [] };
  }

  private versionBundle(): Record<string, unknown> {
    const ruleVersions = this.configs.requiredDoc<Record<string, unknown>>('configs/core/rule_versions.yaml');
    const bundle = ruleVersions.version_bundle;
    if (!bundle || typeof bundle !== 'object') throw new Error('ERR_RULE_VERSION_BUNDLE_MISSING');
    return bundle as Record<string, unknown>;
  }


  private loadToolStateMap(ref: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const raw of this.loadRefList(ref)) {
      const item = this.asRecord(raw, ref);
      const id = this.requiredString(item, 'id', ref);
      result[id] = {
        tool_id: id,
        definition_id: String(item.definition_id ?? id),
        status: String(item.status ?? 'available'),
        condition: String(item.condition ?? 'usable'),
        quality_tier: String(item.quality_tier ?? 'basic'),
        durability_current: item.durability_current ?? null,
        durability_max: item.durability_max ?? null,
        repairable: item.repairable ?? null,
        flags: Array.isArray(item.flags) ? item.flags : []
      };
    }
    return result;
  }

  private loadFacilityStateMap(ref: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const raw of this.loadRefList(ref)) {
      const item = this.asRecord(raw, ref);
      const id = this.requiredString(item, 'id', ref);
      result[id] = {
        facility_id: id,
        definition_id: String(item.definition_id ?? id),
        status: String(item.status ?? 'available'),
        condition: String(item.condition ?? 'usable'),
        quality_tier: String(item.quality_tier ?? 'basic'),
        upgrade_level: Number.isInteger(item.upgrade_level) ? item.upgrade_level : 0,
        durability_current: item.durability_current ?? null,
        durability_max: item.durability_max ?? null,
        capacity_g: item.capacity_g ?? null,
        capacity_ml: item.capacity_ml ?? null,
        container_id: item.container_id ?? null,
        storage_type: item.storage_type ?? null,
        flags: Array.isArray(item.flags) ? item.flags : []
      };
    }
    return result;
  }

  private loadFuelStateMap(ref: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const raw of this.loadRefList(ref)) {
      const item = this.asRecord(raw, ref);
      const id = this.requiredString(item, 'id', ref);
      const unit = typeof item.unit === 'string' ? item.unit : 'bundle';
      result[id] = {
        fuel_id: id,
        definition_id: String(item.definition_id ?? id),
        quantity: { amount: Number(item.quantity ?? 0), unit },
        enough_for_days_estimate: item.enough_for_days_estimate ?? null,
        flags: Array.isArray(item.flags) ? item.flags : []
      };
    }
    return result;
  }

  private asRecord(item: unknown, ref: string): Record<string, unknown> {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`ERR_EXPANDED_REF_ITEM_NOT_OBJECT:${ref}`);
    return item as Record<string, unknown>;
  }

  private requiredString(item: Record<string, unknown>, key: string, ref: string): string {
    const value = item[key];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`ERR_EXPANDED_REF_ITEM_ID_MISSING:${ref}:${key}`);
    return value;
  }

  private loadRefMap(ref: string, idField: string): Record<string, unknown> {
    const list = this.loadRefList(ref);
    const map: Record<string, unknown> = {};
    for (const item of list) {
      if (!item || typeof item !== 'object') throw new Error(`ERR_EXPANDED_REF_ITEM_NOT_OBJECT:${ref}`);
      const id = (item as Record<string, unknown>)[idField];
      if (typeof id !== 'string' || id.length === 0) throw new Error(`ERR_EXPANDED_REF_ITEM_ID_MISSING:${ref}`);
      map[id] = item;
    }
    return map;
  }

  private loadRefList(ref: string): unknown[] {
    const [rawPath, fragment] = ref.split('#');
    if (!rawPath || !fragment) throw new Error(`ERR_EXPANDED_REF_INVALID:${ref}`);
    const normalized = this.normalizeConfigRef(rawPath);
    const doc = this.configs.requiredDoc<Record<string, unknown>>(normalized);
    const value = doc[fragment];
    if (!Array.isArray(value)) throw new Error(`ERR_EXPANDED_REF_NOT_LIST:${ref}`);
    return deepClone(value);
  }

  private normalizeConfigRef(pathFromInitialWorld: string): string {
    const prefix = '../';
    if (!pathFromInitialWorld.startsWith(prefix)) return pathFromInitialWorld;
    return `configs/${pathFromInitialWorld.slice(prefix.length)}`;
  }
}
