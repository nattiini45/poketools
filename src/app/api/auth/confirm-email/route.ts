import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { checkAuthRateLimit } from '@/lib/auth/rate-limits';
import { rateLimitedResponse } from '@/lib/utils/rate-limit';
import { confirmEmailSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

// Public: no auth required
//
// Consumes the token_hash from the Supabase confirmation email.
// POST (not GET) so mail-scanner link prefetch can't burn the token —
// the /auth/confirm page gates this behind a button click.

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const rawBody = body.value;
    const parsed = confirmEmailSchema.safeParse(rawBody);

    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const denied = await checkAuthRateLimit('confirm-email', request);
    if (denied) return rateLimitedResponse(denied.retryAfterSeconds);

    const client = createAuthClient();
    const { error } = await client.auth.verifyOtp({
      type: 'email',
      token_hash: parsed.data.token_hash,
    });

    if (error) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Confirmation link is invalid or has expired. Request a new one below.', code: 'confirm_link_invalid' },
        { status: 400 }
      );
    }

    return NextResponse.json<ApiResult<{ message: string }>>({
      success: true,
      data: { message: 'Email confirmed! You can now sign in.' },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Email confirmation failed', 500, 'email_confirmation_failed');
  }
}
