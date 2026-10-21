/**
 * Test-only in-memory stand-in for `next/cache` (not a test file itself).
 *
 * `unstable_cache` keeps one entry per key parts + arguments, stores the
 * result as JSON and answers a hit with `JSON.parse` — as the Next data cache
 * does — so a value that does not survive JSON shows up in tests.
 * `revalidateTag` drops every entry carrying the tag; `revalidatePath` is only
 * recorded. Time-based revalidation is not modelled: within a test every
 * entry is inside its TTL.
 *
 * Use it from a test with:
 *
 *   vi.mock('next/cache', async () =>
 *     (await import('@/lib/cache/__tests__/fake-next-cache')).fakeNextCache.module);
 *
 * and import `fakeNextCache` in the test to inspect and reset it.
 */

type AnyAsync = (...args: never[]) => Promise<unknown>;

export interface CachedReadRecord {
  keyParts: string[];
  tags: string[];
  revalidate: number | false | undefined;
  hit: boolean;
}

export interface FakeNextCache {
  /** What `vi.mock('next/cache', …)` should return. */
  module: {
    unstable_cache: <T extends AnyAsync>(
      cb: T,
      keyParts?: string[],
      options?: { tags?: string[]; revalidate?: number | false },
    ) => T;
    revalidateTag: (tag: string, profile: string | { expire?: number }) => void;
    revalidatePath: (path: string, type?: 'layout' | 'page') => void;
  };
  /** Every cached call, in order. */
  reads: CachedReadRecord[];
  /** Every `revalidateTag` call, in order. */
  expiredTags: Array<{ tag: string; profile: string | { expire?: number } }>;
  /** Every `revalidatePath` call, in order. */
  revalidatedPaths: Array<{ path: string; type?: 'layout' | 'page' }>;
  /** Live entries by key. */
  entries: Map<string, { body: string; tags: string[] }>;
  /** Forget entries and records. */
  reset(): void;
}

function createFakeNextCache(): FakeNextCache {
  const fake: FakeNextCache = {
    module: {
      unstable_cache: <T extends AnyAsync>(
        cb: T,
        keyParts: string[] = [],
        options: { tags?: string[]; revalidate?: number | false } = {},
      ): T => {
        const tags = [...(options.tags ?? [])];
        const run = async (...args: Parameters<T>) => {
          const key = JSON.stringify([keyParts, args]);
          const entry = fake.entries.get(key);
          fake.reads.push({ keyParts: [...keyParts], tags, revalidate: options.revalidate, hit: !!entry });
          if (entry) return JSON.parse(entry.body) as unknown;
          const result = await cb(...args);
          fake.entries.set(key, { body: JSON.stringify(result) ?? 'null', tags });
          return result;
        };
        return run as unknown as T;
      },
      revalidateTag: (tag, profile) => {
        fake.expiredTags.push({ tag, profile });
        for (const [key, entry] of fake.entries) {
          if (entry.tags.includes(tag)) fake.entries.delete(key);
        }
      },
      revalidatePath: (path, type) => {
        fake.revalidatedPaths.push(type ? { path, type } : { path });
      },
    },
    reads: [],
    expiredTags: [],
    revalidatedPaths: [],
    entries: new Map(),
    reset() {
      fake.reads.length = 0;
      fake.expiredTags.length = 0;
      fake.revalidatedPaths.length = 0;
      fake.entries.clear();
    },
  };
  return fake;
}

/** One shared instance per test file (vitest isolates modules per file). */
export const fakeNextCache = createFakeNextCache();
