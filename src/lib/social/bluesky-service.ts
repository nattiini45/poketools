import 'server-only';

import { readEnv, socialEnvSchema } from '@/lib/env';
import {
  checkBlueskyServiceUrl,
  parseHostAllowlist,
  type BlueskyServiceUrlRejection,
} from './bluesky-host';

/** A `service_url` the provider refuses to post to. The message names the reason, never the URL. */
export class BlueskyServiceUrlError extends Error {
  readonly reason: BlueskyServiceUrlRejection;

  constructor(reason: BlueskyServiceUrlRejection) {
    super(`[Bluesky] service_url rejected: ${reason}`);
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
