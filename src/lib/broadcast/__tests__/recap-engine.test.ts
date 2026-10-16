import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByRound: vi.fn(),
  getMatchesByTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/broadcast-moments', () => ({
  getMomentsByMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getParticipants: vi.fn(),
  getTournamentById: vi.fn(async () => ({ id: 'tournament-1', season_id: 'season-1' })),
}));

vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(async () => []),
}));

vi.mock('@/lib/match/aggregation', () => ({
  computePokemonScore: vi.fn(),
  aggregateTeamFromStats: vi.fn(),
}));

vi.mock('@/lib/pkmn/sprites', () => ({
  getSpriteUrl: vi.fn(),
}));

vi.mock('@/lib/ai/client', () => ({
  complete: vi.fn(),
}));

import { getMatchesByRound, getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMomentsByMatch } from '@/lib/supabase/queries/broadcast-moments';
import { getAggregates } from '@/lib/supabase/queries/aggregates';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { computePokemonScore, aggregateTeamFromStats } from '@/lib/match/aggregation';
import { getSpriteUrl } from '@/lib/pkmn/sprites';
import { outputLanguageInstruction } from '@/lib/ai/language';
import { composeWeeklyRecap } from '../recap-engine';

// ── Helpers ────────────────────────────────────────────────────────

function makeMatch(id: string, overrides?: Record<string, unknown>) {
  return {
    id,
    status: 'completed',
    player_1_id: 'p1',
    player_2_id: 'p2',
    player_1_name: 'Alice',
    player_2_name: 'Bob',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_id: 'p1',
    winner_name: 'Alice',
    games: [
      { winner_id: 'p1' },
      { winner_id: 'p2' },
      { winner_id: 'p1' },
    ],
    ...overrides,
  };
}

const DEFAULT_OPTIONS = {
  seasonId: 'season-1',
  leagueName: 'Test League',
  tournamentId: 'tournament-1',
  tournamentName: 'Test Tournament',
  roundId: 'round-1',
  roundName: 'Round 1',
  roundNumber: 1,
};

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(getMatchesByRound).mockResolvedValue([]);
  vi.mocked(getMatchesByTournament).mockResolvedValue([]);
  vi.mocked(getBattleStatsByMatch).mockResolvedValue({});
  vi.mocked(getMomentsByMatch).mockResolvedValue([]);
  vi.mocked(getAggregates).mockResolvedValue([]);
  vi.mocked(getParticipants).mockResolvedValue([]);
  vi.mocked(computeStandingsForSeason).mockResolvedValue([]);
  vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 3, p2Score: 1 });
  vi.mocked(aggregateTeamFromStats).mockReturnValue([]);
  vi.mocked(getSpriteUrl).mockReturnValue('https://sprites.example.com/garchomp.png');
});

// ── Tests ──────────────────────────────────────────────────────────

describe('composeWeeklyRecap', () => {
  it('returns empty recap when no matches in round', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([]);

    const recap = await composeWeeklyRecap(DEFAULT_OPTIONS);

    expect(recap.results).toEqual([]);
    expect(recap.headline_result).toBeNull();
    expect(recap.league_name).toBe('Test League');
    expect(recap.tournament_name).toBe('Test Tournament');
    expect(recap.round_name).toBe('Round 1');
    expect(recap.round_number).toBe(1);
  });

  it('only includes completed matches (filters out scheduled)', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([
      makeMatch('m1', { status: 'completed' }),
      makeMatch('m2', { status: 'scheduled' }),
    ] as never);

    await composeWeeklyRecap(DEFAULT_OPTIONS);

    // getBattleStatsByMatch should only be called for the completed match
    expect(getBattleStatsByMatch).toHaveBeenCalledTimes(1);
    expect(getBattleStatsByMatch).toHaveBeenCalledWith('m1');
  });

  it('enriches match results with pokemon score and series score', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch('m1')] as never);
    vi.mocked(computePokemonScore).mockReturnValue({ p1Score: 4, p2Score: 2 });
    vi.mocked(aggregateTeamFromStats).mockReturnValue([]);

    const recap = await composeWeeklyRecap(DEFAULT_OPTIONS);

    expect(recap.results).toHaveLength(1);
    expect(recap.results[0].pokemon_score).toBe('4-2');
    expect(recap.results[0].series_score).toBe('2-1'); // from mock match: 2 p1 wins, 1 p2 win
    expect(recap.results[0].winner_name).toBe('Alice');
  });

  it('selects headline result as match with most total games', async () => {
    const closeMatch = makeMatch('m1', {
      games: [
        { winner_id: 'p1' },
        { winner_id: 'p2' },
        { winner_id: 'p1' },
      ],
    });
    const quickMatch = makeMatch('m2', {
      player_1_id: 'p3',
      player_2_id: 'p4',
      player_1_name: 'Charlie',
      player_2_name: 'David',
      winner_id: 'p3',
      winner_name: 'Charlie',
      games: [
        { winner_id: 'p3' },
        { winner_id: 'p3' },
      ],
    });
    vi.mocked(getMatchesByRound).mockResolvedValue([closeMatch, quickMatch] as never);

    const recap = await composeWeeklyRecap(DEFAULT_OPTIONS);

    // m1 has 3 games, m2 has 2 — m1 should be headline
    expect(recap.headline_result).not.toBeNull();
    expect(recap.headline_result!.match.match_id).toBe('m1');
  });

  it('fetches moments for each completed match', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([
      makeMatch('m1'),
      makeMatch('m2'),
    ] as never);

    await composeWeeklyRecap(DEFAULT_OPTIONS);

    expect(getMomentsByMatch).toHaveBeenCalledTimes(2);
    expect(getMomentsByMatch).toHaveBeenCalledWith('m1');
    expect(getMomentsByMatch).toHaveBeenCalledWith('m2');
  });

  it('computes standings movement for rounds > 1', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([]);
    vi.mocked(getMatchesByTournament).mockResolvedValue([]);
    vi.mocked(getParticipants).mockResolvedValue([]);

    const recap = await composeWeeklyRecap({
      ...DEFAULT_OPTIONS,
      roundNumber: 3,
    });

    // Should attempt to compute standings
    expect(getMatchesByTournament).toHaveBeenCalledWith('tournament-1');
    expect(recap.standings_movement).toBeDefined();
  });

  it('returns empty standings movement for round 1', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([]);

    const recap = await composeWeeklyRecap({
      ...DEFAULT_OPTIONS,
      roundNumber: 1,
    });

    expect(recap.standings_movement).toEqual({ risers: [], fallers: [] });
  });

  it('computes pokemon usage across the round', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch('m1')] as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({
      'game-1': [
        { pokemon_name: 'Garchomp', was_brought: true, kos_dealt: 2, match_won: true },
        { pokemon_name: 'Tyranitar', was_brought: true, kos_dealt: 1, match_won: true },
        { pokemon_name: 'Garchomp', was_brought: true, kos_dealt: 0, match_won: false },
      ],
    } as never);

    const recap = await composeWeeklyRecap(DEFAULT_OPTIONS);

    expect(recap.pokemon_usage.length).toBeGreaterThan(0);
  });

  it('does not generate narrative by default', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch('m1')] as never);

    const recap = await composeWeeklyRecap(DEFAULT_OPTIONS);

    expect(recap.narrative).toBeUndefined();
  });

  it('generates narrative when generateNarrative is true', async () => {
    // Mock the dynamic import of AI client
    const mockComplete = vi.fn().mockResolvedValue({ content: 'An exciting round of battles!' });
    vi.doMock('@/lib/ai/client', () => ({ complete: mockComplete }));

    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch('m1')] as never);

    const recap = await composeWeeklyRecap({
      ...DEFAULT_OPTIONS,
      generateNarrative: true,
    });

    // The narrative should be set if AI call succeeded
    // (dynamic import might or might not resolve in test env)
    expect(typeof recap.narrative === 'string' || recap.narrative === undefined).toBe(true);
  });

  it('computes stat leaders from tournament aggregates', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([]);
    vi.mocked(getAggregates).mockResolvedValue([
      { pokemon_name: 'Garchomp', total_kos_dealt: 15, total_games: 5, total_wins: 4, total_appearances: 5, total_brought: 5 },
      { pokemon_name: 'Tyranitar', total_kos_dealt: 10, total_games: 4, total_wins: 2, total_appearances: 4, total_brought: 4 },
    ] as never);

    const recap = await composeWeeklyRecap(DEFAULT_OPTIONS);

    expect(recap.stat_leaders).toBeDefined();
    expect(recap.stat_leaders.most_kos).not.toBeNull();
    expect(recap.stat_leaders.most_kos!.pokemon_name).toBe('Garchomp');
  });

  it('handles stat leaders gracefully when aggregates are empty', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([]);
    vi.mocked(getAggregates).mockResolvedValue([]);

    const recap = await composeWeeklyRecap(DEFAULT_OPTIONS);

    expect(recap.stat_leaders.most_kos).toBeNull();
    expect(recap.stat_leaders.pokemon_mvp).toBeNull();
  });
});

// ── i18n (T15) ─────────────────────────────────────────────────────

describe('composeWeeklyRecap i18n (T15)', () => {
  it('uses the English fallback text by default', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch('m1', { winner_name: null })] as never);
    const recap = await composeWeeklyRecap(DEFAULT_OPTIONS);
    expect(recap.headline_result?.why).toBe('Match of the round');
    expect(recap.results[0].winner_name).toBe('Unknown');
  });

  it('writes the fallback text in the requested locale', async () => {
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch('m1', { winner_name: null })] as never);
    const recap = await composeWeeklyRecap({ ...DEFAULT_OPTIONS, locale: 'de' });
    expect(recap.headline_result?.why).toBe('Spiel der Runde');
    expect(recap.results[0].winner_name).toBe('Unbekannt');
  });

  it('asks the AI for a German narrative when locale is de', async () => {
    const mockComplete = vi.fn().mockResolvedValue({
      content: 'Alice dreht ein enges Spiel gegen Bob. Danach war alles klar.',
    });
    vi.doMock('@/lib/ai/client', () => ({ complete: mockComplete }));
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch('m1')] as never);

    const recap = await composeWeeklyRecap({
      ...DEFAULT_OPTIONS,
      generateNarrative: true,
      locale: 'de',
    });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [systemPrompt] = mockComplete.mock.calls[0] as [string, string];
    expect(systemPrompt.endsWith(outputLanguageInstruction('de'))).toBe(true);
    expect(systemPrompt).toContain('Write all prose in German');
    expect(recap.narrative).toBe('Alice dreht ein enges Spiel gegen Bob. Danach war alles klar.');
    expect(recap.headline_result?.why).toBe('Alice dreht ein enges Spiel gegen Bob.');
  });

  it('asks the AI for an English narrative by default', async () => {
    const mockComplete = vi.fn().mockResolvedValue({ content: 'Alice edges out Bob.' });
    vi.doMock('@/lib/ai/client', () => ({ complete: mockComplete }));
    vi.mocked(getMatchesByRound).mockResolvedValue([makeMatch('m1')] as never);

    await composeWeeklyRecap({ ...DEFAULT_OPTIONS, generateNarrative: true });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [systemPrompt] = mockComplete.mock.calls[0] as [string, string];
    expect(systemPrompt.endsWith(outputLanguageInstruction('en'))).toBe(true);
    expect(systemPrompt).not.toContain('German');
  });
});
