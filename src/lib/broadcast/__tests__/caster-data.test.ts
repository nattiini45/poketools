import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  getH2HBetweenPlayers: vi.fn(),
  getMatchesByPlayer: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForMatch: vi.fn(),
  getTeamByShareToken: vi.fn(),
  getTeamVisibilityFacts: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => { throw new Error('Unexpected database read'); }),
    rpc: vi.fn(() => { throw new Error('Unexpected database RPC'); }),
  },
}));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({ standaloneMatchAliasExists: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({
  getPhaseMatchById: vi.fn(), getPublicMatchesByPhaseIds: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/league-phases', () => ({
  getPhaseById: vi.fn(), getPublicPhaseStandingsParticipants: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-teams', () => ({ getPlayerPhaseTeamForMatch: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseBattleStatsByMatch: vi.fn() }));
vi.mock('@/lib/league-phase/standings-context', () => ({ loadNativeSeasonStandingsContext: vi.fn() }));
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
  getAggregatesSummary: vi.fn(),
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
vi.mock('@/lib/tournament/season-standings', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tournament/season-standings')>(),
  computeStandingsForSeason: vi.fn(),
}));
vi.mock('@/lib/pkmn/dex', () => ({
  getBaseStats: vi.fn(),
}));
vi.mock('@/lib/pkmn/sprites', () => ({
  getItemSpriteUrl: vi.fn().mockReturnValue('/item.png'),
}));
vi.mock('@/lib/pkmn/sprite-styles', () => ({
  siteSpriteUrl: vi.fn().mockReturnValue('/sprite.png'),
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
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getPlayerSignaturesBatch } from '@/lib/supabase/queries/signatures';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getAggregates, getAggregatesSummary, getTotalGamesInScope, getPlayerAggregatesForPokemon } from '@/lib/supabase/queries/aggregates';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { getBaseStats } from '@/lib/pkmn/dex';
import { readPhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import { standaloneMatchAliasExists } from '@/lib/supabase/queries/phase-route-owners';
import { getPhaseMatchById, getPublicMatchesByPhaseIds } from '@/lib/supabase/queries/phase-matches';
import { getPhaseById, getPublicPhaseStandingsParticipants } from '@/lib/supabase/queries/league-phases';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import { getPlayerPhaseTeamForMatch } from '@/lib/supabase/queries/phase-teams';
import { getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { loadNativeSeasonStandingsContext } from '@/lib/league-phase/standings-context';

const mockGetMatch = vi.mocked(getMatchById);
const mockGetH2H = vi.mocked(getH2HBetweenPlayers);
const mockGetMatchesByPlayer = vi.mocked(getMatchesByPlayer);
const mockGetMatchRecords = vi.mocked(getCompletedMatchRecords);
const mockGetTeam = vi.mocked(getPlayerTeamForMatch);

/** Existing cases look as an admin (sees every roster); H3 cases below use other viewers. */
const ADMIN = { viewerId: 'admin-1', isAdmin: true };
const CREATOR = { viewerId: 'creator-1', isAdmin: false };
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
    id: 'team-x', player_id: 'p1', match_id: null, library_published_at: null,
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
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'false');
    setupMocks();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('returns null when match not found', async () => {
    mockGetMatch.mockResolvedValue(null as never);
    const result = await fetchCasterData('m1', ADMIN);
    expect(result).toBeNull();
  });

  it('rejects when the battle-stats read fails (no silent fallback to planned rosters)', async () => {
    mockGetBattleStats.mockRejectedValue(new Error('battle stats down'));
    await expect(fetchCasterData('m1', ADMIN)).rejects.toThrow('battle stats down');
  });

  it('returns full caster data for a valid match', async () => {
    const result = await fetchCasterData('m1', ADMIN);

    expect(result).not.toBeNull();
    expect(result!.matchId).toBe('m1');
    expect(result!.player1.name).toBe('Ash');
    expect(result!.player2.name).toBe('Gary');
    expect(result!.format).toBe('gen9ou');
    expect(result!.generation).toBe(9);
    expect(result!.bestOf).toBe(3);
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
    expect(getPhaseMatchById).not.toHaveBeenCalled();
    expect(standaloneMatchAliasExists).not.toHaveBeenCalled();
  });

  it('enriches pokemon with base stats and speed tiers', async () => {
    const result = await fetchCasterData('m1', ADMIN);

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

    const result = await fetchCasterData('m1', ADMIN);

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

    const result = await fetchCasterData('m1', ADMIN);

    expect(result!.player1.record).toEqual({ wins: 1, losses: 1, draws: 1 });
  });

  it('handles streak data', async () => {
    mockGetStreaks.mockResolvedValueOnce({ current_win_streak: 3, current_loss_streak: 0 } as never);
    mockGetStreaks.mockResolvedValueOnce({ current_win_streak: 0, current_loss_streak: 2 } as never);

    const result = await fetchCasterData('m1', ADMIN);

    expect(result!.player1.streak).toEqual({ type: 'win', count: 3 });
    expect(result!.player2.streak).toEqual({ type: 'loss', count: 2 });
  });

  it('handles null streaks', async () => {
    mockGetStreaks.mockResolvedValue(null as never);

    const result = await fetchCasterData('m1', ADMIN);
    expect(result!.player1.streak).toEqual({ type: null, count: 0 });
  });

  it('extracts generation from format string', async () => {
    mockGetRuleset.mockResolvedValue({ id: 'rs1', base_format: 'gen4ou' } as never);

    const result = await fetchCasterData('m1', ADMIN);
    expect(result!.generation).toBe(4);
  });

  it('defaults to gen 9 when format has no gen prefix', async () => {
    mockGetRuleset.mockResolvedValue({ id: 'rs1', base_format: 'custom' } as never);

    const result = await fetchCasterData('m1', ADMIN);
    expect(result!.generation).toBe(9);
  });

  it('computes standings when match records exist', async () => {
    mockGetMatchesByPlayer.mockResolvedValue([
      { id: 'm2', player_1_id: 'p1', player_2_id: 'p3', player_1_name: 'Ash', player_2_name: 'Brock', status: 'completed' },
    ] as never);

    const result = await fetchCasterData('m1', ADMIN);
    expect(result!.standings).not.toBeNull();
  });

  it('sets standings to null when no match records', async () => {
    mockGetMatchRecords.mockResolvedValue([] as never);

    const result = await fetchCasterData('m1', ADMIN);
    expect(result!.standings).toBeNull();
  });

  it('handles rating data', async () => {
    const ratingMap = new Map([
      ['p1', { rating: 1650, rd: 200 }],
    ]);
    mockGetRatings.mockResolvedValue(ratingMap as never);

    const result = await fetchCasterData('m1', ADMIN);
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

    const result = await fetchCasterData('m1', ADMIN);
    expect(result).not.toBeNull();
    expect(result!.tournamentId).toBeNull();
  });

  // ── H3: spec §7 per match, real viewer ────────────────────────────

  describe('roster visibility (spec §7, per match)', () => {
    it('reads each team for this match', async () => {
      await fetchCasterData('m1', CREATOR);
      expect(mockGetTeam).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'm1', tournament_id: 't1' }));
      expect(mockGetTeam).toHaveBeenCalledWith('p2', expect.objectContaining({ id: 'm1', tournament_id: 't1' }));
    });

    it('gives a creator no rosters while the match is not completed', async () => {
      const result = await fetchCasterData('m1', CREATOR);
      expect(result!.player1.team).toEqual([]);
      expect(result!.player2.team).toEqual([]);
      expect(result!.player1.pokemon).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('Pikachu');
      expect(JSON.stringify(result)).not.toContain('Light Ball');
    });

    it("keeps the owner's own roster for a participant viewer", async () => {
      mockGetTeam.mockImplementation(async (playerId: string) => ({
        id: `team-${playerId}`, player_id: playerId, match_id: null, library_published_at: null,
        pokemon: [{ species: playerId === 'p1' ? 'Pikachu' : 'Eevee', ability: '', item: '', moves: [], level: 100 }],
      }) as never);
      const result = await fetchCasterData('m1', { viewerId: 'p1', isAdmin: false });
      expect(result!.player1.team.map((s) => s.species)).toEqual(['Pikachu']);
      expect(result!.player2.team).toEqual([]);
    });

    it('gives a creator the rosters once the match is completed', async () => {
      mockGetMatch.mockResolvedValue({
        id: 'm1', player_1_id: 'p1', player_2_id: 'p2',
        player_1_name: 'Ash', player_2_name: 'Gary',
        player_1_avatar_url: null, player_2_avatar_url: null,
        tournament_id: 't1', round_id: 'r1', status: 'completed',
      } as never);
      const result = await fetchCasterData('m1', CREATOR);
      expect(result!.player1.team[0].species).toBe('Pikachu');
    });

    it('gives a creator the rosters of an always_public tournament', async () => {
      mockGetTournament.mockResolvedValue({
        id: 't1', name: 'Kanto League', season_id: 's1', ruleset_id: 'rs1', best_of_default: 3,
        team_visibility: 'always_public',
      } as never);
      const result = await fetchCasterData('m1', CREATOR);
      expect(result!.player1.team[0].species).toBe('Pikachu');
    });
  });
});

describe('native caster data', () => {
  const matchId = '55666777-0123-4567-89ab-cdef01234567';
  const phaseId = 'phase-a';
  const match = {
    id: matchId, phase_id: phaseId, round_id: 'round-2', status: 'in_progress',
    player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'Ash', player_2_name: 'Gary',
    player_1_avatar_url: null, player_2_avatar_url: '/trainer.png',
    notes: 'not for the caster', submitter_id: 'private-submitter',
  };
  const phase = {
    id: phaseId, season_id: 'league-a', ruleset_id: 'phase-pin', best_of_default: 3,
    bracket_type: 'swiss', team_visibility: 'hidden_until_match',
  };
  const team = (playerId: string, species: string, published: string | null = null) => ({
    player_id: playerId, match_id: null, library_published_at: published,
    pokemon: [{ species, item: 'Leftovers', ability: 'Static', moves: ['Encore'], level: 50 }],
    share_token: 'not for the caster',
  });
  const rounds = [
    { id: 'round-1', phase_id: phaseId, round_number: 1, name: 'Opening', best_of: 3, bye_player_ids: ['p4'] },
    { id: 'round-2', phase_id: phaseId, round_number: 2, name: 'Swiss 2', best_of: 5, bye_player_ids: [] },
    { id: 'round-3', phase_id: phaseId, round_number: 3, name: 'Swiss 3', best_of: 3, bye_player_ids: [] },
  ];
  const history = [
    { ...match, id: 'prior', round_id: 'round-1', round_number: 1, status: 'completed',
      winner_id: 'p1', date_played: '2026-11-01', created_at: '2026-10-31' },
    { ...match, id: 'draw', round_id: 'round-2', round_number: 2, status: 'completed',
      player_1_id: 'p2', player_2_id: 'p1', winner_id: null, date_played: null, created_at: '2026-11-02' },
    { ...match, id: 'other-pair', round_id: 'round-2', round_number: 2, status: 'completed',
      player_1_id: 'p3', player_2_id: 'p4', winner_id: 'p3' },
    { ...match, id: 'next', round_id: 'round-3', round_number: 3, status: 'scheduled',
      player_2_id: 'p3', player_2_name: 'Brock', created_at: '2026-11-03' },
  ];
  const battleStats = {
    game: [
      { player_id: 'p1', pokemon_name: 'Pikachu', moves_used: ['Thunderbolt'] },
      { player_id: 'p1', pokemon_name: 'Raichu', moves_used: ['Surf'] },
      { player_id: 'p2', pokemon_name: 'Umbreon', moves_used: ['Moonlight'] },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    setupMocks();
    vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
    vi.mocked(readPhaseStorageMode).mockResolvedValue('phase');
    vi.mocked(getPhaseMatchById).mockResolvedValue(match as never);
    vi.mocked(standaloneMatchAliasExists).mockResolvedValue(false);
    vi.mocked(getPhaseById).mockResolvedValue(phase as never);
    vi.mocked(getRoundsByPhase).mockResolvedValue(rounds as never);
    vi.mocked(getPublicMatchesByPhaseIds).mockResolvedValue(new Map([[phaseId, history]]) as never);
    vi.mocked(getPublicPhaseStandingsParticipants).mockResolvedValue(
      [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Gary' }, { id: 'p3', name: 'Brock' }, { id: 'p4', name: 'Misty' }] as never,
    );
    vi.mocked(getRulesetById).mockResolvedValue({ id: 'phase-pin', base_format: 'gen4ou' } as never);
    vi.mocked(getPlayerPhaseTeamForMatch).mockImplementation(async (playerId) =>
      (playerId === 'p1' ? team('p1', 'Pikachu') : team('p2', 'Eevee')) as never);
    vi.mocked(getPhaseBattleStatsByMatch).mockResolvedValue(battleStats as never);
    vi.mocked(getAggregatesSummary).mockResolvedValue([
      { pokemon_name: 'Pikachu', total_appearances: 4, total_led: 1, total_brought: 3, total_games: 2 },
    ] as never);
    vi.mocked(getPlayerAggregatesForPokemon).mockImplementation(async (name, _scope, _phase, playerId) =>
      name === 'Pikachu' && playerId === 'p1'
        ? [{ player_id: 'p1', pokemon_name: 'Pikachu', total_kos_dealt: 7, total_koed: 2 }] as never : []);
    vi.mocked(loadNativeSeasonStandingsContext).mockResolvedValue({ formatType: null });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(['phase', 'frozen_phase'] as const)('uses only native match readers in %s', async (mode) => {
    vi.mocked(readPhaseStorageMode).mockResolvedValue(mode);
    const result = await fetchCasterData(matchId, ADMIN);
    expect(result).toMatchObject({
      matchId, seasonId: 'league-a', tournamentId: null, roundName: 'Swiss 2', bestOf: 5, format: 'gen4ou', generation: 4,
      player1: {
        record: { wins: 1, losses: 0, draws: 1 }, nextMatch: { opponentName: 'Brock', roundName: 'Swiss 3' },
        pokemon: [
          { species: 'Pikachu', usagePct: 40, leadPct: 25, bringPct: 75, koDealt: 7, koReceived: 2 },
          { species: 'Raichu', moves: ['Surf'] },
        ],
      },
      player2: { record: { wins: 0, losses: 1, draws: 1 }, pokemon: [{ species: 'Umbreon', moves: ['Moonlight'] }] },
      h2h: { player1Wins: 1, player2Wins: 0, draws: 1, pastMatches: [
        { matchId: 'prior', roundName: 'Opening', winnerId: 'p1', date: '2026-11-01' },
        { matchId: 'draw', roundName: 'Swiss 2', winnerId: null, date: '2026-11-02' },
      ] },
    });
    expect(result?.player1.team[0]).toMatchObject({ item: 'Leftovers', ability: 'Static', moves: ['Encore'] });
    expect(result?.standings).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: 'p4', wins: 1, losses: 1, points: 1 }),
      expect.objectContaining({ playerId: 'p3', wins: 1, points: 1 }),
    ]));
    expect(JSON.stringify(result)).not.toMatch(/private-submitter|not for the caster|Eevee/);
    expect(getRulesetById).toHaveBeenCalledWith('phase-pin');
    expect(getPhaseById).toHaveBeenCalledWith(phaseId);
    expect(getPublicMatchesByPhaseIds).toHaveBeenCalledWith([phaseId]);
    expect(getPlayerPhaseTeamForMatch).toHaveBeenCalledWith('p2', expect.objectContaining({ id: matchId, phase_id: phaseId }));
    expect(getTotalGamesInScope).toHaveBeenCalledWith('phase', phaseId);
    expect(getAggregatesSummary).toHaveBeenCalledWith('phase', phaseId);
    expect(getPlayerAggregatesForPokemon).toHaveBeenCalledWith('Pikachu', 'phase', phaseId, 'p1');
    for (const reader of [getMatchById, getTournamentById, getRoundById, getMatchesByPlayer, getH2HBetweenPlayers,
      getCompletedMatchRecords, getPlayerTeamForMatch, getBattleStatsByMatch, getAggregates, computeStandingsForSeason,
      standaloneMatchAliasExists]) expect(reader).not.toHaveBeenCalled();
  });

  it('keeps hidden species and their enrichment out of creator and participant views', async () => {
    const creator = await fetchCasterData(matchId, CREATOR);
    for (const player of [creator?.player1, creator?.player2]) {
      expect(player).toMatchObject({ team: [], pokemon: [], archetype: null });
    }
    expect(JSON.stringify(creator)).not.toMatch(/Pikachu|Raichu|Eevee|Umbreon|Moonlight|Leftovers/);
    expect(getPhaseBattleStatsByMatch).not.toHaveBeenCalled();
    expect(getPlayerAggregatesForPokemon).not.toHaveBeenCalled();
    const participant = await fetchCasterData(matchId, { viewerId: 'p1', isAdmin: false });
    expect(participant?.player1.team.map(set => set.species)).toEqual(['Pikachu', 'Raichu']);
    expect(participant?.player2).toMatchObject({ team: [], pokemon: [], archetype: null });
    expect(JSON.stringify(participant)).not.toMatch(/Eevee|Umbreon|Moonlight/);
  });

  it('allows the published planned sets without exposing private battle stats', async () => {
    vi.mocked(getPlayerPhaseTeamForMatch).mockResolvedValueOnce(team('p1', 'Pikachu', '2026-11-01') as never);
    const result = await fetchCasterData(matchId, CREATOR);
    expect(result?.player1.team.map(set => set.species)).toEqual(['Pikachu']);
    expect(JSON.stringify(result)).not.toMatch(/Raichu|Umbreon|Surf|Moonlight/);
    expect(getPhaseBattleStatsByMatch).not.toHaveBeenCalled();
  });

  it.each(['completed', 'always_public'])('shows actual rosters, even without a team row, when %s', async (grant) => {
    if (grant === 'completed') vi.mocked(getPhaseMatchById).mockResolvedValue({ ...match, status: 'completed' } as never);
    else vi.mocked(getPhaseById).mockResolvedValue({ ...phase, team_visibility: grant } as never);
    vi.mocked(getPlayerPhaseTeamForMatch).mockResolvedValueOnce(null);
    const result = await fetchCasterData(matchId, CREATOR);
    expect(result?.player1.team.map(set => set.species)).toEqual(['Pikachu', 'Raichu']);
    expect(result?.player2.team.map(set => set.species)).toEqual(['Umbreon']);
  });

  it('uses visible planned sets when a successful read has no actual stats', async () => {
    vi.mocked(getPhaseBattleStatsByMatch).mockResolvedValue({});
    const result = await fetchCasterData(matchId, ADMIN);
    expect(result?.player1.team.map(set => set.species)).toEqual(['Pikachu']);
    expect(result?.player2.team.map(set => set.species)).toEqual(['Eevee']);
  });

  it('does not turn native query errors into legacy or planned fallbacks', async () => {
    vi.mocked(getPhaseMatchById).mockRejectedValueOnce(new Error('native match read failed'));
    await expect(fetchCasterData(matchId, ADMIN)).rejects.toThrow('native match read failed');
    vi.mocked(getPhaseBattleStatsByMatch).mockRejectedValueOnce(new Error('native battle stats failed'));
    await expect(fetchCasterData(matchId, ADMIN)).rejects.toThrow('native battle stats failed');
    expect(standaloneMatchAliasExists).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it('propagates mode and standalone owner lookup errors', async () => {
    vi.mocked(readPhaseStorageMode).mockRejectedValueOnce(new Error('mode read failed'));
    await expect(fetchCasterData(matchId, ADMIN)).rejects.toThrow('mode read failed');
    expect(getPhaseMatchById).not.toHaveBeenCalled();
    vi.mocked(getPhaseMatchById).mockResolvedValue(null);
    vi.mocked(standaloneMatchAliasExists).mockRejectedValueOnce(new Error('owner read failed'));
    await expect(fetchCasterData(matchId, ADMIN)).rejects.toThrow('owner read failed');
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it('returns not found without switching stores when the actual native phase is missing', async () => {
    vi.mocked(getPhaseById).mockResolvedValue(null);
    expect(await fetchCasterData(matchId, ADMIN)).toBeNull();
    expect(standaloneMatchAliasExists).not.toHaveBeenCalled();
    expect(getMatchById).not.toHaveBeenCalled();
  });

  it.each(['phase', 'frozen_phase'] as const)('allows only positively standalone legacy matches in %s', async (mode) => {
    vi.mocked(readPhaseStorageMode).mockResolvedValue(mode);
    vi.mocked(getPhaseMatchById).mockResolvedValue(null);
    expect(await fetchCasterData(matchId, ADMIN)).toBeNull();
    expect(standaloneMatchAliasExists).toHaveBeenCalledWith(matchId);
    expect(getMatchById).not.toHaveBeenCalled();

    mockGetMatch.mockResolvedValue({ id: matchId, tournament_id: 't1', round_id: 'r1', status: 'scheduled',
      player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'Ash', player_2_name: 'Gary' } as never);
    vi.mocked(standaloneMatchAliasExists).mockResolvedValue(true);
    expect(await fetchCasterData(matchId, ADMIN)).toBeNull();
    expect(getBattleStatsByMatch).not.toHaveBeenCalled();
    expect(getRoundById).not.toHaveBeenCalled();
    mockGetTournament.mockResolvedValue({ id: 't1', season_id: null, ruleset_id: 'rs1' } as never);
    expect(await fetchCasterData(matchId, ADMIN)).toMatchObject({ tournamentId: 't1', seasonId: null });
    expect(getBattleStatsByMatch).toHaveBeenCalledWith(matchId);
    expect(getPhaseBattleStatsByMatch).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'frozen_legacy'] as const)('uses only old match readers in %s', async (mode) => {
    vi.mocked(readPhaseStorageMode).mockResolvedValue(mode);
    expect(await fetchCasterData(matchId, ADMIN)).toMatchObject({ tournamentId: 't1', seasonId: 's1' });
    expect(getMatchById).toHaveBeenCalledWith(matchId);
    expect(getPhaseMatchById).not.toHaveBeenCalled();
    expect(standaloneMatchAliasExists).not.toHaveBeenCalled();
  });
});
