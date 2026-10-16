// Import from @auth/core directly (next-auth re-exports it) so this module
// stays importable outside the Next.js runtime (e.g. Vitest).
import { CredentialsSignin } from '@auth/core/errors';
import { createAuthClient } from '@/lib/supabase/auth-client';

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

export interface CredentialsUser {
  /** Supabase Auth user UUID */
  id: string;
  email: string;
  displayName: string;
}

export async function authorizeCredentials(
  email: string,
  password: string
): Promise<CredentialsUser> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new InvalidCredentialsError();
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
