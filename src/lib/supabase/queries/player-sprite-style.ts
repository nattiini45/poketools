import { supabase } from '../client';
import {
  DEFAULT_SPRITE_STYLE_PREFERENCE,
  isSpriteStylePreference,
  type SpriteStylePreference,
} from '@/lib/pkmn/sprite-styles';

/**
 * `players.sprite_style` (docs/pkmn.md, "Sprite styles"): the signed-in
 * player's sprite style preference. Service-role reads and own-row writes only;
 * callers pass the player id from a live `require*` guard, never from a body.
 */

/**
 * Single-column PK read. A missing row reads as the default ('site'); a stored
 * value outside the CHECK list cannot exist, so one is reported as an error
 * instead of being coerced. Query errors rethrow.
 */
export async function getPlayerSpriteStyle(playerId: string): Promise<SpriteStylePreference> {
  const { data, error } = await supabase
    .from('players')
    .select('sprite_style')
    .eq('id', playerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULT_SPRITE_STYLE_PREFERENCE;
  const stored: unknown = data.sprite_style;
  if (!isSpriteStylePreference(stored)) {
    throw new Error(`[player-sprite-style] players.sprite_style holds an unknown value for ${playerId}`);
  }
  return stored;
}

/** Persists the preference; throws when no row was updated (the player no longer exists). */
export async function setPlayerSpriteStyle(playerId: string, value: SpriteStylePreference): Promise<void> {
  const { data, error } = await supabase
    .from('players')
    .update({ sprite_style: value })
    .eq('id', playerId)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`[player-sprite-style] no players row updated for ${playerId}`);
  }
}
