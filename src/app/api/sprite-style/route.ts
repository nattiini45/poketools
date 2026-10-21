import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getSession, requireAuth } from '@/lib/auth/helpers';
import {
  SPRITE_STYLE_COOKIE,
  SPRITE_STYLE_PREFERENCES,
  type SpriteStylePreference,
} from '@/lib/pkmn/sprite-styles';
import { spriteStyleCookieOptions } from '@/lib/pkmn/sprite-style.server';
import { getPlayerSpriteStyle, setPlayerSpriteStyle } from '@/lib/supabase/queries/player-sprite-style';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

// Public: no auth required
//
// POST /api/sprite-style { style } — the viewer's sprite style (docs/pkmn.md,
// "Sprite styles"). Modelled on POST /api/locale:
//  - every caller gets the `plc_sprite_style` cookie (the root layout reads it
//    into SpriteStyleProvider, so the next render already uses the style);
//  - a signed-in caller with a player row also gets it stored in
//    `players.sprite_style`, the account-wide value SpriteStyleAccountSync
//    re-syncs into the cookie on another browser (via GET below). That write is authorized by the live
//    `requireAuth()` guard (a banned or suspended account is refused) and
//    targets the guard's player id, never an id from the body. It is limited
//    to 30 per player per minute (429 `rate_limited`, no cookie).
// The cookie is httpOnly (only the server reads it) and the server-render
// source of truth; the sign-in sync (src/lib/pkmn/sprite-style-signin.server.ts)
// is its only other writer.
//
// GET /api/sprite-style — the signed-in caller's stored `players.sprite_style`
// (`{ stored }`, null for an anonymous caller or one without a player row).
// SpriteStyleAccountSync calls it once per signed-in player and browser tab and,
// when the account value differs from the cookie, POSTs it back: the account
// value applies on every device without visiting /dashboard/settings. Read-only,
// `no-store`, authorized by the live `requireAuth()` guard like the POST.

const INVALID_MESSAGE = "style must be one of 'site', 'broadcast', 'home', 'animated' or 'pixel'.";

/**
 * Signed-in writes of `players.sprite_style`: 30 per player per minute, far
 * above a person clicking through the five styles plus the once-per-tab
 * reconcile, low enough that a script cannot hammer the column. Anonymous
 * calls write only their own cookie and are not limited.
 */
const SPRITE_STYLE_RATE_BUCKET = 'sprite-style';
const SPRITE_STYLE_RATE_LIMIT = { limit: 30, windowSeconds: 60 } as const;

const bodySchema =z.object({ style: z.enum(SPRITE_STYLE_PREFERENCES) }).strict();

type SpriteStyleData = { style: SpriteStylePreference; persisted: boolean };

type SpriteStyleStoredData = { stored: SpriteStylePreference | null };

export async function GET(): Promise<NextResponse<ApiResult<SpriteStyleStoredData>>> {
  try {
    let stored: SpriteStylePreference | null = null;
    if (await getSession()) {
      const session = await requireAuth();
      if (session.player) stored = await getPlayerSpriteStyle(session.player.playerId);
    }
    return NextResponse.json<ApiResult<SpriteStyleStoredData>>(
      { success: true, data: { stored } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load the sprite style', 500, 'sprite_style_load_failed');
  }
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  return origin === request.nextUrl.origin;
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResult<SpriteStyleData>>> {
  try {
    if (!sameOrigin(request)) {
      console.error('[api/sprite-style] cross-origin sprite style change refused:', request.headers.get('origin'));
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Cross-origin sprite style change refused.', code: 'sprite_style_cross_origin' },
        { status: 403 },
      );
    }

    const raw: unknown = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: INVALID_MESSAGE, code: 'sprite_style_invalid' },
        { status: 400 },
      );
    }
    const { style } = parsed.data;

    // Signed in: the live guard decides (throws 401/403 through safeErrorResponse).
    let persisted = false;
    if (await getSession()) {
      const session = await requireAuth();
      if (session.player) {
        // The column write is limited per player; a refusal sets no cookie
        // either, so the control reverts to the stored choice.
        const rate = await checkRateLimit(SPRITE_STYLE_RATE_BUCKET, session.player.playerId, SPRITE_STYLE_RATE_LIMIT);
        if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);
        await setPlayerSpriteStyle(session.player.playerId, style);
        persisted = true;
      }
    }

    const res = NextResponse.json<ApiResult<SpriteStyleData>>({ success: true, data: { style, persisted } });
    res.cookies.set(SPRITE_STYLE_COOKIE, style, spriteStyleCookieOptions());
    return res;
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save the sprite style', 500, 'sprite_style_save_failed');
  }
}
