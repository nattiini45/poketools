import { supabase } from '../client';
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

export async function getMatchAnalysis(
  matchId: string
): Promise<MatchAnalysis | null> {
  try {
    const { data, error } = await supabase
      .from('match_analyses')
      .select('*')
      .eq('match_id', matchId)
      .maybeSingle();

    if (error) {
      // Gracefully handle table-not-found (pre-migration) — don't crash the page
      console.error('[match-analyses] Query error:', error.message);
      return null;
    }
    return data ? toMatchAnalysis(data) : null;
  } catch {
    return null;
  }
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

export async function updateMatchAnalysis(
  id: string,
  updates: {
    analysis?: MatchAnalysisContent;
    prompt_tokens?: number;
    completion_tokens?: number;
    generation_time_ms?: number;
    status?: MatchAnalysisStatus;
    error?: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from('match_analyses')
    .update({
      ...(updates.analysis !== undefined && { analysis: updates.analysis as unknown as Json }),
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

/** Delete an existing analysis (for admin regeneration) */
export async function deleteMatchAnalysis(matchId: string): Promise<void> {
  const { error } = await supabase
    .from('match_analyses')
    .delete()
    .eq('match_id', matchId);

  if (error) throw error;
}
