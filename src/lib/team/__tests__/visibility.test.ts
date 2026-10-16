import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canViewTeamPokemon, filterTeamVisibility, filterTeamVisibilityBatch, filterTeamPokemonForBroadcast, REDACTED_POKEMON } from '../visibility';
import type { VisibilityContext } from '../visibility';
import type { Team } from '@/types/team';

// ── Mock getMatchesByPlayer & getCompletedMatchRecordsBatch ──────────

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByPlayer: vi.fn(),
  getCompletedMatchRecordsBatch: vi.fn(),
}));

import { getMatchesByPlayer, getCompletedMatchRecordsBatch } from '@/lib/supabase/queries/matches';
const mockedGetMatches = vi.mocked(getMatchesByPlayer);
const mockedGetCompletedBatch = vi.mocked(getCompletedMatchRecordsBatch);

// ── Helpers ──────────────────────────────────────────────────────────

function makeTeam(overrides?: Partial<Team>): Team {
  return {
    id: 'team-1',
    player_id: 'owner-1',
    tournament_id: 'tourney-1',
    pokemon: [
      {
        name: 'Pikachu',
        species: 'Pikachu',
        gender: '',
        item: 'Light Ball',
        ability: 'Static',
        evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: 'Timid',
        level: 100,
        moves: ['Thunderbolt', 'Volt Switch', 'Grass Knot', 'Hidden Power'],
      },
    ],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as Team;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── canViewTeamPokemon ───────────────────────────────────────────────

describe('canViewTeamPokemon', () => {
  it('admin always sees team', async () => {
    const team = makeTeam();
    const ctx: VisibilityContext = { viewerId: 'some-admin', isAdmin: true };
    const result = await canViewTeamPokemon(team, ctx);
    expect(result).toBe(true);
    // Should not call DB at all
    expect(mockedGetMatches).not.toHaveBeenCalled();
  });

  it('owner always sees own team', async () => {
    const team = makeTeam();
    const ctx: VisibilityContext = { viewerId: 'owner-1', isAdmin: false };
    const result = await canViewTeamPokemon(team, ctx);
    expect(result).toBe(true);
    expect(mockedGetMatches).not.toHaveBeenCalled();
  });

  it('opponent with completed match can see team', async () => {
    const team = makeTeam();
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false, tournamentId: 'tourney-1' };
    mockedGetMatches.mockResolvedValue([
      { status: 'completed' } as never,
    ]);
    const result = await canViewTeamPokemon(team, ctx);
    expect(result).toBe(true);
  });

  it('hides team when no completed match exists', async () => {
    const team = makeTeam();
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false };
    mockedGetMatches.mockResolvedValue([
      { status: 'scheduled' } as never,
    ]);
    const result = await canViewTeamPokemon(team, ctx);
    expect(result).toBe(false);
  });

  it('hides team when no matches at all', async () => {
    const team = makeTeam();
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false };
    mockedGetMatches.mockResolvedValue([]);
    const result = await canViewTeamPokemon(team, ctx);
    expect(result).toBe(false);
  });

  it('hides team for null viewerId (unauthenticated)', async () => {
    const team = makeTeam();
    const ctx: VisibilityContext = { viewerId: null, isAdmin: false };
    mockedGetMatches.mockResolvedValue([]);
    const result = await canViewTeamPokemon(team, ctx);
    expect(result).toBe(false);
  });
});

// ── filterTeamVisibility ─────────────────────────────────────────────

describe('filterTeamVisibility', () => {
  it('returns visible teams unchanged', async () => {
    const team = makeTeam();
    const ctx: VisibilityContext = { viewerId: 'owner-1', isAdmin: false };
    const result = await filterTeamVisibility([team], ctx);
    expect(result[0].pokemon).toBe(team.pokemon);
  });

  it('replaces pokemon with REDACTED_POKEMON for hidden teams', async () => {
    const team = makeTeam({ player_id: 'other-player' });
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false };
    mockedGetMatches.mockResolvedValue([]);

    const result = await filterTeamVisibility([team], ctx);
    expect(result[0].pokemon).toHaveLength(6);
    expect(result[0].pokemon[0].species).toBe('hidden');
    // Team metadata preserved
    expect(result[0].id).toBe(team.id);
    expect(result[0].player_id).toBe(team.player_id);
  });

  it('handles mixed visibility correctly', async () => {
    const ownTeam = makeTeam({ id: 'own', player_id: 'viewer-1' });
    const hiddenTeam = makeTeam({ id: 'hidden', player_id: 'stranger' });
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false };
    mockedGetMatches.mockResolvedValue([]);

    const result = await filterTeamVisibility([ownTeam, hiddenTeam], ctx);
    expect(result[0].pokemon[0].species).not.toBe('hidden');
    expect(result[1].pokemon[0].species).toBe('hidden');
  });
});

// ── filterTeamVisibilityBatch ───────────────────────────────────────

describe('filterTeamVisibilityBatch', () => {
  it('returns empty array for empty input', async () => {
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false };
    const result = await filterTeamVisibilityBatch([], ctx);
    expect(result).toEqual([]);
  });

  it('admin sees all teams', async () => {
    const team = makeTeam({ player_id: 'other' });
    const ctx: VisibilityContext = { viewerId: 'admin-1', isAdmin: true, tournamentId: 'tourney-1' };
    mockedGetCompletedBatch.mockResolvedValue(new Map([['tourney-1', []]]));

    const result = await filterTeamVisibilityBatch([team], ctx);
    expect(result[0].pokemon[0].species).not.toBe('hidden');
  });

  it('owner sees own team', async () => {
    const team = makeTeam({ player_id: 'viewer-1' });
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false, tournamentId: 'tourney-1' };
    mockedGetCompletedBatch.mockResolvedValue(new Map([['tourney-1', []]]));

    const result = await filterTeamVisibilityBatch([team], ctx);
    expect(result[0].pokemon[0].species).not.toBe('hidden');
  });

  it('reveals team when player has completed match', async () => {
    const team = makeTeam({ player_id: 'other-player' });
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false, tournamentId: 'tourney-1' };
    mockedGetCompletedBatch.mockResolvedValue(new Map([
      ['tourney-1', [{ player_1_id: 'other-player', player_2_id: 'someone' } as never]],
    ]));

    const result = await filterTeamVisibilityBatch([team], ctx);
    expect(result[0].pokemon[0].species).not.toBe('hidden');
  });

  it('redacts team when player has no completed match', async () => {
    const team = makeTeam({ player_id: 'no-matches' });
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false, tournamentId: 'tourney-1' };
    mockedGetCompletedBatch.mockResolvedValue(new Map([['tourney-1', []]]));

    const result = await filterTeamVisibilityBatch([team], ctx);
    expect(result[0].pokemon[0].species).toBe('hidden');
    expect(result[0].pokemon).toHaveLength(6);
    expect(result[0].id).toBe(team.id);
  });

  it('falls back to per-team check when no tournament scope', async () => {
    const team = makeTeam({ player_id: 'other', tournament_id: undefined } as never);
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false };
    mockedGetMatches.mockResolvedValue([]);

    const result = await filterTeamVisibilityBatch([team], ctx);
    expect(result[0].pokemon[0].species).toBe('hidden');
  });

  it('uses team tournament_id when ctx.tournamentId is absent', async () => {
    const team = makeTeam({ player_id: 'other', tournament_id: 'tourney-from-team' });
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false };
    mockedGetCompletedBatch.mockResolvedValue(new Map([
      ['tourney-from-team', [{ player_1_id: 'other', player_2_id: 'x' } as never]],
    ]));

    const result = await filterTeamVisibilityBatch([team], ctx);
    expect(result[0].pokemon[0].species).not.toBe('hidden');
    expect(mockedGetCompletedBatch).toHaveBeenCalledWith(['tourney-from-team']);
  });

  it('handles empty records map gracefully', async () => {
    const team = makeTeam({ player_id: 'other' });
    const ctx: VisibilityContext = { viewerId: 'viewer-1', isAdmin: false, tournamentId: 'tourney-1' };
    mockedGetCompletedBatch.mockResolvedValue(new Map());

    const result = await filterTeamVisibilityBatch([team], ctx);
    expect(result[0].pokemon[0].species).toBe('hidden');
  });
});

// ── filterTeamPokemonForBroadcast ───────────────────────────────────

describe('filterTeamPokemonForBroadcast', () => {
  it('returns empty array when team is null', async () => {
    const result = await filterTeamPokemonForBroadcast(null, 'tourney-1');
    expect(result).toEqual([]);
  });

  it('returns team pokemon when player has completed match', async () => {
    const team = makeTeam();
    mockedGetMatches.mockResolvedValue([{ status: 'completed' } as never]);

    const result = await filterTeamPokemonForBroadcast(team, 'tourney-1');
    expect(result).toEqual(team.pokemon);
  });

  it('returns redacted pokemon when player has no completed match', async () => {
    const team = makeTeam();
    mockedGetMatches.mockResolvedValue([]);

    const result = await filterTeamPokemonForBroadcast(team, 'tourney-1');
    expect(result).toEqual(REDACTED_POKEMON);
    expect(result).toHaveLength(6);
    expect(result[0].species).toBe('hidden');
  });

  it('uses null viewerId and isAdmin=false for broadcast context', async () => {
    const team = makeTeam();
    mockedGetMatches.mockResolvedValue([{ status: 'scheduled' } as never]);

    const result = await filterTeamPokemonForBroadcast(team, 'tourney-1');
    // No completed matches, so team is redacted
    expect(result).toEqual(REDACTED_POKEMON);
  });
});
