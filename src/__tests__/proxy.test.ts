import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { config, proxy } from '../proxy';

function pageRequest(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://poketools.test${path}`, { headers });
}

/** What the proxy hands the render: Next serialises request header overrides into `x-middleware-request-*` response headers. */
function forwardedRequestHeader(response: Response, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe('proxy request path (#56)', () => {
  it('records the requested path and query for the guards', () => {
    const response = proxy(pageRequest('/dashboard/submit/m1?tab=y'));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard/submit/m1?tab=y');
  });

  it('overwrites a path header the client sent', () => {
    const response = proxy(pageRequest('/dashboard/settings', { 'x-poketools-path': 'https://evil.example/' }));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard/settings');
  });

  it('does not put the path header on the response a client sees', () => {
    const response = proxy(pageRequest('/dashboard'));
    expect(response.headers.get('x-poketools-path')).toBeNull();
  });

  it('drops the _rsc parameter of a client navigation', () => {
    const response = proxy(pageRequest('/dashboard?tab=a&_rsc=abc12'));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard?tab=a');
  });
});

describe('proxy matcher', () => {
  const matches = (url: string) => doesProxyMatch({ config, nextConfig: {}, url });

  it('runs for pages', () => {
    for (const url of ['/', '/leagues', '/dashboard/settings', '/broadcast/match/m1/live', '/auth/signin']) {
      expect(matches(url), url).toBe(true);
    }
  });

  it('skips the API, static assets, images and the favicon', () => {
    for (const url of ['/api/csp-report', '/api/auth/session', '/_next/static/chunks/a.js', '/_next/image', '/favicon.ico']) {
      expect(matches(url), url).toBe(false);
    }
  });
});
