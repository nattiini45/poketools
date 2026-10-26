/**
 * A small least-recently-used cache for compile results.
 *
 * A Map keeps insertion order, so the first key is the least recently used one: `get` re-inserts the entry it
 * returns, and `set` evicts the first key once the cache is full.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(readonly capacity: number = 32) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('LruCache capacity must be a positive integer');
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  /** Keys from least to most recently used. */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  clear(): void {
    this.entries.clear();
  }
}
