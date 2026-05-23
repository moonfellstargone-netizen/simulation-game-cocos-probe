import type { RuntimeConfigSnapshot, StageRuntimeConfig } from './RuntimeConfigSnapshot';

export class ConfigRepository {
  private readonly snapshot: RuntimeConfigSnapshot;

  constructor(snapshot: RuntimeConfigSnapshot) {
    this.snapshot = snapshot;
  }

  loadStage1A(): StageRuntimeConfig {
    const docs = this.snapshot.loaded_documents;
    return {
      snapshot: this.snapshot,
      stageId: this.inferStageId(),
      ruleVersions: this.requiredDoc('configs/core/rule_versions.yaml'),
      stageActiveConfig: this.requiredDoc('configs/active_stage_1A/stage_1A_active_config.yaml'),
      initialWorld: this.requiredDoc('configs/initial_world/stage_1A_initial_world.yaml'),
      newGameBuilderMapping: this.requiredDoc('configs/core/new_game_builder_mapping.yaml'),
      documents: docs
    };
  }

  private inferStageId(): string {
    const activeConfig = this.requiredDoc<Record<string, unknown>>('configs/active_stage_1A/stage_1A_active_config.yaml');
    if (typeof activeConfig.stage_id === 'string') return activeConfig.stage_id;
    if (this.snapshot.source_config_profile.includes('stage_1A')) return 'stage_1A';
    throw new Error('ERR_STAGE_ID_NOT_FOUND');
  }

  requiredDoc<T = Record<string, unknown>>(path: string): T {
    const doc = this.snapshot.loaded_documents[path];
    if (doc === undefined) {
      throw new Error(`ERR_CONFIG_DOC_NOT_LOADED:${path}`);
    }
    return doc as T;
  }

  findDocumentByTopLevelKey(key: string): unknown[] {
    return Object.values(this.snapshot.loaded_documents).filter((doc) => {
      return typeof doc === 'object' && doc !== null && key in (doc as Record<string, unknown>);
    });
  }

  get sourceConfigHash(): string {
    return this.snapshot.source_config_hash_sha256;
  }
}
