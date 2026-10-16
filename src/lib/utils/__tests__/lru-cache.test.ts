import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LruCache } from '../lru-cache';

describe('LruCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns cached values on hit and undefined on miss', () => {
    const cache = new LruCache({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 42);
    expect(cache.get<number>('a')).toBe(42);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('expires entries after the TTL', () => {
    const cache = new LruCache({ ttlMs: 1000, maxEntries: 10 });
    cache.set('a', 'value');
    vi.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.getEntry('a')).toBeUndefined();
  });

  it('evicts the oldest entry when maxEntries is reached', () => {
    const cache = new LruCache({ ttlMs: 60_000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('refreshes recency on read (LRU bump)', () => {
    const cache = new LruCache({ ttlMs: 60_000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // bump 'a' to newest → 'b' becomes oldest
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  it('getEntry distinguishes a cached undefined value from a miss', () => {
    const cache = new LruCache({ ttlMs: 60_000, maxEntries: 10 });
    cache.set('u', undefined);

    // get() cannot tell these apart — that's the documented limitation.
    expect(cache.get('u')).toBeUndefined();
    expect(cache.get('never-set')).toBeUndefined();

    // getEntry() can.
    expect(cache.getEntry('u')).toEqual({ value: undefined });
    expect(cache.getEntry('never-set')).toBeUndefined();
  });

  it('getEntry distinguishes a cached null value (negative caching)', () => {
    const cache = new LruCache({ ttlMs: 60_000, maxEntries: 10 });
    cache.set('neg', null);
    expect(cache.getEntry('neg')).toEqual({ value: null });
    expect(cache.get('neg')).toBeNull();
  });

  it('clear() empties the cache', () => {
    const cache = new LruCache({ ttlMs: 60_000, maxEntries: 10 });
    cache.set('a', 1);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
  });
});
