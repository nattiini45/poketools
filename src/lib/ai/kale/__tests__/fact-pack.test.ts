import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (must come before imports of mocked modules) ────────────

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getSeasonParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByRound: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForMatch: vi.fn(),
}));

vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(),
}));

vi.mock('@/lib/match/aggregation', () => ({
  aggregateTeamFromStats: vi.fn(),
  computePokemonScore: vi.fn(),
  computeQuickStats: vi.fn(),
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getSpecies: vi.fn(),
}));

import { computeMarginDescription, buildRecapFactPack, buildForecastFactPack } from '../fact-pack';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getRoundById, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getMatchesByRound, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { aggregateTeamFromStats, computePokemonScore, computeQuickStats } from '@/lib/match/aggregation';
import { getSpecies } from '@/lib/pkmn/dex';
import type { Standing } from '@/lib/tournament/types';
import type { AggregatedPokemon } from '@/lib/match/aggregation';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── computeMarginDescription ───────────────────────────────────────

describe('computeMarginDescription', () => {
  it('identifies 1-0 as the closest possible margin', () => {
    const result = computeMarginDescription(1, 0);
    expect(result).toContain('closest possible margin');
    expect(result).toContain('1-0');
  });

  it('identifies 2-0 as a comfortable win', () => {
    const result = computeMarginDescription(2, 0);
    expect(result).toContain('comfortable');
    expect(result).toContain('2-0');
  });

  it('identifies 3-0 as a dominant sweep', () => {
    const result = computeMarginDescription(3, 0);
    expect(result).toContain('dominant sweep');
    expect(result).toContain('3-0');
  });

  it('identifies 4-0 as a dominant sweep', () => {
    const result = computeMarginDescription(4, 0);
    expect(result).toContain('dominant sweep');
    expect(result).toContain('4-0');
  });

  it('identifies 2-1 as a close match', () => {
    const result = computeMarginDescription(2, 1);
    expect(result).toContain('close');
    expect(result).toContain('2-1');
  });

  it('identifies 3-1 as a comfortable margin', () => {
    const result = computeMarginDescription(3, 1);
    expect(result).toContain('comfortable');
    expect(result).toContain('3-1');
  });

  it('identifies 4-1 as a commanding victory', () => {
    const result = computeMarginDescription(4, 1);
    expect(result).toContain('commanding');
    expect(result).toContain('4-1');
  });

  it('handles equal scores gracefully', () => {
    const result = computeMarginDescription(2, 2);
    expect(result).toContain('2-2');
  });

  it('handles 3-2 as a close match (diff=1)', () => {
    const result = computeMarginDescription(3, 2);
    expect(result).toContain('close');
    expect(result).toContain('3-2');
  });

  it('handles 5-2 as commanding victory (diff=3)', () => {
    const result = computeMarginDescription(5, 2);
    expect(result).toContain('commanding');
    expect(result).toContain('5-2');
  });

  it('handles 5-0 as a dominant sweep', () => {
    const result = computeMarginDescription(5, 0);
    expect(result).toContain('dominant sweep');
    expect(result).toContain('5-0');
  });

  it('always includes the score string', () => {
    for (const [w, l] of [[1, 0], [2, 0], [3, 0], [2, 1], [3, 1], [3, 2]]) {
      const result = computeMarginDescription(w, l);
      expect(result).toContain(`${w}-${l}`);
    }
  });
});

// ─── buildRecapFactPack ─────────────────────────────────────────────

function makeMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'match-1',
    round_id: 'round-1',
    tournament_id: 'tourney-1',
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'Ash',
    player_2_name: 'Misty',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_id: 'p1',
    winner_name: 'Ash',
    status: 'completed' as const,
    submitter_id: null,
    date_played: null,
    notes: '',
    social_image_url: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    round_status: 'active' as const,
    games: [
      { id: 'g1', game_number: 1, winner_id: 'p1', replay_url: '', source: 'manual' as const },
      { id: 'g2', game_number: 2, winner_id: 'p1', replay_url: '', source: 'manual' as const },
    ],
    ...overrides,
  };
}

function makeAggPokemon(overrides: Partial<AggregatedPokemon> = {}): AggregatedPokemon {
  return {
    pokemonName: 'Pikachu',
    totalKos: 2,
    timesBrought: 2,
    wasKoed: false,
    wasLead: true,
    totalTurnsActive: 10,
    movesUsed: ['Thunderbolt', 'Quick Attack'],
    isMvp: false,
    ...overrides,
  };
}

function makeStanding(overrides: Partial<Standing> = {}): Standing {
  return {
    player_id: 'p1',
    player_name: 'Ash',
    player_avatar_url: null,
    gym_type: null,
    wins: 1,
    losses: 0,
    draws: 0,
    points: 3,
    buchholz: 0,
    games_played: 2,
    kill_differential: 4,
    eliminated: false,
    ...overrides,
  };
}

function setupRecapMocks() {
  vi.mocked(getTournamentById).mockResolvedValue({
    id: 'tourney-1',
    name: 'Test Tournament',
    best_of_default: 3,
    ruleset_id: 'ruleset-1',
    season_id: null,
  } as ReturnType<typeof getTournamentById> extends Promise<infer T> ? T : never);

  vi.mocked(getRoundById).mockResolvedValue({
    id: 'round-1',
    name: 'Round 1',
    round_number: 1,
  } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);

  vi.mocked(getParticipants).mockResolvedValue([
    { id: 'p1', name: 'Ash', avatar_url: null },
    { id: 'p2', name: 'Misty', avatar_url: null },
  ] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

  vi.mocked(getRulesetById).mockResolvedValue({
    id: 'ruleset-1',
    base_format: 'gen9ou',
  } as ReturnType<typeof getRulesetById> extends Promise<infer T> ? T : never);

  vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch()] as ReturnType<typeof getMatchesByRound> extends Promise<infer T> ? T : never);

  vi.mocked(getCompletedMatchRecords).mockResolvedValue([
    { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
  ] as ReturnType<typeof getCompletedMatchRecords> extends Promise<infer T> ? T : never);

  const p1Team = [
    makeAggPokemon({ pokemonName: 'Pikachu', totalKos: 3, isMvp: true }),
    makeAggPokemon({ pokemonName: 'Charizard', totalKos: 1 }),
  ];
  const p2Team = [
    makeAggPokemon({ pokemonName: 'Starmie', totalKos: 1, wasKoed: true }),
  ];

  vi.mocked(getBattleStatsByMatch).mockResolvedValue({
    g1: [],
    g2: [],
  } as unknown as ReturnType<typeof getBattleStatsByMatch> extends Promise<infer T> ? T : never);

  vi.mocked(aggregateTeamFromStats)
    .mockReturnValueOnce(p1Team)
    .mockReturnValueOnce(p2Team);

  vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 2, p2Score: 0 });
  vi.mocked(computeQuickStats).mockReturnValue({ p1TotalKos: 4, p2TotalKos: 1, gamesPlayed: 2 });

  const standings = [
    makeStanding({ player_id: 'p1', player_name: 'Ash', wins: 1, losses: 0, points: 3, kill_differential: 3 }),
    makeStanding({ player_id: 'p2', player_name: 'Misty', wins: 0, losses: 1, points: 0, kill_differential: -3 }),
  ];
  vi.mocked(computeStandingsForSeason).mockResolvedValue(standings);

  vi.mocked(getSpecies).mockReturnValue({ types: ['Electric'] } as ReturnType<typeof getSpecies>);
}

describe('buildRecapFactPack', () => {
  it('throws when tournament is not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null as ReturnType<typeof getTournamentById> extends Promise<infer T> ? T : never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'r1' } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);
    vi.mocked(getParticipants).mockResolvedValue([] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    await expect(buildRecapFactPack('tourney-1', 'round-1')).rejects.toThrow('Tournament tourney-1 not found');
  });

  it('throws when round is not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: 'tourney-1', name: 'T' } as ReturnType<typeof getTournamentById> extends Promise<infer T> ? T : never);
    vi.mocked(getRoundById).mockResolvedValue(null as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);
    vi.mocked(getParticipants).mockResolvedValue([] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    await expect(buildRecapFactPack('tourney-1', 'round-1')).rejects.toThrow('Round round-1 not found');
  });

  it('returns a complete RecapFactPack', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');

    expect(result.tournamentName).toBe('Test Tournament');
    expect(result.roundName).toBe('Round 1');
    expect(result.roundNumber).toBe(1);
    expect(result.format).toBe('gen9ou');
    expect(result.scoring).toContain('3 points');
    expect(result.leagueName).toBeNull();
    expect(result.matches).toHaveLength(1);
    expect(result.currentStandings).toHaveLength(2);
    expect(result.validPlayerNames).toEqual(['Ash', 'Misty']);
  });


  it('builds match facts with correct winner/loser', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');
    const match = result.matches[0];

    expect(match.winnerName).toBe('Ash');
    expect(match.loserName).toBe('Misty');
    expect(match.winnerScore).toBe(2);
    expect(match.loserScore).toBe(0);
    expect(match.scoreString).toBe('2-0');
  });

  it('identifies MVP pokemon', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');
    const match = result.matches[0];

    expect(match.mvpPokemon).toBe('Pikachu');
    expect(match.mvpKos).toBe(3);
  });

  it('generates preWrittenOneLiner with MVP info', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');
    const match = result.matches[0];

    expect(match.preWrittenOneLiner).toContain('Ash defeated Misty');
    expect(match.preWrittenOneLiner).toContain('Pikachu');
    expect(match.preWrittenOneLiner).toContain('MVP');
  });

  it('builds keyPerformances from high-KO pokemon', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');
    const match = result.matches[0];

    // MVP gets a keyPerformance entry
    expect(match.keyPerformances.length).toBeGreaterThanOrEqual(1);
    expect(match.keyPerformances[0]).toContain('Pikachu');
  });

  it('builds standing facts with rank changes', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');

    // First round has no previous standings, so rankChange is just "#N"
    expect(result.currentStandings[0].rank).toBe(1);
    expect(result.currentStandings[0].playerName).toBe('Ash');
    expect(result.currentStandings[0].recordString).toBe('1W-0L');
    expect(result.currentStandings[0].kdString).toBe('+3');
  });

  it('includes pokemonUsage sorted by timesBrought', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');
    expect(result.pokemonUsage.length).toBeGreaterThan(0);

    // Sorted in descending order of timesBrought
    for (let i = 1; i < result.pokemonUsage.length; i++) {
      expect(result.pokemonUsage[i - 1].timesBrought).toBeGreaterThanOrEqual(result.pokemonUsage[i].timesBrought);
    }
  });

  it('selects bestPerformer from largest margin winner', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');

    expect(result.bestPerformer).not.toBeNull();
    expect(result.bestPerformer!.playerName).toBe('Ash');
    expect(result.bestPerformer!.reason).toContain('2-0');
  });

  it('handles no completed matches gracefully', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      name: 'Test Tournament',
      best_of_default: 3,
      ruleset_id: null,
      season_id: null,
    } as never);

    vi.mocked(getRoundById).mockResolvedValue({
      id: 'round-1',
      name: 'Round 1',
      round_number: 1,
    } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);

    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Ash', avatar_url: null },
    ] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    // Matches exist but none completed
    vi.mocked(getMatchesByRound).mockResolvedValue([
      makeMatch({ status: 'pending', winner_id: null }),
    ] as ReturnType<typeof getMatchesByRound> extends Promise<infer T> ? T : never);

    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as ReturnType<typeof getCompletedMatchRecords> extends Promise<infer T> ? T : never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([]);

    const result = await buildRecapFactPack('tourney-1', 'round-1');

    expect(result.matches).toHaveLength(0);
    expect(result.bestPerformer).toBeNull();
    expect(result.pokemonUsage).toHaveLength(0);
    expect(result.format).toBe('unknown');
  });

  it('fails the pack when a battle-stats read fails (no silent "no stats" recap)', async () => {
    setupRecapMocks();
    const dbError = new Error('battle_stats read failed');
    vi.mocked(getBattleStatsByMatch).mockRejectedValueOnce(dbError);

    await expect(buildRecapFactPack('tourney-1', 'round-1')).rejects.toBe(dbError);
  });

  it('includes negative kdString for losing players', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');
    const mistyStanding = result.currentStandings.find(s => s.playerName === 'Misty');
    expect(mistyStanding).toBeDefined();
    expect(mistyStanding!.kdString).toBe('-3');
  });

  it('handles season context with gym types', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      name: 'Test Tournament',
      best_of_default: 3,
      ruleset_id: 'ruleset-1',
      season_id: 'season-1',
    } as ReturnType<typeof getTournamentById> extends Promise<infer T> ? T : never);

    vi.mocked(getRoundById).mockResolvedValue({
      id: 'round-1',
      name: 'Round 1',
      round_number: 1,
    } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);

    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Ash', avatar_url: null },
      { id: 'p2', name: 'Misty', avatar_url: null },
    ] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    vi.mocked(getRulesetById).mockResolvedValue({
      id: 'ruleset-1',
      base_format: 'gen9ou',
    } as ReturnType<typeof getRulesetById> extends Promise<infer T> ? T : never);

    vi.mocked(getSeasonById).mockResolvedValue({
      id: 'season-1',
      name: 'Test League',
      description: null,
      format_type: 'gym_league',
    } as never);

    vi.mocked(getSeasonParticipants).mockResolvedValue([
      { id: 'p1', gym_type: 'Electric', name: 'Ash' },
      { id: 'p2', gym_type: 'Water', name: 'Misty' },
    ] as ReturnType<typeof getSeasonParticipants> extends Promise<infer T> ? T : never);

    vi.mocked(getMatchesByRound).mockResolvedValue([] as ReturnType<typeof getMatchesByRound> extends Promise<infer T> ? T : never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as ReturnType<typeof getCompletedMatchRecords> extends Promise<infer T> ? T : never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([]);

    const result = await buildRecapFactPack('tourney-1', 'round-1');

    expect(result.leagueName).toBe('Test League');
    expect(result.gymTypes['p1']).toBe('Electric');
    expect(result.gymTypes['p2']).toBe('Water');
  });
});

// ─── buildForecastFactPack ──────────────────────────────────────────

describe('buildForecastFactPack', () => {
  it('throws when tournament is not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null as ReturnType<typeof getTournamentById> extends Promise<infer T> ? T : never);
    vi.mocked(getRoundById).mockResolvedValue({ id: 'r1' } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);
    vi.mocked(getParticipants).mockResolvedValue([] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    await expect(buildForecastFactPack('tourney-1', 'round-1')).rejects.toThrow('Tournament tourney-1 not found');
  });

  it('throws when round is not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: 'tourney-1', name: 'T' } as ReturnType<typeof getTournamentById> extends Promise<infer T> ? T : never);
    vi.mocked(getRoundById).mockResolvedValue(null as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);
    vi.mocked(getParticipants).mockResolvedValue([] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    await expect(buildForecastFactPack('tourney-1', 'round-1')).rejects.toThrow('Round round-1 not found');
  });

  it('returns a complete ForecastFactPack', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      name: 'Test Tournament',
      best_of_default: 3,
      ruleset_id: 'ruleset-1',
      season_id: null,
    } as ReturnType<typeof getTournamentById> extends Promise<infer T> ? T : never);

    vi.mocked(getRoundById).mockResolvedValue({
      id: 'round-1',
      name: 'Round 2',
      round_number: 2,
    } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);

    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Ash', avatar_url: null },
      { id: 'p2', name: 'Misty', avatar_url: null },
    ] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    vi.mocked(getRulesetById).mockResolvedValue({
      id: 'ruleset-1',
      base_format: 'gen9ou',
    } as ReturnType<typeof getRulesetById> extends Promise<infer T> ? T : never);

    const pendingMatch = makeMatch({ status: 'pending', winner_id: null });
    vi.mocked(getMatchesByRound).mockResolvedValue([pendingMatch] as ReturnType<typeof getMatchesByRound> extends Promise<infer T> ? T : never);

    vi.mocked(getCompletedMatchRecords).mockResolvedValue([
      { player_1_id: 'p1', player_2_id: 'p3', winner_id: 'p1', round_number: 1 },
    ] as ReturnType<typeof getCompletedMatchRecords> extends Promise<infer T> ? T : never);

    const standings = [
      makeStanding({ player_id: 'p1', player_name: 'Ash', wins: 1, points: 3 }),
      makeStanding({ player_id: 'p2', player_name: 'Misty', wins: 0, points: 0 }),
    ];
    vi.mocked(computeStandingsForSeason).mockResolvedValue(standings);

    vi.mocked(getPlayerTeamForMatch).mockResolvedValue({
      pokemon: [{ species: 'Pikachu' }, { species: 'Charizard' }],
    } as ReturnType<typeof getPlayerTeamForMatch> extends Promise<infer T> ? T : never);

    const result = await buildForecastFactPack('tourney-1', 'round-1');

    expect(result.tournamentName).toBe('Test Tournament');
    expect(result.roundName).toBe('Round 2');
    expect(result.format).toBe('gen9ou');
    expect(result.matchups).toHaveLength(1);
    expect(result.currentStandings).toHaveLength(2);
    expect(result.validPlayerNames).toEqual(['Ash', 'Misty']);
    // hidden_until_match (default) and a scheduled match: no roster reaches the prompt (spec §7).
    expect(result.matchups[0].player1Team).toEqual([]);
    expect(result.matchups[0].player2Team).toEqual([]);
  });

  it('computes head-to-head for matchups', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      name: 'T',
      best_of_default: 3,
      ruleset_id: null,
      season_id: null,
    } as never);

    vi.mocked(getRoundById).mockResolvedValue({
      id: 'round-1',
      name: 'R2',
      round_number: 2,
    } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);

    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Ash', avatar_url: null },
      { id: 'p2', name: 'Misty', avatar_url: null },
    ] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    const pendingMatch = makeMatch({ status: 'pending', winner_id: null });
    vi.mocked(getMatchesByRound).mockResolvedValue([pendingMatch] as ReturnType<typeof getMatchesByRound> extends Promise<infer T> ? T : never);

    // Previous h2h: Ash beat Misty once
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    ] as ReturnType<typeof getCompletedMatchRecords> extends Promise<infer T> ? T : never);

    vi.mocked(computeStandingsForSeason).mockResolvedValue([
      makeStanding({ player_id: 'p1', player_name: 'Ash' }),
      makeStanding({ player_id: 'p2', player_name: 'Misty' }),
    ]);

    vi.mocked(getPlayerTeamForMatch).mockResolvedValue(null as ReturnType<typeof getPlayerTeamForMatch> extends Promise<infer T> ? T : never);

    const result = await buildForecastFactPack('tourney-1', 'round-1');

    expect(result.matchups[0].headToHead).toContain('Ash leads 1-0');
  });

  it('shows First meeting when no prior matches', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      name: 'T',
      best_of_default: 3,
      ruleset_id: null,
      season_id: null,
    } as never);

    vi.mocked(getRoundById).mockResolvedValue({
      id: 'round-1',
      name: 'R1',
      round_number: 1,
    } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);

    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Ash', avatar_url: null },
      { id: 'p2', name: 'Misty', avatar_url: null },
    ] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    const pendingMatch = makeMatch({ status: 'pending', winner_id: null });
    vi.mocked(getMatchesByRound).mockResolvedValue([pendingMatch] as ReturnType<typeof getMatchesByRound> extends Promise<infer T> ? T : never);

    // No prior matches at all
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as ReturnType<typeof getCompletedMatchRecords> extends Promise<infer T> ? T : never);

    vi.mocked(computeStandingsForSeason).mockResolvedValue([]);
    vi.mocked(getPlayerTeamForMatch).mockResolvedValue(null as ReturnType<typeof getPlayerTeamForMatch> extends Promise<infer T> ? T : never);

    const result = await buildForecastFactPack('tourney-1', 'round-1');

    expect(result.matchups[0].headToHead).toBe('First meeting');
  });

  it('skips completed matches in matchup list', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      name: 'T',
      best_of_default: 3,
      ruleset_id: null,
      season_id: null,
    } as never);

    vi.mocked(getRoundById).mockResolvedValue({
      id: 'round-1',
      name: 'R1',
      round_number: 1,
    } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);

    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Ash', avatar_url: null },
      { id: 'p2', name: 'Misty', avatar_url: null },
    ] as ReturnType<typeof getParticipants> extends Promise<infer T> ? T : never);

    // Only completed matches -> they get filtered out of matchups
    vi.mocked(getMatchesByRound).mockResolvedValue([
      makeMatch({ status: 'completed', winner_id: 'p1' }),
    ] as ReturnType<typeof getMatchesByRound> extends Promise<infer T> ? T : never);

    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as ReturnType<typeof getCompletedMatchRecords> extends Promise<infer T> ? T : never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([]);
    vi.mocked(getPlayerTeamForMatch).mockResolvedValue(null as ReturnType<typeof getPlayerTeamForMatch> extends Promise<infer T> ? T : never);

    const result = await buildForecastFactPack('tourney-1', 'round-1');

    expect(result.matchups).toHaveLength(0);
  });

  it('spec §7: forecast rosters appear only when an anonymous reader may see them', async () => {
    vi.mocked(getRoundById).mockResolvedValue({ id: 'round-1', name: 'R2', round_number: 2 } as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'Ash', avatar_url: null },
      { id: 'p2', name: 'Misty', avatar_url: null },
    ] as never);
    const pendingMatch = makeMatch({ status: 'pending', winner_id: null });
    vi.mocked(getMatchesByRound).mockResolvedValue([pendingMatch] as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
    vi.mocked(computeStandingsForSeason).mockResolvedValue([]);
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (pid) => ({
      player_id: pid,
      match_id: null,
      library_published_at: pid === 'p2' ? '2026-01-01T00:00:00Z' : null,
      pokemon: [{ species: pid === 'p1' ? 'Pikachu' : 'Starmie' }],
    }) as never);

    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1', name: 'T', best_of_default: 3, ruleset_id: null, season_id: null,
      team_visibility: 'hidden_until_match',
    } as never);
    const hidden = await buildForecastFactPack('tourney-1', 'round-1');
    // p1's planned roster stays hidden; p2's library-published team is public.
    expect(hidden.matchups[0].player1Team).toEqual([]);
    expect(hidden.matchups[0].player2Team).toEqual(['Starmie']);
    expect(getPlayerTeamForMatch).toHaveBeenCalledWith('p1', pendingMatch);

    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1', name: 'T', best_of_default: 3, ruleset_id: null, season_id: null,
      team_visibility: 'always_public',
    } as never);
    const open = await buildForecastFactPack('tourney-1', 'round-1');
    expect(open.matchups[0].player1Team).toEqual(['Pikachu']);
  });
});

// ─── Byes in the record ─────────────────────────────────────────────

describe('standing records with Swiss byes', () => {
  function useSwissTournament(rounds: { round_number: number; bye_player_ids: string[] }[]) {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      name: 'Swiss Cup',
      best_of_default: 3,
      ruleset_id: 'ruleset-1',
      season_id: null,
      bracket_type: 'swiss',
    } as ReturnType<typeof getTournamentById> extends Promise<infer T> ? T : never);
    vi.mocked(getRoundsByTournament).mockResolvedValue(
      rounds as ReturnType<typeof getRoundsByTournament> extends Promise<infer T> ? T : never,
    );
  }

  it('recap: a record that holds a bye win says it is a win without a match', async () => {
    setupRecapMocks();
    useSwissTournament([
      { round_number: 1, bye_player_ids: ['p1'] },
      // Later rounds are not part of the table "through round 1".
      { round_number: 2, bye_player_ids: ['p1'] },
    ]);

    const result = await buildRecapFactPack('tourney-1', 'round-1');

    expect(result.currentStandings[0].recordString).toBe('1W-0L, incl. 1 bye win without a match');
    expect(result.currentStandings[1].recordString).toBe('0W-1L');
    // The numeric fields stay the table's own.
    expect(result.currentStandings[0].wins).toBe(1);
  });

  it('recap: the previous table counts the byes of one round fewer', async () => {
    setupRecapMocks();
    vi.mocked(getRoundById).mockResolvedValue({
      id: 'round-2',
      name: 'Round 2',
      round_number: 2,
    } as ReturnType<typeof getRoundById> extends Promise<infer T> ? T : never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1', round_number: 1 },
    ] as ReturnType<typeof getCompletedMatchRecords> extends Promise<infer T> ? T : never);
    useSwissTournament([
      { round_number: 1, bye_player_ids: ['p1'] },
      { round_number: 2, bye_player_ids: ['p1'] },
    ]);

    const result = await buildRecapFactPack('tourney-1', 'round-2');

    expect(result.currentStandings[0].recordString).toBe('1W-0L, incl. 2 bye wins without a match');
    expect(result.previousStandings![0].recordString).toBe('1W-0L, incl. 1 bye win without a match');
  });

  it('recap: a tournament without byes keeps the plain record', async () => {
    setupRecapMocks();

    const result = await buildRecapFactPack('tourney-1', 'round-1');

    expect(result.currentStandings[0].recordString).toBe('1W-0L');
  });

  it('forecast: the standings behind the matchups name the bye win too', async () => {
    setupRecapMocks();
    useSwissTournament([{ round_number: 1, bye_player_ids: ['p2'] }]);

    const result = await buildForecastFactPack('tourney-1', 'round-1');

    expect(result.currentStandings.map((s) => s.recordString)).toEqual([
      '1W-0L',
      '0W-1L, incl. 1 bye win without a match',
    ]);
  });

  function useSwissStageOfLeague(formatType: string) {
    useSwissTournament([{ round_number: 1, bye_player_ids: ['p1'] }]);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 'tourney-1',
      name: 'Swiss Cup',
      best_of_default: 3,
      ruleset_id: 'ruleset-1',
      season_id: 'season-1',
      season_format_type: formatType,
      bracket_type: 'swiss',
    } as unknown as Awaited<ReturnType<typeof getTournamentById>>);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: 'season-1',
      name: 'League',
      description: null,
      format_type: formatType,
    } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([] as never);
  }

  it('recap and forecast: an Evolution Point Buy league scores no bye, so no record carries bye text', async () => {
    setupRecapMocks();
    useSwissStageOfLeague('evolution_point_buy');

    const recap = await buildRecapFactPack('tourney-1', 'round-1');
    expect(recap.currentStandings[0].recordString).toBe('1W-0L');
    expect(vi.mocked(computeStandingsForSeason).mock.calls[0][5]).toMatchObject({ byes: [] });

    const forecast = await buildForecastFactPack('tourney-1', 'round-1');
    expect(forecast.currentStandings.map((s) => s.recordString)).toEqual(['1W-0L', '0W-1L']);
    expect(getRoundsByTournament).not.toHaveBeenCalled();
  });

  it('recap: a league of another format with a Swiss stage still annotates its bye wins', async () => {
    setupRecapMocks();
    useSwissStageOfLeague('singles');

    const recap = await buildRecapFactPack('tourney-1', 'round-1');

    expect(recap.currentStandings[0].recordString).toBe('1W-0L, incl. 1 bye win without a match');
  });
});
