import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { getPlayerById, linkAuthUserToPlayer } from '@/lib/supabase/queries/players';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { linkEmailSchema, formatZodErrors } from '@/lib/validation';
import { getRequestLocale } from '@/i18n/server';
import type { ApiResult } from '@/types/api';

/**
 * POST /api/account/link-email
 *
 * Adds an email/password login to the current (Discord-authenticated)
 * player. Creates the Supabase Auth user and links it immediately; email
 * login stays blocked by GoTrue until the address is confirmed, so linking
 * before verification is safe.
 *
 * Explicit duplicate-email error is acceptable here: the caller is
 * authenticated, unlike the public signup route.
 */
export async function POST(request: NextRequest) {
  try {
    const sessionPlayer = await requirePlayer();
    const player = await getPlayerById(sessionPlayer.playerId);
    if (!player) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Player not found', code: 'player_not_found' },
        { status: 404 }
      );
    }
    if (player.auth_user_id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'An email login is already linked to this account.', code: 'email_login_already_linked' },
        { status: 409 }
      );
    }

    const rawBody = await request.json().catch(() => ({}));
    const parsed = linkEmailSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const client = createAuthClient();
    const { data, error } = await client.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        // The UI language picks the confirmation email's language (i18n-core §6.6).
        data: { display_name: player.name, locale: getRequestLocale(request) },
      },
    });

    if (error) {
      if (error.status && error.status >= 400 && error.status < 500) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Could not create the email login. Check the email and password and try again.', code: 'email_login_create_failed' },
          { status: 400 }
        );
      }
      throw error;
    }

    if (!data.user || data.user.identities?.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'This email is already registered.', code: 'email_already_registered' },
        { status: 409 }
      );
    }

    await linkAuthUserToPlayer(player.id, data.user.id);

    return NextResponse.json<ApiResult<{ message: string }>>({
      success: true,
      data: { message: 'Email login added. Check your inbox to confirm the address before using it to sign in.' },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to link email login', 500, 'email_login_link_failed');
  }
}
