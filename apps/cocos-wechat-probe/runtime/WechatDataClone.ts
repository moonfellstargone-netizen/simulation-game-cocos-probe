/** Bundle-local clone for formal DTOs; no engine/platform/global mutation. */
export function structuredClone<T>(value: T, options?: unknown): T {
  const unsupported = (): never => {
    const error = new Error('ERR_WECHAT_DATA_CLONE_UNSUPPORTED');
    error.name = 'DataCloneError';
    throw error;
  };
  if (options !== undefined) unsupported();
  const seen = new Map<object, unknown>();
  const copy = (input: unknown): unknown => {
    if (input === null || ['undefined', 'string', 'boolean', 'number', 'bigint'].includes(typeof input)) return input;
    if (typeof input !== 'object') return unsupported();
    const object = input as object;
    if (seen.has(object)) return seen.get(object);
    const array = Array.isArray(object);
    const prototype = Object.getPrototypeOf(object);
    if (!array && prototype !== Object.prototype && prototype !== null) return unsupported();
    const result: Record<string, unknown> | unknown[] = array ? new Array((object as unknown[]).length) : {};
    seen.set(object, result);
    for (const key of Object.keys(object)) {
      Object.defineProperty(result, key, { value: copy((object as Record<string, unknown>)[key]),
        enumerable: true, configurable: true, writable: true });
    }
    return result;
  };
  return copy(value) as T;
}
