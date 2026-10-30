import { supabase } from '../client';
import type { Tables, Json } from '@/types/database';
import type {
  MatchPrepAnalysis,
  MatchPrepAnalysisContent,
  MatchPrepAnalysisStatus,
} from '@/types/game';

type MatchPrepAnalysisRow = Tables<'match_prep_analyses'>;

function toMatchPrepAnalysis(row: MatchPrepAnalysisRow): MatchPrepAnalysis {
  return {
    id: row.id,
    match_id: row.match_id,
    player_id: row.player_id,
    model_id: row.model_id,
    analysis: (row.analysis as unknown as MatchPrepAnalysisContent) ?? {},
    has_user_team: row.has_user_team,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    generation_time_ms: row.generation_time_ms,
    status: row.status as MatchPrepAnalysisStatus,
    error: row.error,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
  };
}

// ─── Read ────────────────────────────────────────────────────────────

/**
 * The stored scouting report of one player for a match, or null when none
 * exists. A failed read throws (after a tagged log line): the caller decides
 * how to answer it, so a database outage is never shown as "no report yet".
 */
export async function getMatchPrepAnalysis(
  matchId: string,
  playerId: string
): Promise<MatchPrepAnalysis | null> {
  const { data, error } = await supabase
    .from('match_prep_analyses')
    .select('*')
    .eq('match_id', matchId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) {
    console.error('[match-prep-analyses] Query error:', error.message);
    throw error;
  }
  return data ? toMatchPrepAnalysis(data) : null;
}

// ─── Write ───────────────────────────────────────────────────────────

export async function createMatchPrepAnalysis(
  matchId: string,
  playerId: string,
  modelId: string,
  hasUserTeam: boolean
): Promise<MatchPrepAnalysis> {
  const { data, error } = await supabase
    .from('match_prep_analyses')
    .insert({
      match_id: matchId,
      player_id: playerId,
      model_id: modelId,
      has_user_team: hasUserTeam,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return toMatchPrepAnalysis(data);
}

export async function updateMatchPrepAnalysis(
  id: string,
  updates: {
    analysis?: MatchPrepAnalysisContent;
    has_user_team?: boolean;
    prompt_tokens?: number;
    completion_tokens?: number;
    generation_time_ms?: number;
    status?: MatchPrepAnalysisStatus;
    error?: string | null;
    /** The model that actually answered (the row is created with the requested one). */
    model_id?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from('match_prep_analyses')
    .update({
      ...(updates.analysis !== undefined && { analysis: updates.analysis as unknown as Json }),
      ...(updates.model_id !== undefined && { model_id: updates.model_id }),
      ...(updates.has_user_team !== undefined && { has_user_team: updates.has_user_team }),
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

export async function deleteMatchPrepAnalysis(
  matchId: string,
  playerId: string
): Promise<void> {
  const { error } = await supabase
    .from('match_prep_analyses')
    .delete()
    .eq('match_id', matchId)
    .eq('player_id', playerId);

  if (error) throw error;
}

/** Delete all prep analyses for a match (used during match reset) */
export async function deleteMatchPrepAnalysesByMatch(
  matchId: string
): Promise<void> {
  const { error } = await supabase
    .from('match_prep_analyses')
    .delete()
    .eq('match_id', matchId);

  if (error) throw error;
}
