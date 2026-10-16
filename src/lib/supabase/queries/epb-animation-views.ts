import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';

/** Whether the given player has already viewed the EPB replay for a match. */
export async function hasViewedEpbReplay(playerId: string, matchId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('epb_animation_views')
    .select('id')
    .eq('player_id', playerId)
    .eq('match_id', matchId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/** Mark an EPB match replay as viewed for a player (idempotent). */
export async function markEpbReplayViewed(playerId: string, matchId: string): Promise<void> {
  const row: TablesInsert<'epb_animation_views'> = {
    player_id: playerId,
    match_id: matchId,
  };

  const { error } = await supabase
    .from('epb_animation_views')
    .upsert(row, { onConflict: 'player_id,match_id', ignoreDuplicates: true });

  if (error) throw error;
}

/** Batch lookup: which of the given match IDs has this player viewed? */
export async function getViewedEpbMatchIds(
  playerId: string,
  matchIds: string[],
): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from('epb_animation_views')
    .select('match_id')
    .eq('player_id', playerId)
    .in('match_id', matchIds);

  if (error) throw error;
  return new Set((data ?? []).map((r) => r.match_id));
}

/**
 * Delete all viewed-animation markers for a match (match-scoped). A soft
 * reset leaves these behind, which gates the EPB replay animation from
 * re-playing after a re-finalize. Removing them on reset lets the
 * re-finalized match re-show the animation. Returns the count of rows
 * deleted so the cleanup can surface it in its summary.
 */
export async function deleteEpbAnimationViewsByMatch(matchId: string): Promise<number> {
  const { count, error } = await supabase
    .from('epb_animation_views')
    .delete({ count: 'exact' })
    .eq('match_id', matchId);

  if (error) throw error;
  return count ?? 0;
}

export type EpbAnimationViewRow = Tables<'epb_animation_views'>;
