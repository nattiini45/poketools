import 'server-only';
import { createPhaseReport, deletePhaseReport, getPhaseReport, updatePhaseReport } from '@/lib/supabase/queries/phase-reports';
import { loadPhaseRoundScope } from './phase-context';
import { runPhasePipeline } from './kale/phase-pipeline';
import { isKaleConfigured } from './kale/provider';
import type { PhaseReportStandings } from './kale/phase-fact-pack';
import type { PhaseReport, PhaseReportType } from '@/types/phase-report';
import { AI_ANALYSIS_STALE_MS, getClaudeModelId } from './constants';
import { describeAiFailure } from './failure';
import { logger } from '@/lib/logger';

export type PhaseReportGenerationResult = { kind: 'disabled' | 'pending' | 'superseded' }
  | { kind: 'cached' | 'generated'; report: PhaseReport };

export async function generatePhaseReportAsync(phaseId: string, roundId: string, reportType: PhaseReportType,
  standings: PhaseReportStandings): Promise<PhaseReportGenerationResult> {
  if (process.env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE !== 'true' || !isKaleConfigured()) return { kind: 'disabled' };
  await loadPhaseRoundScope(phaseId, roundId);
  const existing = await getPhaseReport(phaseId, roundId, reportType);
  if (existing?.status === 'completed') return { kind: 'cached', report: existing };
  if (existing?.status === 'pending' && Date.now() - new Date(existing.created_at).getTime() < AI_ANALYSIS_STALE_MS) return { kind: 'pending' };
  if (existing && !await deletePhaseReport(phaseId, roundId, reportType)) return { kind: 'superseded' };
  const record = await createPhaseReport(phaseId, roundId, reportType, getClaudeModelId());
  try {
    const result = await runPhasePipeline(phaseId, roundId, reportType, standings);
    const values = { content: result.content, status: 'completed' as const,
      ...(result.modelUsed !== 'unknown' ? { model_id: result.modelUsed } : {}),
      prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens,
      generation_time_ms: result.generationTimeMs,
      error: result.validationErrors.length ? JSON.stringify(result.validationErrors) : null };
    if (!await updatePhaseReport(record.id, values)) return { kind: 'superseded' };
    return { kind: 'generated', report: { ...record, ...values, updated_at: new Date().toISOString() } };
  } catch (error) {
    logger.error('ai/phase-report', 'Phase report generation failed', { error, phaseId, roundId, reportType });
    const failure = describeAiFailure(error, { code: 'ai_report_failed', message: '' });
    await updatePhaseReport(record.id, { status: 'failed', error: failure.stored });
    throw error;
  }
}
