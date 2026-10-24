/**
 * Queries behind the matches list bulk actions and the CSV export: `getMatchesByIds`, the two conditional writes
 * (`setMatchScheduledAtIfOpen`, `updateMatchNotesIfUnchanged`) and `listAdminMatchesForExport`.
 *
 * Same recorder as matches-admin-list.test.ts: every `from()` starts a query that logs the builder methods it was
 * given and resolves through a per-test responder, so a test asserts the exact PostgREST calls.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = [string, unknown[]];
interface RecordedCall {
  table: string;
  ops: Op[];
}
type Result = { data?: unknown; error?: unknown; count?: number | null };

const h = vi.hoisted(() => {
  const calls: RecordedCall[] = [];
  const defaultResponder = (): Result => ({ data: [], error: null, count: 0 });
  const state = { responder: defaultResponder as (call: RecordedCall) => Result };
  const METHODS = [
    'select', 'update', 'eq', 'neq', 'in', 'is', 'or', 'not', 'gte', 'lt', 'lte', 'ilike',
    'order', 'limit', 'range', 'maybeSingle',
  ];

  class Recorder {
    call: RecordedCall;
    constructor(table: string) {
      this.call = { table, ops: [] };
      calls.push(this.call);
    }
    then(onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve()
        .then(() => state.responder(this.call))
        .then(onFulfilled, onRejected);
    }
  }
  for (const method of METHODS) {
    (Recorder.prototype as unknown as Record<string, unknown>)[method] = function (this: Recorder, ...args: unknown[]) {
      this.call.ops.push([method, args]);
      return this;
    };
  }

  return { calls, state, defaultResponder, from: (table: string) => new Recorder(table) };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  getMatchesByIds,
  listAdminMatchesForExport,
  listAdminMatchesPage,
  setMatchScheduledAtIfOpen,
  updateMatchNotesIfUnchanged,
  type AdminMatchListParams,
} from '../matches';

const NOW = new Date('2026-10-25T10:00:00.000Z');
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (count: number, offset = 0) => Array.from({ length: count }, (_, i) => uuid(offset + i + 1));

function matchRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    round_id: 'r1',
    tournament_id: U1,
    player_1_id: 'p1',
    player_2_id: 'p2',
    winner_id: null,
    status: 'scheduled',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    player_1: { name: 'Alice', avatar_url: null },
    player_2: { name: 'Bob', avatar_url: null },
    winner: null,
    games: [],
    round: { status: 'active', name: 'Round 2', round_number: 2, best_of: 3, deadline: null },
    tournaments: {
      name: 'Group stage',
      season_id: 's1',
      archived: false,
      seasons: { name: 'Summer League', is_test_season: false, archived: false },
    },
    ...over,
  };
}

const opsOf = (call: RecordedCall, method: string) => call.ops.filter(([name]) => name === method).map(([, args]) => args);
const callsTo = (table: string) => h.calls.filter((call) => call.table === table);
const selectOf = (call: RecordedCall) => String(opsOf(call, 'select')[0]?.[0]);
const isHydrate = (call: RecordedCall) => selectOf(call).includes('player_1:');
const isHead = (call: RecordedCall) => (opsOf(call, 'select')[0]?.[1] as { head?: boolean } | undefined)?.head === true;
const leanCalls = () => callsTo('matches').filter((call) => !isHydrate(call));
const hydrateCalls = () => callsTo('matches').filter(isHydrate);
const statusOf = (call: RecordedCall) => opsOf(call, 'in').find(([column]) => column === 'status')?.[1] as string[] | undefined;

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = h.defaultResponder;
});

describe('getMatchesByIds', () => {
  it('reads 250 ids in three chunks of at most 100 and keeps the order of the ids', async () => {
    const wanted = ids(250);
    h.state.responder = (call) => {
      const asked = opsOf(call, 'in')[0][1] as string[];
      // Return the chunk reversed: the result must still follow the order of `wanted`.
      return { data: [...asked].reverse().map((id) => matchRow({ id })), error: null };
    };

    const result = await getMatchesByIds(wanted);

    const reads = callsTo('matches');
    expect(reads).toHaveLength(3);
    expect(reads.map((call) => (opsOf(call, 'in')[0][1] as string[]).length)).toEqual([100, 100, 50]);
    for (const read of reads) {
      expect(opsOf(read, 'in')[0][0]).toBe('id');
      expect(selectOf(read)).toContain('player_1:players!matches_player_1_id_fkey');
    }
    expect(result.map((match) => match.id)).toEqual(wanted);
    expect(result[0]).toMatchObject({ player_1_name: 'Alice', player_2_name: 'Bob', round_status: 'active' });
  });

  it('reads each id once and drops an id with no match', async () => {
    h.state.responder = (call) => {
      const asked = opsOf(call, 'in')[0][1] as string[];
      return { data: asked.filter((id) => id !== uuid(2)).map((id) => matchRow({ id })), error: null };
    };

    const result = await getMatchesByIds([uuid(1), uuid(2), uuid(1), uuid(3)]);

    expect(opsOf(callsTo('matches')[0], 'in')[0][1]).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(result.map((match) => match.id)).toEqual([uuid(1), uuid(3)]);
  });

  it('rejects a non-uuid before any read', async () => {
    await expect(getMatchesByIds([uuid(1), 'x,y)']))
      .rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });

  it('reads nothing for no ids', async () => {
    expect(await getMatchesByIds([])).toEqual([]);
    expect(h.calls).toHaveLength(0);
  });

  it('throws the database error', async () => {
    h.state.responder = () => ({ data: null, error: new Error('boom') });
    await expect(getMatchesByIds([uuid(1)])).rejects.toThrow('boom');
  });
});

describe('setMatchScheduledAtIfOpen', () => {
  it('updates by id while the status is not completed and returns the row', async () => {
    h.state.responder = () => ({ data: matchRow({ id: uuid(1), scheduled_at: '2026-11-01T18:00:00Z' }), error: null });

    const result = await setMatchScheduledAtIfOpen(uuid(1), '2026-11-01T18:00:00.000Z');

    const [call] = h.calls;
    expect(call.table).toBe('matches');
    expect(opsOf(call, 'update')).toEqual([[{ scheduled_at: '2026-11-01T18:00:00.000Z' }]]);
    expect(opsOf(call, 'eq')).toEqual([['id', uuid(1)]]);
    expect(opsOf(call, 'neq')).toEqual([['status', 'completed']]);
    expect(opsOf(call, 'maybeSingle')).toHaveLength(1);
    expect(result).toMatchObject({ id: uuid(1), scheduled_at: '2026-11-01T18:00:00Z' });
  });

  it('returns null when no row matched', async () => {
    h.state.responder = () => ({ data: null, error: null });
    expect(await setMatchScheduledAtIfOpen(uuid(1), '2026-11-01T18:00:00.000Z')).toBeNull();
  });

  it('rejects a non-uuid id and throws the database error', async () => {
    await expect(setMatchScheduledAtIfOpen('nope', '2026-11-01T18:00:00.000Z')).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
    h.state.responder = () => ({ data: null, error: new Error('boom') });
    await expect(setMatchScheduledAtIfOpen(uuid(1), '2026-11-01T18:00:00.000Z')).rejects.toThrow('boom');
  });
});

describe('updateMatchNotesIfUnchanged', () => {
  it('updates by id and the updated_at it was read with, and returns the row', async () => {
    h.state.responder = () => ({ data: matchRow({ id: uuid(1), notes: 'a\nb' }), error: null });

    const result = await updateMatchNotesIfUnchanged(uuid(1), '2026-01-01T00:00:00.123456+00:00', 'a\nb');

    const [call] = h.calls;
    expect(opsOf(call, 'update')).toEqual([[{ notes: 'a\nb' }]]);
    expect(opsOf(call, 'eq')).toEqual([
      ['id', uuid(1)],
      ['updated_at', '2026-01-01T00:00:00.123456+00:00'],
    ]);
    // The notes text never reaches a URL filter.
    expect(opsOf(call, 'neq')).toEqual([]);
    expect(opsOf(call, 'or')).toEqual([]);
    expect(result).toMatchObject({ id: uuid(1), notes: 'a\nb' });
  });

  it('returns null when no row matched (the match changed since the read)', async () => {
    h.state.responder = () => ({ data: null, error: null });
    expect(await updateMatchNotesIfUnchanged(uuid(1), '2026-01-01T00:00:00Z', 'x')).toBeNull();
  });

  it('rejects a non-uuid id and throws the database error', async () => {
    await expect(updateMatchNotesIfUnchanged('nope', '2026-01-01T00:00:00Z', 'x')).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
    h.state.responder = () => ({ data: null, error: new Error('boom') });
    await expect(updateMatchNotesIfUnchanged(uuid(1), '2026-01-01T00:00:00Z', 'x')).rejects.toThrow('boom');
  });
});

describe('listAdminMatchesForExport', () => {
  const BASE: Omit<AdminMatchListParams, 'page' | 'pageSize'> = { tournamentIds: null, now: NOW };
  const OPEN = { ...BASE, includeTest: true, includeArchived: true };

  /**
   * Answers the id pages from `all` (range-aware, with the exact total) and the hydrate reads with one row per id.
   * `pages` overrides what a page (by its start offset) returns.
   */
  function script(all: string[], pages: Record<number, string[]> = {}, perStatus?: Record<string, { count: number }>) {
    h.state.responder = (call) => {
      if (call.table === 'seasons') return { data: [], error: null };
      if (isHydrate(call)) {
        const asked = opsOf(call, 'in')[0][1] as string[];
        return { data: asked.map((id) => matchRow({ id })), error: null };
      }
      if (perStatus) {
        const status = statusOf(call)?.[0] ?? '';
        const segment = perStatus[status] ?? { count: 0 };
        if (isHead(call)) return { data: null, error: null, count: segment.count };
        const [from, to] = opsOf(call, 'range')[0] as [number, number];
        return {
          data: Array.from({ length: segment.count }, (_, i) => ({ id: `${status}-${i}` })).slice(from, to + 1),
          error: null,
          count: segment.count,
        };
      }
      if (isHead(call)) return { data: null, error: null, count: all.length };
      const [from, to] = opsOf(call, 'range')[0] as [number, number];
      const page = pages[from] ?? all.slice(from, to + 1);
      return { data: page.map((id) => ({ id })), error: null, count: all.length };
    };
  }

  it('reads 2,300 ids in three 1000-row id pages, then hydrates in chunks of at most 100', async () => {
    const all = ids(2300);
    script(all);

    const result = await listAdminMatchesForExport(OPEN, 5000);

    expect(leanCalls().map((call) => opsOf(call, 'range')[0])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    for (const call of leanCalls()) expect(opsOf(call, 'limit')).toEqual([]);
    const reads = hydrateCalls();
    expect(reads).toHaveLength(23);
    for (const read of reads) expect((opsOf(read, 'in')[0][1] as string[]).length).toBeLessThanOrEqual(100);
    expect(result.rows.map((row) => row.id)).toEqual(all);
    expect(result.total).toBe(2300);
    expect(result.truncated).toBe(false);
    expect(result.rows[0]).toMatchObject({ tournament_name: 'Group stage', season_name: 'Summer League', best_of: 3 });
  });

  it('cuts at the cap, keeps the real total and reports truncated', async () => {
    script(ids(7000));

    const result = await listAdminMatchesForExport(OPEN, 2500);

    expect(leanCalls().map((call) => opsOf(call, 'range')[0])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(result.rows).toHaveLength(2500);
    expect(result.total).toBe(7000);
    expect(result.truncated).toBe(true);
    expect(result.rows[2499].id).toBe(uuid(2500));
    expect(hydrateCalls()).toHaveLength(25);
  });

  it('is not truncated when the total equals the cap, and truncated when one more match exists', async () => {
    script(ids(2500));
    const atCap = await listAdminMatchesForExport(OPEN, 2500);
    expect(atCap.rows).toHaveLength(2500);
    expect(atCap.total).toBe(2500);
    expect(atCap.truncated).toBe(false);

    h.calls.length = 0;
    script(ids(2501));
    const overCap = await listAdminMatchesForExport(OPEN, 2500);
    expect(overCap.rows).toHaveLength(2500);
    expect(overCap.total).toBe(2501);
    expect(overCap.truncated).toBe(true);
  });

  it('is not truncated when the cap was not reached, even if a match vanished before the rows were read', async () => {
    const all = ids(5);
    // The id read counts 5 matches, but one is deleted before the hydrate read: 4 rows, cap far away.
    h.state.responder = (call) => {
      if (call.table === 'seasons') return { data: [], error: null };
      if (isHydrate(call)) {
        const asked = (opsOf(call, 'in')[0][1] as string[]).filter((id) => id !== all[2]);
        return { data: asked.map((id) => matchRow({ id })), error: null };
      }
      if (isHead(call)) return { data: null, error: null, count: all.length };
      return { data: all.map((id) => ({ id })), error: null, count: all.length };
    };

    const result = await listAdminMatchesForExport(OPEN, 2500);

    expect(result.rows).toHaveLength(4);
    expect(result.total).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it('stops at the page that reaches the cap', async () => {
    script(ids(7000));
    await listAdminMatchesForExport(OPEN, 1000);
    expect(leanCalls()).toHaveLength(1);
  });

  it('drops ids that shift between two pages', async () => {
    const all = ids(1500);
    // A write between the pages moved one match: page 2 starts with the last id of page 1.
    script(all, { 1000: all.slice(999, 1500) });

    const result = await listAdminMatchesForExport(OPEN, 5000);

    expect(result.rows.map((row) => row.id)).toEqual(all);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(1500);
    const asked = hydrateCalls().flatMap((call) => opsOf(call, 'in')[0][1] as string[]);
    expect(new Set(asked).size).toBe(asked.length);
    expect(result.truncated).toBe(false);
  });

  it('reads one id page and no hydrate for an empty set', async () => {
    script([]);
    const result = await listAdminMatchesForExport(OPEN, 5000);
    expect(result).toEqual({ rows: [], total: 0, truncated: false });
    expect(leanCalls()).toHaveLength(1);
    expect(hydrateCalls()).toHaveLength(0);
  });

  it('reads nothing for an empty scope, a contradicting filter or an empty status set', async () => {
    script(ids(3));
    const empty = { rows: [], total: 0, truncated: false };
    expect(await listAdminMatchesForExport({ ...OPEN, tournamentIds: [] }, 10)).toEqual(empty);
    expect(await listAdminMatchesForExport({ ...OPEN, replay: 'has', noGames: true }, 10)).toEqual(empty);
    expect(await listAdminMatchesForExport({ ...OPEN, preset: 'stale_in_progress', statuses: ['completed'] }, 10)).toEqual(empty);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a non-uuid id before any read', async () => {
    await expect(listAdminMatchesForExport({ ...OPEN, playerId: 'x,y' }, 10)).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });

  it('builds the same lean queries as the list page for one filter set', async () => {
    const filters: Omit<AdminMatchListParams, 'page' | 'pageSize'> = {
      tournamentIds: [U1, U2],
      statuses: ['pending_confirmation', 'disputed'],
      bestOf: 3,
      replay: 'has',
      date: { field: 'scheduled', from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
      playerIds: [uuid(9)],
      hasNotes: true,
      preset: 'auto_confirms_soon',
      sort: 'scheduled_asc',
      now: NOW,
    };
    script(ids(3));

    await listAdminMatchesPage({ ...filters, page: 1, pageSize: 1000 });
    const fromList = leanCalls().map((call) => call.ops);
    const hiddenFromList = callsTo('seasons').map((call) => call.ops);
    h.calls.length = 0;
    await listAdminMatchesForExport(filters, 5000);

    expect(fromList.length).toBeGreaterThan(0);
    expect(leanCalls().map((call) => call.ops)).toEqual(fromList);
    expect(callsTo('seasons').map((call) => call.ops)).toEqual(hiddenFromList);
  });

  it('builds the same lean queries as the list page for the status-priority sort', async () => {
    const filters: Omit<AdminMatchListParams, 'page' | 'pageSize'> = {
      tournamentIds: null,
      sort: 'status_priority',
      includeTest: true,
      includeArchived: true,
      now: NOW,
    };
    script([], {}, { disputed: { count: 2 }, pending_confirmation: { count: 3 } });

    const list = await listAdminMatchesPage({ ...filters, page: 1, pageSize: 1000 });
    const fromList = leanCalls().map((call) => call.ops);
    h.calls.length = 0;
    const exported = await listAdminMatchesForExport(filters, 5000);

    expect(fromList.length).toBeGreaterThan(5);
    expect(leanCalls().map((call) => call.ops)).toEqual(fromList);
    expect(exported.rows.map((row) => row.id)).toEqual(list.rows.map((row) => row.id));
    expect(exported.total).toBe(5);
  });
});
