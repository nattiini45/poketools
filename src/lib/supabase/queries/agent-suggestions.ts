import { supabase } from '../client';
import type { Json } from '@/types/database';

export async function insertNativeAgentSuggestion(input: {
  playerId: string;
  conversationId: string;
  phaseMatchId: string;
  contextFormat: string;
  proposedTeam: Json | null;
  reasoning: string | null;
  topicTags: string[];
}) {
  const { data, error } = await supabase.from('agent_suggestions').insert({
    player_id: input.playerId, conversation_id: input.conversationId,
    match_id: null, phase_match_id: input.phaseMatchId, context_format: input.contextFormat,
    proposed_team: input.proposedTeam, reasoning: input.reasoning, topic_tags: input.topicTags,
  }).select('*').single();
  if (error) throw error;
  return data;
}

/**
 * Null the `match_id` pointer on every agent suggestion targeting a match
 * (match-scoped), WITHOUT deleting the suggestion rows. An agent suggestion is
 * an AI-generated recommendation tied to a player + conversation, so on match
 * undo only the stale `match_id` pointer is cleared — mirroring the hard-delete
 * FK `ON DELETE SET NULL` behavior (`agent_suggestions.match_id → matches ON
 * DELETE SET NULL`). Returns the count of rows whose pointer was cleared so
 * the cleanup can surface it in its summary.
 */
export async function clearAgentSuggestionsMatchPointer(
  matchId: string
): Promise<number> {
  const { count, error } = await supabase
    .from('agent_suggestions')
    .update({ match_id: null }, { count: 'exact' })
    .eq('match_id', matchId);

  if (error) throw error;
  return count ?? 0;
}
