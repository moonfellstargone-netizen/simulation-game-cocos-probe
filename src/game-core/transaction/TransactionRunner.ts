import type { GameState } from '../domain/types';
import { deepClone } from '../shared/deepClone';

export class TransactionRunner {
  run<T>(state: GameState, operation: () => T): T {
    const before = deepClone(state);
    try {
      return operation();
    } catch (error) {
      state.save_file = before.save_file;
      state.domain_events = before.domain_events;
      throw error;
    }
  }
}
