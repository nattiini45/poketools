import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Chainable Supabase mock ────────────────────────────────────────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
  'limit', 'range', 'match', 'returns', 'throwOnError',
];

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError',
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
  listTeamsByPlayerWithContext,
  listTeamsBySeason,
  createTeam,
  updateTeamPokemon,
  lockTeam,
  lockTeamsByTournament,
  deleteTeam,
  upsertTeamForMatch,
  getItemUsageForPokemon,
} from '../teams';
import type { PokemonSet, TeamImportSource } from '@/types/team';

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

describe('lockTeam', () => {
  it('locks and returns team', async () => {
    mockBuilder.single.mockResolvedValue({
      data: { ...TEAM_ROW, locked: true },
      error: null,
    });

    const result = await lockTeam('team1');
    expect(mockBuilder.update).toHaveBeenCalledWith({ locked: true });
    expect(result.locked).toBe(true);
  });

  it('throws on error', async () => {
    mockBuilder.single.mockResolvedValue({ data: null, error: new Error('lock err') });
    await expect(lockTeam('team1')).rejects.toThrow('lock err');
  });
});

describe('lockTeamsByTournament', () => {
  it('locks all teams in a tournament', async () => {
    mockBuilder.eq.mockReturnValue({ error: null });

    await lockTeamsByTournament('t1');
    expect(mockBuilder.update).toHaveBeenCalledWith({ locked: true });
    expect(mockBuilder.eq).toHaveBeenCalledWith('tournament_id', 't1');
  });

  it('throws on error', async () => {
    mockBuilder.eq.mockReturnValue({ error: new Error('bulk lock err') });
    await expect(lockTeamsByTournament('t1')).rejects.toThrow('bulk lock err');
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

describe('getItemUsageForPokemon', () => {
  it('returns item usage counts and percentages for a pokemon', async () => {
    // Query: from.select.not.eq -> terminal (last chain depends on scope)
    // For tournament scope: .not -> .eq(tournament_id)
    mockBuilder.eq.mockReturnValueOnce({
      data: [
        {
          pokemon: [
            { species: 'Garchomp', item: 'Leftovers' },
            { species: 'Pikachu', item: 'Light Ball' },
          ],
          matches: { status: 'completed', tournament_id: 't1' },
        },
        {
          pokemon: [
            { species: 'Garchomp', item: 'Rocky Helmet' },
          ],
          matches: { status: 'completed', tournament_id: 't1' },
        },
        {
          pokemon: [
            { species: 'Garchomp', item: 'Leftovers' },
          ],
          matches: { status: 'completed', tournament_id: 't1' },
        },
      ],
      error: null,
    });

    const result = await getItemUsageForPokemon('Garchomp', 'tournament', 't1');
    expect(result).toHaveLength(2);
    // Sorted by count desc
    expect(result[0].name).toBe('Leftovers');
    expect(result[0].count).toBe(2);
    expect(result[0].usage_percent).toBeCloseTo(66.67, 1);
    expect(result[1].name).toBe('Rocky Helmet');
    expect(result[1].count).toBe(1);
  });

  it('returns empty array when no data', async () => {
    mockBuilder.eq.mockReturnValueOnce({ data: [], error: null });
    const result = await getItemUsageForPokemon('MissingNo', 'tournament', 't1');
    expect(result).toEqual([]);
  });

  it('skips non-completed matches', async () => {
    mockBuilder.eq.mockReturnValueOnce({
      data: [
        {
          pokemon: [{ species: 'Garchomp', item: 'Leftovers' }],
          matches: { status: 'scheduled', tournament_id: 't1' },
        },
      ],
      error: null,
    });

    const result = await getItemUsageForPokemon('Garchomp', 'tournament', 't1');
    expect(result).toEqual([]);
  });

  it('skips rows with null matches', async () => {
    mockBuilder.eq.mockReturnValueOnce({
      data: [
        {
          pokemon: [{ species: 'Garchomp', item: 'Leftovers' }],
          matches: null,
        },
      ],
      error: null,
    });

    const result = await getItemUsageForPokemon('Garchomp', 'all_time', null);
    expect(result).toEqual([]);
  });

  it('handles non-array pokemon gracefully', async () => {
    mockBuilder.eq.mockReturnValueOnce({
      data: [
        {
          pokemon: 'not-an-array',
          matches: { status: 'completed', tournament_id: 't1' },
        },
      ],
      error: null,
    });

    const result = await getItemUsageForPokemon('Garchomp', 'tournament', 't1');
    expect(result).toEqual([]);
  });

  it('applies player filter when provided', async () => {
    // With playerId, there's an extra .eq call
    mockBuilder.eq
      .mockReturnValueOnce(mockBuilder) // tournament_id eq
      .mockReturnValueOnce({            // player_id eq (terminal)
        data: [
          {
            pokemon: [{ species: 'Garchomp', item: 'Focus Sash' }],
            matches: { status: 'completed', tournament_id: 't1' },
          },
        ],
        error: null,
      });

    const result = await getItemUsageForPokemon('Garchomp', 'tournament', 't1', 'p1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Focus Sash');
  });

  it('throws on database error', async () => {
    mockBuilder.eq.mockReturnValueOnce({ data: null, error: new Error('db err') });
    await expect(
      getItemUsageForPokemon('Garchomp', 'tournament', 't1'),
    ).rejects.toThrow('db err');
  });
});
