import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlayerProfileContent } from '@/types/tournament-report';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/games', () => ({
  getPlayerBattleStats: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAllTimePlayerAggregates: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getCompletedMatchRecords: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(),
}));
vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(),
}));
vi.mock('@/lib/tournament/scoring-byes', () => ({
  loadScoringByes: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { playerProfileDefinition } from '../player-profile';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getPlayerBattleStats } from '@/lib/supabase/queries/games';
import { getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { loadScoringByes } from '@/lib/tournament/scoring-byes';

const mockGetPlayerById = vi.mocked(getPlayerById);
const mockGetBattleStats = vi.mocked(getPlayerBattleStats);
const mockGetAggregates = vi.mocked(getAllTimePlayerAggregates);
const mockGetMatchRecords = vi.mocked(getCompletedMatchRecords);
const mockGetTournament = vi.mocked(getTournamentById);
const mockGetParticipants = vi.mocked(getParticipants);
const mockGetSeasonParticipants = vi.mocked(getSeasonParticipants);
const mockComputeStandings = vi.mocked(computeStandingsForSeason);
const mockLoadByes = vi.mocked(loadScoringByes);

// ─── Fixtures ──────────────────────────────────────────────────────

const PLAYER_ID = 'player-1';
const TOURNAMENT_ID = 'tourney-1';
const ROUND_ID = 'round-1';

function setupMocks() {
  mockGetPlayerById.mockResolvedValue({ id: PLAYER_ID, name: 'Ash' } as never);
  mockGetTournament.mockResolvedValue({
    id: TOURNAMENT_ID, name: 'Kanto League', season_id: 'season-1',
  } as never);
  mockGetMatchRecords.mockResolvedValue([
    { player_1_id: PLAYER_ID, player_2_id: 'player-2', winner_id: PLAYER_ID },
    { player_1_id: 'player-2', player_2_id: PLAYER_ID, winner_id: 'player-2' },
  ] as never);
  mockGetBattleStats.mockResolvedValue([] as never);
  mockGetAggregates.mockResolvedValue([
    { pokemon_name: 'Pikachu', total_brought: 5, total_kos_dealt: 10 },
    { pokemon_name: 'Charizard', total_brought: 3, total_kos_dealt: 6 },
  ] as never);
  mockGetParticipants.mockResolvedValue([
    { id: PLAYER_ID, name: 'Ash', avatar_url: null },
    { id: 'player-2', name: 'Gary', avatar_url: null },
  ] as never);
  mockGetSeasonParticipants.mockResolvedValue([
    { id: PLAYER_ID, name: 'Ash', gym_type: 'Electric' },
  ] as never);
  mockLoadByes.mockResolvedValue([]);
  mockComputeStandings.mockResolvedValue([
    { player_id: PLAYER_ID, player_name: 'Ash', wins: 1, losses: 1, draws: 0, points: 3, kill_differential: 2 },
    { player_id: 'player-2', player_name: 'Gary', wins: 1, losses: 1, draws: 0, points: 3, kill_differential: -2 },
  ] as never);
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('playerProfileDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('has correct type', () => {
    expect(playerProfileDefinition.type).toBe('player_profile');
  });

  describe('buildFactPack', () => {
    it('throws if playerId is missing', async () => {
      await expect(
        playerProfileDefinition.buildFactPack({ tournamentId: TOURNAMENT_ID, roundId: ROUND_ID })
      ).rejects.toThrow('playerId is required');
    });

    it('throws if player not found', async () => {
      mockGetPlayerById.mockResolvedValue(null as never);
      await expect(
        playerProfileDefinition.buildFactPack({ tournamentId: TOURNAMENT_ID, roundId: ROUND_ID, playerId: PLAYER_ID })
      ).rejects.toThrow('Player player-1 not found');
    });

    it('throws if tournament not found', async () => {
      mockGetTournament.mockResolvedValue(null as never);
      await expect(
        playerProfileDefinition.buildFactPack({ tournamentId: TOURNAMENT_ID, roundId: ROUND_ID, playerId: PLAYER_ID })
      ).rejects.toThrow('Tournament tourney-1 not found');
    });

    it('builds fact pack successfully', async () => {
      const fp = await playerProfileDefinition.buildFactPack({
        tournamentId: TOURNAMENT_ID, roundId: ROUND_ID, playerId: PLAYER_ID,
      });

      const factPack = fp as Record<string, unknown>;
      expect(factPack.playerName).toBe('Ash');
      expect(factPack.gymType).toBe('Electric');
      expect(factPack.tournamentName).toBe('Kanto League');
      expect((factPack.signaturePokemon as Array<unknown>).length).toBe(2);
      expect((factPack.validPlayerNames as Array<unknown>)).toContain('Ash');
    });

    it('counts the byes of the standings as bye wins of the player and scores them in the standings', async () => {
      const byes = [{ player_id: PLAYER_ID, round_number: 1 }, { player_id: 'player-2', round_number: 2 }];
      mockLoadByes.mockResolvedValue(byes);

      const fp = await playerProfileDefinition.buildFactPack({
        tournamentId: TOURNAMENT_ID, roundId: ROUND_ID, playerId: PLAYER_ID,
      });

      expect((fp as Record<string, unknown>).seasonByeWins).toBe(1);
      expect(mockComputeStandings.mock.calls[0][5]).toMatchObject({ byes });
    });

    it('has no bye wins when the standings hold no byes', async () => {
      const fp = await playerProfileDefinition.buildFactPack({
        tournamentId: TOURNAMENT_ID, roundId: ROUND_ID, playerId: PLAYER_ID,
      });

      expect((fp as Record<string, unknown>).seasonByeWins).toBe(0);
    });

    it('handles tournament without season_id', async () => {
      mockGetTournament.mockResolvedValue({
        id: TOURNAMENT_ID, name: 'Kanto League', season_id: null,
      } as never);

      const fp = await playerProfileDefinition.buildFactPack({
        tournamentId: TOURNAMENT_ID, roundId: ROUND_ID, playerId: PLAYER_ID,
      });

      expect((fp as Record<string, unknown>).gymType).toBeNull();
    });
  });

  describe('getPromptTasks', () => {
    it('returns single task for single mode', () => {
      const factPack = {
        playerName: 'Ash', gymType: 'Electric', tournamentName: 'Kanto',
        seasonRecord: { wins: 3, losses: 1, draws: 0, points: 9, final_rank: 1, kd: 5 },
        signaturePokemon: [{ pokemonName: 'Pikachu', timesUsed: 5, totalKos: 10 }],
        notableWins: [{ opponentName: 'Gary', score: 'W' }],
        totalMatches: 4,
      };

      const tasks = playerProfileDefinition.getPromptTasks(factPack, 'single');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('single_player_profile');
    });

    it('returns decomposed tasks for decomposed mode', () => {
      const factPack = {
        playerName: 'Ash', gymType: null, tournamentName: 'Kanto',
        seasonRecord: { wins: 2, losses: 2, draws: 1, points: 7, final_rank: 3, kd: -1 },
        signaturePokemon: [{ pokemonName: 'Pikachu', timesUsed: 5, totalKos: 10 }],
        notableWins: [],
        totalMatches: 5,
      };

      const tasks = playerProfileDefinition.getPromptTasks(factPack, 'decomposed');
      expect(tasks.length).toBe(4);
      expect(tasks.map((t) => t.id)).toEqual([
        'profile_headline', 'signature_analysis', 'team_evolution', 'profile_narrative',
      ]);
      // Stage 1 and 2 tasks
      expect(tasks.filter((t) => t.stage === 1)).toHaveLength(3);
      expect(tasks.filter((t) => t.stage === 2)).toHaveLength(1);
    });

    it('says that bye wins are wins without a match', () => {
      const factPack = {
        playerName: 'Ash', gymType: null, tournamentName: 'Swiss Open',
        seasonRecord: { wins: 3, losses: 1, draws: 0, points: 9, final_rank: 2, kd: 3 },
        seasonByeWins: 1,
        signaturePokemon: [], notableWins: [], totalMatches: 3,
      };

      for (const mode of ['single', 'decomposed'] as const) {
        const prompts = playerProfileDefinition.getPromptTasks(factPack, mode).map((t) => t.userPrompt).join('\n');
        expect(prompts).toContain('3W-1L, incl. 1 bye win without a match');
      }
    });

    it('leaves the record unannotated without byes', () => {
      const factPack = {
        playerName: 'Ash', gymType: null, tournamentName: 'Kanto',
        seasonRecord: { wins: 3, losses: 1, draws: 0, points: 9, final_rank: 2, kd: 3 },
        seasonByeWins: 0,
        signaturePokemon: [], notableWins: [], totalMatches: 4,
      };

      const prompts = playerProfileDefinition.getPromptTasks(factPack, 'single').map((t) => t.userPrompt).join('\n');
      expect(prompts).toContain('3W-1L, 9pts');
      expect(prompts).not.toContain('bye');
    });

    it('includes draw in record string when draws > 0', () => {
      const factPack = {
        playerName: 'Ash', gymType: null, tournamentName: 'Kanto',
        seasonRecord: { wins: 2, losses: 1, draws: 1, points: 7, final_rank: 2, kd: 3 },
        signaturePokemon: [], notableWins: [], totalMatches: 4,
      };

      const tasks = playerProfileDefinition.getPromptTasks(factPack, 'single');
      expect(tasks[0].userPrompt).toContain('2W-1L-1D');
    });
  });

  describe('assemble', () => {
    const factPack = {
      playerName: 'Ash',
      seasonRecord: { wins: 3, losses: 1, draws: 0, points: 9, final_rank: 1, kd: 5 },
      signaturePokemon: [
        { pokemonName: 'Pikachu', timesUsed: 5, totalKos: 10 },
      ],
      notableWins: [{ opponentName: 'Gary', score: 'W' }],
    };

    it('assembles decomposed outputs', () => {
      const outputs = new Map([
        ['profile_headline', 'Ash dominates the competition'],
        ['profile_narrative', 'A stellar season for Ash.'],
        ['team_evolution', 'Ash refined his team over time.'],
        ['signature_analysis', '[{"pokemon_name":"Pikachu","analysis":"Electric powerhouse"}]'],
      ]);

      const content = playerProfileDefinition.assemble(outputs, factPack) as PlayerProfileContent;
      expect(content.headline).toBe('Ash dominates the competition');
      expect(content.narrative).toBe('A stellar season for Ash.');
      expect(content.team_evolution).toBe('Ash refined his team over time.');
      expect(content.signature_pokemon[0].analysis).toBe('Electric powerhouse');
    });

    it('assembles single mode JSON output', () => {
      const singleJson = JSON.stringify({
        headline: 'Single headline',
        narrative: 'Single narrative',
        signature_pokemon: [{ pokemon_name: 'Pikachu', analysis: 'Great' }],
        notable_wins: [{ context: 'Close match' }],
        team_evolution: 'Evolved well',
      });
      const outputs = new Map([['single_player_profile', singleJson]]);

      const content = playerProfileDefinition.assemble(outputs, factPack) as PlayerProfileContent;
      expect(content.headline).toBe('Single headline');
      expect(content.narrative).toBe('Single narrative');
      expect(content.team_evolution).toBe('Evolved well');
    });

    it('handles malformed single JSON gracefully', () => {
      const outputs = new Map([['single_player_profile', 'not valid json']]);

      const content = playerProfileDefinition.assemble(outputs, factPack) as PlayerProfileContent;
      // Falls through to decomposed assembly with defaults
      expect(content.headline).toContain("Ash's Season");
    });

    it('falls back to server data when signature_analysis is invalid', () => {
      const outputs = new Map([
        ['profile_headline', 'Title'],
        ['signature_analysis', 'not json'],
      ]);

      const content = playerProfileDefinition.assemble(outputs, factPack) as PlayerProfileContent;
      expect(content.signature_pokemon[0].pokemon_name).toBe('Pikachu');
      expect(content.signature_pokemon[0].times_used).toBe(5);
      expect(content.signature_pokemon[0].analysis).toBe('');
    });

    it('strips think tags from single mode output', () => {
      const singleJson = `<think>reasoning here</think>{"headline":"Clean","narrative":"Text","team_evolution":"Evo"}`;
      const outputs = new Map([['single_player_profile', singleJson]]);

      const content = playerProfileDefinition.assemble(outputs, factPack) as PlayerProfileContent;
      expect(content.headline).toBe('Clean');
    });
  });

  describe('validate', () => {
    it('returns valid when player name is mentioned', () => {
      const factPack = { playerName: 'Ash', validPlayerNames: ['Ash'], validPokemonNames: [] };
      const result = playerProfileDefinition.validate('task1', 'Ash had a great season.', factPack);
      expect(result.valid).toBe(true);
    });

    it('warns when player name is not mentioned', () => {
      const factPack = { playerName: 'Ash', validPlayerNames: ['Ash'], validPokemonNames: [] };
      const result = playerProfileDefinition.validate('task1', 'This player had a great season.', factPack);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('wrong_player');
      expect(result.errors[0].severity).toBe('warning');
      // Warnings don't invalidate
      expect(result.valid).toBe(true);
    });

    it('skips check for empty text', () => {
      const factPack = { playerName: 'Ash' };
      const result = playerProfileDefinition.validate('task1', '', factPack);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
