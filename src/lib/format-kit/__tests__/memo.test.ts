import { beforeEach, describe, expect, it } from 'vitest';
import { clearCompileCache, compile, compileCacheSize } from '../compile';
import {
  compile as compileBrowser,
  clearCompileCache as clearBrowserCache,
  compileCacheSize as browserCacheSize,
} from '../compile.browser';
import { LruCache } from '../engine/memo';
import { CURRENT_ENV } from '../engine/env';
import { classicLeague } from '../presets/classic-league';
import { cup } from '../presets/cup';
import { mutate, rosterEnv } from './fixtures/negative';

/** The same document with every object's keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
  }
  return value;
}

describe('LruCache', () => {
  it('evicts the least recently used entry first', () => {
    const cache = new LruCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1); // a is now the most recent
    cache.set('d', 4); // evicts b
    expect(cache.keys()).toEqual(['c', 'a', 'd']);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(3);
  });

  it('moves a re-set key to the most recent position without growing', () => {
    const cache = new LruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3);
    expect(cache.keys()).toEqual(['b', 'a']);
    expect(cache.get('a')).toBe(3);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('rejects a capacity that is not a positive integer', () => {
    expect(() => new LruCache(0)).toThrow(RangeError);
    expect(() => new LruCache(1.5)).toThrow(RangeError);
    expect(new LruCache().capacity).toBe(32);
  });
});

describe.each([
  ['zod', compile, clearCompileCache],
  ['browser', compileBrowser, clearBrowserCache],
] as const)('compile cache (%s validator)', (_name, run, clear) => {
  beforeEach(() => clear());

  it('returns the identical object for the same document in another key order', () => {
    const first = run(classicLeague);
    expect(run(reverseKeys(classicLeague))).toBe(first);
    expect(run(JSON.parse(JSON.stringify(classicLeague)))).toBe(first);
  });

  it('computes a different result for a different document', () => {
    const changed = mutate(classicLeague, [{ op: 'replace', path: '/stages/0/scoring/win', value: 2 }]);
    expect(run(changed)).not.toBe(run(classicLeague));
  });

  it('recomputes when the environment changes, and reuses an equal environment', () => {
    const base = run(classicLeague, CURRENT_ENV);
    const roster = run(classicLeague, rosterEnv(8));
    expect(roster).not.toBe(base);
    expect(run(classicLeague, rosterEnv(8))).toBe(roster);
    expect(run(classicLeague, { ...CURRENT_ENV, matchModel: { ...CURRENT_ENV.matchModel, draws: true } })).not.toBe(base);
    expect(run(classicLeague, { ...CURRENT_ENV, rulesetIds: new Set(['x', 'y']) })).toBe(
      run(classicLeague, { ...CURRENT_ENV, rulesetIds: new Set(['y', 'x']) }),
    );
  });

  it('is deterministic: two cold compiles are deep-equal', () => {
    const a = run(cup, rosterEnv(16));
    clear();
    const b = run(cup, rosterEnv(16));
    expect(b).not.toBe(a);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('forgets everything on clear', () => {
    const first = run(classicLeague);
    clear();
    expect(run(classicLeague)).not.toBe(first);
  });
});

describe('compile cache size', () => {
  it('keeps one cache per entry point', () => {
    clearCompileCache();
    clearBrowserCache();
    compileBrowser(classicLeague);
    expect(browserCacheSize()).toBe(1);
    expect(compileCacheSize()).toBe(0);
    compile(classicLeague);
    expect(compileCacheSize()).toBe(1);
    clearBrowserCache();
    expect(browserCacheSize()).toBe(0);
    expect(compileCacheSize()).toBe(1);
  });

  it('never holds more than 32 results', () => {
    clearCompileCache();
    for (let i = 0; i < 40; i += 1) {
      compile(mutate(classicLeague, [{ op: 'replace', path: '/stages/0/scoring/win', value: 3 + i }]));
      expect(compileCacheSize()).toBeLessThanOrEqual(32);
    }
    expect(compileCacheSize()).toBe(32);
    clearCompileCache();
    expect(compileCacheSize()).toBe(0);
  });

  it('evicts the oldest document first', () => {
    clearCompileCache();
    const docs = Array.from({ length: 33 }, (_, i) => mutate(classicLeague, [{ op: 'replace', path: '/stages/0/scoring/win', value: 10 + i }]));
    const results = docs.map((doc) => compile(doc));
    expect(compile(docs[32])).toBe(results[32]);
    expect(compile(docs[1])).toBe(results[1]);
    expect(compile(docs[0])).not.toBe(results[0]);
  });
});
