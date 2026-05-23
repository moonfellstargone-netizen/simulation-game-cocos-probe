import type { GameState } from '../domain/types';
import { deepClone } from '../shared/deepClone';

export class SaveManager {
  serialize(state: GameState): string {
    return JSON.stringify(state.save_file);
  }

  deserializeSaveFile(serialized: string): GameState {
    const saveFile = JSON.parse(serialized) as GameState['save_file'];
    return { save_file: saveFile, domain_events: [] };
  }

  cloneState(state: GameState): GameState {
    return deepClone(state);
  }
}
