import type { DomainEvent, GameState } from '../domain/types';
import type { IdService } from '../id/IdService';

export type DomainEventDraft = Omit<DomainEvent, 'event_id'>;

export class DomainEventBus {
  constructor(private readonly ids: IdService) {}

  append(state: GameState, event: DomainEventDraft): DomainEvent {
    const domainEvent: DomainEvent = {
      event_id: this.ids.next('evt'),
      debug_only: false,
      ...event
    };
    state.domain_events.push(domainEvent);
    state.save_file.event_log_summary = {
      ...state.save_file.event_log_summary,
      last_event_id: domainEvent.event_id,
      total_event_count: (Number(state.save_file.event_log_summary.total_event_count) || 0) + 1
    };
    return domainEvent;
  }
}
