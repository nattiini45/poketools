import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SeasonSummaryContent } from '@/types/tournament-report';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getSeasonParticipants: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  getCompletedMatchRecords: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(),
  getTotalGamesInScope: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));
vi.mock('@/lib/tournament/season-standings', () => ({
  computeStandingsForSeason: vi.fn(),
}));
vi.mock('@/lib/tournament/scoring-byes', () => ({
  loadScoringByes: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { seasonSummaryDefinition } from '../season-summary';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getAggregates, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { loadScoringByes } from '@/lib/tournament/scoring-byes';

const mockGetSeasonById = vi.mocked(getSeasonById);
const mockGetSeasonParticipants = vi.mocked(getSeasonParticipants);
const mockGetMatchRecords = vi.mocked(getCompletedMatchRecords);
const mockGetAggregates = vi.mocked(getAggregates);
const mockGetTotalGames = vi.mocked(getTotalGamesInScope);
const mockGetTournament = vi.mocked(getTournamentById);
const mockComputeStandings = vi.mocked(computeStandingsForSeason);
const mockLoadByes = vi.mocked(loadScoringByes);

// ─── Fixtures ──────────────────────────────────────────────────────

function setupMocks() {
  mockGetTournament.mockResolvedValue({
    id: 't1', name: 'Season 1', season_id: 's1', ruleset_id: 'r1',
  } as never);
  mockGetSeasonById.mockResolvedValue({
    id: 's1', name: 'Kanto Season 1', format_type: 'gen9ou',
  } as never);
  mockGetSeasonParticipants.mockResolvedValue([
    { id: 'p1', name: 'Ash', gym_type: 'Electric' },
    { id: 'p2', name: 'Gary', gym_type: 'Ground' },
  ] as never);
  mockGetMatchRecords.mockResolvedValue([
    { player_1_id: 'p1', player_2_id: 'p2', winner_id: 'p1' },
  ] as never);
  mockGetAggregates.mockResolvedValue([
    { pokemon_name: 'Pikachu', total_brought: 10, total_kos_dealt: 15, total_games: 10, total_wins: 7 },
  ] as never);
  mockGetTotalGames.mockResolvedValue(10 as never);
  mockLoadByes.mockResolvedValue([]);
  mockComputeStandings.mockResolvedValue([
    { player_id: 'p1', player_name: 'Ash', wins: 4, losses: 1, draws: 0, points: 12, kill_differential: 8, gym_type: 'Electric' },
    { player_id: 'p2', player_name: 'Gary', wins: 1, losses: 4, draws: 0, points: 3, kill_differential: -8, gym_type: 'Ground' },
  ] as never);
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('seasonSummaryDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('has correct type', () => {
    expect(seasonSummaryDefinition.type).toBe('season_summary');
  });

  describe('buildFactPack', () => {
    it('throws if tournament has no season', async () => {
      mockGetTournament.mockResolvedValue({ id: 't1', season_id: null } as never);
      await expect(
        seasonSummaryDefinition.buildFactPack({ tournamentId: 't1', roundId: 'r1' })
      ).rejects.toThrow('Tournament has no season');
    });

    it('throws if season not found', async () => {
      mockGetSeasonById.mockResolvedValue(null as never);
      await expect(
        seasonSummaryDefinition.buildFactPack({ tournamentId: 't1', roundId: 'r1' })
      ).rejects.toThrow('Season s1 not found');
    });

    it('builds fact pack successfully', async () => {
      const fp = await seasonSummaryDefinition.buildFactPack({ tournamentId: 't1', roundId: 'r1' });
      const factPack = fp as Record<string, unknown>;
      expect(factPack.seasonName).toBe('Kanto Season 1');
      expect(factPack.totalGames).toBe(10);
      expect((factPack.finalStandings as Array<unknown>).length).toBe(2);
      expect((factPack.seasonMvp as Record<string, unknown>).player_name).toBe('Ash');
    });
  });

  describe('buildFactPack with Swiss byes', () => {
    const params = { tournamentId: 't1', roundId: 'r1' };

    it('says how many wins of a record are byes, in the standings and in the champion line', async () => {
      mockLoadByes.mockResolvedValue([
        { player_id: 'p1', round_number: 1 },
        { player_id: 'p1', round_number: 3 },
      ]);

      const fp = (await seasonSummaryDefinition.buildFactPack(params)) as {
        finalStandings: { player_id: string; record: string }[];
        seasonMvp: { reason: string };
      };

      expect(fp.finalStandings.find((s) => s.player_id === 'p1')?.record).toBe(
        '4W-1L, incl. 2 bye wins without a match',
      );
      expect(fp.finalStandings.find((s) => s.player_id === 'p2')?.record).toBe('1W-4L');
      expect(fp.seasonMvp.reason).toContain('(4W-1L, incl. 2 bye wins without a match)');
      expect(mockComputeStandings.mock.calls[0][5]).toMatchObject({
        byes: [
          { player_id: 'p1', round_number: 1 },
          { player_id: 'p1', round_number: 3 },
        ],
      });
    });

    it('leaves every record unannotated when the standings hold no byes', async () => {
      const fp = (await seasonSummaryDefinition.buildFactPack(params)) as {
        finalStandings: { record: string }[];
        seasonMvp: { reason: string };
      };

      expect(fp.finalStandings.map((s) => s.record)).toEqual(['4W-1L', '1W-4L']);
      expect(fp.seasonMvp.reason).toContain('(4W-1L)');
      expect(JSON.stringify(fp)).not.toContain('bye');
    });
  });

  describe('getPromptTasks', () => {
    it('returns single task for single mode', () => {
      const fp = {
        seasonName: 'Kanto', format: 'gen9ou', totalGames: 10,
        finalStandings: [{ rank: 1, player_name: 'Ash', points: 12, record: '4W-1L', kd: '+8', gymType: 'Electric' }],
        topPokemon: [{ pokemonName: 'Pikachu', appearances: 10, kos: 15, winRate: 70 }],
        seasonMvp: { player_name: 'Ash', player_id: 'p1', reason: '#1 with 12pts' },
      };

      const tasks = seasonSummaryDefinition.getPromptTasks(fp, 'single');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('single_season_summary');
    });

    it('returns decomposed tasks for decomposed mode', () => {
      const fp = {
        seasonName: 'Kanto', format: 'gen9ou', totalGames: 10,
        finalStandings: [{ rank: 1, player_name: 'Ash', points: 12, record: '4W-1L', kd: '+8', gymType: null }],
        topPokemon: [{ pokemonName: 'Pikachu', appearances: 10, kos: 15, winRate: 70 }],
        seasonMvp: { player_name: 'Ash', player_id: 'p1', reason: '#1' },
      };

      const tasks = seasonSummaryDefinition.getPromptTasks(fp, 'decomposed');
      expect(tasks.length).toBe(4);
      expect(tasks.map((t) => t.id)).toEqual([
        'season_headline', 'notable_moments', 'meta_evolution', 'season_narrative',
      ]);
    });
  });

  describe('assemble', () => {
    const factPack = {
      seasonName: 'Kanto',
      finalStandings: [{ rank: 1, player_name: 'Ash', player_id: 'p1', points: 12, record: '4W-1L', kd: '+8' }],
      seasonMvp: { player_name: 'Ash', player_id: 'p1', reason: '#1 with 12pts' },
    };

    it('assembles decomposed outputs', () => {
      const outputs = new Map([
        ['season_headline', 'Ash crowned champion'],
        ['season_narrative', 'A dominant season.'],
        ['notable_moments', '["Ash swept Gary","Pikachu led the KO charts"]'],
        ['meta_evolution', 'Electric types dominated.'],
      ]);

      const content = seasonSummaryDefinition.assemble(outputs, factPack) as SeasonSummaryContent;
      expect(content.headline).toBe('Ash crowned champion');
      expect(content.narrative).toBe('A dominant season.');
      expect(content.notable_moments).toEqual(['Ash swept Gary', 'Pikachu led the KO charts']);
      expect(content.meta_evolution).toBe('Electric types dominated.');
    });

    it('assembles single mode JSON output', () => {
      const singleJson = JSON.stringify({
        headline: 'Single headline',
        narrative: 'Single narrative',
        notable_moments: ['Moment 1'],
        meta_evolution: 'Meta evolved',
      });
      const outputs = new Map([['single_season_summary', singleJson]]);

      const content = seasonSummaryDefinition.assemble(outputs, factPack) as SeasonSummaryContent;
      expect(content.headline).toBe('Single headline');
      expect(content.notable_moments).toEqual(['Moment 1']);
    });

    it('handles malformed single JSON gracefully', () => {
      const outputs = new Map([['single_season_summary', 'not json']]);
      const content = seasonSummaryDefinition.assemble(outputs, factPack) as SeasonSummaryContent;
      expect(content.headline).toContain('Season Wrap-Up');
    });

    it('strips think tags and code fences from single mode', () => {
      const singleJson = '<think>reasoning</think>```json\n{"headline":"Clean","narrative":"Text","notable_moments":[],"meta_evolution":"Meta"}\n```';
      const outputs = new Map([['single_season_summary', singleJson]]);

      const content = seasonSummaryDefinition.assemble(outputs, factPack) as SeasonSummaryContent;
      expect(content.headline).toBe('Clean');
    });

    it('parses notable_moments as newline-separated text when JSON is malformed', () => {
      // Must contain '[' so it attempts to extract an array, but the slice must fail to parse
      const outputs = new Map([
        ['notable_moments', '[malformed json here'],
        ['season_headline', 'Title'],
      ]);

      const content = seasonSummaryDefinition.assemble(outputs, factPack) as SeasonSummaryContent;
      // Falls back to newline split (one non-empty line)
      expect(content.notable_moments.length).toBe(1);
      expect(content.notable_moments[0]).toContain('malformed');
    });
  });

  describe('validate', () => {
    it('returns valid when points match standings', () => {
      const factPack = {
        finalStandings: [{ points: 12 }, { points: 3 }],
      };
      const result = seasonSummaryDefinition.validate('task1', 'Ash finished with 12 points.', factPack);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('warns about unrecognized point values', () => {
      const factPack = {
        finalStandings: [{ points: 12 }],
      };
      const result = seasonSummaryDefinition.validate('task1', 'Ash had 99 points this season.', factPack);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].type).toBe('wrong_number');
      // Warnings don't invalidate
      expect(result.valid).toBe(true);
    });

    it('handles text with no point values', () => {
      const factPack = { finalStandings: [{ points: 12 }] };
      const result = seasonSummaryDefinition.validate('task1', 'A great season.', factPack);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
