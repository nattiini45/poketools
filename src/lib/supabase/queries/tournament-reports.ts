import { supabase } from '../client';
import type { Tables, Json } from '@/types/database';
import type {
  TournamentReport,
  TournamentReportType,
  TournamentReportStatus,
  ReportContent,
} from '@/types/tournament-report';

type TournamentReportRow = Tables<'tournament_reports'>;

function toTournamentReport(row: TournamentReportRow): TournamentReport {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    round_id: row.round_id,
    report_type: row.report_type as TournamentReportType,
    model_id: row.model_id,
    content: (row.content as unknown as ReportContent) ?? {},
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    generation_time_ms: row.generation_time_ms,
    status: row.status as TournamentReportStatus,
    error: row.error,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

// ─── Read ────────────────────────────────────────────────────────────

/**
 * Get a specific report by tournament + round + type, or null when none
 * exists. A failed read throws (after a tagged log line); the caller decides
 * how to answer it.
 */
export async function getTournamentReport(
  tournamentId: string,
  roundId: string,
  reportType: TournamentReportType
): Promise<TournamentReport | null> {
  const { data, error } = await supabase
    .from('tournament_reports')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('round_id', roundId)
    .eq('report_type', reportType)
    .maybeSingle();

  if (error) {
    console.error('[tournament-reports] Query error:', error.message);
    throw error;
  }
  return data ? toTournamentReport(data) : null;
}

/**
 * Get all reports for a tournament, ordered by created_at descending. A failed
 * read throws (after a tagged log line), never an empty list.
 */
export async function getTournamentReports(
  tournamentId: string
): Promise<TournamentReport[]> {
  const { data, error } = await supabase
    .from('tournament_reports')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[tournament-reports] Query error:', error.message);
    throw error;
  }
  return (data ?? []).map(toTournamentReport);
}

// ─── Write ───────────────────────────────────────────────────────────

/** Create a pending tournament report */
export async function createTournamentReport(
  tournamentId: string,
  roundId: string,
  reportType: TournamentReportType,
  modelId: string
): Promise<TournamentReport> {
  const { data, error } = await supabase
    .from('tournament_reports')
    .insert({
      tournament_id: tournamentId,
      round_id: roundId,
      report_type: reportType,
      model_id: modelId,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return toTournamentReport(data);
}

/** Update a tournament report (content, status, tokens, error) */
export async function updateTournamentReport(
  id: string,
  updates: {
    content?: ReportContent;
    prompt_tokens?: number;
    completion_tokens?: number;
    generation_time_ms?: number;
    status?: TournamentReportStatus;
    error?: string | null;
    /** The model that actually answered (the row is created with the requested one). */
    model_id?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from('tournament_reports')
    .update({
      ...(updates.content !== undefined && { content: updates.content as unknown as Json }),
      ...(updates.model_id !== undefined && { model_id: updates.model_id }),
      ...(updates.prompt_tokens !== undefined && { prompt_tokens: updates.prompt_tokens }),
      ...(updates.completion_tokens !== undefined && { completion_tokens: updates.completion_tokens }),
      ...(updates.generation_time_ms !== undefined && { generation_time_ms: updates.generation_time_ms }),
      ...(updates.status !== undefined && { status: updates.status }),
      ...(updates.error !== undefined && { error: updates.error }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

/** Delete a report for regeneration */
export async function deleteTournamentReport(
  tournamentId: string,
  roundId: string,
  reportType: TournamentReportType
): Promise<void> {
  const { error } = await supabase
    .from('tournament_reports')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('round_id', roundId)
    .eq('report_type', reportType);

  if (error) throw error;
}
