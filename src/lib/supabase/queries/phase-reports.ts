import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import { settleAiArtifact } from './ai-artifacts';
import { aiArtifactMachine } from '@/lib/ai/artifact-state';
import type { Json, Tables } from '@/types/database';
import type { PhaseReport, PhaseReportType } from '@/types/phase-report';
import type { ReportContent } from '@/types/tournament-report';

const COLUMNS = 'id,phase_id,round_id,report_type,model_id,content,prompt_tokens,completion_tokens,generation_time_ms,status,error,created_at,updated_at' as const;

function toPhaseReport(row: Tables<'phase_reports'>): PhaseReport {
  return {
    id: row.id, phase_id: row.phase_id, round_id: row.round_id,
    report_type: row.report_type as PhaseReportType, model_id: row.model_id,
    content: row.content as unknown as ReportContent,
    prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens,
    generation_time_ms: row.generation_time_ms, status: row.status as PhaseReport['status'], error: row.error,
    created_at: row.created_at ?? '', updated_at: row.updated_at ?? '',
  };
}

export async function getPhaseReport(phaseId: string, roundId: string, reportType: PhaseReportType): Promise<PhaseReport | null> {
  const { data, error } = await supabase.from('phase_reports').select(COLUMNS)
    .eq('phase_id', phaseId).eq('round_id', roundId).eq('report_type', reportType).maybeSingle();
  if (error) throw error;
  return data ? toPhaseReport(data) : null;
}

export async function getPhaseReports(phaseId: string): Promise<PhaseReport[]> {
  const rows = await readAllPages((from, to) => supabase.from('phase_reports').select(COLUMNS)
    .eq('phase_id', phaseId).order('created_at', { ascending: false }).order('id').range(from, to));
  return rows.map(toPhaseReport);
}

export async function createPhaseReport(phaseId: string, roundId: string, reportType: PhaseReportType, modelId: string): Promise<PhaseReport> {
  aiArtifactMachine.assertTransition('absent', 'pending', 'system');
  const { data, error } = await supabase.from('phase_reports')
    .insert({ phase_id: phaseId, round_id: roundId, report_type: reportType, model_id: modelId, status: 'pending' })
    .select(COLUMNS).single();
  if (error) throw error;
  return toPhaseReport(data);
}

export async function updatePhaseReport(id: string, updates: {
  content?: ReportContent;
  prompt_tokens?: number;
  completion_tokens?: number;
  generation_time_ms?: number;
  status: 'completed' | 'failed';
  error?: string | null;
  model_id?: string;
}): Promise<boolean> {
  const { status, content, ...values } = updates;
  return settleAiArtifact('phase_reports', id, status, {
    ...values, ...(content !== undefined ? { content: content as unknown as Json } : {}),
  });
}

export async function deletePhaseReport(phaseId: string, roundId: string, reportType: PhaseReportType): Promise<boolean> {
  const report = await getPhaseReport(phaseId, roundId, reportType);
  if (!report) return false;
  aiArtifactMachine.assertTransition(report.status, 'absent', 'admin');
  const { data, error } = await supabase.from('phase_reports').delete().eq('id', report.id)
    .eq('phase_id', phaseId).eq('status', report.status).select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}
