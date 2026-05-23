import type { FeatureFlagsSnapshot } from '../domain/types';
import type { ConfigRepository } from '../config/ConfigRepository';

export class FeatureFlagService {
  constructor(private readonly configs: ConfigRepository) {}

  buildSnapshot(profileId = 'stage_1A'): FeatureFlagsSnapshot {
    const core = this.configs.requiredDoc<Record<string, unknown>>('configs/core/feature_flags.yaml');
    const overridesDoc = this.configs.requiredDoc<Record<string, unknown>>('configs/active_stage_1A/feature_flag_overrides.yaml');
    const dependenciesDoc = this.configs.requiredDoc<Record<string, unknown>>('configs/core/feature_flag_dependencies.yaml');
    const overrides = (overridesDoc.feature_flag_overrides ?? {}) as Record<string, unknown>;
    const configured = this.flattenFlags(core, overrides);
    const runtimeFlags = this.applyRuntimeGateDependencies(configured, dependenciesDoc);
    return {
      profile_id: profileId,
      merge_policy: 'override_core_feature_flags_by_key',
      source_config_hash: this.configs.sourceConfigHash,
      flags: runtimeFlags
    };
  }

  isRuntimeEnabled(saveFlags: FeatureFlagsSnapshot, flagId: string): boolean {
    return saveFlags.flags[flagId] === true;
  }

  private flattenFlags(core: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(core)) {
      if (typeof value === 'boolean') result[key] = value;
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === 'boolean') result[key] = value;
    }
    return result;
  }

  private applyRuntimeGateDependencies(configured: Record<string, boolean>, dependenciesDoc: Record<string, unknown>): Record<string, boolean> {
    const runtime: Record<string, boolean> = { ...configured };
    const dependencies = (dependenciesDoc.dependencies ?? {}) as Record<string, unknown>;
    for (const [child, rawRule] of Object.entries(dependencies)) {
      if (!rawRule || typeof rawRule !== 'object') continue;
      const rule = rawRule as Record<string, unknown>;
      const requiresAll = Array.isArray(rule.requires_all) ? rule.requires_all.filter((x): x is string => typeof x === 'string') : [];
      const requiresFalse = Array.isArray(rule.requires_false) ? rule.requires_false.filter((x): x is string => typeof x === 'string') : [];
      if (requiresAll.length > 0) {
        runtime[child] = configured[child] === true && requiresAll.every((parent) => runtime[parent] === true);
      }
      if (requiresFalse.length > 0) {
        runtime[child] = runtime[child] === true && requiresFalse.every((parent) => runtime[parent] === false);
      }
      if (rule.dependency_mode === 'debug_overlay_gate' && Array.isArray(rule.allowed_stages) && !rule.allowed_stages.includes('stage_1A')) {
        runtime[child] = false;
      }
    }
    return runtime;
  }
}
