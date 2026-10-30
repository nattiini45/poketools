import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('../kale/provider', () => ({
  isKaleConfigured: vi.fn(),
}));

vi.mock('../kale/pipeline', () => ({
  runPipeline: vi.fn(),
}));

// Mock registry import (side-effect-only)
vi.mock('../kale/registry', () => ({}));

vi.mock('@/lib/supabase/queries/tournament-reports', () => ({
  createTournamentReport: vi.fn(),
  updateTournamentReport: vi.fn(),
  getTournamentReport: vi.fn(),
  deleteTournamentReport: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { generateTournamentReportAsync, parseReportResponse } from '../tournament-report-generator';
import { isKaleConfigured } from '../kale/provider';
import { runPipeline } from '../kale/pipeline';
import {
  createTournamentReport,
  updateTournamentReport,
  getTournamentReport,
  deleteTournamentReport,
} from '@/lib/supabase/queries/tournament-reports';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { revalidateMatchPages } from '@/lib/revalidation';

const mockIsConfigured = vi.mocked(isKaleConfigured);
const mockRunPipeline = vi.mocked(runPipeline);
const mockCreateReport = vi.mocked(createTournamentReport);
const mockUpdateReport = vi.mocked(updateTournamentReport);
const mockGetReport = vi.mocked(getTournamentReport);
const mockDeleteReport = vi.mocked(deleteTournamentReport);
const mockGetTournament = vi.mocked(getTournamentById);
const mockGetRound = vi.mocked(getRoundById);
const mockRevalidate = vi.mocked(revalidateMatchPages);

// ─── Tests ─────────────────────────────────────────────────────────

describe('tournament-report-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('generateTournamentReportAsync', () => {
    it('returns early when Kale is not configured', async () => {
      mockIsConfigured.mockReturnValue(false);
      await generateTournamentReportAsync('t1', 'r1', 'round_recap');
      expect(mockGetReport).not.toHaveBeenCalled();
    });

    it('skips if completed report already exists', async () => {
      mockGetReport.mockResolvedValue({ status: 'completed', created_at: new Date().toISOString() } as never);
      await generateTournamentReportAsync('t1', 'r1', 'round_recap');
      expect(mockCreateReport).not.toHaveBeenCalled();
    });

    it('cleans up stale pending report and regenerates', async () => {
      vi.stubEnv('CLAUDE_MODEL', '');
      const staleDate = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min old
      mockGetReport.mockResolvedValue({ status: 'pending', created_at: staleDate } as never);
      mockCreateReport.mockResolvedValue({ id: 'report-1' } as never);
      mockRunPipeline.mockResolvedValue({
        content: { headline: 'Test' },
        promptTokens: 100,
        completionTokens: 200,
        generationTimeMs: 5000,
        validationErrors: [],
        retryCount: 0,
      } as never);
      mockGetTournament.mockResolvedValue({ id: 't1', name: 'League', season_id: 's1' } as never);
      mockGetRound.mockResolvedValue({ id: 'r1', name: 'Round 1' } as never);

      await generateTournamentReportAsync('t1', 'r1', 'meta_report');

      expect(mockDeleteReport).toHaveBeenCalled();
      // The row is labelled with the Claude model that is asked first.
      expect(mockCreateReport).toHaveBeenCalledWith('t1', 'r1', 'meta_report', 'claude-sonnet-5-5');
      expect(mockUpdateReport).toHaveBeenCalledWith('report-1', expect.objectContaining({
        status: 'completed',
      }));
    });

    it('skips recent pending report', async () => {
      const recentDate = new Date().toISOString();
      mockGetReport.mockResolvedValue({ status: 'pending', created_at: recentDate } as never);
      await generateTournamentReportAsync('t1', 'r1', 'round_recap');
      expect(mockCreateReport).not.toHaveBeenCalled();
    });

    it('generates report and revalidates pages', async () => {
      mockGetReport.mockResolvedValue(null as never);
      mockCreateReport.mockResolvedValue({ id: 'report-1' } as never);
      mockRunPipeline.mockResolvedValue({
        content: { headline: 'Test' },
        promptTokens: 100,
        completionTokens: 200,
        generationTimeMs: 5000,
        validationErrors: [],
        retryCount: 0,
      } as never);

      await generateTournamentReportAsync('t1', 'r1', 'player_profile');

      expect(mockUpdateReport).toHaveBeenCalled();
      expect(mockRevalidate).toHaveBeenCalledWith('t1');
    });

    it('stores the model that answered, not the one that was asked', async () => {
      mockGetReport.mockResolvedValue(null as never);
      mockCreateReport.mockResolvedValue({ id: 'report-1' } as never);
      mockRunPipeline.mockResolvedValue({
        content: { headline: 'Test' },
        promptTokens: 100,
        completionTokens: 200,
        generationTimeMs: 5000,
        validationErrors: [],
        retryCount: 0,
        modelUsed: 'claude-haiku-4-5-20251001',
      } as never);

      await generateTournamentReportAsync('t1', 'r1', 'player_profile');

      expect(mockUpdateReport).toHaveBeenCalledWith(
        'report-1',
        expect.objectContaining({ status: 'completed', model_id: 'claude-haiku-4-5-20251001' }),
      );
    });

    it('keeps the requested model label when no task finished (modelUsed unknown)', async () => {
      mockGetReport.mockResolvedValue(null as never);
      mockCreateReport.mockResolvedValue({ id: 'report-1' } as never);
      mockRunPipeline.mockResolvedValue({
        content: { headline: 'Test' },
        promptTokens: 0,
        completionTokens: 0,
        generationTimeMs: 5000,
        validationErrors: [],
        retryCount: 0,
        modelUsed: 'unknown',
      } as never);

      await generateTournamentReportAsync('t1', 'r1', 'player_profile');

      expect(mockUpdateReport.mock.calls[0][1]).not.toHaveProperty('model_id');
    });

    it('logs validation errors in report update', async () => {
      mockGetReport.mockResolvedValue(null as never);
      mockCreateReport.mockResolvedValue({ id: 'report-1' } as never);
      mockRunPipeline.mockResolvedValue({
        content: { headline: 'Test' },
        promptTokens: 100,
        completionTokens: 200,
        generationTimeMs: 5000,
        validationErrors: [{ type: 'wrong_number', detail: '99pts', severity: 'warning' }],
        retryCount: 0,
      } as never);

      await generateTournamentReportAsync('t1', 'r1', 'season_summary');

      expect(mockUpdateReport).toHaveBeenCalledWith('report-1', expect.objectContaining({
        error: expect.stringContaining('wrong_number'),
      }));
    });

    it('catches and logs errors without throwing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const dbError = new Error('DB error');
      mockGetReport.mockRejectedValue(dbError);
      // Fire-and-forget: the failure is logged, never thrown at the caller
      await expect(generateTournamentReportAsync('t1', 'r1', 'round_recap')).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ai/tournament-report]'), dbError);
      // A failed cache read is not "no report yet": nothing is generated over it
      expect(mockCreateReport).not.toHaveBeenCalled();
      expect(mockRunPipeline).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('parseReportResponse', () => {
    it('parses recap response', () => {
      const json = JSON.stringify({
        headline: 'Big wins',
        narrative: 'Story here.',
        match_summaries: [{
          player_1_name: 'Ash', player_2_name: 'Gary',
          winner_name: 'Ash', score: '2-1', one_liner: 'Close match', mvp_pokemon: 'Pikachu',
        }],
        standings_story: 'Ash leads',
        meta_trends: 'Electric meta',
        player_spotlight: { player_name: 'Ash', reason: 'Undefeated' },
        spicy_pick: { pokemon_name: 'Magikarp', player_name: 'Ash', context: 'Surprise pick' },
      });

      const result = parseReportResponse(json, 'round_recap');
      expect(result.headline).toBe('Big wins');
      expect(result.narrative).toBe('Story here.');
    });

    it('parses forecast response', () => {
      const json = JSON.stringify({
        headline: 'Round 2 preview',
        narrative: 'Big matchups ahead.',
        matchup_previews: [{
          player_1_name: 'Ash', player_2_name: 'Gary',
          storyline: 'Rivalry renewed', edge: 'Ash', key_pokemon: 'Pikachu',
        }],
        standings_context: 'Tight race',
        players_to_watch: [{ player_name: 'Ash', reason: 'Hot streak' }],
        bold_prediction: 'Ash sweeps.',
      });

      const result = parseReportResponse(json, 'round_forecast');
      expect(result.headline).toBe('Round 2 preview');
    });

    it('strips think tags before parsing', () => {
      const json = `<think>some reasoning</think>{"headline":"Test","narrative":"Story"}`;
      const result = parseReportResponse(json, 'round_recap');
      expect(result.headline).toBe('Test');
    });

    it('strips markdown code fences', () => {
      const json = '```json\n{"headline":"Test","narrative":"Story"}\n```';
      const result = parseReportResponse(json, 'round_recap');
      expect(result.headline).toBe('Test');
    });

    it('throws on missing headline', () => {
      const json = JSON.stringify({ narrative: 'Story' });
      expect(() => parseReportResponse(json, 'round_recap')).toThrow('Missing or invalid "headline"');
    });

    it('throws on missing narrative', () => {
      const json = JSON.stringify({ headline: 'Test' });
      expect(() => parseReportResponse(json, 'round_recap')).toThrow('Missing or invalid "narrative"');
    });

    it('throws when no JSON found', () => {
      expect(() => parseReportResponse('just plain text', 'round_recap')).toThrow('No JSON object found');
    });

    it('handles recap without optional spicy_pick', () => {
      const json = JSON.stringify({
        headline: 'Test', narrative: 'Story',
        match_summaries: [], standings_story: '', meta_trends: '',
        player_spotlight: { player_name: '', reason: '' },
      });

      const result = parseReportResponse(json, 'round_recap');
      expect(result).toHaveProperty('spicy_pick');
    });
  });
});
