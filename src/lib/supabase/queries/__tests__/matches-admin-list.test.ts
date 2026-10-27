/**
 * Admin match list queries: `listAdminMatchesPage` (two reads: the page's ids
 * and exact total from a lean select, then the display shape of those ids),
 * the bounded player search, the player names for the filter chips, the
 * League -> Phase filter options (paged past the PostgREST `max_rows` cap)
 * and the rounds of a phase.
 *
 * The Supabase client is a recorder: every `from()` starts a fresh query that
 * logs the builder methods it was given and resolves through a per-test
 * responder, so a test can assert both the exact PostgREST calls and the
 * order the reads happen in.
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
  const METHODS = ['select', 'eq', 'neq', 'in', 'is', 'or', 'not', 'gte', 'lt', 'lte', 'ilike', 'order', 'limit', 'range'];

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

  return {
    calls,
    state,
    defaultResponder,
    from: (table: string) => new Recorder(table),
  };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { ADMIN_MATCH_SEARCH_PLAYER_CAP } from '@/lib/admin/match-list';
import {
  findPlayerIdsForMatchSearch,
  listAdminMatchFilterOptions,
  listAdminMatchRounds,
  listAdminMatchesPage,
  listMatchFilterPlayers,
  listTournamentIdsBySeason,
  type AdminMatchListParams,
} from '../matches';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U4 = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-10-25T10:00:00.000Z');

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
    round: { status: 'active', name: 'Round 2', round_number: 2, best_of: 3, deadline: '2026-02-01T00:00:00Z' },
    tournaments: {
      name: 'Group stage',
      season_id: 's1',
      archived: false,
      seasons: { name: 'Summer League', is_test_season: false, archived: false },
    },
    ...over,
  };
}

// ── recorder helpers ────────────────────────────────────────────────

const opsOf = (call: RecordedCall, method: string) => call.ops.filter(([name]) => name === method).map(([, args]) => args);
const callsTo = (table: string) => h.calls.filter((call) => call.table === table);
const selectOf = (call: RecordedCall) => String(opsOf(call, 'select')[0]?.[0]);
const isHydrate = (call: RecordedCall) => selectOf(call).includes('player_1:');
const isHead = (call: RecordedCall) => (opsOf(call, 'select')[0]?.[1] as { head?: boolean } | undefined)?.head === true;
/** The lean id reads of `matches` (page, segment pages and head counts), without the hydrate read. */
const leanCalls = () => callsTo('matches').filter((call) => !isHydrate(call));
const hydrateCall = () => callsTo('matches').find(isHydrate);
const statusOf = (call: RecordedCall) => opsOf(call, 'in').find(([column]) => column === 'status')?.[1] as string[] | undefined;

interface MatchesScript {
  /** Ids of the page read. */
  ids?: string[];
  count?: number;
  /** Rows the hydrate read returns (default: one matchRow per id asked for). */
  hydrate?: (ids: string[]) => unknown[];
  testSeasons?: string[];
  /** Per status: head count and the ids of its page reads. */
  perStatus?: Record<string, { count: number; ids?: string[] }>;
}

/** Answers the reads of `listAdminMatchesPage`: seasons, head counts, id pages and the hydrate read. */
function script(options: MatchesScript = {}) {
  const { ids = ['m1'], count = ids.length, testSeasons = [], perStatus } = options;
  h.state.responder = (call) => {
    if (call.table === 'seasons') return { data: testSeasons.map((id) => ({ id })), error: null };
    if (call.table !== 'matches') throw new Error(`unexpected read of ${call.table}`);
    if (isHydrate(call)) {
      const asked = opsOf(call, 'in')[0][1] as string[];
      const rows = options.hydrate ? options.hydrate(asked) : asked.map((id) => matchRow({ id }));
      return { data: rows, error: null };
    }
    if (perStatus) {
      const status = statusOf(call)?.[0] ?? '';
      const segment = perStatus[status] ?? { count: 0 };
      if (isHead(call)) return { data: null, error: null, count: segment.count };
      const [from, to] = opsOf(call, 'range')[0] as [number, number];
      const all = segment.ids ?? Array.from({ length: segment.count }, (_, i) => `${status}-${i}`);
      return { data: all.slice(from, to + 1).map((id) => ({ id })), error: null, count: segment.count };
    }
    if (isHead(call)) return { data: null, error: null, count };
    return { data: ids.map((id) => ({ id })), error: null, count };
  };
}

/** The first lean read of `matches`. */
const lean = () => leanCalls()[0];

const BASE: AdminMatchListParams = { tournamentIds: null, page: 1, pageSize: 50, now: NOW };
/** Both hygiene flags on: the bare query, so a test sees only what it asks for. */
const OPEN: AdminMatchListParams = { ...BASE, includeTest: true, includeArchived: true };

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = h.defaultResponder;
});

describe('listAdminMatchesPage: the two reads', () => {
  it('reads one ordered page of ids with an exact count, then hydrates them and maps the row', async () => {
    script({ ids: ['m1'], count: 731 });

    const result = await listAdminMatchesPage({ ...BASE, page: 3 });

    const idRead = lean();
    expect(idRead.table).toBe('matches');
    expect(opsOf(idRead, 'select')[0]).toEqual(['id, tournaments!inner ( id )', { count: 'exact', head: false }]);
    expect(opsOf(idRead, 'order')).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(opsOf(idRead, 'range')).toEqual([[100, 149]]);
    expect(opsOf(idRead, 'limit')).toEqual([]);

    expect(hydrateCall()).toBeDefined();
    expect(opsOf(hydrateCall()!, 'in')).toEqual([['id', ['m1']]]);
    // The hydrate read carries no filter, order or range: it only turns ids into rows.
    for (const method of ['eq', 'neq', 'is', 'or', 'gte', 'lt', 'lte', 'order', 'range']) {
      expect(opsOf(hydrateCall()!, method)).toEqual([]);
    }

    expect(result.total).toBe(731);
    expect(result.rows[0]).toMatchObject({
      id: 'm1',
      tournament_name: 'Group stage',
      season_id: 's1',
      season_name: 'Summer League',
      season_is_test: false,
      archived: false,
      round_name: 'Round 2',
      round_number: 2,
      best_of: 3,
      round_deadline: '2026-02-01T00:00:00Z',
      player_1_name: 'Alice',
    });
  });

  it('maps a standalone tournament to no league', async () => {
    script({
      hydrate: () => [matchRow({ tournaments: { name: 'Weekly #1', season_id: null, archived: false, seasons: null } })],
    });
    const { rows } = await listAdminMatchesPage(BASE);
    expect(rows[0]).toMatchObject({
      tournament_name: 'Weekly #1',
      season_id: null,
      season_name: null,
      season_is_test: false,
      archived: false,
    });
  });

  it('flags a test league, and an archived tournament or an archived league as archived', async () => {
    script({
      ids: ['a', 'b', 'c'],
      hydrate: () => [
        matchRow({
          id: 'a',
          tournaments: { name: 'T', season_id: 's', archived: false, seasons: { name: 'S', is_test_season: true, archived: false } },
        }),
        matchRow({
          id: 'b',
          tournaments: { name: 'T', season_id: 's', archived: true, seasons: { name: 'S', is_test_season: false, archived: false } },
        }),
        matchRow({
          id: 'c',
          tournaments: { name: 'T', season_id: 's', archived: false, seasons: { name: 'S', is_test_season: false, archived: true } },
        }),
      ],
    });
    const { rows } = await listAdminMatchesPage(BASE);
    expect(rows.map((r) => [r.season_is_test, r.archived])).toEqual([
      [true, false],
      [false, true],
      [false, true],
    ]);
  });

  it('selects players in the narrow shape only (no private player column) and the games with the row', async () => {
    script();
    await listAdminMatchesPage(BASE);
    const select = selectOf(hydrateCall()!);
    expect(select).toMatch(/player_1:players!matches_player_1_id_fkey \( name, avatar_url \)/);
    expect(select).toMatch(/player_2:players!matches_player_2_id_fkey \( name, avatar_url \)/);
    expect(select).toMatch(/winner:players!matches_winner_id_fkey \( name \)/);
    expect(select).toMatch(/games \( id, game_number, winner_id, replay_url, source, stats_locked \)/);
    expect(select).toMatch(/round:rounds!matches_round_id_fkey \( status, name, round_number, best_of, deadline \)/);
    expect(select).toMatch(/tournaments!inner \( name, season_id, archived, seasons \( name, is_test_season, archived \) \)/);
    for (const column of ['discord_id', 'auth_user_id', 'ban_reason', 'suspended_until', 'is_admin', 'avatar_config']) {
      expect(select).not.toContain(column);
    }
  });

  it('keeps the order of the id read and skips an id that vanished before the hydrate read', async () => {
    script({
      ids: ['b', 'gone', 'a'],
      count: 3,
      // The database answers in its own order and has lost one match in between.
      hydrate: () => [matchRow({ id: 'a' }), matchRow({ id: 'b' })],
    });
    const result = await listAdminMatchesPage(BASE);
    expect(result.rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(result.total).toBe(3);
  });

  it('makes no hydrate read for an empty page', async () => {
    script({ ids: [], count: 0 });
    const result = await listAdminMatchesPage(BASE);
    expect(result).toEqual({ rows: [], total: 0 });
    expect(hydrateCall()).toBeUndefined();
  });

  it('applies scope, status, standalone, player and match-id filters in the database', async () => {
    script();
    await listAdminMatchesPage({
      ...BASE,
      tournamentIds: [U1, U2],
      standaloneOnly: true,
      statuses: ['disputed', 'completed'],
      matchId: U3,
      playerIds: [U1, U2],
    });
    const read = lean();
    expect(opsOf(read, 'in')).toContainEqual(['tournament_id', [U1, U2]]);
    expect(opsOf(read, 'is')).toContainEqual(['tournaments.season_id', null]);
    expect(opsOf(read, 'in')).toContainEqual(['status', ['disputed', 'completed']]);
    expect(opsOf(read, 'eq')).toContainEqual(['id', U3]);
    expect(opsOf(read, 'or')).toContainEqual([`player_1_id.in.(${U1},${U2}),player_2_id.in.(${U1},${U2})`]);
  });

  it('adds no tournament or status filter for an unrestricted caller', async () => {
    script();
    await listAdminMatchesPage(BASE);
    expect(opsOf(lean(), 'in')).toEqual([]);
  });

  it('returns an empty page for an empty scope without querying', async () => {
    const result = await listAdminMatchesPage({ ...BASE, tournamentIds: [] });
    expect(result).toEqual({ rows: [], total: 0 });
    expect(h.calls).toHaveLength(0);
  });

  it('refuses a player id that is not a uuid before it reaches the filter string', async () => {
    await expect(listAdminMatchesPage({ ...BASE, playerIds: ['x),or=(id.neq.0'] })).rejects.toThrow(/playerId/);
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ['playerId', { playerId: 'x),or=(id.neq.0' }, /playerId/],
    ['player2Id', { playerId: U1, player2Id: 'x)' }, /playerId/],
    ['roundId', { roundId: 'nope' }, /roundId/],
    ['rulesetId', { rulesetId: 'nope' }, /rulesetId/],
    ['matchId', { matchId: 'nope' }, /matchId/],
  ])('refuses a %s that is not a uuid before any read', async (_name, extra, pattern) => {
    await expect(listAdminMatchesPage({ ...BASE, ...extra })).rejects.toThrow(pattern);
    expect(h.calls).toHaveLength(0);
  });

  it('reports the real total when the page is past the last row, instead of an error', async () => {
    h.state.responder = (call) => {
      if (call.table === 'seasons') return { data: [], error: null };
      if (isHead(call)) return { data: null, error: null, count: 12 };
      return { data: null, error: { code: 'PGRST103', message: 'range' }, count: null };
    };

    const result = await listAdminMatchesPage({ ...BASE, page: 9, pageSize: 25 });

    expect(result).toEqual({ rows: [], total: 12 });
    expect(opsOf(leanCalls().at(-1)!, 'select')[0]).toEqual(['id, tournaments!inner ( id )', { count: 'exact', head: true }]);
    expect(hydrateCall()).toBeUndefined();
  });

  it('throws every other database error', async () => {
    const dbError = { code: '57014', message: 'timeout' };
    h.state.responder = (call) =>
      call.table === 'seasons' ? { data: [], error: null } : { data: null, error: dbError, count: null };
    await expect(listAdminMatchesPage(BASE)).rejects.toBe(dbError);
  });

  it('throws a failed hydrate read', async () => {
    const dbError = { code: '57014', message: 'timeout' };
    h.state.responder = (call) => {
      if (call.table === 'seasons') return { data: [], error: null };
      if (isHydrate(call)) return { data: null, error: dbError };
      return { data: [{ id: 'm1' }], error: null, count: 1 };
    };
    await expect(listAdminMatchesPage(BASE)).rejects.toBe(dbError);
  });
});

describe('listAdminMatchesPage: the lean select', () => {
  const select = async (params: Partial<AdminMatchListParams>) => {
    h.calls.length = 0;
    script();
    await listAdminMatchesPage({ ...BASE, ...params });
    return opsOf(lean(), 'select')[0][0];
  };

  it('embeds only the tournament in a default request, and no games', async () => {
    const result = await select({});
    expect(result).toBe('id, tournaments!inner ( id )');
    expect(result).not.toContain('games');
    expect(result).not.toContain('rounds');
  });

  it('embeds nothing when nothing needs an embed', async () => {
    expect(await select({ includeTest: true, includeArchived: true })).toBe('id');
    expect(await select({ ...OPEN, hasNotes: true, playerId: U1, date: { field: 'created', from: '2026-01-01T00:00:00Z' } })).toBe('id');
    expect(await select({ ...OPEN, statuses: ['disputed'], roundId: U1, tournamentIds: [U2] })).toBe('id');
  });

  it.each<[string, Partial<AdminMatchListParams>, string]>([
    ['standalone', { ...OPEN, standaloneOnly: true }, 'id, tournaments!inner ( id )'],
    ['archived hygiene', { includeTest: true }, 'id, tournaments!inner ( id )'],
    ['bracket type', { ...OPEN, bracketType: 'swiss' }, 'id, tournaments!inner ( id )'],
    ['ruleset', { ...OPEN, rulesetId: U1 }, 'id, tournaments!inner ( id )'],
    ['league format', { ...OPEN, formatType: 'draft' }, 'id, tournaments!inner ( id, seasons!inner ( id ) )'],
    ['best of', { ...OPEN, bestOf: 3 }, 'id, rounds!inner ( id )'],
    ['the overdue preset', { ...OPEN, preset: 'overdue' }, 'id, rounds!inner ( id )'],
    // The deadline is in the embed's select list: PostgREST orders a to-one embed by what the embed selects.
    ['a deadline sort', { ...OPEN, sort: 'deadline_asc' }, 'id, rounds!inner ( id, deadline )'],
    ['a deadline sort with a round filter', { ...OPEN, sort: 'deadline_desc', bestOf: 3, preset: 'overdue' }, 'id, rounds!inner ( id, deadline )'],
    ['has replay', { ...OPEN, replay: 'has' }, 'id, games!inner ( id )'],
    ['hand-edited', { ...OPEN, handEdited: true }, 'id, games!inner ( id )'],
    ['replay and hand-edited', { ...OPEN, replay: 'has', handEdited: true }, 'id, games!inner ( id )'],
    ['no games', { ...OPEN, noGames: true }, 'id, games ( id )'],
    ['no replay', { ...OPEN, replay: 'none' }, 'id, games ( id )'],
    [
      'format, best of and replay together',
      { ...OPEN, formatType: 'singles', bestOf: 1, replay: 'has' },
      'id, tournaments!inner ( id, seasons!inner ( id ) ), rounds!inner ( id ), games!inner ( id )',
    ],
  ])('adds the embed %s needs', async (_name, params, expected) => {
    expect(await select(params)).toBe(expected);
  });

  it('embeds the tournament for the test-league filter when test leagues exist', async () => {
    h.calls.length = 0;
    script({ testSeasons: [U1] });
    await listAdminMatchesPage({ ...BASE, includeArchived: true });
    expect(opsOf(lean(), 'select')[0][0]).toBe('id, tournaments!inner ( id )');
  });

  it('uses the same select for the page and the segment pages and head counts', async () => {
    script({ perStatus: { disputed: { count: 2 }, scheduled: { count: 1 } } });
    await listAdminMatchesPage({ ...OPEN, sort: 'status_priority', bestOf: 3, pageSize: 10 });
    const selects = new Set(leanCalls().map((call) => opsOf(call, 'select')[0][0]));
    expect([...selects]).toEqual(['id, rounds!inner ( id )']);
  });
});

describe('listAdminMatchesPage: filters', () => {
  const read = async (params: Partial<AdminMatchListParams>) => {
    h.calls.length = 0;
    script();
    await listAdminMatchesPage({ ...OPEN, ...params });
    return lean();
  };

  it('filters by round, format, bracket type, ruleset and best of on the right tables', async () => {
    const call = await read({
      roundId: U1,
      formatType: 'doubles',
      bracketType: 'double_elim',
      rulesetId: U2,
      bestOf: 5,
    });
    const eq = opsOf(call, 'eq');
    expect(eq).toContainEqual(['round_id', U1]);
    expect(eq).toContainEqual(['tournaments.seasons.format_type', 'doubles']);
    expect(eq).toContainEqual(['tournaments.bracket_type', 'double_elim']);
    expect(eq).toContainEqual(['tournaments.ruleset_id', U2]);
    expect(eq).toContainEqual(['rounds.best_of', 5]);
  });

  it.each([
    ['scheduled', 'scheduled_at'],
    ['played', 'date_played'],
    ['created', 'created_at'],
    ['updated', 'updated_at'],
  ] as const)('applies a %s window as gte / lt on %s', async (field, column) => {
    const call = await read({ date: { field, from: '2026-10-24T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z' } });
    expect(opsOf(call, 'gte')).toEqual([[column, '2026-10-24T22:00:00.000Z']]);
    expect(opsOf(call, 'lt')).toEqual([[column, '2026-10-25T23:00:00.000Z']]);
  });

  it('applies a one-sided window as one bound', async () => {
    const onlyFrom = await read({ date: { field: 'created', from: '2026-10-24T22:00:00.000Z' } });
    expect(opsOf(onlyFrom, 'gte')).toHaveLength(1);
    expect(opsOf(onlyFrom, 'lt')).toHaveLength(0);
    const onlyTo = await read({ date: { field: 'created', to: '2026-10-25T23:00:00.000Z' } });
    expect(opsOf(onlyTo, 'gte')).toHaveLength(0);
    expect(opsOf(onlyTo, 'lt')).toHaveLength(1);
  });

  it('filters "date not set" with IS NULL on the column, not a window', async () => {
    const call = await read({ date: { field: 'played', none: true } });
    expect(opsOf(call, 'is')).toContainEqual(['date_played', null]);
    expect(opsOf(call, 'gte')).toHaveLength(0);
    expect(opsOf(call, 'lt')).toHaveLength(0);
  });

  it('matches a player in either seat', async () => {
    const call = await read({ playerId: U1 });
    expect(opsOf(call, 'or')).toEqual([[`player_1_id.eq.${U1},player_2_id.eq.${U1}`]]);
  });

  it('matches a head-to-head in either seat order', async () => {
    const call = await read({ playerId: U1, player2Id: U2 });
    expect(opsOf(call, 'or')).toEqual([
      [`and(player_1_id.eq.${U1},player_2_id.eq.${U2}),and(player_1_id.eq.${U2},player_2_id.eq.${U1})`],
    ]);
  });

  it('ignores a second player without the first (the route refuses it before)', async () => {
    const call = await read({ player2Id: U2 });
    expect(opsOf(call, 'or')).toEqual([]);
  });

  it('ANDs the search players with the player filter (two or() groups)', async () => {
    const call = await read({ playerId: U1, playerIds: [U3, U4] });
    expect(opsOf(call, 'or')).toEqual([
      [`player_1_id.eq.${U1},player_2_id.eq.${U1}`],
      [`player_1_id.in.(${U3},${U4}),player_2_id.in.(${U3},${U4})`],
    ]);
  });

  it('filters has-replay and hand-edited on the same games embed', async () => {
    const replay = await read({ replay: 'has' });
    expect(opsOf(replay, 'neq')).toEqual([['games.replay_url', '']]);
    const edited = await read({ handEdited: true });
    expect(opsOf(edited, 'eq')).toContainEqual(['games.stats_locked', true]);
    const both = await read({ replay: 'has', handEdited: true });
    expect(opsOf(both, 'neq')).toEqual([['games.replay_url', '']]);
    expect(opsOf(both, 'eq')).toContainEqual(['games.stats_locked', true]);
    expect(opsOf(both, 'is')).toEqual([]);
  });

  it('filters admin notes on the match itself', async () => {
    const call = await read({ hasNotes: true });
    expect(opsOf(call, 'neq')).toEqual([['notes', '']]);
  });

  it('filters "no games" with the anti-join and "no replay" with the anti-join plus the embedded replay filter', async () => {
    const noGames = await read({ noGames: true });
    expect(opsOf(noGames, 'is')).toEqual([['games', null]]);
    expect(opsOf(noGames, 'neq')).toEqual([]);

    const noReplay = await read({ replay: 'none' });
    expect(opsOf(noReplay, 'is')).toEqual([['games', null]]);
    expect(opsOf(noReplay, 'neq')).toEqual([['games.replay_url', '']]);

    // No game at all already means no replay: the embedded replay filter would let a match with replay-less games through.
    const both = await read({ replay: 'none', noGames: true });
    expect(opsOf(both, 'is')).toEqual([['games', null]]);
    expect(opsOf(both, 'neq')).toEqual([]);
  });

  it('returns an empty page, without a read, for content filters that contradict each other', async () => {
    for (const extra of [
      { noGames: true, replay: 'has' as const },
      { noGames: true, handEdited: true },
      { replay: 'none' as const, handEdited: true },
    ]) {
      h.calls.length = 0;
      await expect(listAdminMatchesPage({ ...OPEN, ...extra })).resolves.toEqual({ rows: [], total: 0 });
      expect(h.calls).toHaveLength(0);
    }
  });
});

describe('listAdminMatchesPage: presets', () => {
  const read = async (params: Partial<AdminMatchListParams>) => {
    h.calls.length = 0;
    script();
    await listAdminMatchesPage({ ...OPEN, ...params });
    return lean();
  };

  it('awaiting_confirmation is the pending_confirmation status and nothing else', async () => {
    const call = await read({ preset: 'awaiting_confirmation' });
    expect(opsOf(call, 'in')).toEqual([['status', ['pending_confirmation']]]);
    expect(opsOf(call, 'lte')).toHaveLength(0);
    expect(opsOf(call, 'lt')).toHaveLength(0);
  });

  it('auto_confirms_soon is pending_confirmation with auto_confirm_at within 24 hours (NULL and past due fall out of lte)', async () => {
    const call = await read({ preset: 'auto_confirms_soon' });
    expect(opsOf(call, 'in')).toEqual([['status', ['pending_confirmation']]]);
    expect(opsOf(call, 'lte')).toEqual([['auto_confirm_at', '2026-10-26T10:00:00.000Z']]);
  });

  it('stale_in_progress is in_progress and not updated for 3 days', async () => {
    const call = await read({ preset: 'stale_in_progress' });
    expect(opsOf(call, 'in')).toEqual([['status', ['in_progress']]]);
    expect(opsOf(call, 'lt')).toEqual([['updated_at', '2026-10-22T10:00:00.000Z']]);
  });

  it('overdue is every status but completed with a round deadline in the past', async () => {
    const call = await read({ preset: 'overdue' });
    expect(opsOf(call, 'in')).toEqual([['status', ['scheduled', 'in_progress', 'pending_confirmation', 'disputed']]]);
    expect(opsOf(call, 'lt')).toEqual([['rounds.deadline', '2026-10-25T10:00:00.000Z']]);
    expect(opsOf(call, 'select')[0][0]).toBe('id, rounds!inner ( id )');
  });

  it('uses the clock of the request: now defaults to the current time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-10T00:00:00.000Z'));
    try {
      h.calls.length = 0;
      script();
      await listAdminMatchesPage({ tournamentIds: null, page: 1, pageSize: 50, includeTest: true, includeArchived: true, preset: 'overdue' });
      expect(opsOf(lean(), 'lt')).toEqual([['rounds.deadline', '2030-01-10T00:00:00.000Z']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('narrows the status tab to what the preset can match', async () => {
    const call = await read({ preset: 'overdue', statuses: ['completed', 'disputed'] });
    expect(opsOf(call, 'in')).toEqual([['status', ['disputed']]]);
  });

  it('returns an empty page without any read when the preset and the status tab do not intersect', async () => {
    for (const params of [
      { preset: 'awaiting_confirmation' as const, statuses: ['completed' as const] },
      { preset: 'stale_in_progress' as const, statuses: ['scheduled' as const, 'disputed' as const] },
      { preset: 'overdue' as const, statuses: ['completed' as const] },
    ]) {
      h.calls.length = 0;
      await expect(listAdminMatchesPage({ ...BASE, ...params })).resolves.toEqual({ rows: [], total: 0 });
      expect(h.calls).toHaveLength(0);
    }
  });
});

describe('listAdminMatchesPage: archived and test leagues are hidden by default', () => {
  it('hides archived tournaments and leagues and the matches of test leagues', async () => {
    script({ testSeasons: [U1, U2] });
    await listAdminMatchesPage(BASE);

    expect(callsTo('seasons')).toHaveLength(1);
    expect(opsOf(callsTo('seasons')[0], 'select')).toEqual([['id']]);
    // Test and archived leagues in one read: an unarchived phase of an archived league is hidden with its league.
    expect(opsOf(callsTo('seasons')[0], 'or')).toEqual([['is_test_season.eq.true,archived.eq.true']]);

    const read = lean();
    expect(opsOf(read, 'eq')).toContainEqual(['tournaments.archived', false]);
    expect(opsOf(read, 'or')).toEqual([
      [`season_id.is.null,season_id.not.in.(${U1},${U2})`, { referencedTable: 'tournaments' }],
    ]);
  });

  it('adds no league filter when there is no hidden league, but still hides archived tournaments', async () => {
    script({ testSeasons: [] });
    await listAdminMatchesPage(BASE);
    const read = lean();
    expect(opsOf(read, 'eq')).toContainEqual(['tournaments.archived', false]);
    expect(opsOf(read, 'or')).toEqual([]);
  });

  it('reads only the archived leagues when test leagues are shown, and only the test leagues when archived ones are', async () => {
    script({ testSeasons: [U1] });
    await listAdminMatchesPage({ ...BASE, includeTest: true });
    expect(opsOf(callsTo('seasons')[0], 'or')).toEqual([['archived.eq.true']]);
    expect(opsOf(lean(), 'or')).toEqual([
      [`season_id.is.null,season_id.not.in.(${U1})`, { referencedTable: 'tournaments' }],
    ]);

    h.calls.length = 0;
    script({ testSeasons: [U1] });
    await listAdminMatchesPage({ ...BASE, includeArchived: true });
    expect(opsOf(callsTo('seasons')[0], 'or')).toEqual([['is_test_season.eq.true']]);
  });

  it('shows archived leagues and tournaments with includeArchived', async () => {
    script({ testSeasons: [U1] });
    await listAdminMatchesPage({ ...BASE, includeArchived: true });
    const read = lean();
    expect(opsOf(read, 'eq').filter(([column]) => column === 'tournaments.archived')).toEqual([]);
    expect(opsOf(read, 'or')).toHaveLength(1);
  });

  it('shows everything with both flags: no filter and no read of the seasons', async () => {
    script({ testSeasons: [U1] });
    await listAdminMatchesPage(OPEN);
    expect(callsTo('seasons')).toHaveLength(0);
    const read = lean();
    expect(opsOf(read, 'eq')).toEqual([]);
    expect(opsOf(read, 'or')).toEqual([]);
  });

  it('does not look for test leagues when only standalone tournaments are asked for', async () => {
    script({ testSeasons: [U1] });
    await listAdminMatchesPage({ ...BASE, standaloneOnly: true });
    expect(callsTo('seasons')).toHaveLength(0);
  });

  it('groups a long list of test leagues into one or() per 100 ids, ANDed', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    script({ testSeasons: many });
    await listAdminMatchesPage({ ...BASE, includeArchived: true });
    const groups = opsOf(lean(), 'or');
    expect(groups).toHaveLength(3);
    const sizes = groups.map(([filter]) => String(filter).split(',').length - 1);
    expect(sizes).toEqual([100, 100, 50]);
    for (const [, options] of groups) expect(options).toEqual({ referencedTable: 'tournaments' });
  });

  it('applies the hygiene filters to every segment page and head count of the status sort', async () => {
    script({ testSeasons: [U1], perStatus: { disputed: { count: 1 } } });
    await listAdminMatchesPage({ ...BASE, sort: 'status_priority', statuses: ['disputed'] });
    expect(callsTo('seasons')).toHaveLength(1);
    expect(leanCalls().length).toBe(2);
    for (const call of leanCalls()) {
      expect(opsOf(call, 'eq')).toContainEqual(['tournaments.archived', false]);
      expect(opsOf(call, 'or')).toHaveLength(1);
    }
  });
});

describe('listAdminMatchesPage: sort', () => {
  const orders = async (sort: AdminMatchListParams['sort']) => {
    h.calls.length = 0;
    script();
    await listAdminMatchesPage({ ...OPEN, sort });
    return opsOf(lean(), 'order');
  };

  it('keeps newest first as the default and for created_desc', async () => {
    const expected = [
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ];
    expect(await orders(undefined)).toEqual(expected);
    expect(await orders('created_desc')).toEqual(expected);
  });

  it('puts matches without a scheduled time last in both directions', async () => {
    expect(await orders('scheduled_asc')).toEqual([
      ['scheduled_at', { ascending: true, nullsFirst: false }],
      ['id', { ascending: true }],
    ]);
    expect(await orders('scheduled_desc')).toEqual([
      ['scheduled_at', { ascending: false, nullsFirst: false }],
      ['id', { ascending: false }],
    ]);
  });

  it('orders by the round deadline through the to-one embed, nulls last in both directions', async () => {
    expect(await orders('deadline_asc')).toEqual([
      ['rounds(deadline)', { ascending: true, nullsFirst: false }],
      ['id', { ascending: true }],
    ]);
    expect(await orders('deadline_desc')).toEqual([
      ['rounds(deadline)', { ascending: false, nullsFirst: false }],
      ['id', { ascending: false }],
    ]);
  });

  it('orders by the last update, then the id', async () => {
    expect(await orders('updated_desc')).toEqual([
      ['updated_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(await orders('updated_asc')).toEqual([
      ['updated_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });
});

describe('listAdminMatchesPage: status-priority sort', () => {
  /** disputed 3, pending_confirmation 0, in_progress 5, scheduled 10, completed 2: 20 matches. */
  const COUNTS = {
    disputed: { count: 3 },
    pending_confirmation: { count: 0 },
    in_progress: { count: 5 },
    scheduled: { count: 10 },
    completed: { count: 2 },
  };

  const run = async (page: number, pageSize: number, extra: Partial<AdminMatchListParams> = {}) => {
    h.calls.length = 0;
    script({ perStatus: COUNTS });
    const result = await listAdminMatchesPage({ ...OPEN, sort: 'status_priority', page, pageSize, ...extra });
    const heads = leanCalls().filter(isHead);
    const pages = leanCalls().filter((call) => !isHead(call));
    return {
      result,
      heads: heads.map((call) => statusOf(call)),
      pages: pages.map((call) => ({ status: statusOf(call), range: opsOf(call, 'range')[0] })),
      pageCalls: pages,
      hydrated: hydrateCall() ? (opsOf(hydrateCall()!, 'in')[0][1] as string[]) : null,
    };
  };

  it('counts every status once, in priority order, and sums them to the total', async () => {
    const { result, heads } = await run(2, 4);
    expect(heads).toEqual([['disputed'], ['pending_confirmation'], ['in_progress'], ['scheduled'], ['completed']]);
    expect(result.total).toBe(20);
  });

  it('page 2 of size 4 falls inside the in-progress segment only', async () => {
    const { pages, hydrated, result } = await run(2, 4);
    expect(pages).toEqual([{ status: ['in_progress'], range: [1, 4] }]);
    expect(hydrated).toEqual(['in_progress-1', 'in_progress-2', 'in_progress-3', 'in_progress-4']);
    expect(result.rows.map((r) => r.id)).toEqual(hydrated);
  });

  it('a page that spans segments reads each overlapping segment, in segment order, and skips empty ones', async () => {
    const first = await run(1, 4);
    expect(first.pages).toEqual([
      { status: ['disputed'], range: [0, 2] },
      { status: ['in_progress'], range: [0, 0] },
    ]);
    expect(first.hydrated).toEqual(['disputed-0', 'disputed-1', 'disputed-2', 'in_progress-0']);

    const middle = await run(2, 6);
    expect(middle.pages).toEqual([
      { status: ['in_progress'], range: [3, 4] },
      { status: ['scheduled'], range: [0, 3] },
    ]);
    expect(middle.hydrated).toEqual([
      'in_progress-3', 'in_progress-4', 'scheduled-0', 'scheduled-1', 'scheduled-2', 'scheduled-3',
    ]);
  });

  it('orders each segment oldest waiting first', async () => {
    const { pageCalls } = await run(1, 4);
    for (const call of pageCalls) {
      expect(opsOf(call, 'order')).toEqual([
        ['updated_at', { ascending: true }],
        ['id', { ascending: true }],
      ]);
    }
  });

  it('the last page ends in the last segment', async () => {
    const { pages, hydrated } = await run(5, 4);
    expect(pages).toEqual([
      { status: ['scheduled'], range: [8, 9] },
      { status: ['completed'], range: [0, 1] },
    ]);
    expect(hydrated).toEqual(['scheduled-8', 'scheduled-9', 'completed-0', 'completed-1']);
  });

  it('a page past the end returns no rows, the real total, and no page or hydrate read', async () => {
    const { result, pages, hydrated } = await run(6, 4);
    expect(result).toEqual({ rows: [], total: 20 });
    expect(pages).toEqual([]);
    expect(hydrated).toBeNull();
  });

  it('counts only the statuses of the tab, still in priority order', async () => {
    const { heads, result } = await run(1, 50, { statuses: ['scheduled', 'disputed'] });
    expect(heads).toEqual([['disputed'], ['scheduled']]);
    expect(result.total).toBe(13);
  });

  it('counts only the status of a preset', async () => {
    const { heads } = await run(1, 50, { preset: 'stale_in_progress' });
    expect(heads).toEqual([['in_progress']]);
  });

  it('runs the per-status reads with the same filters as the id read', async () => {
    h.calls.length = 0;
    script({ perStatus: COUNTS });
    await listAdminMatchesPage({ ...OPEN, sort: 'status_priority', pageSize: 4, roundId: U1, hasNotes: true });
    for (const call of leanCalls()) {
      expect(opsOf(call, 'eq')).toContainEqual(['round_id', U1]);
      expect(opsOf(call, 'neq')).toContainEqual(['notes', '']);
    }
  });

  it('throws a failed head count', async () => {
    const dbError = { code: '57014', message: 'timeout' };
    h.state.responder = (call) => (isHead(call) ? { data: null, error: dbError, count: null } : { data: [], error: null });
    await expect(listAdminMatchesPage({ ...OPEN, sort: 'status_priority', pageSize: 4 })).rejects.toBe(dbError);
  });
});

describe('findPlayerIdsForMatchSearch', () => {
  it('reads only ids, matching name or username case-insensitively with wildcards escaped and quoted', async () => {
    h.state.responder = () => ({ data: [{ id: U1 }], error: null });
    const result = await findPlayerIdsForMatchSearch('50%_a,"b"');
    expect(result).toEqual({ ids: [U1], truncated: false });
    const call = h.calls[0];
    expect(call.table).toBe('players');
    expect(opsOf(call, 'select')).toEqual([['id']]);
    // `%` and `_` get a LIKE backslash, then every backslash and quote is escaped for the quoted value.
    const pattern = String.raw`%50\\%\\_a,\"b\"%`;
    expect(opsOf(call, 'or')).toEqual([[`name.ilike."${pattern}",ps_username.ilike."${pattern}"`]]);
  });

  it('is bounded and says so when more players match than it expands', async () => {
    const many = Array.from({ length: ADMIN_MATCH_SEARCH_PLAYER_CAP + 1 }, (_, i) => ({ id: `p${i}` }));
    h.state.responder = () => ({ data: many, error: null });
    const result = await findPlayerIdsForMatchSearch('a');
    expect(opsOf(h.calls[0], 'limit')).toEqual([[ADMIN_MATCH_SEARCH_PLAYER_CAP + 1]]);
    expect(result.ids).toHaveLength(ADMIN_MATCH_SEARCH_PLAYER_CAP);
    expect(result.truncated).toBe(true);
  });

  it('throws a database error', async () => {
    const dbError = new Error('players down');
    h.state.responder = () => ({ data: null, error: dbError });
    await expect(findPlayerIdsForMatchSearch('a')).rejects.toBe(dbError);
  });
});

describe('listMatchFilterPlayers', () => {
  it('reads the id and name columns only', async () => {
    h.state.responder = () => ({
      data: [{ id: U1, name: 'Mara', discord_id: 'secret', status: 'banned' }],
      error: null,
    });
    const result = await listMatchFilterPlayers([U1], { visibleOnly: false });
    expect(result).toEqual([{ id: U1, name: 'Mara' }]);
    const call = h.calls[0];
    expect(call.table).toBe('players');
    expect(opsOf(call, 'select')).toEqual([['id, name']]);
    expect(opsOf(call, 'in')).toEqual([['id', [U1]]]);
    expect(opsOf(call, 'eq')).toEqual([]);
  });

  it('keeps only what the public directory shows when visibleOnly is set', async () => {
    h.state.responder = () => ({ data: [], error: null });
    await listMatchFilterPlayers([U1, U2], { visibleOnly: true });
    expect(opsOf(h.calls[0], 'eq')).toEqual([
      ['status', 'active'],
      ['is_test_account', false],
    ]);
  });

  it('de-duplicates the ids and reads nothing for an empty list', async () => {
    h.state.responder = () => ({ data: [], error: null });
    await listMatchFilterPlayers([U1, U1], { visibleOnly: false });
    expect(opsOf(h.calls[0], 'in')).toEqual([['id', [U1]]]);

    h.calls.length = 0;
    await expect(listMatchFilterPlayers([], { visibleOnly: true })).resolves.toEqual([]);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses an id that is not a uuid before any read', async () => {
    await expect(listMatchFilterPlayers(['nope'], { visibleOnly: false })).rejects.toThrow(/playerId/);
    expect(h.calls).toHaveLength(0);
  });

  it('throws a database error', async () => {
    const dbError = new Error('players down');
    h.state.responder = () => ({ data: null, error: dbError });
    await expect(listMatchFilterPlayers([U1], { visibleOnly: false })).rejects.toBe(dbError);
  });
});

describe('listTournamentIdsBySeason', () => {
  it('lists the phase ids of a league', async () => {
    h.state.responder = () => ({ data: [{ id: U1 }, { id: U2 }], error: null });
    await expect(listTournamentIdsBySeason(U3)).resolves.toEqual([U1, U2]);
    expect(opsOf(h.calls[0], 'eq')).toEqual([['season_id', U3]]);
  });

  it('rejects an id that is not a uuid', async () => {
    await expect(listTournamentIdsBySeason('nope')).rejects.toThrow(/seasonId/);
  });
});

describe('listAdminMatchRounds', () => {
  it('reads the rounds of one tournament in play order, narrow columns only', async () => {
    h.state.responder = () => ({
      data: [
        { id: 'r1', name: 'Round 1', round_number: 1, bracket_side: null, deadline: '2026-01-01', best_of: 3 },
        { id: 'r2', name: 'Round 2', round_number: 2, bracket_side: 'winners', deadline: null, best_of: 3 },
      ],
      error: null,
    });
    const rounds = await listAdminMatchRounds(U1);
    expect(rounds).toEqual([
      { id: 'r1', name: 'Round 1', round_number: 1, bracket_side: null },
      { id: 'r2', name: 'Round 2', round_number: 2, bracket_side: 'winners' },
    ]);
    const call = h.calls[0];
    expect(call.table).toBe('rounds');
    expect(opsOf(call, 'select')).toEqual([['id, name, round_number, bracket_side']]);
    expect(opsOf(call, 'eq')).toEqual([['tournament_id', U1]]);
    expect(opsOf(call, 'order')).toEqual([['round_number'], ['bracket_side'], ['id']]);
  });

  it('pages past the 1000-row cap', async () => {
    const row = (i: number) => ({ id: `r${i}`, name: `R${i}`, round_number: i, bracket_side: null });
    h.state.responder = (call) => {
      const [from] = opsOf(call, 'range')[0] as [number, number];
      return { data: from === 0 ? Array.from({ length: 1000 }, (_, i) => row(i)) : [row(1000)], error: null };
    };
    const rounds = await listAdminMatchRounds(U1);
    expect(rounds).toHaveLength(1001);
    expect(h.calls.map((call) => opsOf(call, 'range')[0])).toEqual([[0, 999], [1000, 1999]]);
  });

  it('rejects an id that is not a uuid before any read', async () => {
    await expect(listAdminMatchRounds('nope')).rejects.toThrow(/tournamentId/);
    expect(h.calls).toHaveLength(0);
  });

  it('throws a database error', async () => {
    const dbError = new Error('rounds down');
    h.state.responder = () => ({ data: null, error: dbError });
    await expect(listAdminMatchRounds(U1)).rejects.toBe(dbError);
  });
});

describe('listAdminMatchFilterOptions', () => {
  const tournament = (over: Record<string, unknown>) => ({
    id: 't',
    name: 'T',
    status: 'active',
    archived: false,
    season_id: null,
    stage_order: 0,
    ruleset_id: 'rs1',
    ...over,
  });
  const season = (over: Record<string, unknown>) => ({
    id: 's',
    name: 'S',
    status: 'active',
    archived: false,
    is_test_season: false,
    ...over,
  });
  const ruleset = (id: string, name: string) => ({ id, name });

  /** A fake database: `.in('id', [...])` filters, `.range(from, to)` slices; nothing else is honoured. */
  function database(tables: Record<string, unknown[]>) {
    h.state.responder = (call) => {
      let rows = tables[call.table] ?? [];
      const inOp = opsOf(call, 'in').find(([column]) => column === 'id');
      if (inOp) rows = rows.filter((row) => (inOp[1] as string[]).includes((row as { id: string }).id));
      const range = opsOf(call, 'range')[0] as [number, number] | undefined;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return { data: rows, error: null };
    };
  }

  it('groups phases under their league (by stage_order) and lists standalone tournaments, archived flagged and last', async () => {
    database({
      tournaments: [
        tournament({ id: 'a2', name: 'Playoffs', season_id: 's1', stage_order: 1 }),
        tournament({ id: 'a1', name: 'Groups', season_id: 's1', stage_order: 0 }),
        tournament({ id: 'old', name: 'Old cup', archived: true }),
        tournament({ id: 'w1', name: 'Weekly' }),
      ],
      seasons: [season({ id: 's0', name: 'Aaa archived', archived: true }), season({ id: 's1', name: 'Summer League' })],
      ruleset_definition_versions: [ruleset('rs1', 'Gen 9 OU')],
    });

    const options = await listAdminMatchFilterOptions({ tournamentIds: null, seasonIds: null });

    expect(options.leagues.map((l) => l.id)).toEqual(['s1', 's0']);
    expect(options.leagues[0].phases.map((p) => p.id)).toEqual(['a1', 'a2']);
    expect(options.leagues[1]).toMatchObject({ archived: true, phases: [] });
    expect(options.tournaments.map((t) => t.id)).toEqual(['w1', 'old']);
    expect(options.tournaments[1]).toMatchObject({ archived: true });
  });

  it('carries the ruleset id of each phase and standalone tournament and lists the rulesets by name', async () => {
    database({
      tournaments: [
        tournament({ id: 'a1', season_id: 's1', ruleset_id: 'rs2' }),
        tournament({ id: 'a2', season_id: 's1', ruleset_id: 'rs1', stage_order: 1 }),
        tournament({ id: 'w1', ruleset_id: 'rs2' }),
      ],
      seasons: [season({ id: 's1' })],
      ruleset_definition_versions: [ruleset('rs2', 'Zeta rules'), ruleset('rs1', 'Alpha rules'), ruleset('rs9', 'Unused')],
    });

    const options = await listAdminMatchFilterOptions({ tournamentIds: null, seasonIds: null });

    expect(options.leagues[0].phases.map((p) => [p.id, p.ruleset_id])).toEqual([['a1', 'rs2'], ['a2', 'rs1']]);
    expect(options.tournaments[0]).toMatchObject({ id: 'w1', ruleset_id: 'rs2' });
    // Only the rulesets of the tournaments read, sorted by name.
    expect(options.rulesets).toEqual([
      { id: 'rs1', name: 'Alpha rules' },
      { id: 'rs2', name: 'Zeta rules' },
    ]);
    // A ruleset is a pinned VERSION: the list reads the version rows (frozen name).
    const rulesetRead = callsTo('ruleset_definition_versions')[0];
    expect(opsOf(rulesetRead, 'select')).toEqual([['id, name:name_text']]);
    expect([...(opsOf(rulesetRead, 'in')[0][1] as string[])].sort()).toEqual(['rs1', 'rs2']);
    expect(opsOf(callsTo('tournaments')[0], 'select')[0][0]).toContain('ruleset_id');
  });

  it('pages past the 1000-row PostgREST cap for tournaments and seasons', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => tournament({ id: `t${i}`, season_id: 's1' }));
    const rest = Array.from({ length: 5 }, (_, i) => tournament({ id: `u${i}`, season_id: 's1' }));
    database({ tournaments: [...full, ...rest], seasons: [season({ id: 's1' })], ruleset_definition_versions: [ruleset('rs1', 'R')] });

    const options = await listAdminMatchFilterOptions({ tournamentIds: null, seasonIds: null });

    const tournamentRanges = callsTo('tournaments').map((call) => opsOf(call, 'range')[0]);
    expect(tournamentRanges).toEqual([[0, 999], [1000, 1999]]);
    expect(options.leagues[0].phases).toHaveLength(1005);
  });

  it('restricts a resource admin to their tournaments, the leagues those belong to and their rulesets', async () => {
    database({
      tournaments: [
        tournament({ id: 'a1', season_id: 's1', ruleset_id: 'rs1' }),
        tournament({ id: 'w1', name: 'Weekly', ruleset_id: 'rs2' }),
        tournament({ id: 'other', season_id: 's3', ruleset_id: 'rs3' }),
      ],
      seasons: [season({ id: 's1' }), season({ id: 's2' }), season({ id: 's3' })],
      ruleset_definition_versions: [ruleset('rs1', 'One'), ruleset('rs2', 'Two'), ruleset('rs3', 'Three')],
    });

    const options = await listAdminMatchFilterOptions({ tournamentIds: ['a1', 'w1'], seasonIds: ['s2'] });

    expect(opsOf(callsTo('tournaments')[0], 'in')).toEqual([['id', ['a1', 'w1']]]);
    expect(opsOf(callsTo('tournaments')[0], 'range')).toEqual([]);
    // Assigned league s2 (no phases yet) plus the league s1 of the assigned phase.
    expect([...(opsOf(callsTo('seasons')[0], 'in')[0][1] as string[])].sort()).toEqual(['s1', 's2']);
    expect(options.leagues.map((l) => l.id).sort()).toEqual(['s1', 's2']);
    expect(options.tournaments.map((t) => t.id)).toEqual(['w1']);
    // The rulesets are those of the scoped tournaments only: not the unscoped tournament's.
    expect([...(opsOf(callsTo('ruleset_definition_versions')[0], 'in')[0][1] as string[])].sort()).toEqual(['rs1', 'rs2']);
    expect(options.rulesets.map((r) => r.id)).toEqual(['rs1', 'rs2']);
  });

  it('reads a long id list in chunks', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t${i}`);
    database({});
    await listAdminMatchFilterOptions({ tournamentIds: ids, seasonIds: [] });
    const sizes = callsTo('tournaments').map((call) => (opsOf(call, 'in')[0][1] as string[]).length);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it('reads nothing for a resource admin with no assignments', async () => {
    const options = await listAdminMatchFilterOptions({ tournamentIds: [], seasonIds: [] });
    expect(options).toEqual({ leagues: [], tournaments: [], rulesets: [] });
    expect(h.calls).toHaveLength(0);
  });

  it('reads no rulesets when there is no tournament', async () => {
    database({ tournaments: [], seasons: [season({ id: 's1' })] });
    const options = await listAdminMatchFilterOptions({ tournamentIds: null, seasonIds: null });
    expect(options.rulesets).toEqual([]);
    expect(callsTo('ruleset_definition_versions')).toHaveLength(0);
  });

  it('throws a database error', async () => {
    const dbError = new Error('tournaments down');
    h.state.responder = () => ({ data: null, error: dbError });
    await expect(listAdminMatchFilterOptions({ tournamentIds: null, seasonIds: null })).rejects.toBe(dbError);
  });
});
