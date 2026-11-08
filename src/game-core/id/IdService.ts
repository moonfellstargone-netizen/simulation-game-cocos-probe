export interface IdService {
  next(prefix: string): string;
}

export class DeterministicIdService implements IdService {
  private readonly counters = new Map<string, string>();

  checkpoint(): ReadonlyMap<string, string> { return new Map(this.counters); }

  restore(checkpoint: ReadonlyMap<string, string>): void {
    this.counters.clear();
    for (const [prefix, value] of checkpoint) this.counters.set(prefix, value);
  }

  observeExisting(value: unknown): void {
    const pending: unknown[] = [value];
    const visited = new WeakSet<object>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (typeof current === 'string') {
        this.observeId(current);
      } else if (current !== null && typeof current === 'object' && !visited.has(current)) {
        visited.add(current);
        for (const [key, entry] of Object.entries(current)) {
          this.observeId(key);
          pending.push(entry);
        }
      }
    }
  }

  next(prefix: string): string {
    const digits = (this.counters.get(prefix) ?? '0').split('');
    let position = digits.length - 1;
    while (position >= 0 && digits[position] === '9') {
      digits[position] = '0';
      position -= 1;
    }
    if (position < 0) {
      digits.unshift('1');
    } else {
      digits[position] = String.fromCharCode(digits[position]!.charCodeAt(0) + 1);
    }
    const nextValue = digits.join('');
    this.counters.set(prefix, nextValue);
    return `${prefix}_${nextValue.padStart(6, '0')}`;
  }

  private observeId(value: string): void {
    const separator = value.lastIndexOf('_');
    if (separator <= 0) return;
    const suffix = value.slice(separator + 1);
    if (suffix.length < 6 || !/^[0-9]+$/.test(suffix)) return;
    const prefix = value.slice(0, separator);
    const observed = suffix.replace(/^0+/, '') || '0';
    const current = this.counters.get(prefix) ?? '0';
    if (observed.length > current.length || (observed.length === current.length && observed > current)) {
      this.counters.set(prefix, observed);
    }
  }
}
