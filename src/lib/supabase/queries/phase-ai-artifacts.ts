import { supabase } from '../client';
import { getPhaseMatchById } from './phase-matches';
import { settleAiArtifact } from './ai-artifacts';
import { aiArtifactMachine } from '@/lib/ai/artifact-state';
import type { Json, Tables } from '@/types/database';
import type { MatchAnalysis, MatchAnalysisContent, MatchPrepAnalysis, MatchPrepAnalysisContent } from '@/types/game';
import type { PokemonSet } from '@/types/team';
import { assertValidUuid } from '@/lib/utils/uuid';
import { readAllPages } from '../read-all-pages';

const RESULT_COLUMNS = 'id,match_id,model_id,analysis,prompt_tokens,completion_tokens,generation_time_ms,status,error,created_at,updated_at' as const;
const PREP_COLUMNS = `${RESULT_COLUMNS},player_id,has_user_team` as const;

export async function getPhaseAiParticipants(phaseId: string) {
  const rows = await readAllPages<{ player: { id: string; name: string; avatar_url: string | null } }>((from, to) =>
    supabase.from('phase_participants').select('player:players!phase_participants_player_id_fkey(id,name,avatar_url)')
      .eq('phase_id', phaseId).order('player_id').range(from, to));
  return rows.map(row => ({ id: row.player.id, name: row.player.name, avatar_url: row.player.avatar_url }));
}

async function assertScope(phaseId: string, matchId: string) {
  assertValidUuid(phaseId);
  assertValidUuid(matchId);
  const match = await getPhaseMatchById(matchId);
  if (!match || match.phase_id !== phaseId) throw new Error('Match not found in phase');
}

function analysis(row: Tables<'phase_match_analyses'>): MatchAnalysis {
  return { id: row.id, match_id: row.match_id, model_id: row.model_id,
    analysis: row.analysis as unknown as MatchAnalysisContent, prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens, generation_time_ms: row.generation_time_ms,
    status: row.status as MatchAnalysis['status'], error: row.error,
    created_at: row.created_at ?? '', updated_at: row.updated_at ?? '' };
}

function prep(row: Tables<'phase_match_prep_analyses'>): MatchPrepAnalysis {
  return { ...analysis(row), analysis: row.analysis as unknown as MatchPrepAnalysisContent,
    player_id: row.player_id, has_user_team: row.has_user_team };
}

export async function getPhaseMatchAnalysis(phaseId: string, matchId: string): Promise<MatchAnalysis | null> {
  await assertScope(phaseId, matchId);
  const { data, error } = await supabase.from('phase_match_analyses').select(RESULT_COLUMNS).eq('match_id', matchId).maybeSingle();
  if (error) throw error;
  return data ? analysis(data) : null;
}

export async function getPhaseMatchPrepAnalysis(phaseId: string, matchId: string, playerId: string): Promise<MatchPrepAnalysis | null> {
  await assertScope(phaseId, matchId);
  const { data, error } = await supabase.from('phase_match_prep_analyses').select(PREP_COLUMNS)
    .eq('match_id', matchId).eq('player_id', playerId).maybeSingle();
  if (error) throw error;
  return data ? prep(data) : null;
}

export async function getPhaseScoutingAccess(phaseId: string, matchId: string) {
  assertValidUuid(phaseId);
  assertValidUuid(matchId);
  const { data, error } = await supabase.from('phase_matches').select('status,player_1_id,player_2_id')
    .eq('id', matchId).eq('phase_id', phaseId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getPhasePlayerPrepTeam(phaseId: string, matchId: string, playerId: string): Promise<{ pokemon: PokemonSet[] } | null> {
  await assertScope(phaseId, matchId);
  const { data, error } = await supabase.from('phase_match_prep_teams').select('pokemon')
    .eq('match_id', matchId).eq('player_id', playerId).maybeSingle();
  if (error) throw error;
  return data ? { pokemon: data.pokemon as unknown as PokemonSet[] } : null;
}

export async function createPhaseMatchAnalysis(phaseId: string, matchId: string, modelId: string): Promise<MatchAnalysis> {
  await assertScope(phaseId, matchId);
  aiArtifactMachine.assertTransition('absent', 'pending', 'system');
  const { data, error } = await supabase.from('phase_match_analyses')
    .insert({ match_id: matchId, model_id: modelId, status: 'pending' }).select(RESULT_COLUMNS).single();
  if (error) throw error;
  return analysis(data);
}

export async function createPhaseMatchPrepAnalysis(phaseId: string, matchId: string, playerId: string, modelId: string, hasUserTeam: boolean): Promise<MatchPrepAnalysis> {
  await assertScope(phaseId, matchId);
  aiArtifactMachine.assertTransition('absent', 'pending', 'system');
  const { data, error } = await supabase.from('phase_match_prep_analyses')
    .insert({ match_id: matchId, player_id: playerId, model_id: modelId, has_user_team: hasUserTeam, status: 'pending' }).select(PREP_COLUMNS).single();
  if (error) throw error;
  return prep(data);
}

type ResultValues<T> = {
  analysis?: T; status: 'completed' | 'failed'; error?: string | null; model_id?: string;
  prompt_tokens?: number; completion_tokens?: number; generation_time_ms?: number;
};

export function updatePhaseMatchAnalysis(id: string, values: ResultValues<MatchAnalysisContent>): Promise<boolean> {
  const { status, analysis, ...rest } = values;
  return settleAiArtifact('phase_match_analyses', id, status, { ...rest,
    ...(analysis !== undefined ? { analysis: analysis as unknown as Json } : {}) });
}

export function updatePhaseMatchPrepAnalysis(id: string, values: ResultValues<MatchPrepAnalysisContent> & { has_user_team?: boolean }): Promise<boolean> {
  const { status, analysis, ...rest } = values;
  return settleAiArtifact('phase_match_prep_analyses', id, status, { ...rest,
    ...(analysis !== undefined ? { analysis: analysis as unknown as Json } : {}) });
}

export async function deletePhaseMatchAnalysis(phaseId: string, matchId: string): Promise<boolean> {
  const row = await getPhaseMatchAnalysis(phaseId, matchId);
  if (!row) return false;
  aiArtifactMachine.assertTransition(row.status, 'absent', 'admin');
  const { data, error } = await supabase.from('phase_match_analyses').delete()
    .eq('id', row.id).eq('match_id', matchId).eq('status', row.status).select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}

export async function deletePhaseMatchPrepAnalysis(
  phaseId: string, matchId: string, playerId: string, expected: Pick<MatchPrepAnalysis, 'id' | 'status'>,
): Promise<boolean> {
  await assertScope(phaseId, matchId);
  aiArtifactMachine.assertTransition(expected.status, 'absent', 'player');
  const { data, error } = await supabase.from('phase_match_prep_analyses').delete()
    .eq('id', expected.id).eq('match_id', matchId).eq('player_id', playerId).eq('status', expected.status).select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}
