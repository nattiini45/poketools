/**
 * Admin match list queries: `listAdminMatchesPage` (server-side filters,
 * `.range()` paging with an exact count), the bounded player search, and the
 * League -> Phase filter options (paged past the PostgREST `max_rows` cap).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuilder, METHODS } = vi.hoisted(() => {
  const methods = [
    'from', 'select', 'eq', 'in', 'is', 'or', 'order', 'limit', 'range',
  ];
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of methods) mb[m] = vi.fn();
  return { mockBuilder: mb, METHODS: methods };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { ADMIN_MATCH_SEARCH_PLAYER_CAP } from '@/lib/admin/match-list';
import {
  findPlayerIdsForMatchSearch,
  listAdminMatchFilterOptions,
  listAdminMatchesPage,
  listTournamentIdsBySeason,
} from '../matches';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

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
    round: { status: 'active' },
    tournaments: { name: 'Group stage', season_id: 's1', seasons: { name: 'Summer League' } },
    ...over,
  };
}

beforeEach(() => {
  for (const m of METHODS) mockBuilder[m].mockReset().mockReturnValue(mockBuilder);
  delete (mockBuilder as { then?: unknown }).then;
});

describe('listAdminMatchesPage', () => {
  it('reads one ordered page with an exact count and maps league context onto the row', async () => {
    mockBuilder.range.mockReturnValue({ data: [matchRow()], error: null, count: 731 });

    const result = await listAdminMatchesPage({ tournamentIds: null, page: 3, pageSize: 50 });

    expect(mockBuilder.from).toHaveBeenCalledWith('matches');
    expect(mockBuilder.select).toHaveBeenCalledWith(expect.stringContaining('tournaments!inner'), {
      count: 'exact',
      head: false,
    });
    expect(mockBuilder.order.mock.calls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(mockBuilder.range).toHaveBeenCalledWith(100, 149);
    expect(mockBuilder.limit).not.toHaveBeenCalled();
    expect(result.total).toBe(731);
    expect(result.rows[0]).toMatchObject({
      id: 'm1',
      tournament_name: 'Group stage',
      season_id: 's1',
      season_name: 'Summer League',
      player_1_name: 'Alice',
    });
  });

  it('maps a standalone tournament to no league', async () => {
    mockBuilder.range.mockReturnValue({
      data: [matchRow({ tournaments: { name: 'Weekly #1', season_id: null, seasons: null } })],
      error: null,
      count: 1,
    });
    const { rows } = await listAdminMatchesPage({ tournamentIds: null, page: 1, pageSize: 25 });
    expect(rows[0]).toMatchObject({ tournament_name: 'Weekly #1', season_id: null, season_name: null });
  });

  it('selects players in the narrow shape only (no private player column)', async () => {
    mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
    await listAdminMatchesPage({ tournamentIds: null, page: 1, pageSize: 50 });
    const select = String(mockBuilder.select.mock.calls[0][0]);
    expect(select).toMatch(/player_1:players!matches_player_1_id_fkey \( name, avatar_url \)/);
    expect(select).toMatch(/player_2:players!matches_player_2_id_fkey \( name, avatar_url \)/);
    expect(select).toMatch(/winner:players!matches_winner_id_fkey \( name \)/);
    for (const column of ['discord_id', 'auth_user_id', 'ban_reason', 'suspended_until', 'is_admin', 'avatar_config']) {
      expect(select).not.toContain(column);
    }
  });

  it('applies scope, status, standalone, player and match-id filters in the database', async () => {
    mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
    await listAdminMatchesPage({
      tournamentIds: [U1, U2],
      standaloneOnly: true,
      statuses: ['disputed', 'completed'],
      matchId: U3,
      playerIds: [U1, U2],
      page: 1,
      pageSize: 50,
    });
    expect(mockBuilder.in).toHaveBeenCalledWith('tournament_id', [U1, U2]);
    expect(mockBuilder.is).toHaveBeenCalledWith('tournaments.season_id', null);
    expect(mockBuilder.in).toHaveBeenCalledWith('status', ['disputed', 'completed']);
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', U3);
    expect(mockBuilder.or).toHaveBeenCalledWith(`player_1_id.in.(${U1},${U2}),player_2_id.in.(${U1},${U2})`);
  });

  it('adds no tournament filter for an unrestricted caller', async () => {
    mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });
    await listAdminMatchesPage({ tournamentIds: null, page: 1, pageSize: 50 });
    expect(mockBuilder.in).not.toHaveBeenCalled();
  });

  it('returns an empty page for an empty scope without querying', async () => {
    const result = await listAdminMatchesPage({ tournamentIds: [], page: 1, pageSize: 50 });
    expect(result).toEqual({ rows: [], total: 0 });
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('refuses a player id that is not a uuid before it reaches the filter string', async () => {
    await expect(
      listAdminMatchesPage({ tournamentIds: null, playerIds: ['x),or=(id.neq.0'], page: 1, pageSize: 50 })
    ).rejects.toThrow(/playerId/);
    expect(mockBuilder.or).not.toHaveBeenCalled();
  });

  it('reports the real total when the page is past the last row, instead of an error', async () => {
    mockBuilder.range.mockReturnValue({ data: null, error: { code: 'PGRST103', message: 'range' }, count: null });
    (mockBuilder as { then?: unknown }).then = (resolve: (value: unknown) => void) =>
      resolve({ data: null, error: null, count: 12 });

    const result = await listAdminMatchesPage({ tournamentIds: null, page: 9, pageSize: 25 });

    expect(result).toEqual({ rows: [], total: 12 });
    expect(mockBuilder.select).toHaveBeenLastCalledWith(expect.any(String), { count: 'exact', head: true });
  });

  it('throws every other database error', async () => {
    const dbError = { code: '57014', message: 'timeout' };
    mockBuilder.range.mockReturnValue({ data: null, error: dbError, count: null });
    await expect(listAdminMatchesPage({ tournamentIds: null, page: 1, pageSize: 50 })).rejects.toBe(dbError);
  });
});

describe('findPlayerIdsForMatchSearch', () => {
  it('reads only ids, matching name or username case-insensitively with wildcards escaped and quoted', async () => {
    mockBuilder.limit.mockReturnValue({ data: [{ id: U1 }], error: null });
    const result = await findPlayerIdsForMatchSearch('50%_a,"b"');
    expect(result).toEqual({ ids: [U1], truncated: false });
    expect(mockBuilder.from).toHaveBeenCalledWith('players');
    expect(mockBuilder.select).toHaveBeenCalledWith('id');
    // `%` and `_` get a LIKE backslash, then every backslash and quote is escaped for the quoted value.
    const pattern = String.raw`%50\\%\\_a,\"b\"%`;
    expect(mockBuilder.or).toHaveBeenCalledWith(`name.ilike."${pattern}",ps_username.ilike."${pattern}"`);
  });

  it('is bounded and says so when more players match than it expands', async () => {
    const many = Array.from({ length: ADMIN_MATCH_SEARCH_PLAYER_CAP + 1 }, (_, i) => ({ id: `p${i}` }));
    mockBuilder.limit.mockReturnValue({ data: many, error: null });
    const result = await findPlayerIdsForMatchSearch('a');
    expect(mockBuilder.limit).toHaveBeenCalledWith(ADMIN_MATCH_SEARCH_PLAYER_CAP + 1);
    expect(result.ids).toHaveLength(ADMIN_MATCH_SEARCH_PLAYER_CAP);
    expect(result.truncated).toBe(true);
  });

  it('throws a database error', async () => {
    const dbError = new Error('players down');
    mockBuilder.limit.mockReturnValue({ data: null, error: dbError });
    await expect(findPlayerIdsForMatchSearch('a')).rejects.toBe(dbError);
  });
});

describe('listTournamentIdsBySeason', () => {
  it('lists the phase ids of a league', async () => {
    mockBuilder.limit.mockReturnValue({ data: [{ id: U1 }, { id: U2 }], error: null });
    await expect(listTournamentIdsBySeason(U3)).resolves.toEqual([U1, U2]);
    expect(mockBuilder.eq).toHaveBeenCalledWith('season_id', U3);
  });

  it('rejects an id that is not a uuid', async () => {
    await expect(listTournamentIdsBySeason('nope')).rejects.toThrow(/seasonId/);
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

  it('groups phases under their league (by stage_order) and lists standalone tournaments, archived flagged and last', async () => {
    mockBuilder.range
      .mockReturnValueOnce({
        data: [
          tournament({ id: 'a2', name: 'Playoffs', season_id: 's1', stage_order: 1 }),
          tournament({ id: 'a1', name: 'Groups', season_id: 's1', stage_order: 0 }),
          tournament({ id: 'old', name: 'Old cup', archived: true }),
          tournament({ id: 'w1', name: 'Weekly' }),
        ],
        error: null,
      })
      .mockReturnValueOnce({
        data: [
          season({ id: 's0', name: 'Aaa archived', archived: true }),
          season({ id: 's1', name: 'Summer League' }),
        ],
        error: null,
      });

    const options = await listAdminMatchFilterOptions({ tournamentIds: null, seasonIds: null });

    expect(options.leagues.map((l) => l.id)).toEqual(['s1', 's0']);
    expect(options.leagues[0].phases.map((p) => p.id)).toEqual(['a1', 'a2']);
    expect(options.leagues[1]).toMatchObject({ archived: true, phases: [] });
    expect(options.tournaments.map((t) => t.id)).toEqual(['w1', 'old']);
    expect(options.tournaments[1]).toMatchObject({ archived: true });
  });

  it('pages past the 1000-row PostgREST cap for tournaments and seasons', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => tournament({ id: `t${i}`, season_id: 's1' }));
    const rest = Array.from({ length: 5 }, (_, i) => tournament({ id: `u${i}`, season_id: 's1' }));
    mockBuilder.range
      .mockReturnValueOnce({ data: full, error: null })
      .mockReturnValueOnce({ data: rest, error: null })
      .mockReturnValueOnce({ data: [season({ id: 's1' })], error: null });

    const options = await listAdminMatchFilterOptions({ tournamentIds: null, seasonIds: null });

    expect(mockBuilder.range.mock.calls.slice(0, 2)).toEqual([[0, 999], [1000, 1999]]);
    expect(options.leagues[0].phases).toHaveLength(1005);
  });

  it('restricts a resource admin to their tournaments and the leagues those belong to', async () => {
    mockBuilder.order
      .mockReturnValueOnce({
        data: [
          tournament({ id: 'a1', season_id: 's1' }),
          tournament({ id: 'w1', name: 'Weekly' }),
        ],
        error: null,
      })
      .mockReturnValueOnce({ data: [season({ id: 's1' }), season({ id: 's2' })], error: null });

    const options = await listAdminMatchFilterOptions({ tournamentIds: ['a1', 'w1'], seasonIds: ['s2'] });

    expect(mockBuilder.in.mock.calls[0]).toEqual(['id', ['a1', 'w1']]);
    // Assigned league s2 (no phases yet) plus the league s1 of the assigned phase.
    expect(mockBuilder.in.mock.calls[1][0]).toBe('id');
    expect([...mockBuilder.in.mock.calls[1][1]].sort()).toEqual(['s1', 's2']);
    expect(mockBuilder.range).not.toHaveBeenCalled();
    expect(options.leagues.map((l) => l.id).sort()).toEqual(['s1', 's2']);
    expect(options.tournaments.map((t) => t.id)).toEqual(['w1']);
  });

  it('reads a long id list in chunks', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t${i}`);
    mockBuilder.order.mockReturnValue({ data: [], error: null });
    await listAdminMatchFilterOptions({ tournamentIds: ids, seasonIds: [] });
    const tournamentCalls = mockBuilder.in.mock.calls.filter(([, chunk]) => chunk[0]?.startsWith('t'));
    expect(tournamentCalls.map(([, chunk]) => chunk.length)).toEqual([100, 100, 50]);
  });

  it('reads nothing for a resource admin with no assignments', async () => {
    const options = await listAdminMatchFilterOptions({ tournamentIds: [], seasonIds: [] });
    expect(options).toEqual({ leagues: [], tournaments: [] });
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('throws a database error', async () => {
    const dbError = new Error('tournaments down');
    mockBuilder.range.mockReturnValue({ data: null, error: dbError });
    await expect(listAdminMatchFilterOptions({ tournamentIds: null, seasonIds: null })).rejects.toBe(dbError);
  });
});
