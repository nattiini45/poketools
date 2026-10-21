/**
 * Query helpers behind the chronological rating rebuild (code review H13):
 *   - `getRatingHistoryByMatches` chunks the match ids and pages every chunk
 *     past `max_rows`;
 *   - `getCompletedMatchesForRatingReplay` reads every completed match of the
 *     player (paged, narrow select), not the 500 newest of any status;
 *   - `replacePlayerRatingCurve` writes the whole curve through ONE RPC and
 *     never masks a failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Page = { data: unknown[] | null; error: { message: string; code?: string } | null };

const h = vi.hoisted(() => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const pages: Page[] = [];
  const builder: Record<string, unknown> = {};
  const record = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const m of ['from', 'select', 'in', 'eq', 'or', 'order', 'not', 'is']) {
    builder[m] = record(m);
  }
  const terminal = (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      const next = pages.shift();
      if (!next) throw new Error('test: no scripted page left');
      return Promise.resolve(next);
    };
  builder.range = terminal('range');
  builder.limit = terminal('limit');
  const rpc = { fn: null as null | ((...args: unknown[]) => Promise<unknown>) };
  builder.rpc = (...args: unknown[]) => {
    calls.push({ method: 'rpc', args });
    if (!rpc.fn) throw new Error('test: rpc not scripted');
    return rpc.fn(...args);
  };
  return { calls, pages, builder, rpc };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: h.builder }));
vi.mock('@/lib/supabase/queries/test-accounts', () => ({
  getTestAccountIds: vi.fn().mockResolvedValue([]),
}));

import {
  getCompletedMatchesForRatingReplay,
  getRatingHistoryByMatches,
  replacePlayerRatingCurve,
  RatingCurveStaleError,
  type RatingHistoryInsertInput,
} from '../ratings';

const PLAYER = '11111111-1111-4111-8111-111111111111';
const OPPONENT = '22222222-2222-4222-8222-222222222222';

function callsOf(method: string) {
  return h.calls.filter((c) => c.method === method);
}

function historyRow(i: number, matchId = `m-${i}`) {
  return {
    id: `h-${String(i).padStart(5, '0')}`,
    player_id: PLAYER,
    match_id: matchId,
    rating_before: 1500,
    rating_after: 1510,
    rd_before: 200,
    rd_after: 190,
    opponent_id: OPPONENT,
    opponent_rating: 1500,
    result: 'win',
    rating_change: 10,
    recorded_at: '2026-01-01T00:00:00.000Z',
  };
}

function matchRow(i: number) {
  return {
    id: `match-${i}`,
    tournament_id: 'tournament-1',
    player_1_id: PLAYER,
    player_2_id: OPPONENT,
    winner_id: PLAYER,
    date_played: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  h.calls.length = 0;
  h.pages.length = 0;
  h.rpc.fn = null;
});

describe('getRatingHistoryByMatches', () => {
  it('returns [] without a request for no ids', async () => {
    await expect(getRatingHistoryByMatches([])).resolves.toEqual([]);
    expect(h.calls).toHaveLength(0);
  });

  it('chunks the ids (150 per request) and dedupes them', async () => {
    const ids = Array.from({ length: 320 }, (_, i) => `m-${i}`);
    h.pages.push({ data: [historyRow(0, 'm-0')], error: null });
    h.pages.push({ data: [], error: null });
    h.pages.push({ data: [historyRow(1, 'm-319')], error: null });

    const rows = await getRatingHistoryByMatches([...ids, 'm-0', 'm-5']);

    const inCalls = callsOf('in');
    expect(inCalls.map((c) => (c.args[1] as string[]).length)).toEqual([150, 150, 20]);
    expect(inCalls.every((c) => c.args[0] === 'match_id')).toBe(true);
    expect(rows.map((r) => r.match_id)).toEqual(['m-0', 'm-319']);
    // Stable paging order on the unique id.
    expect(callsOf('order').every((c) => c.args[0] === 'id')).toBe(true);
  });

  it('pages one chunk past max_rows with .range() until a short page', async () => {
    h.pages.push({ data: Array.from({ length: 1000 }, (_, i) => historyRow(i)), error: null });
    h.pages.push({ data: [historyRow(1000)], error: null });

    const rows = await getRatingHistoryByMatches(['m-a']);

    expect(rows).toHaveLength(1001);
    expect(callsOf('range').map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('throws the PostgREST error unchanged', async () => {
    const error = { message: 'boom', code: '57014' };
    h.pages.push({ data: null, error });
    await expect(getRatingHistoryByMatches(['m-a'])).rejects.toBe(error);
  });
});

describe('getCompletedMatchesForRatingReplay', () => {
  const playerFilter = `or(player_1_id.eq.${PLAYER},player_2_id.eq.${PLAYER})`;

  it('rejects a non-UUID player id before any request', async () => {
    await expect(getCompletedMatchesForRatingReplay('not-a-uuid')).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });

  it('reads only completed matches with a narrow select, dated first, then undated (nulls last)', async () => {
    const undated = { ...matchRow(2), date_played: null };
    h.pages.push({ data: [{ ...matchRow(1), notes: 'secret', status: 'completed' }], error: null });
    h.pages.push({ data: [undated], error: null });

    const rows = await getCompletedMatchesForRatingReplay(PLAYER);

    expect(rows).toEqual([matchRow(1), undated]);
    expect(callsOf('from').map((c) => c.args)).toEqual([['matches'], ['matches']]);
    expect(callsOf('select')[0].args[0]).toBe(
      'id, tournament_id, player_1_id, player_2_id, winner_id, date_played, created_at'
    );
    // First page of each pass: the player filter only, no cursor.
    expect(callsOf('or').map((c) => c.args[0])).toEqual([`and(${playerFilter})`, `and(${playerFilter})`]);
    expect(callsOf('eq').map((c) => c.args)).toEqual([['status', 'completed'], ['status', 'completed']]);
    expect(callsOf('not').map((c) => c.args)).toEqual([['date_played', 'is', null]]);
    expect(callsOf('is').map((c) => c.args)).toEqual([['date_played', null]]);
    expect(callsOf('order').map((c) => c.args)).toEqual([
      ['date_played', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(callsOf('limit').map((c) => c.args)).toEqual([[1000], [1000]]);
    expect(callsOf('range')).toHaveLength(0);
  });

  it('pages past 1000 dated matches with a keyset cursor behind the last row (no offsets)', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      ...matchRow(i),
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      date_played: '2026-01-02T00:00:00.123456+00:00',
      created_at: '2026-01-01T00:00:00+00:00',
    }));
    h.pages.push({ data: firstPage, error: null });
    h.pages.push({ data: Array.from({ length: 3 }, (_, i) => matchRow(1000 + i)), error: null });
    h.pages.push({ data: [], error: null });

    const rows = await getCompletedMatchesForRatingReplay(PLAYER);

    expect(rows).toHaveLength(1003);
    const last = firstPage[999];
    expect(callsOf('or')[1].args[0]).toBe(
      `and(${playerFilter},` +
        `or(date_played.lt."${last.date_played}",and(date_played.eq."${last.date_played}",` +
        `or(created_at.lt."${last.created_at}",and(created_at.eq."${last.created_at}",id.lt."${last.id}")))))`
    );
    expect(callsOf('range')).toHaveLength(0);
  });

  it('pages past 1000 undated matches on (created_at, id)', async () => {
    const undatedPage = Array.from({ length: 1000 }, (_, i) => ({
      ...matchRow(i),
      date_played: null,
      created_at: `2026-01-01T00:00:00.${String(i).padStart(6, '0')}+00:00`,
    }));
    h.pages.push({ data: [], error: null });
    h.pages.push({ data: undatedPage, error: null });
    h.pages.push({ data: [{ ...matchRow(2000), date_played: null }], error: null });

    const rows = await getCompletedMatchesForRatingReplay(PLAYER);

    expect(rows).toHaveLength(1001);
    const last = undatedPage[999];
    expect(callsOf('or')[2].args[0]).toBe(
      `and(${playerFilter},or(created_at.lt."${last.created_at}",and(created_at.eq."${last.created_at}",id.lt."${last.id}")))`
    );
  });

  it('throws the PostgREST error of a later page unchanged', async () => {
    const error = { message: 'page 2 failed' };
    h.pages.push({ data: Array.from({ length: 1000 }, (_, i) => matchRow(i)), error: null });
    h.pages.push({ data: null, error });
    await expect(getCompletedMatchesForRatingReplay(PLAYER)).rejects.toBe(error);
  });

  it('throws the PostgREST error of the undated pass unchanged', async () => {
    const error = { message: 'undated failed' };
    h.pages.push({ data: [], error: null });
    h.pages.push({ data: null, error });
    await expect(getCompletedMatchesForRatingReplay(PLAYER)).rejects.toBe(error);
  });
});

describe('replacePlayerRatingCurve', () => {
  const state = {
    rating: 1600,
    rd: 120,
    volatility: 0.06,
    peak_rating: 1610,
    peak_date: '2026-01-02T00:00:00.000Z',
    wins: 2,
    losses: 1,
    draws: 0,
    last_match_at: '2026-01-03T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };
  const entry: RatingHistoryInsertInput = {
    player_id: PLAYER,
    match_id: '33333333-3333-4333-8333-333333333333',
    rating_before: 1500,
    rating_after: 1600,
    rd_before: 200,
    rd_after: 120,
    opponent_id: OPPONENT,
    opponent_rating: 1500,
    result: 'win',
    recorded_at: '2026-01-03T00:00:00.000Z',
  };

  it('sends the state and history to rating_replace_player_history in one call', async () => {
    h.rpc.fn = async () => ({ data: 2, error: null });

    const inserted = await replacePlayerRatingCurve(PLAYER, state, [
      entry,
      { ...entry, match_id: '44444444-4444-4444-8444-444444444444', recorded_at: undefined },
    ], [entry.match_id]);

    expect(inserted).toBe(2);
    const rpcCalls = callsOf('rpc');
    expect(rpcCalls).toHaveLength(1);
    const [fn, args] = rpcCalls[0].args as [string, Record<string, unknown>];
    expect(fn).toBe('rating_replace_player_history');
    expect(args.p_player_id).toBe(PLAYER);
    expect(args.p_state).toEqual(state);
    expect(args.p_history).toEqual([
      entry,
      { ...entry, match_id: '44444444-4444-4444-8444-444444444444', recorded_at: null },
    ]);
    // The history fence: the player's own rows the replay read.
    expect(args.p_expected_history_match_ids).toEqual([entry.match_id]);
    // No table-level write path is used any more.
    expect(callsOf('from')).toHaveLength(0);
  });

  it('sends an empty history so stale rows are still cleared', async () => {
    h.rpc.fn = async () => ({ data: 0, error: null });
    await expect(replacePlayerRatingCurve(PLAYER, state, [], [])).resolves.toBe(0);
    const [, args] = callsOf('rpc')[0].args as [string, Record<string, unknown>];
    expect(args.p_history).toEqual([]);
  });

  it('stamps updated_at when the caller leaves it out', async () => {
    h.rpc.fn = async () => ({ data: 0, error: null });
    const { updated_at: _omit, ...withoutUpdatedAt } = state;
    await replacePlayerRatingCurve(PLAYER, withoutUpdatedAt, [], []);
    const [, args] = callsOf('rpc')[0].args as [string, { p_state: { updated_at: string } }];
    expect(Number.isNaN(Date.parse(args.p_state.updated_at))).toBe(false);
  });

  it('refuses a history row of another player before any request', async () => {
    h.rpc.fn = async () => ({ data: 1, error: null });
    await expect(
      replacePlayerRatingCurve(PLAYER, state, [{ ...entry, player_id: OPPONENT }], [])
    ).rejects.toThrow(/belong to another player/);
    expect(callsOf('rpc')).toHaveLength(0);
  });

  it('rejects a non-UUID player id before any request', async () => {
    h.rpc.fn = async () => ({ data: 0, error: null });
    await expect(replacePlayerRatingCurve('nope', state, [], [])).rejects.toThrow();
    expect(callsOf('rpc')).toHaveLength(0);
  });

  it('throws the RPC error unchanged (nothing is retried or masked)', async () => {
    const error = { message: 'p_history row(s) are not objects', code: '22023' };
    h.rpc.fn = async () => ({ data: null, error });
    await expect(replacePlayerRatingCurve(PLAYER, state, [entry], [])).rejects.toBe(error);
    expect(callsOf('rpc')).toHaveLength(1);
  });

  it('maps the history fence refusal (40001) to RatingCurveStaleError, keeping the cause', async () => {
    const error = { message: 'player gained a rating_history row', code: '40001' };
    h.rpc.fn = async () => ({ data: null, error });
    const rejection = replacePlayerRatingCurve(PLAYER, state, [entry], []);
    await expect(rejection).rejects.toBeInstanceOf(RatingCurveStaleError);
    await expect(rejection).rejects.toMatchObject({ playerId: PLAYER, cause: error });
  });

  it('throws when the RPC reports a different row count than it was sent', async () => {
    h.rpc.fn = async () => ({ data: 0, error: null });
    await expect(replacePlayerRatingCurve(PLAYER, state, [entry], [])).rejects.toThrow(
      /inserted 0 row\(s\).*expected 1/
    );
  });
});
