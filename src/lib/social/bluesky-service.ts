import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { readEnv, socialEnvSchema } from '@/lib/env';
import {
  checkBlueskyServiceUrl,
  parseHostAllowlist,
  type BlueskyServiceUrlRejection,
} from './bluesky-host';

/**
 * A stored `service_url` the provider refuses to post to. The message and the
 * code's `reason` param name the rule that failed, never the URL, so it is safe
 * to return to the admin (a distinct 422 at the test route) and to log.
 */
export class BlueskyServiceUrlError extends UserFacingError<'social_bluesky_service_url_rejected'> {
  readonly reason: BlueskyServiceUrlRejection;

  constructor(reason: BlueskyServiceUrlRejection) {
    super(`The stored Bluesky server address is not allowed (${reason})`, {
      code: 'social_bluesky_service_url_rejected',
      params: { reason },
      status: 422,
    });
    this.name = 'BlueskyServiceUrlError';
    this.reason = reason;
  }
}

/**
 * The checked `https://host` base for one `service_url`, against the default
 * host plus `BLUESKY_SERVICE_HOST_ALLOWLIST`. Throws `BlueskyServiceUrlError`.
 */
export function resolveBlueskyServiceUrl(value: string | null | undefined): string {
  const allowlist = parseHostAllowlist(readEnv(socialEnvSchema).BLUESKY_SERVICE_HOST_ALLOWLIST);
  const result = checkBlueskyServiceUrl(value, allowlist);
  if (!result.ok) throw new BlueskyServiceUrlError(result.reason);
  return result.origin;
}

/** The rejection reason for a `service_url` that must not be stored, or null when it is acceptable. */
export function blueskyServiceUrlRejection(
  value: string | null | undefined,
): BlueskyServiceUrlRejection | null {
  try {
    resolveBlueskyServiceUrl(value);
    return null;
  } catch (err) {
    if (err instanceof BlueskyServiceUrlError) return err.reason;
    throw err;
  }
}
