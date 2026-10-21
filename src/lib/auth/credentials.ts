// Import from @auth/core directly (next-auth re-exports it) so this module
// stays importable outside the Next.js runtime (e.g. Vitest).
import { CredentialsSignin } from '@auth/core/errors';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { checkAuthRateLimit } from '@/lib/auth/rate-limits';

/**
 * Email/password sign-in backed by Supabase Auth (GoTrue), called server-side
 * from the NextAuth Credentials provider. Supabase error messages are never
 * surfaced to clients — only the stable `code` values below.
 */

export class InvalidCredentialsError extends CredentialsSignin {
  code = 'invalid_credentials';
}

export class EmailNotVerifiedError extends CredentialsSignin {
  code = 'email_not_verified';
}

/** Too many password attempts from this client IP (request limiter, `AUTH_RATE_LIMITS.signin`). */
export class TooManySignInAttemptsError extends CredentialsSignin {
  code = 'too_many_attempts';
}

export interface CredentialsUser {
  /** Supabase Auth user UUID */
  id: string;
  email: string;
  displayName: string;
}

/**
 * `request` is the sign-in request NextAuth hands to `authorize`; when given,
 * the attempt is counted per client IP before GoTrue is asked (brute-force
 * guard, code review H8; no per-email bucket, so a stranger cannot lock an
 * account out). The limiter fails open: an outage is
 * logged and sign-in keeps working.
 */
export async function authorizeCredentials(
  email: string,
  password: string,
  request?: Pick<Request, 'headers'>
): Promise<CredentialsUser> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new InvalidCredentialsError();
  }

  if (request) {
    const denied = await checkAuthRateLimit('signin', request);
    if (denied) throw new TooManySignInAttemptsError();
  }

  const client = createAuthClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: normalizedEmail,
    password,
  });

  if (error) {
    if (error.code === 'email_not_confirmed') {
      throw new EmailNotVerifiedError();
    }
    throw new InvalidCredentialsError();
  }

  const displayName =
    typeof data.user.user_metadata?.display_name === 'string' &&
    data.user.user_metadata.display_name.trim()
      ? data.user.user_metadata.display_name.trim()
      : normalizedEmail.split('@')[0];

  return {
    id: data.user.id,
    email: normalizedEmail,
    displayName,
  };
}
