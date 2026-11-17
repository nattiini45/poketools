import { supabase } from '../client';
import { logger } from '@/lib/logger';
import type { MatchChildrenCleanup } from '@/lib/match/match-children';

export interface PhaseMatchChildrenEffects {
  releaseTeams(matchId: string): Promise<number>;
}

export async function cleanPhaseMatchChildren(matchId: string, effects: PhaseMatchChildrenEffects): Promise<MatchChildrenCleanup> {
  if (typeof effects?.releaseTeams !== 'function') throw new Error('Native phase team release effect is required before match child cleanup');
  const releasedTeams = await effects.releaseTeams(matchId);
  const result: MatchChildrenCleanup = {
    matchPrepTeamsDeleted: 0, matchProposalsDeleted: 0, broadcastMomentsDeleted: 0,
    animationViewsDeleted: 0, teamPointersCleared: releasedTeams, castSessionPointersCleared: 0,
    agentSuggestionPointersCleared: 0, socialImageCleared: false,
  };
  const deletes = [
    ['phase_match_prep_teams', 'matchPrepTeamsDeleted'],
    ['phase_match_proposals', 'matchProposalsDeleted'],
    ['phase_broadcast_moments', 'broadcastMomentsDeleted'],
    ['phase_epb_animation_views', 'animationViewsDeleted'],
  ] as const;
  for (const [table, key] of deletes) {
    try {
      const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('match_id', matchId);
      if (error) throw error;
      result[key] = count ?? 0;
    } catch (error) {
      logger.error('phase-match/children', `Failed to delete ${table}`, { error, matchId });
    }
  }
  const pointers = [
    ['phase_cast_sessions', 'match_id', 'castSessionPointersCleared'],
    ['teams', 'phase_match_id', 'teamPointersCleared'],
    ['cast_sessions', 'phase_match_id', 'castSessionPointersCleared'],
    ['agent_suggestions', 'phase_match_id', 'agentSuggestionPointersCleared'],
  ] as const;
  for (const [table, column, key] of pointers) {
    try {
      const { error, count } = await supabase.from(table).update({ [column]: null }, { count: 'exact' }).eq(column, matchId);
      if (error) throw error;
      result[key] += count ?? 0;
    } catch (error) {
      logger.error('phase-match/children', `Failed to clear ${table}.${column}`, { error, matchId });
    }
  }
  try {
    const { error } = await supabase.from('phase_matches').update({ social_image_url: null }).eq('id', matchId);
    if (error) throw error;
    result.socialImageCleared = true;
  } catch (error) {
    logger.error('phase-match/children', 'Failed to clear social image', { error, matchId });
  }
  return result;
}

export async function deletePhaseMatchAnalyses(matchId: string): Promise<void> {
  const { error } = await supabase.from('phase_match_analyses').delete().eq('match_id', matchId);
  if (error) throw error;
}

export async function deletePhaseMatchPrepAnalyses(matchId: string): Promise<void> {
  const { error } = await supabase.from('phase_match_prep_analyses').delete().eq('match_id', matchId);
  if (error) throw error;
}
