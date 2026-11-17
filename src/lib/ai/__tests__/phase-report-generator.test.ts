import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ scope: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), pipeline: vi.fn(), configured: vi.fn() }));
vi.mock('../phase-context', () => ({ loadPhaseRoundScope: h.scope }));
vi.mock('@/lib/supabase/queries/phase-reports', () => ({ getPhaseReport: h.get, createPhaseReport: h.create, updatePhaseReport: h.update, deletePhaseReport: h.remove }));
vi.mock('../kale/phase-pipeline', () => ({ runPhasePipeline: h.pipeline }));
vi.mock('../kale/provider', () => ({ isKaleConfigured: h.configured }));
import { generatePhaseReportAsync } from '../phase-report-generator';
const standings = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_ENABLE_KALE_CABBAGE', 'true');
  h.configured.mockReturnValue(true); h.scope.mockResolvedValue({}); h.get.mockResolvedValue(null);
  h.create.mockResolvedValue({ id: 'artifact' }); h.update.mockResolvedValue(true); h.remove.mockResolvedValue(true);
  h.pipeline.mockResolvedValue({ content: { headline: 'Native recap' }, modelUsed: 'actual-model', promptTokens: 3,
    completionTokens: 4, generationTimeMs: 5, validationErrors: [] });
});
describe('native report generation', () => {
  it('is disabled before any native reads by default', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_KALE_CABBAGE', 'false');
    await generatePhaseReportAsync('phase', 'round', 'round_recap', standings);
    expect(h.scope).not.toHaveBeenCalled(); expect(h.pipeline).not.toHaveBeenCalled();
  });
  it.each(['completed', 'pending'])('serves %s artifacts before generation', async status => {
    h.get.mockResolvedValue({ status, created_at: new Date().toISOString() });
    await generatePhaseReportAsync('phase', 'round', 'round_recap', standings);
    expect(h.create).not.toHaveBeenCalled(); expect(h.pipeline).not.toHaveBeenCalled();
  });
  it('settles the native report with actual model usage and exact phase ids', async () => {
    expect((await generatePhaseReportAsync('phase', 'round', 'round_recap', standings)).kind).toBe('generated');
    expect(h.pipeline).toHaveBeenCalledWith('phase', 'round', 'round_recap', standings);
    expect(h.update).toHaveBeenCalledWith('artifact', expect.objectContaining({ status: 'completed', model_id: 'actual-model', prompt_tokens: 3 }));
  });
  it('reports a lost settlement without publishing a generated result', async () => {
    h.update.mockResolvedValue(false);
    expect(await generatePhaseReportAsync('phase', 'round', 'round_recap', standings)).toEqual({ kind: 'superseded' });
  });
  it('persists a safe failure without masking the original cause', async () => {
    const error = new Error('Synthetic model failure'); h.pipeline.mockRejectedValueOnce(error);
    await expect(generatePhaseReportAsync('phase', 'round', 'round_forecast', standings)).rejects.toBe(error);
    expect(h.update).toHaveBeenCalledWith('artifact', { status: 'failed', error: 'ai_report_failed: Error' });
  });
  it('does not write if the round is outside the requested phase', async () => {
    h.scope.mockRejectedValueOnce(new Error('Round not found in phase'));
    await expect(generatePhaseReportAsync('phase', 'other', 'round_recap', standings)).rejects.toThrow('Round');
    expect(h.get).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
});
