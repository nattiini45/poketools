/**
 * `getMatchesByTournament` against the in-memory PostgREST: one tournament's
 * matches, oldest first, paged past the `max_rows` ceiling with `.range()`.
 * It used to read 500 rows in no order, so the public tournament page,
 * broadcast standings and bracket generation could silently miss matches in
 * a large stage. A tournament under 1000 matches must stay ONE query (the
 * page query budgets count it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';
import { buildFixtureTables } from '@/lib/worlds/__tests__/world-fixture-db';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

import { getMatchesByTournament } from '../matches';

const T = 'big-stage';

/**
 * `count` matches of tournament T (plus one of another tournament), stored
 * newest first so the read's order is what puts them oldest first. Every
 * second pair shares a `created_at`, so `id` must break the tie.
 */
function manyMatches(count: number) {
  const tables = buildFixtureTables();
  const template = tables.matches[0];
  const rows = Array.from({ length: count }, (_, i) => ({
    ...template,
    id: `m-${String(i).padStart(5, '0')}`,
    tournament_id: T,
    created_at: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 2) * 60_000).toISOString(),
  }));
  return {
    ...tables,
    matches: [...rows.reverse(), { ...template, id: 'other', tournament_id: 'other-stage' }],
  };
}

function expectedIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `m-${String(i).padStart(5, '0')}`);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return () => warn.mockRestore();
});

describe('getMatchesByTournament', () => {
  it('reads a tournament under 1000 matches in ONE query, oldest first (created_at, then id)', async () => {
    fake.current = createFakeSupabase(manyMatches(600));

    const matches = await getMatchesByTournament(T);

    expect(fake.current.queries).toHaveLength(1);
    const [read] = fake.current.queries;
    expect(read.filters).toEqual([{ op: 'eq', column: 'tournament_id', value: T }]);
    expect(read.orders).toEqual([
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ]);
    expect(read.range).toEqual({ from: 0, to: 999 });
    expect(read.limit).toBeNull();
    // Before: `.limit(500)` with no order returned an arbitrary 500 of the 600.
    expect(matches.map((m) => m.id)).toEqual(expectedIds(600));
    expect(warn).not.toHaveBeenCalled();
  });

  it('pages past the max_rows ceiling with .range() instead of truncating', async () => {
    fake.current = createFakeSupabase(manyMatches(2300));

    const matches = await getMatchesByTournament(T);

    expect(fake.current.queries.map((q) => q.range)).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ]);
    expect(matches.map((m) => m.id)).toEqual(expectedIds(2300));
    expect(warn).not.toHaveBeenCalled();
  });

  it('a full last window costs one extra, empty read', async () => {
    fake.current = createFakeSupabase(manyMatches(1000));

    const matches = await getMatchesByTournament(T);

    expect(fake.current.queries).toHaveLength(2);
    expect(matches).toHaveLength(1000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an empty tournament is one query and an empty list', async () => {
    fake.current = createFakeSupabase(manyMatches(0));

    expect(await getMatchesByTournament(T)).toEqual([]);
    expect(fake.current.queries).toHaveLength(1);
  });

  it('discloses reaching its 10 000-match bound instead of masking it', async () => {
    fake.current = createFakeSupabase(manyMatches(10_001));

    const matches = await getMatchesByTournament(T);

    expect(fake.current.queries).toHaveLength(10);
    expect(matches).toHaveLength(10_000);
    expect(matches.at(-1)?.id).toBe('m-09999');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('10000-match bound'));
  });

  it('a read error on a later page is thrown, not dropped', async () => {
    const inner = createFakeSupabase(manyMatches(1200));
    let reads = 0;
    fake.current = {
      ...inner,
      client: {
        ...inner.client,
        from: (table: string) => {
          const builder = inner.client.from(table) as Record<string, unknown>;
          reads++;
          if (reads === 2) {
            builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              Promise.resolve({ data: null, error: new Error('page 2 failed') }).then(onFulfilled, onRejected);
          }
          return builder;
        },
      },
    } as FakeSupabase;

    await expect(getMatchesByTournament(T)).rejects.toThrow('page 2 failed');
  });
});
