import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { resendVerificationSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

// Public: no auth required
//
// Re-sends the signup confirmation email. Always returns a generic success
// so the endpoint can't be used to probe which emails are registered.

const GENERIC_SUCCESS = 'If that email has a pending signup, a new confirmation email is on its way.';

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => ({}));
    const parsed = resendVerificationSchema.safeParse(rawBody);

    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const client = createAuthClient();
    const { error } = await client.auth.resend({
      type: 'signup',
      email: parsed.data.email,
    });

    if (error) {
      // Swallow per-email failures (unknown address, already confirmed,
      // rate limit) — same generic response either way.
      console.warn('[auth] resend verification failed:', error.code ?? error.message);
    }

    return NextResponse.json<ApiResult<{ message: string }>>({
      success: true,
      data: { message: GENERIC_SUCCESS },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to resend verification email', 500, 'verification_resend_failed');
  }
}
