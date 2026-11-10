import { supabase } from '../client';
import { settleAiArtifact } from './ai-artifacts';
import type { Tables, Json } from '@/types/database';
import type { MatchAnalysis, MatchAnalysisContent, MatchAnalysisStatus } from '@/types/game';

type MatchAnalysisRow = Tables<'match_analyses'>;

function toMatchAnalysis(row: MatchAnalysisRow): MatchAnalysis {
  return {
    id: row.id,
    match_id: row.match_id,
    model_id: row.model_id,
    analysis: (row.analysis as unknown as MatchAnalysisContent) ?? {},
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    generation_time_ms: row.generation_time_ms,
    status: row.status as MatchAnalysisStatus,
    error: row.error,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

// ─── Read ────────────────────────────────────────────────────────────

/**
 * The stored analysis for a match, or null when none exists. A failed read
 * throws (after a tagged log line): the caller decides how to answer it, so a
 * database outage is never shown as "no analysis yet".
 */
export async function getMatchAnalysis(
  matchId: string
): Promise<MatchAnalysis | null> {
  const { data, error } = await supabase
    .from('match_analyses')
    .select('*')
    .eq('match_id', matchId)
    .maybeSingle();

  if (error) {
    console.error('[match-analyses] Query error:', error.message);
    throw error;
  }
  return data ? toMatchAnalysis(data) : null;
}

// ─── Write ───────────────────────────────────────────────────────────

export async function createMatchAnalysis(
  matchId: string,
  modelId: string
): Promise<MatchAnalysis> {
  const { data, error } = await supabase
    .from('match_analyses')
    .insert({
      match_id: matchId,
      model_id: modelId,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return toMatchAnalysis(data);
}

/** Settles a pending analysis as completed or failed (compare-and-set: `settleAiArtifact`). False when no pending row matched. */
export async function updateMatchAnalysis(
  id: string,
  updates: {
    analysis?: MatchAnalysisContent;
    prompt_tokens?: number;
    completion_tokens?: number;
    generation_time_ms?: number;
    status: Exclude<MatchAnalysisStatus, 'pending'>;
    error?: string | null;
    /** The model that actually answered (the row is created with the requested one). */
    model_id?: string;
  }
): Promise<boolean> {
  const { status, analysis, ...rest } = updates;
  return settleAiArtifact('match_analyses', id, status, {
    ...rest,
    ...(analysis !== undefined && { analysis: analysis as unknown as Json }),
  });
}

/** Delete an existing analysis (for admin regeneration) */
export async function deleteMatchAnalysis(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('match_analyses')
    .delete()
    .eq('match_id', matchId);

  if (error) throw error;
}
