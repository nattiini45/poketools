/**
 * `public/sw-routing.js` is a plain script that `public/sw.js` loads with `importScripts`; it is run here the same
 * way (a bare context whose `self` it attaches to), so the test exercises the file the worker really uses.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isPwaShellEntry } from '../caches';

const SOURCE = readFileSync(path.join(process.cwd(), 'public', 'sw-routing.js'), 'utf8');
const ORIGIN = 'https://poketools.test';

interface Routing {
  isStaticAsset(pathname: string): boolean;
  isShellEntry(pathname: string): boolean;
  shouldCacheNavigation(pathname: string, response: { ok: boolean; status: number }): boolean;
  routeRequest(request: { method: string; url: string; mode?: string }, origin: string): 'navigation' | 'static' | 'pass';
}

function loadRouting(): Routing {
  const self: { PokeToolsSwRouting?: Routing } = {};
  vm.runInNewContext(SOURCE, { self, URL }, { filename: 'sw-routing.js' });
  if (!self.PokeToolsSwRouting) throw new Error('sw-routing.js did not register itself');
  return self.PokeToolsSwRouting;
}

const routing = loadRouting();
const ok = { ok: true, status: 200 };

describe('isStaticAsset', () => {
  it.each(['/_next/static/chunks/app.js', '/_next/static/css/a.css', '/pwa/icon-192.png', '/pwa/apple-touch-icon.png'])(
    '%s is cache-first',
    (pathname) => {
      expect(routing.isStaticAsset(pathname)).toBe(true);
    },
  );

  it.each([
    '/',
    '/leagues',
    '/_next/image',
    '/_next/data/abc/x.json',
    '/avatar/me.png',
    '/fonts/inter.woff2',
    '/sprites/pikachu.png',
    '/manifest.webmanifest',
    '/favicon.ico',
    '/offline.html',
    '/_next/staticfoo',
    '/pwa',
    '/models/world/a.glb',
  ])('%s is not', (pathname) => {
    expect(routing.isStaticAsset(pathname)).toBe(false);
  });
});

describe('isShellEntry', () => {
  it.each(['/offline.html', '/_next/static/chunks/app.js', '/pwa/icon-192.png'])('%s is kept for every visitor', (pathname) => {
    expect(routing.isShellEntry(pathname)).toBe(true);
  });

  it.each(['/', '/dashboard', '/teams/shared/token', '/offline.html/x', '/api/players'])('%s is not', (pathname) => {
    expect(routing.isShellEntry(pathname)).toBe(false);
  });

  it('is the rule sign-out applies to the worker caches (src/lib/pwa/caches.ts)', () => {
    for (const pathname of [
      '/offline.html', '/pwa/icon-512.png', '/_next/static/a.js', '/', '/dashboard', '/_next/image', '/offline.html/x', '/pwa', '/manifest.webmanifest',
    ]) {
      expect(isPwaShellEntry(`${ORIGIN}${pathname}`), pathname).toBe(routing.isShellEntry(pathname));
    }
  });
});

describe('shouldCacheNavigation', () => {
  it.each([
    '/dashboard',
    '/dashboard/broadcast',
    '/admin',
    '/admin/players',
    '/creator',
    '/creator/wiki',
    '/teambuilder',
    '/broadcast/match/1/live',
    '/auth/signin',
    '/teams/shared/token',
    '/leagues',
    '/',
  ])('never stores the page at %s', (pathname) => {
    expect(routing.shouldCacheNavigation(pathname, ok)).toBe(false);
  });

  it.each([404, 500, 503])('never stores a %i', (status) => {
    expect(routing.shouldCacheNavigation('/leagues', { ok: false, status })).toBe(false);
  });
});

describe('routeRequest', () => {
  const request = (url: string, over: Partial<{ method: string; mode: string }> = {}) => ({
    method: 'GET',
    mode: 'no-cors',
    url: `${ORIGIN}${url}`,
    ...over,
  });

  it('answers navigations network first, whatever the page', () => {
    for (const url of ['/', '/dashboard', '/leagues/1', '/broadcast/match/1/live']) {
      expect(routing.routeRequest(request(url, { mode: 'navigate' }), ORIGIN)).toBe('navigation');
    }
  });

  it('serves only the two static prefixes cache first', () => {
    expect(routing.routeRequest(request('/_next/static/a.js'), ORIGIN)).toBe('static');
    expect(routing.routeRequest(request('/pwa/icon-192.png'), ORIGIN)).toBe('static');
    expect(routing.routeRequest(request('/_next/image?url=%2Fa.png&w=64&q=75'), ORIGIN)).toBe('pass');
    expect(routing.routeRequest(request('/avatar/a.png'), ORIGIN)).toBe('pass');
  });

  it('leaves the API, other methods and other origins alone', () => {
    expect(routing.routeRequest(request('/api/players'), ORIGIN)).toBe('pass');
    expect(routing.routeRequest(request('/api/players', { mode: 'navigate' }), ORIGIN)).toBe('pass');
    expect(routing.routeRequest(request('/_next/static/a.js', { method: 'POST' }), ORIGIN)).toBe('pass');
    expect(routing.routeRequest({ method: 'GET', mode: 'no-cors', url: 'https://cdn.example/_next/static/a.js' }, ORIGIN)).toBe('pass');
  });
});
