/**
 * Per-player favourite draft lines (`draft_line_favorites`).
 * Favourites belong to the player, not
 * to a pool, so they survive from the initial draft into the redraft. Private
 * to the player: no cached public read includes them.
 */
import 'server-only';

import { supabase } from '../client';
import { DraftRuleError } from '@/lib/draft/errors';
import type { LineId } from '@/types/draft-queue';

/** At most this many favourites per player (`FAVORITES_LIMIT {max}`). */
export const MAX_FAVORITE_LINES = 200;

/** The player's favourite line ids, oldest first. */
export async function getFavoriteLineIds(playerId: string): Promise<LineId[]> {
  const { data, error } = await supabase
    .from('draft_line_favorites')
    .select('line_id')
    .eq('player_id', playerId)
    .order('created_at', { ascending: true })
    .limit(MAX_FAVORITE_LINES + 1);

  if (error) throw error;
  return (data ?? []).map((row) => row.line_id);
}

/**
 * Adds or removes one favourite and returns the resulting list (one read plus at
 * most one write). Adding past `MAX_FAVORITE_LINES` throws `FAVORITES_LIMIT`;
 * adding a present line or removing an absent one writes nothing.
 */
export async function setFavoriteLine(playerId: string, lineId: LineId, favorite: boolean): Promise<LineId[]> {
  const current = await getFavoriteLineIds(playerId);
  const present = current.includes(lineId);

  if (favorite) {
    if (present) return current;
    if (current.length >= MAX_FAVORITE_LINES) {
      throw new DraftRuleError('FAVORITES_LIMIT', { max: MAX_FAVORITE_LINES });
    }
    const { error } = await supabase
      .from('draft_line_favorites')
      .upsert({ player_id: playerId, line_id: lineId }, { onConflict: 'player_id,line_id', ignoreDuplicates: true });
    if (error) throw error;
    return [...current, lineId];
  }

  if (!present) return current;
  const { error } = await supabase
    .from('draft_line_favorites')
    .delete()
    .eq('player_id', playerId)
    .eq('line_id', lineId);
  if (error) throw error;
  return current.filter((id) => id !== lineId);
}
