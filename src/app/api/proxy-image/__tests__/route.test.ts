import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GET } from '../route';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

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

  // ── Happy path ─────────────────────────────────────────────────────

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
});
