import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  getH2HBetweenPlayers: vi.fn(),
  getMatchesByPlayer: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));
vi.mock('@/lib/match/aggregation', () => ({
  resolveActualTeam: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRatingsBatch: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignaturesBatch: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/streaks', () => ({
  getPlayerStreaks: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(),
  getTotalGamesInScope: vi.fn(),
  getPlayerAggregatesForPokemon: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
}));
vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(),
}));
vi.mock('@/lib/pkmn/dex', () => ({
  getBaseStats: vi.fn(),
}));
vi.mock('@/lib/pkmn/sprites', () => ({
  getSpriteUrl: vi.fn().mockReturnValue('/sprite.png'),
  getItemSpriteUrl: vi.fn().mockReturnValue('/item.png'),
}));
vi.mock('@/lib/pkmn/speed-calc', () => ({
  calcSpeed: vi.fn().mockReturnValue(100),
}));
vi.mock('@/lib/pkmn/archetype', () => ({
  classifyTeam: vi.fn().mockReturnValue('balance'),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { fetchCasterData } from '../caster-data';
import { getMatchById, getH2HBetweenPlayers, getMatchesByPlayer, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getPlayerSignaturesBatch } from '@/lib/supabase/queries/signatures';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getAggregates, getTotalGamesInScope, getPlayerAggregatesForPokemon } from '@/lib/supabase/queries/aggregates';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { getBaseStats } from '@/lib/pkmn/dex';

const mockGetMatch = vi.mocked(getMatchById);
const mockGetH2H = vi.mocked(getH2HBetweenPlayers);
const mockGetMatchesByPlayer = vi.mocked(getMatchesByPlayer);
const mockGetMatchRecords = vi.mocked(getCompletedMatchRecords);
const mockGetTeam = vi.mocked(getPlayerTeamForTournament);
const mockGetBattleStats = vi.mocked(getBattleStatsByMatch);
const mockGetRatings = vi.mocked(getPlayerRatingsBatch);
const mockGetSigs = vi.mocked(getPlayerSignaturesBatch);
const mockGetStreaks = vi.mocked(getPlayerStreaks);
const mockGetAggregates = vi.mocked(getAggregates);
const mockGetTotalGames = vi.mocked(getTotalGamesInScope);
const mockGetPlayerAggs = vi.mocked(getPlayerAggregatesForPokemon);
const mockGetRound = vi.mocked(getRoundById);
const mockGetTournament = vi.mocked(getTournamentById);
const mockGetRuleset = vi.mocked(getRulesetById);
const mockComputeStandings = vi.mocked(computeStandingsForSeason);
const mockGetBaseStats = vi.mocked(getBaseStats);

// ─── Helpers ───────────────────────────────────────────────────────

function setupMocks() {
  mockGetMatch.mockResolvedValue({
    id: 'm1', player_1_id: 'p1', player_2_id: 'p2',
    player_1_name: 'Ash', player_2_name: 'Gary',
    player_1_avatar_url: null, player_2_avatar_url: null,
    tournament_id: 't1', round_id: 'r1', status: 'in_progress',
  } as never);
  mockGetRound.mockResolvedValue({ id: 'r1', name: 'Round 1', best_of: 3 } as never);
  mockGetTournament.mockResolvedValue({
    id: 't1', name: 'Kanto League', season_id: 's1', ruleset_id: 'rs1', best_of_default: 3,
  } as never);
  mockGetRuleset.mockResolvedValue({ id: 'rs1', base_format: 'gen9ou' } as never);
  mockGetRatings.mockResolvedValue(new Map() as never);
  mockGetSigs.mockResolvedValue(new Map() as never);
  mockGetStreaks.mockResolvedValue(null as never);
  mockGetTeam.mockResolvedValue({
    pokemon: [{ species: 'Pikachu', ability: 'Static', item: 'Light Ball', moves: ['Thunderbolt'], level: 100 }],
  } as never);
  mockGetH2H.mockResolvedValue([] as never);
  mockGetAggregates.mockResolvedValue([] as never);
  mockGetTotalGames.mockResolvedValue(10 as never);
  mockGetMatchRecords.mockResolvedValue([
    { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1' },
  ] as never);
  mockGetMatchesByPlayer.mockResolvedValue([] as never);
  mockGetBattleStats.mockResolvedValue({} as never);
  mockGetPlayerAggs.mockResolvedValue([] as never);
  mockGetBaseStats.mockReturnValue({
    types: ['Electric'],
    baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
  } as never);
  mockComputeStandings.mockResolvedValue([
    { player_id: 'p1', player_name: 'Ash', wins: 1, losses: 0, points: 3, kill_differential: 2 },
  ] as never);
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('fetchCasterData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('returns null when match not found', async () => {
    mockGetMatch.mockResolvedValue(null as never);
    const result = await fetchCasterData('m1');
    expect(result).toBeNull();
  });

  it('returns full caster data for a valid match', async () => {
    const result = await fetchCasterData('m1');

    expect(result).not.toBeNull();
    expect(result!.matchId).toBe('m1');
    expect(result!.player1.name).toBe('Ash');
    expect(result!.player2.name).toBe('Gary');
    expect(result!.format).toBe('gen9ou');
    expect(result!.generation).toBe(9);
    expect(result!.bestOf).toBe(3);
  });

  it('enriches pokemon with base stats and speed tiers', async () => {
    const result = await fetchCasterData('m1');

    expect(result!.player1.pokemon.length).toBeGreaterThan(0);
    const pokemon = result!.player1.pokemon[0];
    expect(pokemon.species).toBe('Pikachu');
    expect(pokemon.types).toEqual(['Electric']);
    expect(pokemon.spriteUrl).toBe('/sprite.png');
    expect(pokemon.speedTiers).toBeDefined();
  });

  it('builds H2H data from match history', async () => {
    mockGetH2H.mockResolvedValue([
      { id: 'h1', winner_id: 'p1', date_played: '2024-01-01', created_at: '2024-01-01' },
      { id: 'h2', winner_id: 'p2', date_played: '2024-02-01', created_at: '2024-02-01' },
    ] as never);

    const result = await fetchCasterData('m1');

    expect(result!.h2h.player1Wins).toBe(1);
    expect(result!.h2h.player2Wins).toBe(1);
    expect(result!.h2h.pastMatches).toHaveLength(2);
  });

  it('builds player records from match records', async () => {
    mockGetMatchRecords.mockResolvedValue([
      { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1' },
      { player_1_id: 'p1', player_2_id: 'p3', winner_id: 'p3' },
      { player_1_id: 'p2', player_2_id: 'p1', winner_id: null },
    ] as never);

    const result = await fetchCasterData('m1');

    expect(result!.player1.record).toEqual({ wins: 1, losses: 1, draws: 1 });
  });

  it('handles streak data', async () => {
    mockGetStreaks.mockResolvedValueOnce({ current_win_streak: 3, current_loss_streak: 0 } as never);
    mockGetStreaks.mockResolvedValueOnce({ current_win_streak: 0, current_loss_streak: 2 } as never);

    const result = await fetchCasterData('m1');

    expect(result!.player1.streak).toEqual({ type: 'win', count: 3 });
    expect(result!.player2.streak).toEqual({ type: 'loss', count: 2 });
  });

  it('handles null streaks', async () => {
    mockGetStreaks.mockResolvedValue(null as never);

    const result = await fetchCasterData('m1');
    expect(result!.player1.streak).toEqual({ type: null, count: 0 });
  });

  it('extracts generation from format string', async () => {
    mockGetRuleset.mockResolvedValue({ id: 'rs1', base_format: 'gen4ou' } as never);

    const result = await fetchCasterData('m1');
    expect(result!.generation).toBe(4);
  });

  it('defaults to gen 9 when format has no gen prefix', async () => {
    mockGetRuleset.mockResolvedValue({ id: 'rs1', base_format: 'custom' } as never);

    const result = await fetchCasterData('m1');
    expect(result!.generation).toBe(9);
  });

  it('computes standings when match records exist', async () => {
    mockGetMatchesByPlayer.mockResolvedValue([
      { id: 'm2', player_1_id: 'p1', player_2_id: 'p3', player_1_name: 'Ash', player_2_name: 'Brock', status: 'completed' },
    ] as never);

    const result = await fetchCasterData('m1');
    expect(result!.standings).not.toBeNull();
  });

  it('sets standings to null when no match records', async () => {
    mockGetMatchRecords.mockResolvedValue([] as never);

    const result = await fetchCasterData('m1');
    expect(result!.standings).toBeNull();
  });

  it('handles rating data', async () => {
    const ratingMap = new Map([
      ['p1', { rating: 1650, rd: 200 }],
    ]);
    mockGetRatings.mockResolvedValue(ratingMap as never);

    const result = await fetchCasterData('m1');
    expect(result!.player1.rating).toBe(1650);
    expect(result!.player2.rating).toBeNull();
  });

  it('handles missing tournament gracefully', async () => {
    mockGetMatch.mockResolvedValue({
      id: 'm1', player_1_id: 'p1', player_2_id: 'p2',
      player_1_name: 'Ash', player_2_name: 'Gary',
      player_1_avatar_url: null, player_2_avatar_url: null,
      tournament_id: null, round_id: 'r1', status: 'in_progress',
    } as never);

    const result = await fetchCasterData('m1');
    expect(result).not.toBeNull();
    expect(result!.tournamentId).toBeNull();
  });
});
