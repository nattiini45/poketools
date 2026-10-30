/**
 * Completed-match readers against the in-memory PostgREST with a 1000-row `max_rows` ceiling.
 * `getCompletedMatchRecords`, `getCompletedMatchRecordsBatch` and `getPlayerIdsWithCompletedMatches`
 * used an unordered `.limit(2000)`, which the server cut to 1000 rows without a signal, so standings
 * and profile composition lost matches in large stages. They now page `.range()` on (created_at, id)
 * and stay ONE query for a result of 1000 rows or fewer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeRow, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

import {
  getCompletedMatchRecords,
  getCompletedMatchRecordsBatch,
  getPlayerIdsWithCompletedMatches,
} from '../matches';

const T = 'big-stage';

function idOf(i: number): string {
  return `m-${String(i).padStart(5, '0')}`;
}

/**
 * `count` completed matches of one tournament, stored newest first so the read's order is what puts
 * them oldest first. Every second pair shares a `created_at`, so `id` must break the tie. Each row
 * carries its own players, so distinct-player counts exceed the page size.
 */
function completedRows(count: number, tournamentId = T, offset = 0): FakeRow[] {
  return Array.from({ length: count }, (_, k) => {
    const i = offset + k;
    return {
      id: idOf(i),
      tournament_id: tournamentId,
      status: 'completed',
      player_1_id: `pl-${i}-a`,
      player_2_id: `pl-${i}-b`,
      winner_id: `pl-${i}-a`,
      created_at: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 2) * 60_000).toISOString(),
      rounds: { round_number: (i % 7) + 1 },
    };
  }).reverse();
}

function expectedRecord(i: number) {
  return {
    match_id: idOf(i),
    player_1_id: `pl-${i}-a`,
    player_2_id: `pl-${i}-b`,
    winner_id: `pl-${i}-a`,
    round_number: (i % 7) + 1,
  };
}

function expectedRecords(count: number, offset = 0) {
  return Array.from({ length: count }, (_, k) => expectedRecord(offset + k));
}

function use(matches: FakeRow[]): FakeSupabase {
  fake.current = createFakeSupabase({ matches }, {}, { maxRows: 1000 });
  return fake.current;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return () => warn.mockRestore();
});

describe('getCompletedMatchRecords', () => {
  it('returns every completed match of a 2345-match tournament, oldest first, over three range queries', async () => {
    const noise: FakeRow[] = [
      ...completedRows(5, 'other-stage', 9000),
      ...completedRows(5, T, 8000).map((r) => ({ ...r, status: 'scheduled' })),
    ];
    const f = use([...completedRows(2345), ...noise]);

    const records = await getCompletedMatchRecords(T);

    // Before: an unordered `.limit(2000)` that the server cut to 1000 rows.
    expect(records).toHaveLength(2345);
    expect(records).toEqual(expectedRecords(2345));
    expect(f.queries).toHaveLength(3);
    expect(f.queries.map((q) => q.range)).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ]);
    for (const q of f.queries) {
      expect(q.table).toBe('matches');
      expect(q.select).toBe('id, player_1_id, player_2_id, winner_id, rounds!inner( round_number )');
      expect(q.limit).toBeNull();
      expect(q.orders).toEqual([
        { column: 'created_at', ascending: true },
        { column: 'id', ascending: true },
      ]);
      expect(q.filters).toEqual([
        { op: 'eq', column: 'tournament_id', value: T },
        { op: 'eq', column: 'status', value: 'completed' },
      ]);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads 3 rows in exactly ONE query and maps them as before', async () => {
    const f = use(completedRows(3));

    const records = await getCompletedMatchRecords(T);

    expect(f.queries).toHaveLength(1);
    expect(records).toEqual(expectedRecords(3));
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads an Evolution Point Buy stage identically (the reader is format-agnostic)', async () => {
    const f = use([...completedRows(3, 'e-stage-1'), ...completedRows(2, 's-stage-1', 100)]);

    const records = await getCompletedMatchRecords('e-stage-1');

    expect(f.queries).toHaveLength(1);
    expect(records).toEqual(expectedRecords(3));
  });

  it('needs a second query, and no warning, for exactly 1000 matches', async () => {
    const f = use(completedRows(1000));

    const records = await getCompletedMatchRecords(T);

    expect(records).toHaveLength(1000);
    expect(f.queries).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops at the 20,000-row bound and logs a warning naming the reader', async () => {
    use(completedRows(20_001));

    const records = await getCompletedMatchRecords(T);

    expect(records).toHaveLength(20_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('getCompletedMatchRecords');
  });

  it('rethrows a client error', async () => {
    const boom = new Error('records unavailable');
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
    builder.range = () => Promise.resolve({ data: null, error: boom });
    fake.current = {
      client: { from: () => builder, rpc: () => Promise.resolve({ data: null, error: null }) },
      queries: [],
      reset: () => {},
    };

    await expect(getCompletedMatchRecords(T)).rejects.toBe(boom);
  });
});

describe('getCompletedMatchRecordsBatch', () => {
  it('returns every row of 2345 matches over 3 tournaments, grouped per tournament in read order', async () => {
    // Interleave tournaments by index so each page mixes them.
    const rows = completedRows(2345).map((r) => ({
      ...r,
      tournament_id: `t-${Number((r.id as string).slice(2)) % 3}`,
    }));
    const f = use([...rows, ...completedRows(4, 'unrelated', 9000)]);

    const result = await getCompletedMatchRecordsBatch(['t-0', 't-1', 't-2']);

    expect(f.queries).toHaveLength(3);
    for (const q of f.queries) {
      expect(q.filters).toEqual([
        { op: 'in', column: 'tournament_id', value: ['t-0', 't-1', 't-2'] },
        { op: 'eq', column: 'status', value: 'completed' },
      ]);
      expect(q.orders).toEqual([
        { column: 'created_at', ascending: true },
        { column: 'id', ascending: true },
      ]);
      expect(q.limit).toBeNull();
    }
    expect([...result.keys()].sort()).toEqual(['t-0', 't-1', 't-2']);
    expect([...result.values()].reduce((sum, list) => sum + list.length, 0)).toBe(2345);

    // Each tournament's list keeps read order (created_at, id), which here is the index order.
    for (const [t, list] of result) {
      const n = Number(t.slice(2));
      const indexes = Array.from({ length: 2345 }, (_, i) => i).filter((i) => i % 3 === n);
      expect(list).toEqual(indexes.map(expectedRecord));
    }
  });

  it('keys only tournaments that have rows, in ONE query for a short result', async () => {
    const f = use(completedRows(3, 't-1'));

    const result = await getCompletedMatchRecordsBatch(['t-1', 't-empty']);

    expect(f.queries).toHaveLength(1);
    expect([...result.keys()]).toEqual(['t-1']);
    expect(result.get('t-1')).toEqual(expectedRecords(3));
    expect(warn).not.toHaveBeenCalled();
  });

  it('issues no query for an empty id list', async () => {
    const f = use(completedRows(3));

    const result = await getCompletedMatchRecordsBatch([]);

    expect(result.size).toBe(0);
    expect(f.queries).toHaveLength(0);
  });
});

describe('getPlayerIdsWithCompletedMatches', () => {
  it('returns every player of 2345 completed matches (more than 1000 distinct players)', async () => {
    const f = use([...completedRows(2345), ...completedRows(3, 'other-stage', 9000)]);

    const ids = await getPlayerIdsWithCompletedMatches([T]);

    expect(f.queries).toHaveLength(3);
    for (const q of f.queries) {
      expect(q.orders).toEqual([{ column: 'id', ascending: true }]);
    }
    expect(ids.size).toBe(2345 * 2);
    expect(ids.has('pl-2344-b')).toBe(true);
    expect(ids.has('pl-0-a')).toBe(true);
    expect(ids.has('pl-9000-a')).toBe(false);
  });

  it('issues no query for an empty id list', async () => {
    const f = use(completedRows(3));

    expect((await getPlayerIdsWithCompletedMatches([])).size).toBe(0);
    expect(f.queries).toHaveLength(0);
  });
});
