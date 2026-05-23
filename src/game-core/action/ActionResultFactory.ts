import type { ActionObjectRef, ActionRequest, ActionResult, ConsumedResourceRef, EventLogEntry, MessageParam } from './ActionTypes';
import type { DomainEvent } from '../domain/types';

interface BuildOptions {
  status_code?: string;
  message_key?: string;
  message_params?: MessageParam[];
  consumed_resources?: ConsumedResourceRef[];
  created_objects?: ActionObjectRef[];
  updated_objects?: ActionObjectRef[];
  released_reservations?: string[];
  domain_events?: DomainEvent[];
  event_log_entries?: EventLogEntry[];
  warnings?: string[];
  preview_mismatch?: boolean;
  debug_trace?: ActionResult['debug_trace'];
}

export class ActionResultFactory {
  success(request: ActionRequest, options: BuildOptions = {}): ActionResult {
    return {
      request_id: request.request_id,
      success: true,
      status_code: options.status_code ?? 'OK',
      message_key: options.message_key ?? `action_result.${request.action_type}.ok`,
      message_params: options.message_params ?? [],
      consumed_resources: options.consumed_resources ?? [],
      created_objects: options.created_objects ?? [],
      updated_objects: options.updated_objects ?? [],
      released_reservations: options.released_reservations ?? [],
      domain_events: options.domain_events ?? [],
      event_log_entries: options.event_log_entries ?? [{ message_key: `event_log.${request.action_type}.ok` }],
      warnings: options.warnings ?? [],
      preview_mismatch: options.preview_mismatch ?? false,
      ...(options.debug_trace === undefined ? {} : { debug_trace: options.debug_trace })
    };
  }

  failure(request: ActionRequest, statusCode: string, messageParams: Record<string, unknown> = {}): ActionResult {
    return {
      request_id: request.request_id ?? 'invalid_request',
      success: false,
      status_code: statusCode,
      message_key: `action_result.${statusCode}`,
      message_params: this.toMessageParams(messageParams),
      consumed_resources: [],
      created_objects: [],
      updated_objects: [],
      released_reservations: [],
      domain_events: [],
      event_log_entries: [],
      warnings: [],
      preview_mismatch: false
    };
  }

  withDomainEvents(result: ActionResult, events: DomainEvent[]): ActionResult {
    return { ...result, domain_events: events };
  }

  private toMessageParams(params: Record<string, unknown>): MessageParam[] {
    return Object.entries(params).map(([key, value]) => ({
      key,
      value: this.normalizeMessageValue(value)
    }));
  }

  private normalizeMessageValue(value: unknown): MessageParam['value'] {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    return JSON.stringify(value);
  }
}
