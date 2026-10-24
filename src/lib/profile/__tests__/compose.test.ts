import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all query imports ─────────────────────────────────────────

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(async () => ({
    id: 'player-1', name: 'Alice', discord_id: '123',
    avatar_url: null, created_at: '', updated_at: '',
  })),
  getPlayerParticipations: vi.fn(async () => ({
    tournamentIds: ['tourney-1'],
  })),
}));

vi.mock('@/lib/supabase/queries/matches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/matches')>();
  return {
    ...actual,
    getMatchesByPlayerWithTournament: vi.fn(async () => []),
    getCompletedMatchRecordsBatch: vi.fn(async () => new Map()),
  };
});

vi.mock('@/lib/supabase/queries/games', () => ({
  getPlayerBattleStats: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getGlobalKillRankForPokemon: vi.fn(async () => ({
    rankings: new Map(),
    totalRanked: 0,
  })),
  getAllTimePlayerAggregates: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  listTournamentsByIds: vi.fn(async () => [
    {
      id: 'tourney-1', name: 'Test Cup', status: 'active',
      bracket_type: 'round_robin', season_id: null,
    },
  ]),
  getParticipantsBatch: vi.fn(async () => new Map([
    ['tourney-1', [
      { id: 'player-1', name: 'Alice' },
      { id: 'player-2', name: 'Bob' },
    ]],
  ])),
}));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRating: vi.fn(async () => null),
}));

vi.mock('@/lib/supabase/queries/streaks', () => ({
  getPlayerStreaks: vi.fn(async () => null),
}));

vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignatures: vi.fn(async () => null),
}));

vi.mock('@/lib/supabase/queries/achievements', () => ({
  getPlayerAchievements: vi.fn(async () => []),
}));

vi.mock('@/lib/tournament/season-standings', () => ({
  NO_SEASON_CONTEXT: { formatType: null },
  loadSeasonStandingsContexts: vi.fn(async () => new Map()),
  computeStandingsFromContext: vi.fn(() => [
    { player_id: 'player-1', player_name: 'Alice', wins: 2, losses: 0, draws: 0, points: 6, kill_differential: 5, avatar_url: null, gym_type: null, game_wins: 4, game_losses: 0 },
    { player_id: 'player-2', player_name: 'Bob', wins: 0, losses: 2, draws: 0, points: 0, kill_differential: -5, avatar_url: null, gym_type: null, game_wins: 0, game_losses: 4 },
  ]),
}));

vi.mock('@/lib/tournament/scoring-byes', () => ({
  loadScoringByesBatch: vi.fn(async (tournaments: { id: string }[]) => new Map(tournaments.map((t) => [t.id, []]))),
}));

// Only for the test that runs the real byes loader: the rounds read it must not make for an EPB league.
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getByeRoundsByTournamentIds: vi.fn(async () => new Map()),
}));

import { composePlayerProfile } from '../compose';
import { loadScoringByesBatch } from '@/lib/tournament/scoring-byes';
import { getPlayerById, getPlayerParticipations } from '@/lib/supabase/queries/players';
import { getMatchesByPlayerWithTournament } from '@/lib/supabase/queries/matches';
import { getPlayerBattleStats } from '@/lib/supabase/queries/games';
import { getGlobalKillRankForPokemon, getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import { listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { getByeRoundsByTournamentIds } from '@/lib/supabase/queries/rounds';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { getPlayerAchievements } from '@/lib/supabase/queries/achievements';
import type { PlayerBattleStatRow } from '@/types/profile';

describe('composePlayerProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when player not found', async () => {
    vi.mocked(getPlayerById).mockResolvedValueOnce(null);
    const result = await composePlayerProfile('nonexistent');
    expect(result).toBeNull();
  });

  it('returns a complete profile for a known player', async () => {
    const profile = await composePlayerProfile('player-1');
    expect(profile).not.toBeNull();
    expect(profile!.player.id).toBe('player-1');
    expect(profile!.player.name).toBe('Alice');
    expect(profile!.headline).toBeDefined();
    expect(Array.isArray(profile!.current_participations)).toBe(true);
    expect(Array.isArray(profile!.past_participations)).toBe(true);
    expect(Array.isArray(profile!.upcoming_matches)).toBe(true);
    expect(Array.isArray(profile!.recent_matches)).toBe(true);
    expect(Array.isArray(profile!.most_used_pokemon)).toBe(true);
    expect(Array.isArray(profile!.best_kill_pokemon)).toBe(true);
    expect(Array.isArray(profile!.recent_form)).toBe(true);
    expect(Array.isArray(profile!.trophies)).toBe(true);
    expect(profile!.rating).toBeNull();
    expect(profile!.streaks).toBeNull();
    expect(Array.isArray(profile!.signatures)).toBe(true);
    expect(Array.isArray(profile!.achievements)).toBe(true);
  });

  it('fetches all required data in parallel', async () => {
    await composePlayerProfile('player-1');
    expect(getPlayerParticipations).toHaveBeenCalledWith('player-1');
    expect(getMatchesByPlayerWithTournament).toHaveBeenCalledWith('player-1');
    expect(getPlayerBattleStats).toHaveBeenCalledWith('player-1');
    expect(getAllTimePlayerAggregates).toHaveBeenCalledWith('player-1');
    expect(getPlayerRating).toHaveBeenCalledWith('player-1');
    expect(getPlayerStreaks).toHaveBeenCalledWith('player-1');
    expect(getPlayerSignatures).toHaveBeenCalledWith('player-1');
    expect(getPlayerAchievements).toHaveBeenCalledWith('player-1');
  });

  it('categorizes active tournaments as current participations', async () => {
    const profile = await composePlayerProfile('player-1');
    expect(profile!.current_participations.length).toBe(1);
    expect(profile!.current_participations[0].name).toBe('Test Cup');
    expect(profile!.current_participations[0].status).toBe('active');
  });

  it('categorizes completed tournaments as past participations', async () => {
    vi.mocked(listTournamentsByIds).mockResolvedValueOnce([
      {
        id: 'tourney-1', name: 'Old Cup', status: 'completed',
        bracket_type: 'round_robin', season_id: null,
      },
    ] as Awaited<ReturnType<typeof listTournamentsByIds>>);

    const profile = await composePlayerProfile('player-1');
    expect(profile!.past_participations.length).toBe(1);
    expect(profile!.current_participations.length).toBe(0);
  });

  it('computes trophies for top-3 finishes in completed tournaments', async () => {
    vi.mocked(listTournamentsByIds).mockResolvedValueOnce([
      {
        id: 'tourney-1', name: 'Champions Cup', status: 'completed',
        bracket_type: 'round_robin', season_id: null,
      },
    ] as Awaited<ReturnType<typeof listTournamentsByIds>>);

    const profile = await composePlayerProfile('player-1');
    // Rank 1 from mocked standings
    expect(profile!.trophies.length).toBe(1);
    expect(profile!.trophies[0]).toEqual({
      id: 'tourney-1',
      name: 'Champions Cup',
      rank: 1,
    });
  });

  it('computes headline stats from match data', async () => {
    vi.mocked(getMatchesByPlayerWithTournament).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 'tourney-1', tournament_name: 'Test Cup',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'player-2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: 'player-1', status: 'completed',
        date_played: '2024-01-01', created_at: '2024-01-01',
        games: [{ id: 'g1', winner_id: 'player-1' }],
      },
      {
        id: 'm2', tournament_id: 'tourney-1', tournament_name: 'Test Cup',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'player-3',
        player_1_name: 'Alice', player_2_name: 'Charlie',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: 'player-3', status: 'completed',
        date_played: '2024-01-02', created_at: '2024-01-02',
        games: [{ id: 'g2', winner_id: 'player-3' }],
      },
    ] as unknown as Awaited<ReturnType<typeof getMatchesByPlayerWithTournament>>);

    vi.mocked(getPlayerBattleStats).mockResolvedValueOnce([
      { pokemon_name: 'Pikachu', kos_dealt: 3, was_koed: false, match_won: true, tournament_id: 'tourney-1' },
      { pokemon_name: 'Pikachu', kos_dealt: 1, was_koed: true, match_won: false, tournament_id: 'tourney-1' },
      { pokemon_name: 'Charizard', kos_dealt: 2, was_koed: false, match_won: true, tournament_id: 'tourney-1' },
    ] as PlayerBattleStatRow[]);

    const profile = await composePlayerProfile('player-1');
    expect(profile!.headline.total_matches).toBe(2);
    expect(profile!.headline.total_wins).toBe(1);
    expect(profile!.headline.total_losses).toBe(1);
    expect(profile!.headline.win_rate).toBe(50);
    expect(profile!.headline.total_kos_dealt).toBe(6); // 3+1+2
    expect(profile!.headline.unique_pokemon_used).toBe(2);
    expect(profile!.headline.tournaments_entered).toBe(1);
  });

  it('computes recent form from last 5 completed matches', async () => {
    vi.mocked(getMatchesByPlayerWithTournament).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 't1', tournament_name: 'T',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: 'player-1', status: 'completed',
        date_played: '2024-01-03', created_at: '2024-01-03', games: [],
      },
      {
        id: 'm2', tournament_id: 't1', tournament_name: 'T',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'p3',
        player_1_name: 'Alice', player_2_name: 'Charlie',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: 'p3', status: 'completed',
        date_played: '2024-01-02', created_at: '2024-01-02', games: [],
      },
      {
        id: 'm3', tournament_id: 't1', tournament_name: 'T',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'p4',
        player_1_name: 'Alice', player_2_name: 'Dave',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: null, status: 'completed',
        date_played: '2024-01-01', created_at: '2024-01-01', games: [],
      },
    ] as unknown as Awaited<ReturnType<typeof getMatchesByPlayerWithTournament>>);

    const profile = await composePlayerProfile('player-1');
    // Sorted by date_played desc: m1 (W), m2 (L), m3 (D)
    expect(profile!.recent_form).toEqual(['W', 'L', 'D']);
  });

  it('computes most used pokemon from player aggregates', async () => {
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValueOnce([
      {
        id: 'agg-1',
        scope_type: 'all_time',
        scope_id: null,
        player_id: 'player-1',
        pokemon_name: 'Pikachu',
        total_appearances: 3,
        total_brought: 3,
        total_led: 1,
        total_kos_dealt: 6,
        total_koed: 1,
        total_wins: 2,
        total_games: 3,
        move_counts: {},
        last_updated: '2024-01-01',
      },
      {
        id: 'agg-2',
        scope_type: 'all_time',
        scope_id: null,
        player_id: 'player-1',
        pokemon_name: 'Charizard',
        total_appearances: 1,
        total_brought: 1,
        total_led: 0,
        total_kos_dealt: 5,
        total_koed: 0,
        total_wins: 1,
        total_games: 1,
        move_counts: {},
        last_updated: '2024-01-01',
      },
    ]);

    const profile = await composePlayerProfile('player-1');
    expect(profile!.most_used_pokemon.length).toBeGreaterThanOrEqual(1);
    expect(profile!.most_used_pokemon[0].pokemon_name).toBe('Pikachu');
    expect(profile!.most_used_pokemon[0].total_games).toBe(3);
    expect(profile!.most_used_pokemon[0].total_kos_dealt).toBe(6);
    expect(profile!.most_used_pokemon[0].total_koed).toBe(1);
    expect(profile!.most_used_pokemon[0].kill_differential).toBe(5);
    expect(profile!.most_used_pokemon[0].win_rate).toBe(67);
  });

  it('computes best kill pokemon with global rankings', async () => {
    vi.mocked(getPlayerBattleStats).mockResolvedValueOnce([
      { pokemon_name: 'Pikachu', kos_dealt: 10, was_koed: false, match_won: true, tournament_id: 'tourney-1' },
      { pokemon_name: 'Pikachu', kos_dealt: 5, was_koed: false, match_won: true, tournament_id: 'tourney-1' },
    ] as PlayerBattleStatRow[]);

    vi.mocked(getGlobalKillRankForPokemon).mockResolvedValueOnce({
      rankings: new Map([['Pikachu', { rank: 1, kos: 15 }]]),
      totalRanked: 50,
    });

    const profile = await composePlayerProfile('player-1');
    expect(profile!.best_kill_pokemon.length).toBe(1);
    expect(profile!.best_kill_pokemon[0]).toEqual({
      pokemon_name: 'Pikachu',
      kos_dealt: 15,
      rank: 1,
      total_ranked: 50,
    });
  });

  it('returns empty best_kill_pokemon when no battle stats', async () => {
    vi.mocked(getPlayerBattleStats).mockResolvedValueOnce([]);

    const profile = await composePlayerProfile('player-1');
    expect(profile!.best_kill_pokemon).toEqual([]);
  });

  it('computes best pokemon per tournament', async () => {
    vi.mocked(getPlayerBattleStats).mockResolvedValueOnce([
      { pokemon_name: 'Pikachu', kos_dealt: 3, was_koed: false, match_won: true, tournament_id: 'tourney-1' },
      { pokemon_name: 'Charizard', kos_dealt: 5, was_koed: false, match_won: true, tournament_id: 'tourney-1' },
    ] as PlayerBattleStatRow[]);

    const profile = await composePlayerProfile('player-1');
    // The best pokemon for tourney-1 should be Charizard (5 KOs > 3 KOs)
    const participation = profile!.current_participations.find((p) => p.id === 'tourney-1');
    expect(participation?.best_pokemon).toEqual({ pokemon_name: 'Charizard', kos_dealt: 5 });
  });

  it('returns signatures as empty array when null', async () => {
    vi.mocked(getPlayerSignatures).mockResolvedValueOnce(null);

    const profile = await composePlayerProfile('player-1');
    expect(profile!.signatures).toEqual([]);
  });

  it('returns signatures from player data', async () => {
    vi.mocked(getPlayerSignatures).mockResolvedValueOnce({
      signatures: [{ pokemon_name: 'Pikachu', score: 100 }],
    } as unknown as Awaited<ReturnType<typeof getPlayerSignatures>>);

    const profile = await composePlayerProfile('player-1');
    expect(profile!.signatures).toEqual([{ pokemon_name: 'Pikachu', score: 100 }]);
  });

  it('builds upcoming and recent match lists', async () => {
    vi.mocked(getMatchesByPlayerWithTournament).mockResolvedValueOnce([
      {
        id: 'm1', tournament_id: 't1', tournament_name: 'Test',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: null, status: 'scheduled',
        date_played: null, scheduled_at: '2024-02-01T12:00:00Z', created_at: '2024-01-01',
        games: [],
      },
      {
        id: 'm2', tournament_id: 't1', tournament_name: 'Test',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'p3',
        player_1_name: 'Alice', player_2_name: 'Charlie',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: 'player-1', status: 'completed',
        date_played: '2024-01-05', scheduled_at: null, created_at: '2024-01-05',
        games: [{ id: 'g1', winner_id: 'player-1' }, { id: 'g2', winner_id: 'player-1' }],
      },
    ] as unknown as Awaited<ReturnType<typeof getMatchesByPlayerWithTournament>>);

    const profile = await composePlayerProfile('player-1');
    expect(profile!.upcoming_matches.length).toBe(1);
    expect(profile!.upcoming_matches[0].opponent_name).toBe('Bob');
    expect(profile!.recent_matches.length).toBe(1);
    expect(profile!.recent_matches[0].opponent_name).toBe('Charlie');
    expect(profile!.recent_matches[0].game_score).toBe('2-0');
  });

  it('sorts upcoming matches by scheduled_at ascending', async () => {
    vi.mocked(getMatchesByPlayerWithTournament).mockResolvedValueOnce([
      {
        id: 'm-later', tournament_id: 't1', tournament_name: 'Test',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'p3',
        player_1_name: 'Alice', player_2_name: 'Charlie',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: null, status: 'scheduled',
        date_played: null, scheduled_at: '2024-02-10T12:00:00Z', created_at: '2024-01-01',
        games: [],
      },
      {
        id: 'm-sooner', tournament_id: 't1', tournament_name: 'Test',
        round_id: 'r1', player_1_id: 'player-1', player_2_id: 'p2',
        player_1_name: 'Alice', player_2_name: 'Bob',
        player_1_avatar_url: null, player_2_avatar_url: null,
        winner_id: null, status: 'in_progress',
        date_played: null, scheduled_at: '2024-02-01T12:00:00Z', created_at: '2024-01-02',
        games: [],
      },
    ] as unknown as Awaited<ReturnType<typeof getMatchesByPlayerWithTournament>>);

    const profile = await composePlayerProfile('player-1');
    expect(profile!.upcoming_matches.map((m) => m.opponent_name)).toEqual(['Bob', 'Charlie']);
  });

  it('handles standings computation failure gracefully (and logs it)', async () => {
    const { computeStandingsFromContext } = await import('@/lib/tournament/season-standings');
    const failure = new Error('standings fail');
    vi.mocked(computeStandingsFromContext).mockImplementationOnce(() => {
      throw failure;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const profile = await composePlayerProfile('player-1');
      // Should not crash
      expect(profile).not.toBeNull();
      expect(profile!.current_participations[0].standing).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('standings failed for tournament'),
        failure,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('resolves every season context in ONE batched call, not one lookup per tournament', async () => {
    const { computeStandingsFromContext, loadSeasonStandingsContexts } = await import(
      '@/lib/tournament/season-standings'
    );
    const epbContext = { formatType: 'evolution_point_buy', evolutionPoints: { 'player-1': 3 } };
    vi.mocked(loadSeasonStandingsContexts).mockResolvedValueOnce(new Map([['season-a', epbContext]]));
    vi.mocked(listTournamentsByIds).mockResolvedValueOnce([
      { id: 't-1', name: 'A1', status: 'active', bracket_type: 'round_robin', season_id: 'season-a' },
      { id: 't-2', name: 'A2', status: 'completed', bracket_type: 'round_robin', season_id: 'season-a' },
      { id: 't-3', name: 'Solo', status: 'completed', bracket_type: 'swiss', season_id: null },
      { id: 't-4', name: 'Later', status: 'upcoming', bracket_type: 'swiss', season_id: 'season-b' },
    ] as Awaited<ReturnType<typeof listTournamentsByIds>>);

    await composePlayerProfile('player-1');

    expect(loadSeasonStandingsContexts).toHaveBeenCalledTimes(1);
    // Only tournaments that get a table are asked for (the upcoming one is not).
    expect(loadSeasonStandingsContexts).toHaveBeenCalledWith(['season-a', 'season-a', null]);
    const contexts = vi.mocked(computeStandingsFromContext).mock.calls.map((call) => call[0]);
    expect(contexts).toEqual([epbContext, epbContext, { formatType: null }]);
  });

  it('scores the stored byes of a Swiss tournament in the profile standing', async () => {
    const { computeStandingsFromContext } = await import('@/lib/tournament/season-standings');
    const byes = [{ player_id: 'player-1', round_number: 1 }];
    vi.mocked(loadScoringByesBatch).mockResolvedValueOnce(new Map([['t-swiss', byes]]));
    vi.mocked(listTournamentsByIds).mockResolvedValueOnce([
      { id: 't-swiss', name: 'Swiss Cup', status: 'active', bracket_type: 'swiss', season_id: null },
    ] as Awaited<ReturnType<typeof listTournamentsByIds>>);

    await composePlayerProfile('player-1');

    const options = vi.mocked(computeStandingsFromContext).mock.calls[0][5];
    expect(options).toEqual({ byes });
  });

  it('reads the byes of every Swiss tournament in ONE batched call, not one read per tournament', async () => {
    const { computeStandingsFromContext } = await import('@/lib/tournament/season-standings');
    const byesOne = [{ player_id: 'player-1', round_number: 1 }];
    const byesTwo = [{ player_id: 'player-1', round_number: 2 }];
    vi.mocked(loadScoringByesBatch).mockResolvedValueOnce(
      new Map([
        ['t-swiss-1', byesOne],
        ['t-swiss-2', byesTwo],
        ['t-rr', []],
      ]),
    );
    vi.mocked(listTournamentsByIds).mockResolvedValueOnce([
      { id: 't-swiss-1', name: 'Swiss One', status: 'active', bracket_type: 'swiss', season_id: null },
      { id: 't-swiss-2', name: 'Swiss Two', status: 'completed', bracket_type: 'swiss', season_id: null },
      { id: 't-rr', name: 'Round Robin', status: 'active', bracket_type: 'round_robin', season_id: null },
      { id: 't-later', name: 'Later', status: 'upcoming', bracket_type: 'swiss', season_id: null },
    ] as Awaited<ReturnType<typeof listTournamentsByIds>>);

    await composePlayerProfile('player-1');

    expect(loadScoringByesBatch).toHaveBeenCalledTimes(1);
    // Only the tournaments that get a table are asked for (the upcoming one is not).
    expect(vi.mocked(loadScoringByesBatch).mock.calls[0][0].map((t) => t.id)).toEqual([
      't-swiss-1',
      't-swiss-2',
      't-rr',
    ]);
    const byesPerTable = vi.mocked(computeStandingsFromContext).mock.calls.map((call) => call[5]);
    expect(byesPerTable).toEqual([{ byes: byesOne }, { byes: byesTwo }, { byes: [] }]);
  });

  it('reads no rounds for a Swiss stage of an Evolution Point Buy league and still shows its standing', async () => {
    const { computeStandingsFromContext } = await import('@/lib/tournament/season-standings');
    const actual = await vi.importActual<typeof import('@/lib/tournament/scoring-byes')>(
      '@/lib/tournament/scoring-byes',
    );
    vi.mocked(loadScoringByesBatch).mockImplementationOnce(actual.loadScoringByesBatch);
    vi.mocked(listTournamentsByIds).mockResolvedValueOnce([
      {
        id: 't-epb-swiss',
        name: 'EPB Swiss',
        status: 'active',
        bracket_type: 'swiss',
        season_id: 'season-a',
        season_format_type: 'evolution_point_buy',
      },
    ] as Awaited<ReturnType<typeof listTournamentsByIds>>);

    const profile = await composePlayerProfile('player-1');

    // The loader received the format from the tournament row, so the gate stopped the read.
    expect(vi.mocked(loadScoringByesBatch).mock.calls[0][0][0]).toMatchObject({
      id: 't-epb-swiss',
      season_format_type: 'evolution_point_buy',
    });
    expect(getByeRoundsByTournamentIds).not.toHaveBeenCalled();
    expect(vi.mocked(computeStandingsFromContext).mock.calls[0][5]).toEqual({ byes: [] });
    expect(profile!.current_participations[0].standing).not.toBeNull();
  });

  it('a failed bye read costs the Swiss standings (logged), not the profile or the other tables', async () => {
    const failure = new Error('rounds unavailable');
    vi.mocked(loadScoringByesBatch).mockRejectedValueOnce(failure);
    vi.mocked(listTournamentsByIds).mockResolvedValueOnce([
      { id: 't-swiss', name: 'Swiss Cup', status: 'active', bracket_type: 'swiss', season_id: null },
      { id: 't-rr', name: 'Round Robin', status: 'active', bracket_type: 'round_robin', season_id: null },
    ] as Awaited<ReturnType<typeof listTournamentsByIds>>);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const profile = await composePlayerProfile('player-1');
      expect(profile).not.toBeNull();
      const byId = Object.fromEntries(profile!.current_participations.map((p) => [p.id, p.standing]));
      expect(byId['t-swiss']).toBeNull();
      expect(byId['t-rr']).not.toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bye rounds failed'), failure);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a failed season-context read costs only the season-bound standings (logged), never the profile', async () => {
    const { loadSeasonStandingsContexts } = await import('@/lib/tournament/season-standings');
    const failure = new Error('seasons unavailable');
    vi.mocked(loadSeasonStandingsContexts).mockRejectedValueOnce(failure);
    vi.mocked(listTournamentsByIds).mockResolvedValueOnce([
      { id: 't-league', name: 'League Stage', status: 'active', bracket_type: 'round_robin', season_id: 'season-a' },
      { id: 't-solo', name: 'Solo Cup', status: 'active', bracket_type: 'swiss', season_id: null },
    ] as Awaited<ReturnType<typeof listTournamentsByIds>>);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const profile = await composePlayerProfile('player-1');

      const byId = Object.fromEntries(profile!.current_participations.map((p) => [p.id, p.standing]));
      expect(byId['t-league']).toBeNull();
      expect(byId['t-solo']).not.toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('season standings contexts failed'),
        failure,
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
