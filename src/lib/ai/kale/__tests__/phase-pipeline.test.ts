import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ recap: vi.fn(), forecast: vi.fn(), model: vi.fn(),
  legacy: vi.fn(() => { throw new Error('Legacy fact loader called'); }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('../phase-fact-pack', () => ({ buildPhaseRecapFactPack: h.recap, buildPhaseForecastFactPack: h.forecast }));
vi.mock('../fact-pack', () => ({ buildRecapFactPack: h.legacy, buildForecastFactPack: h.legacy }));
vi.mock('../provider', () => ({ kaleGenerateText: h.model }));
import { runPhasePipeline } from '../phase-pipeline';
const standings = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('KALE_PIPELINE_MODE', 'single');
  const base = { leagueName: 'Synthetic league', tournamentName: 'Native stage', roundName: 'Round 1', roundNumber: 1,
    format: 'gen9ou', gen: 9, bestOf: 1, scoring: 'Pinned scoring', gymTypes: {}, currentStandings: [], validPlayerNames: [], validPokemonNames: [] };
  h.recap.mockResolvedValue({ ...base, matches: [], previousStandings: null, standingsChanges: [], pokemonUsage: [], bestPerformer: null,
    unusualPick: null, matchData: [], pokemonTypes: {} });
  h.forecast.mockResolvedValue({ ...base, matchups: [] });
  h.model.mockResolvedValue({ content: JSON.stringify({ headline: 'Native headline', narrative: 'Synthetic narrative', match_summaries: [], matchup_previews: [] }),
    model: 'actual-model', prompt_tokens: 4, completion_tokens: 6 });
});
describe('native phase Kale pipeline composition', () => {
  it.each(['round_recap', 'round_forecast'] as const)('reuses the %s executor without loading a tournament fact pack', async reportType => {
    const result = await runPhasePipeline('phase', 'round', reportType, standings);
    expect(result.content.headline).toBe('Native headline'); expect(result.modelUsed).toBe('actual-model');
    expect(result.promptTokens).toBe(4); expect(result.completionTokens).toBe(6);
    expect(reportType === 'round_recap' ? h.recap : h.forecast).toHaveBeenCalledWith('phase', 'round', standings);
    expect(h.model).toHaveBeenCalled(); expect(h.legacy).not.toHaveBeenCalled();
  });
});
