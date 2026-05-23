export interface RuntimeConfigSnapshot {
  snapshot_id: string;
  source_formal_design_version: string;
  source_config_profile: string;
  source_config_hash_sha256: string;
  loaded_documents: Record<string, unknown>;
  schema_paths: string[];
}

export interface StageRuntimeConfig {
  snapshot: RuntimeConfigSnapshot;
  stageId: string;
  ruleVersions: Record<string, unknown>;
  stageActiveConfig: Record<string, unknown>;
  initialWorld: Record<string, unknown>;
  newGameBuilderMapping: Record<string, unknown>;
  documents: Record<string, unknown>;
}
