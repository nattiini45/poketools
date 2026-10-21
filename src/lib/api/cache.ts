/**
 * Cache-Control header helpers for API routes.
 *
 * Most public read routes return immutable-or-stale-safe data and share the
 * same `public, s-maxage=X, stale-while-revalidate=Y` shape. Use
 * `cacheHeaders()` for bespoke values and the named constants for the common
 * buckets so the magic strings don't drift.
 */

/** Full Cache-Control header value object, ready to spread into `headers`. */
export type CacheHeaders = Readonly<{ 'Cache-Control': string }>;

/**
 * Build a `public, s-maxage=X, stale-while-revalidate=Y` Cache-Control value.
 * `maxAge` is the CDN edge TTL in seconds; `swr` is the stale-while-revalidate
 * window (defaults to 4× the max-age, mirroring the wiki/dex convention).
 */
export function cacheHeaders(maxAgeSeconds: number, swrSeconds?: number): CacheHeaders {
  const swr = swrSeconds ?? maxAgeSeconds * 4;
  return { 'Cache-Control': `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${swr}` };
}

/**
 * Named cache buckets. Import as `CACHE.HOUR` etc. Routes whose data changes
 * more often should use `cacheHeaders()` with explicit shorter values.
 */
export const CACHE = {
  /** 5s edge + 10s SWR — near-real-time broadcast state. */
  REALTIME: cacheHeaders(5, 10),
  /** 1 minute edge + 5 minute SWR — aggregates / stats that recompute often. */
  MINUTE: cacheHeaders(60, 300),
  /** 1 minute edge + 1 minute SWR — /api/stats; shorter SWR pairs with post-aggregate revalidation. */
  STATS: cacheHeaders(60, 60),
  /** 1 hour edge + 1 day SWR — dex / wiki data (immutable per deploy). */
  HOUR: cacheHeaders(3600, 86400),
  /** 1 day edge — fully static manifests. */
  DAY: cacheHeaders(86400, 86400),
  /** No caching. */
  NONE: { 'Cache-Control': 'no-store' } as const,
} as const;