import { supabase } from '../client';

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