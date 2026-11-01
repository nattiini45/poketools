import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { supabase } from '@/lib/supabase/client';
import { revokeSessionsOfAuthUser } from '@/lib/supabase/queries/players';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { checkAuthRateLimit } from '@/lib/auth/rate-limits';
import { rateLimitedResponse } from '@/lib/utils/rate-limit';
import { resetPasswordSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

// Public: no auth required
//
// Completes the forgot-password flow: verifies the recovery token_hash from
// the email, then sets the new password via the admin API. No Supabase
// session is ever persisted — NextAuth remains the only session layer.

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const rawBody = body.value;
    const parsed = resetPasswordSchema.safeParse(rawBody);

    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const denied = await checkAuthRateLimit('reset-password', request);
    if (denied) return rateLimitedResponse(denied.retryAfterSeconds);

    const client = createAuthClient();
    const { data, error } = await client.auth.verifyOtp({
      type: 'recovery',
      token_hash: parsed.data.token_hash,
    });

    if (error || !data.user) {
      // Expected for an expired or reused link; log the cause (never the token) before the generic 400.
      console.warn('[auth] reset-password: recovery token rejected:', error ? (error.code ?? error.name) : 'no user in verifyOtp result');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Reset link is invalid or has expired. Request a new one.', code: 'reset_link_invalid' },
        { status: 400 }
      );
    }

    // The epoch lives on the player, so this also ends the account's Discord sessions. It is written before the
    // password changes and a failure aborts the reset: the other order would leave a changed password with the
    // sessions of whoever held the old one still valid. A password update that fails afterwards only signs the
    // owner out early.
    await revokeSessionsOfAuthUser(data.user.id);

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      data.user.id,
      { password: parsed.data.password }
    );

    if (updateError) throw updateError;

    // Revoke once more: an old-password sign-in that finished between the first write and the password change was
    // stamped after the first epoch. Its `authAt` is the time its attempt started (`authStartedAt`), which precedes
    // this write, so it dies here. The password has already changed, so a failure is retried once and then surfaced.
    try {
      await revokeSessionsOfAuthUser(data.user.id);
    } catch (firstErr) {
      console.error('[auth] reset-password: second session revocation failed, retrying:', firstErr);
      await revokeSessionsOfAuthUser(data.user.id);
    }

    return NextResponse.json<ApiResult<{ message: string }>>({
      success: true,
      data: { message: 'Password updated! You can now sign in.' },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Password reset failed', 500, 'password_reset_failed');
  }
}
