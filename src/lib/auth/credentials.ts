// Import from @auth/core directly (next-auth re-exports it) so this module
// stays importable outside the Next.js runtime (e.g. Vitest).
import { CredentialsSignin } from '@auth/core/errors';
import { createAuthClient } from '@/lib/supabase/auth-client';
import { checkAuthRateLimit } from '@/lib/auth/rate-limits';
import { FIELD_LIMITS } from '@/lib/validation/schemas';

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

  return {
    id: data.user.id,
    email: normalizedEmail,
    displayName: resolveDisplayName(data.user.user_metadata?.display_name, normalizedEmail),
  };
}

/**
 * GoTrue's own signup endpoint is reachable with the public anon key, so the
 * `display_name` metadata can bypass the app's signup schema. It becomes the
 * stored player name, hence it is brought to the name rules here: control
 * characters dropped, whitespace collapsed, at most `FIELD_LIMITS.NAME`
 * characters (counted in code points, so a pair is never cut). A missing or
 * empty result falls back to the email's local part, cleaned the same way.
 */
function resolveDisplayName(raw: unknown, normalizedEmail: string): string {
  const fromMetadata = typeof raw === 'string' ? cleanName(raw) : '';
  return fromMetadata || cleanName(normalizedEmail.split('@')[0]) || 'Player';
}

function cleanName(value: string): string {
  const cleaned = value.replace(/\s+/gu, ' ').replace(/\p{Cc}+/gu, '').trim();
  return Array.from(cleaned).slice(0, FIELD_LIMITS.NAME).join('').trim();
}
