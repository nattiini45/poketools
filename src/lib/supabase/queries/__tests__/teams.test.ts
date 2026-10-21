import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Chainable Supabase mock ────────────────────────────────────────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
  'limit', 'range', 'match', 'returns', 'throwOnError', 'rpc',
];

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError', 'rpc',
  ];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import {
  listTeamsByTournament,
  listTeamsByTournamentIds,
  listTeamsByPlayer,
  getTeamById,
  getPlayerTeamForTournament,
  getPlayerTeamForMatch,
  listTeamsByPlayerWithContext,
  listTeamsBySeason,
  createTeam,
  updateTeamPokemon,
  deleteTeam,
  upsertTeamForMatch,
  getItemUsageForPokemon,
  getTeamByShareToken,
  setTeamShareToken,
  disableTeamShareToken,
  forkTeam,
  getTeamVisibilityFacts,
  listSeasonTeamLeadsWithFacts,
  listLibraryTeams,
  ITEM_USAGE_LIMIT,
  TEAM_COLUMNS,
} from '../teams';
import { ilikeAnyOf } from '../../postgrest-filter';
import { TeamMatchCompletedError } from '@/lib/team/completed-match-lock';
import type { PokemonSet, Team, TeamImportSource } from '@/types/team';

// ── Test fixtures ──────────────────────────────────────────────────
const TEAM_ROW = {
  id: 'team1',
  player_id: 'p1',
  tournament_id: 't1',
  season_id: null,
  match_id: null,
  pokemon: [{ species: 'Pikachu', item: 'Light Ball' }],
  import_source: 'manual',
  locked: false,
  is_draft_team: false,
  draft_pool_id: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const LOCKED_TEAM_ROW = { ...TEAM_ROW, id: 'team-locked', locked: true };

/** The refusal of trigger teams_completed_match_lock as PostgREST reports it. */
const COMPLETED_MATCH_REFUSAL = {
  code: 'P0001',
  message: 'TEAM_MATCH_COMPLETED',
  details: '{"team_id": "team1", "match_id": "match1"}',
  hint: null,
};

beforeEach(() => {
  // mockReset clears calls, instances, AND the mockReturnValueOnce queue.
  // mockClear alone does NOT clear the once-queue, causing stale values to
  // leak between tests when a test sets mockReturnValueOnce but the runtime
  // code path never consumes it (e.g. 'all_time' scope skips .eq() calls).
  for (const m of [...chainMethods, 'single', 'maybeSingle']) {
    mockBuilder[m].mockReset();
  }
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
});

// ── toTeam transformer ─────────────────────────────────────────────
describe('listTeamsByTournament (exercises toTeam)', () => {
  it('returns mapped teams ordered by created_at', async () => {
    // Chain: from -> select -> eq -> order -> await
    mockBuilder.order.mockReturnValue({ data: [TEAM_ROW], error: null });

    const result = await listTeamsByTournament('t1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(result).toHaveLength(1);

    const t = result[0];
    expect(t.id).toBe('team1');
    expect(t.player_id).toBe('p1');
    expect(t.tournament_id).toBe('t1');
    expect(t.pokemon).toEqual([{ species: 'Pikachu', item: 'Light Ball' }]);
    expect(t.locked).toBe(false);
    expect(t.is_draft_team).toBe(false);
  });

  it('throws on error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('db error') });
    await expect(listTeamsByTournament('t1')).rejects.toThrow('db error');
  });
});

describe('listTeamsByTournamentIds', () => {
  it('returns empty array for empty input without querying', async () => {
    const result = await listTeamsByTournamentIds([]);
    expect(result).toEqual([]);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('returns teams across multiple tournaments', async () => {
    const row2 = { ...TEAM_ROW, id: 'team2', tournament_id: 't2' };
    mockBuilder.order.mockReturnValue({ data: [TEAM_ROW, row2], error: null });

    const result = await listTeamsByTournamentIds(['t1', 't2']);
    expect(mockBuilder.in).toHaveBeenCalledWith('tournament_id', ['t1', 't2']);
    expect(result).toHaveLength(2);
  });

  it('throws on error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('multi err') });
    await expect(listTeamsByTournamentIds(['t1'])).rejects.toThrow('multi err');
  });
});

describe('listTeamsByPlayer', () => {
  it('returns teams for a player sorted desc', async () => {
    mockBuilder.order.mockReturnValue({ data: [TEAM_ROW], error: null });

    const result = await listTeamsByPlayer('p1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
    expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toHaveLength(1);
  });

  it('throws on error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('player err') });
    await expect(listTeamsByPlayer('p1')).rejects.toThrow('player err');
  });
});

describe('getTeamById', () => {
  it('returns team when found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: TEAM_ROW, error: null });

    const result = await getTeamById('team1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('team1');
  });

  it('returns null when not found', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await getTeamById('missing');
    expect(result).toBeNull();
  });

  it('throws on error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('get err') });
    await expect(getTeamById('team1')).rejects.toThrow('get err');
  });
});

describe('getPlayerTeamForTournament', () => {
  it('returns team for player+tournament combo', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: TEAM_ROW, error: null });

    const result = await getPlayerTeamForTournament('p1', 't1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(result).not.toBeNull();
    expect(result!.player_id).toBe('p1');
  });

  it('returns null when no team exists', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await getPlayerTeamForTournament('p1', 't-none');
    expect(result).toBeNull();
  });

  it('throws on error', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: new Error('combo err') });
    await expect(getPlayerTeamForTournament('p1', 't1')).rejects.toThrow('combo err');
  });

  it('reads only the planned row (no match_id), so a match-prep row next to it cannot make it throw', async () => {
    // With a planned row AND a match-linked row in one tournament, the
    // unfiltered read hit PGRST116 (maybeSingle with two rows). The filter
    // keeps the match-linked row out of this read.
    mockBuilder.maybeSingle.mockResolvedValue({ data: TEAM_ROW, error: null });

    const result = await getPlayerTeamForTournament('p1', 't1');

    expect(mockBuilder.is).toHaveBeenCalledWith('match_id', null);
    expect(result?.id).toBe('team1');
    expect(result?.match_id).toBeNull();
  });
});

describe('getPlayerTeamForMatch', () => {
  const MATCH = { id: 'a0000000-0000-4000-a000-000000000001', tournament_id: 't1' };
  const LINKED_ROW = { ...TEAM_ROW, id: 'team-linked', match_id: MATCH.id, created_at: '2025-02-01T00:00:00Z' };
  const OTHER_PLANNED = { ...TEAM_ROW, id: 'team-planned-2' };

  it('filters to the player, the tournament and (this match or planned), match id quoted', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });

    await getPlayerTeamForMatch('p1', MATCH);

    expect(mockBuilder.eq).toHaveBeenCalledWith('player_id', 'p1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
    expect(mockBuilder.or).toHaveBeenCalledWith(`match_id.eq."${MATCH.id}",match_id.is.null`);
  });

  it('prefers the row linked to this match over the planned row (two rows, no throw)', async () => {
    mockBuilder.order.mockReturnValue({ data: [LINKED_ROW, TEAM_ROW], error: null });

    const result = await getPlayerTeamForMatch('p1', MATCH);

    expect(result?.id).toBe('team-linked');
  });

  it('falls back to the planned row', async () => {
    mockBuilder.order.mockReturnValue({ data: [TEAM_ROW], error: null });
    expect((await getPlayerTeamForMatch('p1', MATCH))?.id).toBe('team1');
  });

  it('returns null without rows', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });
    expect(await getPlayerTeamForMatch('p1', MATCH)).toBeNull();
  });

  it('a match id with logic-tree characters cannot add conditions (L1)', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });

    await getPlayerTeamForMatch('p1', { id: 'x,player_id.neq.p1', tournament_id: 't1' });

    expect(mockBuilder.or).toHaveBeenCalledWith('match_id.eq."x,player_id.neq.p1",match_id.is.null');
  });

  it('throws on two planned rows (data error, no silent pick)', async () => {
    mockBuilder.order.mockReturnValue({ data: [TEAM_ROW, OTHER_PLANNED], error: null });
    await expect(getPlayerTeamForMatch('p1', MATCH)).rejects.toThrow('2 planned rows');
  });

  it('throws on two rows linked to the match', async () => {
    mockBuilder.order.mockReturnValue({ data: [LINKED_ROW, { ...LINKED_ROW, id: 'dup' }], error: null });
    await expect(getPlayerTeamForMatch('p1', MATCH)).rejects.toThrow('2 rows linked to match');
  });

  it('throws on a database error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('match read err') });
    await expect(getPlayerTeamForMatch('p1', MATCH)).rejects.toThrow('match read err');
  });

  it('selects no share column (C1)', async () => {
    mockBuilder.order.mockReturnValue({ data: [], error: null });
    await getPlayerTeamForMatch('p1', MATCH);
    expect(mockBuilder.select).toHaveBeenCalledWith(TEAM_COLUMNS);
  });
});

describe('listTeamsByPlayerWithContext', () => {
  it('returns paginated data with tournament names and total', async () => {
    const rowWithJoin = { ...TEAM_ROW, tournaments: { name: 'Weekly #1' } };
    mockBuilder.range.mockReturnValue({ data: [rowWithJoin], error: null, count: 5 });

    const result = await listTeamsByPlayerWithContext('p1');
    expect(result.total).toBe(5);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].tournament_name).toBe('Weekly #1');
  });

  it('handles null tournaments join', async () => {
    const rowNoJoin = { ...TEAM_ROW, tournaments: null };
    mockBuilder.range.mockReturnValue({ data: [rowNoJoin], error: null, count: 1 });

    const result = await listTeamsByPlayerWithContext('p1');
    expect(result.data[0].tournament_name).toBeNull();
  });

  it('clamps limit to 200', async () => {
    mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });

    await listTeamsByPlayerWithContext('p1', { limit: 500 });
    // limit clamped to 200, offset 0 -> range(0, 199)
    expect(mockBuilder.range).toHaveBeenCalledWith(0, 199);
  });

  it('applies offset', async () => {
    mockBuilder.range.mockReturnValue({ data: [], error: null, count: 0 });

    await listTeamsByPlayerWithContext('p1', { limit: 10, offset: 20 });
    expect(mockBuilder.range).toHaveBeenCalledWith(20, 29);
  });

  it('defaults total to 0 when count is null', async () => {
    mockBuilder.range.mockReturnValue({ data: [], error: null, count: null });

    const result = await listTeamsByPlayerWithContext('p1');
    expect(result.total).toBe(0);
  });

  it('throws on error', async () => {
    mockBuilder.range.mockReturnValue({ data: null, error: new Error('ctx err'), count: null });
    await expect(listTeamsByPlayerWithContext('p1')).rejects.toThrow('ctx err');
  });
});

describe('listTeamsBySeason', () => {
  it('returns teams for a season', async () => {
    mockBuilder.order.mockReturnValue({ data: [TEAM_ROW], error: null });

    const result = await listTeamsBySeason('s1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('season_id', 's1');
    expect(result).toHaveLength(1);
  });

  it('throws on error', async () => {
    mockBuilder.order.mockReturnValue({ data: null, error: new Error('season err') });
    await expect(listTeamsBySeason('s1')).rejects.toThrow('season err');
  });
});

describe('createTeam', () => {
  it('inserts and returns mapped team', async () => {
    mockBuilder.single.mockResolvedValue({ data: TEAM_ROW, error: null });

    const result = await createTeam('p1', {
      tournament_id: 't1',
      pokemon: [{ species: 'Pikachu', item: 'Light Ball' }] as unknown as PokemonSet[],
      import_source: 'manual' as TeamImportSource,
    });

    expect(mockBuilder.insert).toHaveBeenCalledWith({
      player_id: 'p1',
      tournament_id: 't1',
      season_id: null,
      pokemon: [{ species: 'Pikachu', item: 'Light Ball' }],
      import_source: 'manual',
    });
    expect(result.id).toBe('team1');
  });

  it('handles optional season_id', async () => {
    mockBuilder.single.mockResolvedValue({ data: TEAM_ROW, error: null });

    await createTeam('p1', {
      tournament_id: null,
      season_id: 's1',
      pokemon: [] as unknown as PokemonSet[],
      import_source: 'manual' as TeamImportSource,
    });

    const insertArg = mockBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.tournament_id).toBeNull();
    expect(insertArg.season_id).toBe('s1');
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: new Error('create err') });
    await expect(
      createTeam('p1', {
        tournament_id: null,
        pokemon: [] as unknown as PokemonSet[],
        import_source: 'manual' as TeamImportSource,
      }),
    ).rejects.toThrow('create err');
  });
});

describe('updateTeamPokemon', () => {
  it('updates pokemon when team is not locked', async () => {
    // First call: getTeamById via maybeSingle
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: TEAM_ROW, error: null });
    // Second call: update -> select -> single
    mockBuilder.single.mockResolvedValue({
      data: { ...TEAM_ROW, pokemon: [{ species: 'Raichu' }] },
      error: null,
    });

    const result = await updateTeamPokemon(
      'team1',
      [{ species: 'Raichu' }] as unknown as PokemonSet[],
      'manual',
    );
    expect(result.pokemon).toEqual([{ species: 'Raichu' }]);
  });

  it('throws when team is locked', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LOCKED_TEAM_ROW, error: null });

    await expect(
      updateTeamPokemon('team-locked', [] as unknown as PokemonSet[], 'manual'),
    ).rejects.toThrow('Team is locked and cannot be edited');
  });

  it('throws when team is not found', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      updateTeamPokemon('missing', [] as unknown as PokemonSet[], 'manual'),
    ).rejects.toThrow('Team not found');
  });
});

// ── Completed-match lock (lead ruling round 5) ─────────────────────
describe('team writes on a row linked to a completed match', () => {
  const LINKED_ROW = { ...TEAM_ROW, match_id: 'match1' };
  const pokemon = [{ species: 'Raichu' }] as unknown as PokemonSet[];

  it('updateTeamPokemon: the trigger refusal becomes the catalogued 409 TeamMatchCompletedError', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: COMPLETED_MATCH_REFUSAL });

    const err = await updateTeamPokemon('team1', pokemon, 'manual').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamMatchCompletedError);
    expect(err).toMatchObject({ code: 'team_match_completed', statusCode: 409 });
  });

  it('updateTeamPokemon: any other failure propagates unchanged', async () => {
    const other = { code: 'P0001', message: 'SOMETHING_ELSE', details: null, hint: null };
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: other });

    await expect(updateTeamPokemon('team1', pokemon, 'manual')).rejects.toBe(other);
  });

  it('updateTeamPokemon with correction: writes through team_correct_update (no plain update) and reads the row back', async () => {
    mockBuilder.maybeSingle
      .mockResolvedValueOnce({ data: LINKED_ROW, error: null }) // lock pre-read
      .mockResolvedValueOnce({ data: { ...LINKED_ROW, pokemon }, error: null }); // read-back
    mockBuilder.rpc.mockResolvedValueOnce({ data: true, error: null });

    const result = await updateTeamPokemon('team1', pokemon, 'pokepastes', 'Fixed', { correction: true });

    expect(mockBuilder.rpc).toHaveBeenCalledWith('team_correct_update', {
      p_team_id: 'team1',
      p_pokemon: pokemon,
      p_import_source: 'pokepastes',
      p_name: 'Fixed',
    });
    expect(mockBuilder.update).not.toHaveBeenCalled();
    expect(result.pokemon).toEqual(pokemon);
    expect(result).not.toHaveProperty('share_token');
  });

  it('updateTeamPokemon with correction: no name keeps the current one (p_name omitted)', async () => {
    mockBuilder.maybeSingle
      .mockResolvedValueOnce({ data: LINKED_ROW, error: null })
      .mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.rpc.mockResolvedValueOnce({ data: true, error: null });

    await updateTeamPokemon('team1', pokemon, 'manual', undefined, { correction: true });

    expect(mockBuilder.rpc.mock.calls[0][1]).not.toHaveProperty('p_name');
  });

  it('updateTeamPokemon with correction: a failed RPC throws its error; a vanished row is not found', async () => {
    const rpcError = { code: '57014', message: 'canceling statement', details: null, hint: null };
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.rpc.mockResolvedValueOnce({ data: null, error: rpcError });
    await expect(updateTeamPokemon('team1', pokemon, 'manual', undefined, { correction: true })).rejects.toBe(rpcError);

    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(updateTeamPokemon('team1', pokemon, 'manual', undefined, { correction: true })).rejects.toThrow(
      'Team not found',
    );
  });

  it('deleteTeam: the trigger refusal becomes TeamMatchCompletedError', async () => {
    mockBuilder.eq
      .mockReturnValueOnce(mockBuilder) // getTeamById .eq('id')
      .mockReturnValue({ error: COMPLETED_MATCH_REFUSAL }); // delete .eq('id')
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });

    await expect(deleteTeam('team1')).rejects.toBeInstanceOf(TeamMatchCompletedError);
  });

  it('deleteTeam with correction: deletes through team_correct_delete, never a plain delete', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.rpc.mockResolvedValueOnce({ data: true, error: null });

    await deleteTeam('team1', { correction: true });

    expect(mockBuilder.rpc).toHaveBeenCalledWith('team_correct_delete', { p_team_id: 'team1' });
    expect(mockBuilder.delete).not.toHaveBeenCalled();
  });

  it('deleteTeam with correction: a missing row is not found, an RPC error propagates', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(deleteTeam('team1', { correction: true })).rejects.toThrow('Team not found');

    const rpcError = new Error('rpc down');
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.rpc.mockResolvedValueOnce({ data: null, error: rpcError });
    await expect(deleteTeam('team1', { correction: true })).rejects.toBe(rpcError);
  });

  it('upsertTeamForMatch: a participant rewrite refused by the trigger becomes TeamMatchCompletedError', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LINKED_ROW, error: null });
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: COMPLETED_MATCH_REFUSAL });

    await expect(upsertTeamForMatch('p1', 'match1', 't1', pokemon, 'manual')).rejects.toBeInstanceOf(
      TeamMatchCompletedError,
    );
  });

  it('upsertTeamForMatch with correction: rewrites the existing row through team_correct_update', async () => {
    mockBuilder.maybeSingle
      .mockResolvedValueOnce({ data: LINKED_ROW, error: null }) // existing (player, match) row
      .mockResolvedValueOnce({ data: { ...LINKED_ROW, pokemon }, error: null }); // read-back
    mockBuilder.rpc.mockResolvedValueOnce({ data: true, error: null });

    const result = await upsertTeamForMatch('p1', 'match1', 't1', pokemon, 'manual', { correction: true });

    expect(mockBuilder.rpc).toHaveBeenCalledWith('team_correct_update', {
      p_team_id: 'team1',
      p_pokemon: pokemon,
      p_import_source: 'manual',
    });
    expect(mockBuilder.update).not.toHaveBeenCalled();
    expect(result?.pokemon).toEqual(pokemon);
  });
});

describe('deleteTeam', () => {
  it('deletes an unlocked team', async () => {
    // getTeamById chain: from -> select -> eq -> maybeSingle
    // delete chain:      from -> delete -> eq -> (terminal)
    // First eq call (getTeamById) must return mockBuilder so .maybeSingle is available
    // Second eq call (delete) is terminal
    mockBuilder.eq
      .mockReturnValueOnce(mockBuilder)   // getTeamById .eq('id')
      .mockReturnValue({ error: null });  // delete .eq('id')
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: TEAM_ROW, error: null });

    await deleteTeam('team1');
    expect(mockBuilder.delete).toHaveBeenCalled();
  });

  it('throws when team is locked', async () => {
    // getTeamById returns locked team, delete should not be reached
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: LOCKED_TEAM_ROW, error: null });

    await expect(deleteTeam('team-locked')).rejects.toThrow(
      'Team is locked and cannot be deleted',
    );
  });

  it('throws when team not found', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(deleteTeam('missing')).rejects.toThrow('Team not found');
  });
});

describe('upsertTeamForMatch', () => {
  const pokemon = [{ species: 'Pikachu' }] as unknown as PokemonSet[];
  const importSource = 'replay' as TeamImportSource;

  it('creates new team when none exists', async () => {
    // Lookup chain: from -> select -> eq('player_id') -> eq('match_id') -> maybeSingle
    // Need eq to chain twice before maybeSingle
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // insert -> select -> single
    mockBuilder.single.mockResolvedValue({ data: TEAM_ROW, error: null });

    const result = await upsertTeamForMatch('p1', 'match1', 't1', pokemon, importSource);
    expect(result).not.toBeNull();
    expect(mockBuilder.insert).toHaveBeenCalledWith({
      player_id: 'p1',
      match_id: 'match1',
      tournament_id: 't1',
      pokemon: [{ species: 'Pikachu' }],
      import_source: 'replay',
    });
  });

  it('updates existing unlocked team', async () => {
    const existingRow = { ...TEAM_ROW, match_id: 'match1', locked: false };
    // Lookup: eq chains return mockBuilder (default), maybeSingle returns existing
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: existingRow, error: null });
    // Update: update -> eq -> select -> single
    mockBuilder.single.mockResolvedValue({
      data: { ...existingRow, pokemon: [{ species: 'Pikachu' }] },
      error: null,
    });

    const result = await upsertTeamForMatch('p1', 'match1', 't1', pokemon, importSource);
    expect(result).not.toBeNull();
    expect(mockBuilder.update).toHaveBeenCalled();
  });

  it('returns null when existing team is locked', async () => {
    const lockedExisting = { ...TEAM_ROW, match_id: 'match1', locked: true };
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: lockedExisting, error: null });

    const result = await upsertTeamForMatch('p1', 'match1', 't1', pokemon, importSource);
    expect(result).toBeNull();
  });

  it('throws when insert fails', async () => {
    // Lookup returns null (no existing)
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    // Insert fails
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: new Error('insert err') });

    await expect(
      upsertTeamForMatch('p1', 'match1', 't1', pokemon, importSource),
    ).rejects.toThrow('insert err');
  });

  it('throws when update fails', async () => {
    const existingRow = { ...TEAM_ROW, match_id: 'match1', locked: false };
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: existingRow, error: null });
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: new Error('update err') });

    await expect(
      upsertTeamForMatch('p1', 'match1', 't1', pokemon, importSource),
    ).rejects.toThrow('update err');
  });
});

describe('getItemUsageForPokemon (H9: aggregated in SQL)', () => {
  it('calls the RPC with species, scope, player and the item cap, and maps the rows', async () => {
    mockBuilder.rpc.mockResolvedValueOnce({
      data: [
        { item: 'Leftovers', uses: 2, total_sets: 3 },
        { item: 'Rocky Helmet', uses: 1, total_sets: 3 },
      ],
      error: null,
    });

    const result = await getItemUsageForPokemon('Garchomp', 'tournament', 't1', 'p1');

    expect(mockBuilder.rpc).toHaveBeenCalledWith('get_item_usage_for_pokemon', {
      p_species: 'Garchomp',
      p_scope_type: 'tournament',
      p_scope_id: 't1',
      p_player_id: 'p1',
      p_limit: ITEM_USAGE_LIMIT,
    });
    expect(mockBuilder.from).not.toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'Leftovers', count: 2, usage_percent: (2 / 3) * 100 });
    expect(result[1].name).toBe('Rocky Helmet');
  });

  it('omits the scope id and player for an all-time, all-player read', async () => {
    mockBuilder.rpc.mockResolvedValueOnce({ data: [], error: null });

    await getItemUsageForPokemon('Garchomp', 'all_time', null);

    expect(mockBuilder.rpc).toHaveBeenCalledWith('get_item_usage_for_pokemon', {
      p_species: 'Garchomp',
      p_scope_type: 'all_time',
      p_limit: ITEM_USAGE_LIMIT,
    });
  });

  it('percentages use the scope-wide total (items past the cap still count)', async () => {
    mockBuilder.rpc.mockResolvedValueOnce({ data: [{ item: 'Choice Scarf', uses: 5, total_sets: 20 }], error: null });
    const [row] = await getItemUsageForPokemon('Garchomp', 'league', 's1');
    expect(row.usage_percent).toBe(25);
  });

  it('returns an empty list for no rows', async () => {
    mockBuilder.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await getItemUsageForPokemon('MissingNo', 'tournament', 't1')).toEqual([]);
  });

  it('throws on database error', async () => {
    mockBuilder.rpc.mockResolvedValueOnce({ data: null, error: new Error('db err') });
    await expect(getItemUsageForPokemon('Garchomp', 'tournament', 't1')).rejects.toThrow('db err');
  });
});

// ── C1: the share token never enters a Team ─────────────────────────

describe('team reads select no share column (C1)', () => {
  it('TEAM_COLUMNS lists every teams column except the share columns', () => {
    expect(TEAM_COLUMNS).not.toMatch(/share/);
    expect(TEAM_COLUMNS).not.toContain('*');
  });

  it('every select of the module names explicit columns without share columns', async () => {
    mockBuilder.order.mockReturnValue({ data: [TEAM_ROW], error: null });
    mockBuilder.maybeSingle.mockResolvedValue({ data: TEAM_ROW, error: null });
    mockBuilder.single.mockResolvedValue({ data: TEAM_ROW, error: null });
    mockBuilder.range.mockReturnValue({ data: [TEAM_ROW], error: null, count: 1 });

    await listTeamsByTournament('t1');
    await listTeamsByTournamentIds(['t1']);
    await listTeamsByPlayer('p1');
    await getTeamById('team1');
    await getPlayerTeamForTournament('p1', 't1');
    await listTeamsBySeason('s1');
    await createTeam('p1', { tournament_id: null, pokemon: [], import_source: 'manual' });
    await updateTeamPokemon('team1', [], 'manual');
    await getTeamByShareToken('5e17e1a1-dead-4bee-8f00-5ec2e7700000');
    await forkTeam({ ...TEAM_ROW, name: '' } as unknown as Team, 'p2');

    expect(mockBuilder.select.mock.calls.length).toBeGreaterThanOrEqual(10);
    for (const [columns] of mockBuilder.select.mock.calls) {
      expect(typeof columns).toBe('string');
      expect(columns).not.toMatch(/share/);
      expect(columns).not.toBe('*');
    }
  });

  it('toTeam drops share columns that a raw row carries', async () => {
    const raw = { ...TEAM_ROW, share_token: 'SECRET-TOKEN', share_enabled_at: '2099-01-01T00:00:00Z' };
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: raw, error: null });

    const team = await getTeamById('team1');

    expect(team).not.toHaveProperty('share_token');
    expect(team).not.toHaveProperty('share_enabled_at');
    expect(JSON.stringify(team)).not.toContain('SECRET-TOKEN');
  });
});

describe('share link queries', () => {
  it('getTeamByShareToken matches only an enabled link', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: TEAM_ROW, error: null });

    const team = await getTeamByShareToken('tok');

    expect(mockBuilder.eq).toHaveBeenCalledWith('share_token', 'tok');
    expect(mockBuilder.not).toHaveBeenCalledWith('share_enabled_at', 'is', null);
    expect(team?.id).toBe('team1');
  });

  it('setTeamShareToken returns the TeamShareLink (the only token carrier)', async () => {
    mockBuilder.single.mockResolvedValueOnce({
      data: { id: 'team1', share_token: 'new-token', share_enabled_at: '2026-10-18T00:00:00Z' },
      error: null,
    });

    const link = await setTeamShareToken('team1');

    expect(mockBuilder.select).toHaveBeenCalledWith('id, share_token, share_enabled_at');
    expect(link).toEqual({ team_id: 'team1', share_token: 'new-token', share_enabled_at: '2026-10-18T00:00:00Z' });
  });

  it('setTeamShareToken throws when the row comes back without a link (no silent empty URL)', async () => {
    mockBuilder.single.mockResolvedValueOnce({
      data: { id: 'team1', share_token: null, share_enabled_at: null },
      error: null,
    });
    await expect(setTeamShareToken('team1')).rejects.toThrow('without a share link');
  });

  it('setTeamShareToken throws on database error', async () => {
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: new Error('update err') });
    await expect(setTeamShareToken('team1')).rejects.toThrow('update err');
  });

  it('disableTeamShareToken clears both columns and returns nothing', async () => {
    mockBuilder.eq.mockReturnValueOnce({ error: null });

    await expect(disableTeamShareToken('team1')).resolves.toBeUndefined();
    expect(mockBuilder.update).toHaveBeenCalledWith({ share_token: null, share_enabled_at: null });
    expect(mockBuilder.select).not.toHaveBeenCalled();
  });

  it('disableTeamShareToken throws on database error', async () => {
    mockBuilder.eq.mockReturnValueOnce({ error: new Error('disable err') });
    await expect(disableTeamShareToken('team1')).rejects.toThrow('disable err');
  });
});

describe('forkTeam', () => {
  it('inserts a personal copy (no tournament, no season) pointing at the source', async () => {
    mockBuilder.single.mockResolvedValueOnce({ data: { ...TEAM_ROW, id: 'fork1', player_id: 'p2' }, error: null });
    const source = { ...TEAM_ROW, name: '', tournament_id: 't1', season_id: 's1' } as unknown as Team;

    const forked = await forkTeam(source, 'p2');

    expect(mockBuilder.insert).toHaveBeenCalledWith({
      player_id: 'p2',
      tournament_id: null,
      season_id: null,
      pokemon: TEAM_ROW.pokemon,
      import_source: 'manual',
      forked_from_team_id: 'team1',
    });
    expect(forked.id).toBe('fork1');
  });

  it('throws on insert error', async () => {
    mockBuilder.single.mockResolvedValueOnce({ data: null, error: new Error('fork err') });
    await expect(forkTeam(TEAM_ROW as unknown as Team, 'p2')).rejects.toThrow('fork err');
  });
});

describe('getTeamVisibilityFacts (H3)', () => {
  it('returns an empty map without a query for no ids', async () => {
    expect(await getTeamVisibilityFacts([])).toEqual(new Map());
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('reads the linked match status and tournament setting through the row foreign keys', async () => {
    mockBuilder.in.mockResolvedValueOnce({
      data: [
        { id: 'a', match: { status: 'completed' }, tournament: { team_visibility: 'hidden_until_match' } },
        { id: 'b', match: null, tournament: { team_visibility: 'always_public' } },
        { id: 'c', match: null, tournament: null },
      ],
      error: null,
    });

    const facts = await getTeamVisibilityFacts(['a', 'b', 'c', 'a']);

    expect(mockBuilder.select).toHaveBeenCalledWith(
      'id, match:matches!teams_match_id_fkey(status), tournament:tournaments!teams_tournament_id_fkey(team_visibility)'
    );
    expect(mockBuilder.in).toHaveBeenCalledWith('id', ['a', 'b', 'c']);
    expect(facts.get('a')).toEqual({ match_status: 'completed', tournament_visibility: 'hidden_until_match' });
    expect(facts.get('b')).toEqual({ match_status: null, tournament_visibility: 'always_public' });
    expect(facts.get('c')).toEqual({ match_status: null, tournament_visibility: null });
  });

  it('chunks long id lists (100 per request)', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `team-${i}`);
    mockBuilder.in.mockResolvedValue({ data: [], error: null });

    await getTeamVisibilityFacts(ids);

    expect(mockBuilder.in).toHaveBeenCalledTimes(3);
    expect(mockBuilder.in.mock.calls.map(([, chunk]) => (chunk as string[]).length)).toEqual([100, 100, 50]);
  });

  it('throws on database error', async () => {
    mockBuilder.in.mockResolvedValueOnce({ data: null, error: new Error('facts err') });
    await expect(getTeamVisibilityFacts(['a'])).rejects.toThrow('facts err');
  });
});

describe('listSeasonTeamLeadsWithFacts (public world aces, spec §7)', () => {
  const SELECT =
    'id, player_id, updated_at, lead_species:pokemon->0->>species, match:matches!teams_match_id_fkey(status), tournament:tournaments!teams_tournament_id_fkey(team_visibility)';
  const leadRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    player_id: 'p1',
    updated_at: '2026-09-01T00:00:00Z',
    lead_species: 'Garchomp',
    match: { status: 'completed' },
    tournament: { team_visibility: 'hidden_until_match' },
    ...overrides,
  });

  it('reads the season rows AND the stage rows (where a played match team lives), with the facts embedded', async () => {
    mockBuilder.range
      .mockResolvedValueOnce({ data: [leadRow('season-row', { match: null, tournament: null })], error: null })
      .mockResolvedValueOnce({ data: [leadRow('stage-row')], error: null });

    const leads = await listSeasonTeamLeadsWithFacts('season-1', ['stage-1', 'stage-2', 'stage-1']);

    expect(mockBuilder.from).toHaveBeenCalledWith('teams');
    expect(mockBuilder.select).toHaveBeenCalledWith(SELECT);
    expect(mockBuilder.select).toHaveBeenCalledTimes(2);
    expect(mockBuilder.select.mock.calls.every(([sel]) => !/\*|pokemon(?!->)/.test(sel as string))).toBe(true);
    expect(mockBuilder.eq).toHaveBeenCalledWith('season_id', 'season-1');
    expect(mockBuilder.in).toHaveBeenCalledWith('tournament_id', ['stage-1', 'stage-2']);
    expect(leads).toEqual([
      {
        id: 'season-row',
        player_id: 'p1',
        updated_at: '2026-09-01T00:00:00Z',
        lead_species: 'Garchomp',
        facts: { match_status: null, tournament_visibility: null },
      },
      {
        id: 'stage-row',
        player_id: 'p1',
        updated_at: '2026-09-01T00:00:00Z',
        lead_species: 'Garchomp',
        facts: { match_status: 'completed', tournament_visibility: 'hidden_until_match' },
      },
    ]);
  });

  it('returns a row found by both reads once, and maps a missing lead set to null', async () => {
    mockBuilder.range
      .mockResolvedValueOnce({ data: [leadRow('both', { lead_species: null })], error: null })
      .mockResolvedValueOnce({ data: [leadRow('both', { lead_species: null })], error: null });

    const leads = await listSeasonTeamLeadsWithFacts('season-1', ['stage-1']);

    expect(leads.map((lead) => [lead.id, lead.lead_species])).toEqual([['both', null]]);
  });

  it('skips the stage read for a league without stages', async () => {
    mockBuilder.range.mockResolvedValueOnce({ data: [], error: null });

    expect(await listSeasonTeamLeadsWithFacts('season-1', [])).toEqual([]);
    expect(mockBuilder.in).not.toHaveBeenCalled();
    expect(mockBuilder.range).toHaveBeenCalledTimes(1);
  });

  it('pages past max_rows until a short page, so no lead is cut off', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => leadRow(`t-${i}`));
    mockBuilder.range
      .mockResolvedValueOnce({ data: full, error: null })
      .mockResolvedValueOnce({ data: [leadRow('t-1000')], error: null });

    const leads = await listSeasonTeamLeadsWithFacts('season-1', []);

    expect(leads).toHaveLength(1001);
    expect(mockBuilder.range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(mockBuilder.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(mockBuilder.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('propagates a read error', async () => {
    mockBuilder.range
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('stage read err') });

    await expect(listSeasonTeamLeadsWithFacts('season-1', ['stage-1'])).rejects.toThrow('stage read err');
  });
});

describe('listLibraryTeams search (L1)', () => {
  it('sends the search as quoted, LIKE-escaped conditions and keeps the published-only filter', async () => {
    const term = 'a,b)c"d\\e%_';
    // Chain: from -> select -> not -> order -> range -> or -> await
    mockBuilder.or.mockResolvedValueOnce({ data: [], error: null, count: 0 });

    const result = await listLibraryTeams({ search: term });

    expect(mockBuilder.not).toHaveBeenCalledWith('library_published_at', 'is', null);
    expect(mockBuilder.or).toHaveBeenCalledWith(ilikeAnyOf(['library_title', 'library_description'], term));
    expect(mockBuilder.or).toHaveBeenCalledWith(
      'library_title.ilike."%a,b)c\\"d\\\\\\\\e\\\\%\\\\_%",library_description.ilike."%a,b)c\\"d\\\\\\\\e\\\\%\\\\_%"'
    );
    expect(result).toEqual({ data: [], total: 0 });
  });

  it('sends no or() without a search', async () => {
    mockBuilder.range.mockResolvedValueOnce({ data: [], error: null, count: 0 });
    await listLibraryTeams({});
    expect(mockBuilder.or).not.toHaveBeenCalled();
  });
});

describe('upsertTeamForMatch lookup errors', () => {
  it('throws when the existing-row lookup fails (no blind insert)', async () => {
    mockBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('lookup err') });

    await expect(
      upsertTeamForMatch('p1', 'match1', 't1', [] as PokemonSet[], 'replay' as TeamImportSource),
    ).rejects.toThrow('lookup err');
    expect(mockBuilder.insert).not.toHaveBeenCalled();
  });
});
