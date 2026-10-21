import { describe, it, expect, vi, beforeEach } from 'vitest';

// The limiter decision is mocked; the 429 body comes from the real `rateLimitedResponse`.
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkPublicRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 })),
}));

import { GET } from '../route';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';
import { checkPublicRateLimit } from '@/lib/utils/rate-limit';

// ── Helpers ────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetchSuccess(contentType = 'image/png') {
  const buffer = new ArrayBuffer(8);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': contentType }),
    arrayBuffer: () => Promise.resolve(buffer),
  });
}

function mockFetchFailure() {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    headers: new Headers({}),
  });
}

function mockFetchThrow() {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
}

describe('GET /api/proxy-image', () => {
  // Public: no auth required
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // ── Validation ─────────────────────────────────────────────────────

  it('returns 400 when url param is missing', async () => {
    const res = await GET(makeRequest(undefined, {}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Missing url parameter');
    expect(body.code).toBe('proxy_url_missing');
  });

  it('returns 400 for an invalid URL', async () => {
    const res = await GET(makeRequest(undefined, { url: 'not-a-url' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid URL');
    expect(body.code).toBe('proxy_url_invalid');
  });

  it('returns 403 for non-HTTPS URLs', async () => {
    const res = await GET(
      makeRequest(undefined, { url: 'http://play.pokemonshowdown.com/sprites/gen5/pikachu.png' }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('Only HTTPS URLs are allowed');
    expect(body.code).toBe('proxy_https_only');
  });

  it('returns 403 for a disallowed host', async () => {
    const res = await GET(
      makeRequest(undefined, { url: 'https://evil.com/sprites/pikachu.png' }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('Domain or path not allowed');
    expect(body.code).toBe('proxy_url_not_allowed');
  });

  it('returns 403 for an allowed host but wrong path prefix', async () => {
    const res = await GET(
      makeRequest(undefined, { url: 'https://play.pokemonshowdown.com/users/pikachu.png' }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('Domain or path not allowed');
    expect(body.code).toBe('proxy_url_not_allowed');
  });

  it('returns 403 for an allowed host on a non-default port', async () => {
    mockFetchSuccess();
    const res = await GET(
      makeRequest(undefined, { url: 'https://play.pokemonshowdown.com:8443/sprites/gen5/pikachu.png' }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe('proxy_url_not_allowed');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns 403 for an allowed host with embedded credentials', async () => {
    mockFetchSuccess();
    const res = await GET(
      makeRequest(undefined, { url: 'https://user:pass@play.pokemonshowdown.com/sprites/gen5/pikachu.png' }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe('proxy_url_not_allowed');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it('refuses upstream redirects instead of following them', async () => {
    mockFetchSuccess('image/png');

    await GET(makeRequest(undefined, { url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png' }));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('fetches only the allowlisted origin plus the vetted path, never the caller query or fragment', async () => {
    mockFetchSuccess('image/png');

    await GET(
      makeRequest(undefined, { url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png?x=1#frag' }),
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      expect.anything(),
    );
  });

  it.each([
    'https://play.pokemonshowdown.com/sprites/%2e%2e/secret.png',
    'https://play.pokemonshowdown.com/sprites/gen5//pikachu.png',
    'https://play.pokemonshowdown.com/sprites/%E0%A4%A.png',
  ])('refuses an empty, dot or malformed sprite path segment: %s', async (url) => {
    mockFetchSuccess('image/png');

    const res = await GET(makeRequest(undefined, { url }));

    expect(res.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('re-encodes each sprite path segment so an encoded slash stays inside it', async () => {
    mockFetchSuccess('image/png');

    await GET(makeRequest(undefined, { url: 'https://img.pokemondb.net/sprites/home/normal/a%2Fb.png' }));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://img.pokemondb.net/sprites/home/normal/a%2Fb.png',
      expect.anything(),
    );
  });

  it('accepts an image content type with parameters and returns the bare type', async () => {
    mockFetchSuccess('image/png; charset=binary');

    const res = await GET(
      makeRequest(undefined, { url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('proxies an image from Showdown sprites', async () => {
    mockFetchSuccess('image/png');

    const res = await GET(
      makeRequest(undefined, {
        url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toContain('max-age=86400');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('lets the CDN cache sprites for a week with a day of stale-while-revalidate', async () => {
    mockFetchSuccess('image/png');

    const res = await GET(
      makeRequest(undefined, {
        url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    );
  });

  it('does not mark error responses as cacheable', async () => {
    mockFetchFailure();

    const res = await GET(
      makeRequest(undefined, {
        url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      }),
    );

    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control') ?? '').not.toContain('s-maxage');
  });

  it('proxies an image from PokemonDB sprites', async () => {
    mockFetchSuccess('image/webp');

    const res = await GET(
      makeRequest(undefined, {
        url: 'https://img.pokemondb.net/sprites/home/normal/pikachu.png',
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
  });

  // ── Upstream errors ────────────────────────────────────────────────

  it('returns 502 when upstream returns non-ok status', async () => {
    mockFetchFailure();

    const res = await GET(
      makeRequest(undefined, {
        url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain('Upstream fetch failed');
    expect(body.code).toBe('proxy_upstream_failed');
  });

  it('returns 502 when upstream returns non-image content type', async () => {
    mockFetchSuccess('text/html');

    const res = await GET(
      makeRequest(undefined, {
        url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain('Upstream did not return an image');
    expect(body.code).toBe('proxy_upstream_not_image');
  });

  it('returns 502 for an SVG upstream response', async () => {
    mockFetchSuccess('image/svg+xml');

    const res = await GET(
      makeRequest(undefined, { url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.svg' }),
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe('proxy_upstream_not_image');
  });

  it('returns 502 when the upstream redirects (fetch rejects the redirect)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: unexpected redirect'));

    const res = await GET(
      makeRequest(undefined, { url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png' }),
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain('Proxy fetch failed');
  });

  it('returns 502 when fetch throws (network error)', async () => {
    mockFetchThrow();

    const res = await GET(
      makeRequest(undefined, {
        url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png',
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain('Proxy fetch failed');
  });

  // ── Rate limit (per client IP) ────────────────────────────

  it('checks the per-IP public limiter on the request before any upstream fetch: 60 per minute', async () => {
    mockFetchSuccess();
    const req = makeRequest(undefined, { url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png' });

    await GET(req);

    expect(vi.mocked(checkPublicRateLimit)).toHaveBeenCalledWith('proxy-image', req, { limit: 60, windowSeconds: 60 });
  });

  it('returns 429 with the retry delay and never fetches when the limiter denies', async () => {
    mockFetchSuccess();
    vi.mocked(checkPublicRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 17 });

    const res = await GET(makeRequest(undefined, { url: 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png' }));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('17');
    expect(body).toEqual({
      success: false,
      error: 'Rate limit exceeded. Try again in 17s.',
      code: 'rate_limited',
      params: { seconds: 17 },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
