import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MetaReportContent } from '@/types/tournament-report';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(),
  getTotalGamesInScope: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { metaReportDefinition } from '../meta-report';
import { getAggregates, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';

const mockGetAggregates = vi.mocked(getAggregates);
const mockGetTotalGames = vi.mocked(getTotalGamesInScope);
const mockGetTournament = vi.mocked(getTournamentById);
const mockGetRuleset = vi.mocked(getRulesetById);

// ─── Fixtures ──────────────────────────────────────────────────────

function setupMocks() {
  mockGetTournament.mockResolvedValue({
    id: 't1', name: 'Kanto League', ruleset_id: 'r1',
  } as never);
  mockGetRuleset.mockResolvedValue({
    id: 'r1', base_format: 'gen9ou',
  } as never);
  mockGetAggregates.mockResolvedValue([
    { pokemon_name: 'Pikachu', total_brought: 8, total_kos_dealt: 12, total_games: 10, total_wins: 7 },
    { pokemon_name: 'Charizard', total_brought: 6, total_kos_dealt: 9, total_games: 8, total_wins: 5 },
  ] as never);
  mockGetTotalGames.mockResolvedValue(10 as never);
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('metaReportDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('has correct type', () => {
    expect(metaReportDefinition.type).toBe('meta_report');
  });

  describe('buildFactPack', () => {
    it('throws if tournament not found', async () => {
      mockGetTournament.mockResolvedValue(null as never);
      await expect(
        metaReportDefinition.buildFactPack({ tournamentId: 't1', roundId: 'r1' })
      ).rejects.toThrow('Tournament t1 not found');
    });

    it('builds fact pack successfully', async () => {
      const fp = await metaReportDefinition.buildFactPack({ tournamentId: 't1', roundId: 'r1' });
      const factPack = fp as Record<string, unknown>;
      expect(factPack.tournamentName).toBe('Kanto League');
      expect(factPack.format).toBe('gen9ou');
      expect(factPack.totalGames).toBe(10);
      expect((factPack.usageData as Array<unknown>).length).toBe(2);
    });

    it('handles missing ruleset', async () => {
      mockGetTournament.mockResolvedValue({
        id: 't1', name: 'Kanto League', ruleset_id: null,
      } as never);

      const fp = await metaReportDefinition.buildFactPack({ tournamentId: 't1', roundId: 'r1' });
      expect((fp as Record<string, unknown>).format).toBe('unknown');
    });

    it('calculates usage percentages correctly', async () => {
      const fp = await metaReportDefinition.buildFactPack({ tournamentId: 't1', roundId: 'r1' });
      const usageData = (fp as Record<string, unknown>).usageData as Array<Record<string, number>>;
      // Pikachu: 8/10 = 80%
      expect(usageData[0].usagePct).toBe(80);
      // Pikachu win rate: 7/10 = 70%
      expect(usageData[0].winRate).toBe(70);
    });

    it('handles zero total games', async () => {
      mockGetTotalGames.mockResolvedValue(0 as never);
      const fp = await metaReportDefinition.buildFactPack({ tournamentId: 't1', roundId: 'r1' });
      const usageData = (fp as Record<string, unknown>).usageData as Array<Record<string, number>>;
      expect(usageData[0].usagePct).toBe(0);
    });
  });

  describe('getPromptTasks', () => {
    it('returns single task for single mode', () => {
      const fp = {
        tournamentName: 'Kanto', format: 'gen9ou', totalGames: 10,
        usageData: [{ pokemonName: 'Pikachu', usagePct: 80, totalKos: 12, winRate: 70, totalAppearances: 8, totalGames: 10, totalWins: 7 }],
        topPokemon: [],
      };

      const tasks = metaReportDefinition.getPromptTasks(fp, 'single');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('single_meta_report');
    });

    it('returns decomposed tasks for decomposed mode', () => {
      const fp = {
        tournamentName: 'Kanto', format: 'gen9ou', totalGames: 10,
        usageData: [{ pokemonName: 'Pikachu', usagePct: 80, totalKos: 12, winRate: 70, totalAppearances: 8, totalGames: 10, totalWins: 7 }],
        topPokemon: [],
      };

      const tasks = metaReportDefinition.getPromptTasks(fp, 'decomposed');
      expect(tasks.length).toBe(5);
      expect(tasks.map((t) => t.id)).toEqual([
        'meta_headline', 'top_pokemon_analysis', 'type_trends', 'emerging_threats', 'meta_narrative',
      ]);
    });
  });

  describe('assemble', () => {
    const factPack = {
      tournamentName: 'Kanto',
      usageData: [
        { pokemonName: 'Pikachu', usagePct: 80, totalKos: 12, winRate: 70 },
      ],
    };

    it('assembles decomposed outputs', () => {
      const outputs = new Map([
        ['meta_headline', 'Pikachu dominates the meta'],
        ['meta_narrative', 'Electric types run wild.'],
        ['top_pokemon_analysis', '[{"pokemon_name":"Pikachu","role":"Sweeper","analysis":"Dominant"}]'],
        ['type_trends', 'Electric types prevalent.'],
        ['emerging_threats', 'Charizard rising.'],
      ]);

      const content = metaReportDefinition.assemble(outputs, factPack) as MetaReportContent;
      expect(content.headline).toBe('Pikachu dominates the meta');
      expect(content.narrative).toBe('Electric types run wild.');
      expect(content.top_pokemon[0].role).toBe('Sweeper');
      expect(content.type_trends).toBe('Electric types prevalent.');
      expect(content.emerging_threats).toBe('Charizard rising.');
    });

    it('assembles single mode JSON output', () => {
      const singleJson = JSON.stringify({
        headline: 'Single headline',
        narrative: 'Single narrative',
        top_pokemon: [{ pokemon_name: 'Pikachu', role: 'Sweeper', analysis: 'Best' }],
        type_trends: 'Electric dominated',
        emerging_threats: 'Fire types rising',
      });
      const outputs = new Map([['single_meta_report', singleJson]]);

      const content = metaReportDefinition.assemble(outputs, factPack) as MetaReportContent;
      expect(content.headline).toBe('Single headline');
      expect(content.top_pokemon[0].pokemon_name).toBe('Pikachu');
    });

    it('handles malformed single JSON gracefully', () => {
      const outputs = new Map([['single_meta_report', 'not json']]);
      const content = metaReportDefinition.assemble(outputs, factPack) as MetaReportContent;
      expect(content.headline).toContain('Meta Report');
    });

    it('handles malformed top_pokemon_analysis', () => {
      const outputs = new Map([
        ['meta_headline', 'Title'],
        ['top_pokemon_analysis', 'broken json'],
      ]);

      const content = metaReportDefinition.assemble(outputs, factPack) as MetaReportContent;
      expect(content.top_pokemon).toEqual([]);
    });

    it('includes server-computed usage_data', () => {
      const outputs = new Map([['meta_headline', 'Title']]);
      const content = metaReportDefinition.assemble(outputs, factPack) as MetaReportContent;
      expect(content.usage_data[0].pokemon_name).toBe('Pikachu');
      expect(content.usage_data[0].usage_pct).toBe(80);
    });
  });

  describe('validate', () => {
    it('returns valid when percentages match', () => {
      const factPack = {
        usageData: [{ usagePct: 80, winRate: 70 }],
      };
      const result = metaReportDefinition.validate('task1', 'Pikachu had 80% usage with 70% win rate.', factPack);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('warns about unrecognized percentages', () => {
      const factPack = {
        usageData: [{ usagePct: 80, winRate: 70 }],
      };
      const result = metaReportDefinition.validate('task1', 'Pikachu had 95% usage.', factPack);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].type).toBe('wrong_number');
      expect(result.valid).toBe(true);
    });

    it('ignores 0% and values above 100%', () => {
      const factPack = { usageData: [] };
      const result = metaReportDefinition.validate('task1', '0% and 150% are ignored.', factPack);
      expect(result.errors).toHaveLength(0);
    });
  });
});
