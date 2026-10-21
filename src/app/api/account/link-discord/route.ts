import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { LINK_DISCORD_COOKIE } from '@/auth';
import { requirePlayer } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { safeErrorResponse } from '@/lib/api/error-response';
import { signLinkToken } from '@/lib/utils/crypto';
import { requireEnv } from '@/lib/env';
import type { ApiResult } from '@/types/api';

const LINK_INTENT_TTL_MS = 10 * 60 * 1000;

/**
 * POST /api/account/link-discord
 *
 * Step 1 of linking Discord to an email/password account: sets a signed,
 * single-use intent cookie, then the client starts the Discord OAuth flow.
 * The signIn callback in src/auth.ts consumes the cookie and performs the
 * actual link.
 */
export async function POST() {
  try {
    const sessionPlayer = await requirePlayer();
    const player = await getPlayerById(sessionPlayer.playerId);
    if (!player) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 }
      );
    }
    if (player.discord_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'A Discord account is already linked.', code: 'discord_already_linked' },
        { status: 409 }
      );
    }

    const expiresAtMs = Date.now() + LINK_INTENT_TTL_MS;
    const token = signLinkToken(player.id, expiresAtMs, requireEnv('NEXTAUTH_SECRET'));

    const cookieStore = await cookies();
    cookieStore.set(LINK_DISCORD_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: LINK_INTENT_TTL_MS / 1000,
    });

    return NextResponse.json<ApiResult<{ message: string }>>({
      success: true,
      data: { message: 'Link intent created. Continue with Discord sign-in.' },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to start Discord linking', 500, 'discord_link_start_failed');
  }
}
