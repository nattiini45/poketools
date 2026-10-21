import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { checkPublicRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
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

/**
 * Raster types only. SVG is excluded on purpose: served same-origin it can run
 * script under the site CSP, and no sprite style needs it.
 */
const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/gif',
  'image/jpeg',
  'image/webp',
]);

/**
 * The fetch target for an allowlisted request. Each host is a literal
 * `https://host/sprites/` prefix, so only the path below `/sprites/` comes
 * from the caller and can never change the host (CodeQL js/request-forgery).
 */
function upstreamUrl(host: string, spritePath: string): string {
  switch (host) {
    case 'play.pokemonshowdown.com':
      return `https://play.pokemonshowdown.com/sprites/${spritePath}`;
    case 'img.pokemondb.net':
      return `https://img.pokemondb.net/sprites/${spritePath}`;
    default:
      throw new Error(`proxy-image: no upstream for allowlisted host ${host}`);
  }
}

/**
 * Re-encodes the caller's path below `/sprites/` one segment at a time, so a
 * segment can never carry a `/`, `?`, `#` or `@` into the upstream URL.
 * Null for an empty, `.` or `..` segment (an encoded `%2e%2e` would
 * otherwise climb out of `/sprites/` once fetch normalises the path) or a
 * malformed percent escape.
 */
function encodeSpritePath(rawPath: string): string | null {
  const segments: string[] = [];
  for (const raw of rawPath.split('/')) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '' || segment === '.' || segment === '..') return null;
    segments.push(encodeURIComponent(segment));
  }
  return segments.join('/');
}

/** Browser: 1 day. CDN edge: 7 days, plus 1 day stale-while-revalidate. */
const PROXY_IMAGE_CACHE_CONTROL =
  'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400';

export async function GET(req: NextRequest) {
  const rateResult = await checkPublicRateLimit('proxy-image', req, { limit: 60, windowSeconds: 60 });
  if (!rateResult.allowed) return rateLimitedResponse(rateResult.retryAfterSeconds);

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

  // Check host + path-prefix allowlist. `host` includes any port, so a
  // non-default port or embedded credentials never match.
  const origin = ALLOWED_ORIGINS.find(
    (o) =>
      parsed.host === o.host &&
      parsed.port === '' &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname.startsWith(o.pathPrefix)
  );
  if (!origin) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Domain or path not allowed', code: 'proxy_url_not_allowed' },
      { status: 403 }
    );
  }

  try {
    // The upstream URL is rebuilt from the allowlisted origin and the vetted
    // path only (no query, fragment or credentials from the caller), so the
    // request target never comes from user input. Redirects are refused: the
    // allowlist above only vets the first hop.
    const spritePath = encodeSpritePath(parsed.pathname.slice(origin.pathPrefix.length));
    if (spritePath === null) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Domain or path not allowed', code: 'proxy_url_not_allowed' },
        { status: 403 }
      );
    }
    const response = await fetch(upstreamUrl(origin.host, spritePath), {
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Upstream fetch failed', code: 'proxy_upstream_failed' },
        { status: 502 }
      );
    }

    // Validate upstream actually returned an image
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
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
        // Normalised value from the allowlist, never the raw upstream header.
        'Content-Type': contentType,
        'Cache-Control': PROXY_IMAGE_CACHE_CONTROL,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Proxy fetch failed', 502);
  }
}
