import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

/**
 * Proxy external images to avoid CORS issues during client-side canvas capture.
 * Tightly scoped: only sprite-path images from Pokémon Showdown and PokemonDB.
 */
// Public: no auth required

/** Host + path-prefix pairs that are allowed through the proxy. */
const ALLOWED_ORIGINS: { host: string; pathPrefix: string }[] = [
  { host: 'play.pokemonshowdown.com', pathPrefix: '/sprites/' },
  { host: 'img.pokemondb.net', pathPrefix: '/sprites/' },
];

const ALLOWED_CONTENT_TYPE_PREFIX = 'image/';

/** Browser: 1 day. CDN edge: 7 days, plus 1 day stale-while-revalidate. */
const PROXY_IMAGE_CACHE_CONTROL =
  'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateResult = checkRateLimit(`proxy-image:${ip}`, 60, 60_000);
  if (!rateResult.allowed) {
    return NextResponse.json<ApiResult<never>>(
      {
        success: false,
        error: 'Rate limit exceeded',
        code: 'rate_limited',
        params: { seconds: rateResult.retryAfterSeconds },
      },
      { status: 429, headers: { 'Retry-After': String(rateResult.retryAfterSeconds) } }
    );
  }

  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Missing url parameter', code: 'proxy_url_missing' },
      { status: 400 }
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (err) {
    return safeErrorResponse(err, 'Invalid URL', 400, 'proxy_url_invalid');
  }

  // Enforce HTTPS only
  if (parsed.protocol !== 'https:') {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Only HTTPS URLs are allowed', code: 'proxy_https_only' },
      { status: 403 }
    );
  }

  // Check host + path-prefix allowlist
  const allowed = ALLOWED_ORIGINS.some(
    (o) => parsed.hostname === o.host && parsed.pathname.startsWith(o.pathPrefix)
  );
  if (!allowed) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Domain or path not allowed', code: 'proxy_url_not_allowed' },
      { status: 403 }
    );
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Upstream fetch failed', code: 'proxy_upstream_failed' },
        { status: 502 }
      );
    }

    // Validate upstream actually returned an image
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith(ALLOWED_CONTENT_TYPE_PREFIX)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Upstream did not return an image', code: 'proxy_upstream_not_image' },
        { status: 502 }
      );
    }

    const buffer = await response.arrayBuffer();

    // Sprites are immutable per URL: browsers keep them a day, and the CDN
    // keeps them a week (then serves stale for a day while it refetches), so
    // repeat views never re-run this function or re-hit the upstream host.
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': PROXY_IMAGE_CACHE_CONTROL,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Proxy fetch failed', 502);
  }
}
