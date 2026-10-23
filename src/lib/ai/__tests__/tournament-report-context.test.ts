import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all query imports ─────────────────────────────────────────

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(async () => ({
    id: 'tourney-1', season_id: null, ruleset_id: null,
    name: 'Test Cup', best_of_default: 3,
    bracket_type: 'round_robin', description: null, is_doubles: false,
    status: 'active', team_visibility: 'hidden_until_match',
  })),
  getParticipants: vi.fn(async () => [
    { id: 'p1', name: 'Alice', avatar_url: null },
    { id: 'p2', name: 'Bob', avatar_url: null },
  ]),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(async () => null),
  getSeasonParticipants: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(async () => null),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(async () => ({
    id: 'round-1', name: 'Round 1', round_number: 1, best_of: 3,
  })),
  getRoundsByTournament: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByRound: vi.fn(async () => []),
  getCompletedMatchRecords: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(async () => ({})),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForMatch: vi.fn(async () => null),
}));

vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(async () => [
    {
      player_id: 'p1', player_name: 'Alice', avatar_url: null,
      points: 3, wins: 1, losses: 0, draws: 0, game_wins: 2, game_losses: 0,
      kill_differential: 3, gym_type: null,
    },
    {
      player_id: 'p2', player_name: 'Bob', avatar_url: null,
      points: 0, wins: 0, losses: 1, draws: 0, game_wins: 0, game_losses: 2,
      kill_differential: -3, gym_type: null,
    },
  ]),
}));

vi.mock('@/lib/match/aggregation', () => ({
  aggregateTeamFromStats: vi.fn(() => []),
  computePokemonScore: vi.fn(() => ({ p1Score: 2, p2Score: 0 })),
  computeQuickStats: vi.fn(() => ({ p1TotalKos: 3, p2TotalKos: 1, gamesPlayed: 2 })),
}));

vi.mock('../context-builder', () => ({
  buildRulesetSection: vi.fn(() => '## FORMAT: gen9ou\n'),
  parseGenFromFormat: vi.fn(() => 9),
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getSpecies: vi.fn(() => ({ types: ['Electric'] })),
}));

import {
  buildRoundRecapPrompt,
  buildRoundForecastPrompt,
} from '../tournament-report-context';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getMatchesByRound, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { aggregateTeamFromStats } from '@/lib/match/aggregation';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import type { Team } from '@/types/team';

describe('buildRoundRecapPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns system prompt, user prompt, matchData, and pokemonTypes', async () => {
    const result = await buildRoundRecapPrompt('tourney-1', 'round-1');
    expect(result.systemPrompt).toContain('Kale Cabbage');
    expect(result.userPrompt).toContain('TOURNAMENT');
    expect(Array.isArray(result.matchData)).toBe(true);
    expect(typeof result.pokemonTypes).toBe('object');
  });

  it('throws when tournament not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce(null);
    await expect(buildRoundRecapPrompt('bad', 'round-1')).rejects.toThrow('not found');
  });

  it('throws when round not found', async () => {
    vi.mocked(getRoundById).mockResolvedValueOnce(null);
    await expect(buildRoundRecapPrompt('tourney-1', 'bad')).rejects.toThrow('not found');
  });

  it('includes match details for completed matches', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        winner_id: 'p1', winner_name: 'Alice',
        status: 'completed',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);

    vi.mocked(getBattleStatsByMatch).mockResolvedValueOnce({
      'game-1': [
        {
          id: 's1', game_id: 'game-1', player_id: 'p1', pokemon_name: 'Pikachu',
          was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false,
          moves_used: ['Thunderbolt'], turns_active: 5, match_won: true, created_at: '',
        },
      ],
    });

    vi.mocked(aggregateTeamFromStats).mockReturnValue([
      {
        pokemonName: 'Pikachu', timesBrought: 1, wasLead: true,
        totalKos: 2, wasKoed: false, movesUsed: ['Thunderbolt'],
        isMvp: true, totalTurnsActive: 5,
      },
    ]);

    const result = await buildRoundRecapPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('MATCH RESULTS');
    expect(result.matchData.length).toBe(1);
    expect(result.matchData[0].winner_name).toBe('Alice');
    expect(result.matchData[0].mvp_pokemon).toBe('Pikachu');
  });

  it('handles no completed matches', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        winner_id: null, status: 'scheduled',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);

    const result = await buildRoundRecapPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('No completed matches');
    expect(result.matchData.length).toBe(0);
  });

  it('includes season context when tournament has season_id', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-1', ruleset_id: null,
      name: 'Test Cup', best_of_default: 3, bracket_type: 'round_robin',
      description: null, is_doubles: false, status: 'active',
    } as never);

    vi.mocked(getSeasonById).mockResolvedValueOnce({
      id: 'season-1', name: 'The League', description: 'Special rules here',
      format_type: 'swiss',
    } as never);

    vi.mocked(getSeasonParticipants).mockResolvedValueOnce([
      { id: 'p1', name: 'Alice', gym_type: 'Fire' },
    ] as Awaited<ReturnType<typeof getSeasonParticipants>>);

    const result = await buildRoundRecapPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('LEAGUE CONTEXT');
    expect(result.userPrompt).toContain('The League');
    expect(result.userPrompt).toContain('Gym Leader Typings');
    expect(result.userPrompt).toContain('Fire-type');
  });

  it('includes standings with position deltas', async () => {
    // previous standings exist because allMatchRecords has records from round < 1
    vi.mocked(getCompletedMatchRecords).mockResolvedValueOnce([
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    ] as Awaited<ReturnType<typeof getCompletedMatchRecords>>);

    const result = await buildRoundRecapPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('STANDINGS');
    expect(result.userPrompt).toContain('Alice');
  });

  it('scores a Swiss tournament byes through the recapped round, and one round fewer for the previous table', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: null, ruleset_id: null, name: 'Swiss Cup', best_of_default: 3,
      bracket_type: 'swiss', description: null, is_doubles: false, status: 'active',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(getRoundById).mockResolvedValueOnce({
      id: 'round-2', name: 'Round 2', round_number: 2, best_of: 3,
    } as Awaited<ReturnType<typeof getRoundById>>);
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce([
      { round_number: 1, bye_player_ids: ['p2'] },
      { round_number: 2, bye_player_ids: ['p1'] },
      { round_number: 3, bye_player_ids: ['p2'] },
    ] as Awaited<ReturnType<typeof getRoundsByTournament>>);
    vi.mocked(getCompletedMatchRecords).mockResolvedValueOnce([
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    ] as Awaited<ReturnType<typeof getCompletedMatchRecords>>);

    await buildRoundRecapPrompt('tourney-1', 'round-2');

    const calls = vi.mocked(computeStandingsForSeason).mock.calls;
    expect(calls).toHaveLength(2);
    // (seasonId, ids, names, records, avatars, options, gymTypes)
    expect(calls[0][5]).toMatchObject({
      byes: [
        { player_id: 'p2', round_number: 1 },
        { player_id: 'p1', round_number: 2 },
      ],
    });
    expect(calls[1][5]).toMatchObject({ byes: [{ player_id: 'p2', round_number: 1 }] });
  });

  it('says in the standings that a bye is a win without a match, counting only the byes through the recapped round', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: null, ruleset_id: null, name: 'Swiss Cup', best_of_default: 3,
      bracket_type: 'swiss', description: null, is_doubles: false, status: 'active',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(getRoundById).mockResolvedValueOnce({
      id: 'round-2', name: 'Round 2', round_number: 2, best_of: 3,
    } as Awaited<ReturnType<typeof getRoundById>>);
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce([
      { round_number: 1, bye_player_ids: ['p1'] },
      { round_number: 3, bye_player_ids: ['p1'] },
    ] as Awaited<ReturnType<typeof getRoundsByTournament>>);

    const result = await buildRoundRecapPrompt('tourney-1', 'round-2');

    const lines = result.userPrompt.split('\n');
    const alice = lines.find((line) => line.includes('Alice') && line.includes('pts'));
    expect(alice).toContain('(1W-0L, incl. 1 bye win without a match)');
    const bob = lines.find((line) => line.includes('Bob') && line.includes('pts'));
    expect(bob).toContain('(0W-1L)');
    expect(bob).not.toContain('bye');
  });

  it('writes the plain record when no bye is stored', async () => {
    const result = await buildRoundRecapPrompt('tourney-1', 'round-1');

    expect(result.userPrompt).toContain('(1W-0L)');
    expect(result.userPrompt).not.toContain('bye win');
  });

  it('builds pokemonTypes lookup from match details', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        winner_id: 'p1', status: 'completed',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);

    vi.mocked(getBattleStatsByMatch).mockResolvedValueOnce({
      'game-1': [
        {
          id: 's1', game_id: 'game-1', player_id: 'p1', pokemon_name: 'Pikachu',
          was_brought: true, was_lead: true, kos_dealt: 2, was_koed: false,
          moves_used: ['Thunderbolt'], turns_active: 5, match_won: true, created_at: '',
        },
      ],
    });

    vi.mocked(aggregateTeamFromStats).mockReturnValue([
      {
        pokemonName: 'Pikachu', timesBrought: 1, wasLead: true,
        totalKos: 2, wasKoed: false, movesUsed: ['Thunderbolt'],
        isMvp: true, totalTurnsActive: 5,
      },
    ]);

    const { getSpecies } = await import('@/lib/pkmn/dex');
    vi.mocked(getSpecies).mockReturnValue({ types: ['Electric'] } as ReturnType<typeof getSpecies>);

    const result = await buildRoundRecapPrompt('tourney-1', 'round-1');
    expect(result.pokemonTypes['Pikachu']).toEqual(['Electric']);
  });
});

describe('buildRoundForecastPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns system and user prompt', async () => {
    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.systemPrompt).toContain('Kale Cabbage');
    expect(result.userPrompt).toContain('TOURNAMENT');
  });

  it('throws when tournament not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce(null);
    await expect(buildRoundForecastPrompt('bad', 'round-1')).rejects.toThrow('not found');
  });

  it('throws when round not found', async () => {
    vi.mocked(getRoundById).mockResolvedValueOnce(null);
    await expect(buildRoundForecastPrompt('tourney-1', 'bad')).rejects.toThrow('not found');
  });

  it('includes standings when match records exist', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValueOnce([
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    ] as Awaited<ReturnType<typeof getCompletedMatchRecords>>);

    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('STANDINGS');
  });

  it('says in the standings that a bye is a win without a match', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: null, ruleset_id: null, name: 'Swiss Cup', best_of_default: 3,
      bracket_type: 'swiss', description: null, is_doubles: false, status: 'active',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(getRoundsByTournament).mockResolvedValueOnce([
      { round_number: 1, bye_player_ids: ['p1'] },
    ] as Awaited<ReturnType<typeof getRoundsByTournament>>);
    vi.mocked(getCompletedMatchRecords).mockResolvedValueOnce([
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    ] as Awaited<ReturnType<typeof getCompletedMatchRecords>>);

    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');

    expect(result.userPrompt).toContain('Alice: 3pts (1W-0L, incl. 1 bye win without a match)');
    expect(result.userPrompt).toContain('Bob: 0pts (0W-1L)');
  });

  it('skips standings when no records exist', async () => {
    vi.mocked(getCompletedMatchRecords).mockResolvedValueOnce([]);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([]);

    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    // No standings section since allMatchRecords is empty
    expect(result.userPrompt).not.toContain('STANDINGS');
  });

  it('includes upcoming matchups for pending matches', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        winner_id: null, status: 'scheduled',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);

    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('UPCOMING MATCHUPS');
    expect(result.userPrompt).toContain('Alice');
    expect(result.userPrompt).toContain('Bob');
  });

  it('shows head-to-head record for recurring opponents', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        winner_id: null, status: 'scheduled',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);

    vi.mocked(getCompletedMatchRecords).mockResolvedValueOnce([
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    ] as Awaited<ReturnType<typeof getCompletedMatchRecords>>);

    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('Head-to-head');
    expect(result.userPrompt).toContain('1-0');
  });

  it('shows first meeting when no h2h', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        winner_id: null, status: 'scheduled',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);

    vi.mocked(getCompletedMatchRecords).mockResolvedValueOnce([]);

    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('First meeting');
  });

  it('shows no pending matches message', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        winner_id: 'p1', status: 'completed',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);

    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain('No pending matches');
  });
});

// ─── Spec §7: planned rosters in the forecast prompt (code review H3) ───

describe('buildRoundForecastPrompt roster visibility', () => {
  const scheduled = {
    id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
    player_1_id: 'p1', player_2_id: 'p2',
    player_1_name: 'Alice', player_2_name: 'Bob',
    winner_id: null, status: 'scheduled',
  };

  function team(playerId: string, species: string, extra: Partial<Team> = {}): Team {
    return {
      id: `team-${playerId}`,
      player_id: playerId,
      tournament_id: 'tourney-1',
      match_id: null,
      library_published_at: null,
      pokemon: [{ species }],
      ...extra,
    } as unknown as Team;
  }

  function tournamentWith(visibility: string) {
    return {
      id: 'tourney-1', season_id: null, ruleset_id: null,
      name: 'Test Cup', best_of_default: 3,
      bracket_type: 'round_robin', description: null, is_doubles: false,
      status: 'active', team_visibility: visibility,
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMatchesByRound).mockResolvedValueOnce(
      [scheduled] as Awaited<ReturnType<typeof getMatchesByRound>>
    );
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (pid: string) =>
      team(pid, pid === 'p1' ? 'Pikachu' : 'Garchomp')
    );
  });

  it('reads the roster for the match itself, never the tournament-wide planned row', async () => {
    await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(getPlayerTeamForMatch).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'm1' }));
    expect(getPlayerTeamForMatch).toHaveBeenCalledWith('p2', expect.objectContaining({ id: 'm1' }));
  });

  it('keeps planned rosters of a scheduled match out of the prompt (hidden_until_match)', async () => {
    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).not.toContain('Pikachu');
    expect(result.userPrompt).not.toContain('Garchomp');
    expect(result.userPrompt).not.toContain("'s team:");
  });

  it('shows both rosters when the tournament is always_public', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce(tournamentWith('always_public'));
    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain("Alice's team: Pikachu");
    expect(result.userPrompt).toContain("Bob's team: Garchomp");
  });

  it('shows only the library-published roster', async () => {
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (pid: string) =>
      pid === 'p1'
        ? team('p1', 'Pikachu', { library_published_at: '2026-10-01T00:00:00Z' })
        : team('p2', 'Garchomp')
    );
    const result = await buildRoundForecastPrompt('tourney-1', 'round-1');
    expect(result.userPrompt).toContain("Alice's team: Pikachu");
    expect(result.userPrompt).not.toContain('Garchomp');
  });

  it('propagates a failed team read instead of dropping the roster', async () => {
    vi.mocked(getPlayerTeamForMatch).mockRejectedValue(new Error('teams read failed'));
    await expect(buildRoundForecastPrompt('tourney-1', 'round-1')).rejects.toThrow('teams read failed');
  });
});

describe('buildRoundRecapPrompt error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when a battle-stats read fails (no silent empty stats)', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', round_id: 'round-1',
        player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        winner_id: 'p1', status: 'completed',
      },
    ] as Awaited<ReturnType<typeof getMatchesByRound>>);
    vi.mocked(getBattleStatsByMatch).mockRejectedValueOnce(new Error('stats read failed'));
    await expect(buildRoundRecapPrompt('tourney-1', 'round-1')).rejects.toThrow('stats read failed');
  });
});
