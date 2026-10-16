import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all query imports ─────────────────────────────────────────

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(async () => ({
    id: 'tourney-1', season_id: null, ruleset_id: null,
    name: 'Test Cup', best_of_default: 3,
    bracket_type: 'round_robin', description: null, is_doubles: false,
    status: 'active',
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
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByRound: vi.fn(async () => []),
  getCompletedMatchRecords: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(async () => ({})),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForTournament: vi.fn(async () => null),
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
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getMatchesByRound, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { aggregateTeamFromStats } from '@/lib/match/aggregation';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';

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
