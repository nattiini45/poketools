import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { checkAuthRateLimit } from '@/lib/auth/rate-limits';
import { rateLimitedResponse } from '@/lib/utils/rate-limit';
import { signupSchema, formatZodErrors } from '@/lib/validation';
import { getRequestLocale } from '@/i18n/server';
import type { ApiResult } from '@/types/api';

// Public: no auth required
//
// Creates a Supabase Auth user and sends a confirmation email. The player
// row is NOT created here — it's created on first successful login (jwt
// callback), so unverified signups never pollute the players table.
//
// Anti-enumeration: an already-registered email returns the same generic
// success message as a fresh signup.
//
// The viewer's UI language (`plc_locale` cookie) is stored as
// `user_metadata.locale`, so the Supabase email templates
// (`supabase/templates/*.html`) can pick English or German (i18n-core §6.6).

const GENERIC_SUCCESS = 'Check your inbox to confirm your email address.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const rawBody = body.value;
    const parsed = signupSchema.safeParse(rawBody);

    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const { email, password, display_name } = parsed.data;

    const denied = await checkAuthRateLimit('signup', request, email);
    if (denied) return rateLimitedResponse(denied.retryAfterSeconds);

    // Constant delay to blunt brute-force/enumeration timing
    await new Promise((r) => setTimeout(r, 500));

    const client = createAuthClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name, locale: getRequestLocale(request) },
      },
    });

    if (error) {
      // Weak password / rate limit etc. — don't leak Supabase internals,
      // but distinguish validation-class failures from server faults.
      if (error.status && error.status >= 400 && error.status < 500) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'Signup failed. Check your email and password and try again.',
            code: 'signup_failed',
          },
          { status: 400 }
        );
      }
      throw error;
    }

    // data.user.identities is [] when the email is already registered —
    // still return the generic success (no enumeration).
    void data;

    return NextResponse.json<ApiResult<{ message: string }>>({
      success: true,
      data: { message: GENERIC_SUCCESS },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Signup failed', 500, 'signup_error');
  }
}
