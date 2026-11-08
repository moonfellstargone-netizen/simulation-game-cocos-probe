import type { ConfigRepository } from './ConfigRepository';
import type { PhysicalPolicy } from '../storage/PhysicalCapacity';
import { PhysicalPolicyRegistry } from '../storage/PhysicalPolicyRegistry';

export interface PhysicalCapacityConfig {
  default_policy_id: string;
  initial_container_limits: Record<string, { mass_g: number; volume_ml: number }>;
  policies: readonly PhysicalPolicy[];
}

export function loadPhysicalCapacityConfig(configs: ConfigRepository): PhysicalCapacityConfig {
  const config = configs.requiredDoc<PhysicalCapacityConfig>('configs/storage/physical_capacity_policies.yaml');
  if (!config || typeof config.default_policy_id !== 'string' || !config.default_policy_id.trim()
      || !Array.isArray(config.policies) || !config.initial_container_limits || typeof config.initial_container_limits !== 'object') {
    throw new Error('ERR_PHYSICAL_CONFIG_INVALID');
  }
  return config;
}

export function loadPhysicalPolicyRegistry(configs: ConfigRepository): PhysicalPolicyRegistry {
  const config = loadPhysicalCapacityConfig(configs);
  const registry = new PhysicalPolicyRegistry(config.policies);
  registry.resolve(config.default_policy_id);
  return registry;
}
