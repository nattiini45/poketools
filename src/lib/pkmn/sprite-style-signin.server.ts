import 'server-only';
import { cookies } from 'next/headers';
import { getPlayerSpriteStyle, setPlayerSpriteStyle } from '@/lib/supabase/queries/player-sprite-style';
import {
  DEFAULT_SPRITE_STYLE_PREFERENCE,
  SPRITE_STYLE_COOKIE,
  isSpriteStylePreference,
} from './sprite-styles';
import { spriteStyleCookieOptions } from './sprite-style.server';

/**
 * Sign-in sync of the sprite style (docs/pkmn.md, "Sprite styles"). The
 * `plc_sprite_style` cookie is the server-render source of truth, so the
 * first page after signing in must already use the account's style:
 *
 *  - an existing player: the account value (`players.sprite_style`) wins and
 *    is written to the cookie when it differs (a missing cookie already reads
 *    as 'site', so an account at 'site' needs no write);
 *  - a player created by this sign-in has no choice of its own yet: a valid,
 *    non-default cookie (chosen while signed out) is adopted into the new
 *    account instead of being reset to 'site'.
 *
 * Called by the NextAuth jwt callback on the initial sign-in only, inside the
 * auth route handler, where `cookies()` is writable. `playerId` is the player
 * the sign-in itself resolved (never client input). Errors rethrow; the
 * caller logs them in full and refuses the sign-in (no log-and-continue,
 * AGENTS.md rule 5).
 *
 * The adoption for a new account goes beyond the literal round-4 wording
 * ("sign-in syncs the cookie from players.sprite_style"), but ends in the same
 * state: after adoption the column and the cookie hold the same value, and
 * a style picked seconds before creating the account is not thrown away.
 */
export async function syncSpriteStyleCookieAtSignIn(
  playerId: string,
  { created }: { created: boolean },
): Promise<'adopted' | 'synced' | 'unchanged'> {
  const store = await cookies();
  const raw = store.get(SPRITE_STYLE_COOKIE)?.value;
  const browser = isSpriteStylePreference(raw) ? raw : DEFAULT_SPRITE_STYLE_PREFERENCE;

  if (created && browser !== DEFAULT_SPRITE_STYLE_PREFERENCE) {
    await setPlayerSpriteStyle(playerId, browser);
    return 'adopted';
  }

  const stored = await getPlayerSpriteStyle(playerId);
  // A junk cookie value is rewritten even when the account is at the default.
  if (stored === browser && (raw === undefined || raw === stored)) return 'unchanged';
  store.set(SPRITE_STYLE_COOKIE, stored, spriteStyleCookieOptions());
  return 'synced';
}
