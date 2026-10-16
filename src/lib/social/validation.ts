import type { SocialCredentials } from '@/types/social';

export function hasValue(value: string | null | undefined): value is string {
  return Boolean(value && value.trim().length > 0);
}

/**
 * A missing credential field: the English `message` plus the parts a localized
 * client message needs (`social_credentials_field_required` with
 * `{ provider, field }`). `provider` is the display name (X, Threads, Bluesky),
 * `field` the credential key.
 */
export interface CredentialFieldError {
  message: string;
  provider: string;
  field: string;
}

function missingField(provider: string, field: string): CredentialFieldError {
  return { message: `${provider} credentials require ${field}`, provider, field };
}

/** The first required credential field that is empty, or null when complete. */
export function checkCredentials(credentials: SocialCredentials): CredentialFieldError | null {
  if (credentials.provider === 'x') {
    if (!hasValue(credentials.access_token)) return missingField('X', 'access_token');
    return null;
  }

  if (credentials.provider === 'threads') {
    if (!hasValue(credentials.access_token)) return missingField('Threads', 'access_token');
    if (!hasValue(credentials.user_id)) return missingField('Threads', 'user_id');
    return null;
  }

  if (!hasValue(credentials.handle)) return missingField('Bluesky', 'handle');
  if (!hasValue(credentials.app_password)) return missingField('Bluesky', 'app_password');
  return null;
}

/** The English message of `checkCredentials`, or null when complete. */
export function validateCredentials(credentials: SocialCredentials): string | null {
  return checkCredentials(credentials)?.message ?? null;
}

export function toCredentialHint(credentials: SocialCredentials): string | null {
  if (credentials.provider === 'x') {
    return credentials.account_label ?? credentials.user_id ?? 'X account';
  }

  if (credentials.provider === 'threads') {
    return credentials.account_label ?? credentials.user_id;
  }

  return credentials.handle;
}
