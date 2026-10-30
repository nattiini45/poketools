import { NextRequest, NextResponse } from 'next/server';
import { isReservedSuperadminEmail, requirePlayer } from '@/lib/auth/helpers';
import { getPlayerById, linkAuthUserToPlayer } from '@/lib/supabase/queries/players';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { linkEmailSchema, formatZodErrors } from '@/lib/validation';
import { getRequestLocale } from '@/i18n/server';
import { readJsonBody } from '@/lib/api/json-body';
import { checkRateLimit, emailIdentity, rateLimitedResponse, type RateLimitOptions } from '@/lib/utils/rate-limit';
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
 * authenticated, unlike the public signup route, and every attempt counts
 * against two fail-closed limits (per player, per inbox) before anything is
 * checked, so the answer cannot be used to test addresses in bulk (#36).
 *
 * SUPERADMIN_EMAIL is reserved: only the SUPERADMIN_DISCORD_ID player may
 * link it. Anyone else gets the generic create-failed 400, so the
 * route does not reveal which address is reserved.
 */
/** Attempts per player, whatever the address. */
export const LINK_EMAIL_PLAYER_LIMIT: RateLimitOptions = { limit: 5, windowSeconds: 60 * 60, failMode: 'closed' };
/** Attempts per inbox (`emailIdentity`), whoever asks. */
export const LINK_EMAIL_INBOX_LIMIT: RateLimitOptions = { limit: 3, windowSeconds: 60 * 60, failMode: 'closed' };

const CREATE_FAILED_BODY: ApiResult<never> = {
  success: false,
  error: 'Could not create the email login. Check the email and password and try again.',
  code: 'email_login_create_failed',
};

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

    const perPlayer = await checkRateLimit('link-email-player', player.id, LINK_EMAIL_PLAYER_LIMIT);
    if (!perPlayer.allowed) return rateLimitedResponse(perPlayer.retryAfterSeconds);

    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const parsed = linkEmailSchema.safeParse(body.value);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const perInbox = await checkRateLimit('link-email-inbox', emailIdentity(parsed.data.email), LINK_EMAIL_INBOX_LIMIT);
    if (!perInbox.allowed) return rateLimitedResponse(perInbox.retryAfterSeconds);

    const superadminDiscordId = process.env.SUPERADMIN_DISCORD_ID;
    const isDiscordSuperadmin = !!superadminDiscordId && player.discord_id === superadminDiscordId;
    if (isReservedSuperadminEmail(parsed.data.email) && !isDiscordSuperadmin) {
      return NextResponse.json<ApiResult<never>>(CREATE_FAILED_BODY, { status: 400 });
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
        return NextResponse.json<ApiResult<never>>(CREATE_FAILED_BODY, { status: 400 });
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
