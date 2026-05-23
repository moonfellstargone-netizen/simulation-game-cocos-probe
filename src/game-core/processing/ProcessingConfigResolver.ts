import type { ConfigRepository } from '../config/ConfigRepository';

export interface ProcessingMethodConfig {
  id: string;
  display_name_key?: string;
  input_view_requirements?: Array<Record<string, unknown>>;
  tool_requirements?: string[];
  facility_requirements?: string[];
  time_cost_minutes?: number;
  process_duration_minutes?: number;
  environment_effects?: Record<string, unknown>;
  property_transform_rules?: Record<string, unknown>;
  defect_rules?: Record<string, unknown>;
  recovery_options?: Record<string, unknown>;
  output_form_rules?: Record<string, unknown>;
  event_log_rules?: Record<string, string>;
}

export class ProcessingConfigResolver {
  constructor(private readonly configs: ConfigRepository) {}

  resolveMethod(methodId: string): ProcessingMethodConfig {
    for (const [path, document] of Object.entries(this.configs.loadStage1A().documents)) {
      if (!path.startsWith('configs/processing/methods/')) continue;
      if (!document || typeof document !== 'object') continue;
      const method = document as Partial<ProcessingMethodConfig>;
      if (method.id === methodId) return method as ProcessingMethodConfig;
    }
    throw new Error(`ERR_PROCESSING_METHOD_NOT_FOUND:${methodId}`);
  }
}
