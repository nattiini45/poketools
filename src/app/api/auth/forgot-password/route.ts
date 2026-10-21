import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { checkAuthRateLimit } from '@/lib/auth/rate-limits';
import { rateLimitedResponse } from '@/lib/utils/rate-limit';
import { forgotPasswordSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

// Public: no auth required
//
// Sends a password recovery email (Supabase template carries token_hash to
// /auth/reset-password). Always returns a generic success — no enumeration.

const GENERIC_SUCCESS = 'If an account exists for that email, a password reset link is on its way.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const rawBody = body.value;
    const parsed = forgotPasswordSchema.safeParse(rawBody);

    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const denied = await checkAuthRateLimit('forgot-password', request, parsed.data.email);
    if (denied) return rateLimitedResponse(denied.retryAfterSeconds);

    const client = createAuthClient();
    const { error } = await client.auth.resetPasswordForEmail(parsed.data.email);

    if (error) {
      // Same generic response either way — log for ops only.
      console.warn('[auth] password reset email failed:', error.code ?? error.message);
    }

    return NextResponse.json<ApiResult<{ message: string }>>({
      success: true,
      data: { message: GENERIC_SUCCESS },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to send password reset email', 500, 'password_reset_email_failed');
  }
}
