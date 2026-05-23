import type { DefinitionRef, MaterialLot, Quantity, SourceRef, StorageRef } from '../domain/types';
import type { IdService } from '../id/IdService';

export interface CreateMaterialLotOptions {
  lotIdPrefix?: string;
  base_id: string;
  category: string;
  quantity: Quantity;
  current_form: string;
  property_profile: Record<string, number | string | boolean>;
  source_ref: SourceRef;
  storage_ref: StorageRef;
  definition_ref: DefinitionRef;
  storage_footprint: Quantity;
  world_time: number;
  schema_version: string;
  rules_version: string;
  flags?: string[];
  lineage_summary?: Record<string, unknown>;
}

export class MaterialLotFactory {
  constructor(private readonly ids: IdService) {}

  create(options: CreateMaterialLotOptions): MaterialLot {
    const lot: MaterialLot = {
      lot_id: this.ids.next(options.lotIdPrefix ?? 'lot'),
      base_id: options.base_id,
      category: options.category,
      quantity: { ...options.quantity },
      current_form: options.current_form,
      property_profile: { ...options.property_profile },
      source_ref: { ...options.source_ref },
      storage_ref: { ...options.storage_ref },
      created_time: options.world_time,
      last_update_time: options.world_time,
      schema_version: options.schema_version,
      rules_version: options.rules_version,
      flags: options.flags ?? [],
      definition_ref: { ...options.definition_ref },
      storage_footprint: { ...options.storage_footprint }
    };
    if (options.lineage_summary !== undefined) lot.lineage_summary = options.lineage_summary;
    return lot;
  }
}
