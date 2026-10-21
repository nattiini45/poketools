import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import {
  DEFAULT_SPRITE_STYLE_PREFERENCE,
  SPRITE_STYLE_COOKIE,
  SPRITE_STYLE_COOKIE_MAX_AGE,
  isSpriteStylePreference,
  type SpriteStylePreference,
} from './sprite-styles';

/**
 * Attributes of the `plc_sprite_style` cookie, shared by its two writers
 * (`POST /api/sprite-style` and the sign-in sync in
 * `sprite-style-signin.server.ts`). httpOnly: only the server reads it.
 */
export function spriteStyleCookieOptions() {
  return {
    path: '/',
    maxAge: SPRITE_STYLE_COOKIE_MAX_AGE,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  };
}

/**
 * The viewer's sprite-style preference from the `plc_sprite_style` cookie
 * (docs/pkmn.md, "Sprite styles"). Read once per render by the root layout,
 * which hands it to `SpriteStyleProvider`; never the session (AGENTS.md: the
 * root layout reads no session) and never inside a `cachedRead` /
 * `unstable_cache` callback (Next forbids `cookies()` there).
 *
 * The cookie is the server-render source of truth. Signed-in players'
 * `players.sprite_style` reaches it when they save it (`POST /api/sprite-style`
 * writes both), when they sign in (`syncSpriteStyleCookieAtSignIn`, from the
 * NextAuth jwt callback) and, for a value changed on another device later,
 * through `SpriteStyleAccountSync`'s once-per-tab reconcile (and the settings
 * page). A missing or unknown value is the
 * default ('site'): the cookie is client-controlled, so a junk value is not an
 * error to report.
 */
export const getSpriteStylePreference = cache(async (): Promise<SpriteStylePreference> => {
  const value = (await cookies()).get(SPRITE_STYLE_COOKIE)?.value;
  return isSpriteStylePreference(value) ? value : DEFAULT_SPRITE_STYLE_PREFERENCE;
});
