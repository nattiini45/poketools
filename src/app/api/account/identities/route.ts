import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getAuthUserEmailState } from '@/lib/supabase/queries/auth-users';
import { safeErrorResponse } from '@/lib/api/error-response';
import type { ApiResult } from '@/types/api';

export interface AccountIdentities {
  hasDiscord: boolean;
  hasEmail: boolean;
  email: string | null;
  emailConfirmed: boolean;
}

/**
 * GET /api/account/identities
 *
 * Returns which login methods are linked to the current player. Email
 * address is read from Supabase Auth (auth.users is the single source of
 * truth — players has no email column).
 */
export async function GET() {
  try {
    const sessionPlayer = await requirePlayer();
    const player = await getPlayerById(sessionPlayer.playerId);
    if (!player) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 }
      );
    }

    let email: string | null = null;
    let emailConfirmed = false;
    if (player.auth_user_id) {
      const state = await getAuthUserEmailState(player.auth_user_id);
      if (state) {
        email = state.email;
        emailConfirmed = state.emailConfirmed;
      }
    }

    return NextResponse.json<ApiResult<AccountIdentities>>({
      success: true,
      data: {
        hasDiscord: !!player.discord_id,
        hasEmail: !!player.auth_user_id,
        email,
        emailConfirmed,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load account identities');
  }
}
