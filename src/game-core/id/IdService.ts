export interface IdService {
  next(prefix: string): string;
}

export class DeterministicIdService implements IdService {
  private counters = new Map<string, number>();

  next(prefix: string): string {
    const nextValue = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, nextValue);
    return `${prefix}_${String(nextValue).padStart(6, '0')}`;
  }
}
