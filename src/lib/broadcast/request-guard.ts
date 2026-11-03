import { NextResponse } from 'next/server';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

export interface BroadcastGuardOptions {
  /** Limiter bucket: one per route, so one overlay kind cannot starve another. */
  bucket: string;
  /** Requests per IP per minute. */
  limit: number;
  /** Query parameters the route reads, each with the values it accepts. Anything else is refused. */
  allowedParams: Readonly<Record<string, readonly string[]>>;
}

/**
 * Per-IP limits of the public overlay data routes, sized from the overlays'
 * real polling: one OBS machine shares one IP and runs several overlays at
 * `?poll=1000` (five state-driven overlays is 300 requests a minute).
 * `recap` keeps its own, lower limit (30).
 */
export const BROADCAST_ROUTE_LIMITS = {
  state: { bucket: 'broadcast-state', limit: 300, allowedParams: { enrich: ['true', 'false'] } },
  solo: { bucket: 'broadcast-solo', limit: 150, allowedParams: {} },
  preview: { bucket: 'broadcast-preview', limit: 60, allowedParams: {} },
  standings: { bucket: 'broadcast-standings', limit: 60, allowedParams: {} },
} as const satisfies Record<string, BroadcastGuardOptions>;

function queryIsAccepted(rawUrl: string, allowed: BroadcastGuardOptions['allowedParams']): boolean {
  const url = new URL(rawUrl);
  // `%65nrich=true`, a trailing `&` or a bare `?` parse like the canonical query but are other raw URLs for the CDN.
  const marker = rawUrl.indexOf('?');
  if (marker >= 0) {
    const raw = rawUrl.slice(marker + 1).split('#', 1)[0];
    if (raw === '' || raw !== url.searchParams.toString()) return false;
  }
  const seen = new Set<string>();
  for (const [name, value] of url.searchParams) {
    // A repeated name or an unlisted value is another URL for the CDN, so another cache entry.
    if (seen.has(name)) return false;
    seen.add(name);
    if (!Object.hasOwn(allowed, name) || !allowed[name].includes(value)) return false;
  }
  return true;
}

/**
 * First thing a public overlay data route does after its path-id check.
 * Returns the response to send, or null to carry on:
 *
 * 1. A query the route does not read is refused with 400 before any I/O, and
 *    before the limiter (a Postgres RPC on Vercel). The CDN keys its cache on
 *    the full URL, so an appended `?x=1` would run the whole fan-out again; the
 *    refusal also holds when the limiter fails open, and a refused request
 *    never spends the caller's bucket.
 * 2. The per-IP limit. A limiter outage lets the request through (default
 *    fail-open): it must not black out a live broadcast.
 */
export async function guardBroadcastRequest(
  request: Pick<Request, 'url' | 'headers'>,
  options: BroadcastGuardOptions,
): Promise<NextResponse<ApiResult<never>> | null> {
  if (!queryIsAccepted(request.url, options.allowedParams)) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Unsupported query parameter', code: 'broadcast_query_invalid' },
      { status: 400 },
    );
  }
  const rate = await checkPublicRateLimit(options.bucket, request, { limit: options.limit, windowSeconds: 60 });
  return rate.allowed ? null : rateLimitedResponse(rate.retryAfterSeconds);
}
