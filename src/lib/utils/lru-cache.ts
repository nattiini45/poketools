/**
 * Shared in-memory LRU cache with TTL expiry.
 *
 * Used by the AI agent tools (pkmn / smogon / execute) so each module does not
 * re-implement the same Map-based LRU. Per-module `CACHE_TTL_MS` /
 * `CACHE_MAX_ENTRIES` are passed to the constructor, preserving the original
 * per-module budgets.
 *
 * Recency is refreshed on read (Map preserves insertion order → re-insert moves
 * an entry to newest). Eviction removes the oldest insertion-order key when the
 * size cap is reached.
 */
export interface LruCacheOptions {
  ttlMs: number;
  maxEntries: number;
}

interface CacheEntry<V> {
  value: V;
  expires: number;
}

export class LruCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, CacheEntry<unknown>>();

  constructor(opts: LruCacheOptions) {
    this.ttlMs = opts.ttlMs;
    this.maxEntries = opts.maxEntries;
  }

  get<T>(key: string): T | undefined {
    return this.lookup(key)?.value as T | undefined;
  }

  /**
   * Like `get()`, but wraps the hit so a cached `undefined` value stays
   * distinguishable from a miss. Use this when the cached type is `unknown`
   * or may legitimately be `undefined`.
   */
  getEntry<T>(key: string): { value: T } | undefined {
    const entry = this.lookup(key);
    return entry ? { value: entry.value as T } : undefined;
  }

  private lookup(key: string): CacheEntry<unknown> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency (Map preserves insertion order → re-insert moves to newest).
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  set(key: string, value: unknown): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}