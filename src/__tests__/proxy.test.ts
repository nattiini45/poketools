import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { buildStaticPolicy } from '@/lib/security/csp-policy.mjs';
import { pageGate } from '@/lib/seo/page-gate';
import { config, proxy } from '../proxy';

vi.mock('@/lib/seo/page-gate', () => ({ pageGate: vi.fn(async () => ({ status: null, shareLimit: null })) }));

function pageRequest(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://poketools.test${path}`, { headers });
}

/** What the proxy hands the render: Next serialises request header overrides into `x-middleware-request-*` response headers. */
function forwardedRequestHeader(response: Response, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe('proxy request path (#56)', () => {
  const signedIn = { cookie: 'authjs.session-token=a' };
  it('records the requested path and query for the guards', async () => {
    const response = await proxy(pageRequest('/dashboard/submit/m1?tab=y', signedIn));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard/submit/m1?tab=y');
  });

  it('overwrites a path header the client sent', async () => {
    const response = await proxy(pageRequest('/dashboard/settings', { ...signedIn, 'x-poketools-path': 'https://evil.example/' }));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard/settings');
  });

  it('does not put the path header on the response a client sees', async () => {
    const response = await proxy(pageRequest('/dashboard', signedIn));
    expect(response.headers.get('x-poketools-path')).toBeNull();
  });

  it('drops the _rsc parameter of a client navigation', async () => {
    const response = await proxy(pageRequest('/dashboard?tab=a&_rsc=abc12', signedIn));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard?tab=a');
  });
});

const NONCE_IN_POLICY = /'nonce-([A-Za-z0-9+/]+={0,2})'/;

function scriptSrcOf(policy: string | null) {
  return (policy ?? '').split(';').map((d) => d.trim()).find((d) => /^script-src /i.test(d)) ?? '';
}

describe('proxy CSP (#37)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports the nonce policy and enforces the static policy beside it, by default', async () => {
    const response = await proxy(pageRequest('/leagues'));
    const reportOnly = response.headers.get('content-security-policy-report-only');
    expect(scriptSrcOf(reportOnly)).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
    expect(scriptSrcOf(reportOnly)).not.toContain("'unsafe-inline'");
    // Same enforcement as before the proxy took the header over from next.config.mjs: unsafe-inline, and no nonce in script-src.
    const enforced = response.headers.get('content-security-policy');
    expect(enforced).toBe(
      buildStaticPolicy({ dev: process.env.NODE_ENV !== 'production', nonce: NONCE_IN_POLICY.exec(reportOnly ?? '')?.[1] }),
    );
    expect(scriptSrcOf(enforced)).toContain("'unsafe-inline'");
    expect(scriptSrcOf(enforced)).not.toContain('nonce-');
  });

  it('enforces the nonce policy, and only that, when CSP_ENFORCE is set', async () => {
    vi.stubEnv('CSP_ENFORCE', '1');
    const response = await proxy(pageRequest('/leagues'));
    const enforced = response.headers.get('content-security-policy');
    expect(scriptSrcOf(enforced)).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
    expect(scriptSrcOf(enforced)).not.toContain("'unsafe-inline'");
    expect(response.headers.get('content-security-policy-report-only')).toBeNull();
  });

  it('allows the Vercel preview toolbar script on a preview deployment only, in every policy the proxy sends', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const policies = (response: Response) => [
      response.headers.get('content-security-policy'),
      response.headers.get('content-security-policy-report-only'),
      forwardedRequestHeader(response, 'content-security-policy'),
    ];

    for (const env of [undefined, 'production', 'development']) {
      vi.stubEnv('VERCEL_ENV', env);
      for (const policy of policies(await proxy(pageRequest('/leagues')))) expect(policy, String(env)).not.toContain('vercel.live');
    }

    vi.stubEnv('VERCEL_ENV', 'preview');
    for (const policy of policies(await proxy(pageRequest('/leagues')))) {
      expect(scriptSrcOf(policy)).toContain('https://vercel.live');
    }
    vi.stubEnv('CSP_ENFORCE', '1');
    expect(scriptSrcOf((await proxy(pageRequest('/leagues'))).headers.get('content-security-policy'))).toContain('https://vercel.live');
  });

  it('keeps upgrade-insecure-requests out of the report-only header in production, where browsers log an error for it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const reportOnly = (await proxy(pageRequest('/leagues'))).headers.get('content-security-policy-report-only');
    expect(reportOnly).not.toContain('upgrade-insecure-requests');
    vi.stubEnv('CSP_ENFORCE', '1');
    expect((await proxy(pageRequest('/leagues'))).headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
  });

  it('turns report-only back on when the flag is switched off', async () => {
    vi.stubEnv('CSP_ENFORCE', '1');
    vi.stubEnv('CSP_ENFORCE', '0');
    const response = await proxy(pageRequest('/leagues'));
    expect(scriptSrcOf(response.headers.get('content-security-policy'))).toContain("'unsafe-inline'");
    expect(response.headers.get('content-security-policy-report-only')).not.toBeNull();
  });

  it('hands the render the same nonce the header carries, in x-nonce and in the request policy', async () => {
    const response = await proxy(pageRequest('/leagues'));
    const nonce = NONCE_IN_POLICY.exec(response.headers.get('content-security-policy-report-only') ?? '')?.[1];
    expect(nonce).toBeTruthy();
    expect(forwardedRequestHeader(response, 'x-nonce')).toBe(nonce);
    // Next.js reads the nonce for its own scripts from the request's Content-Security-Policy header.
    expect(NONCE_IN_POLICY.exec(forwardedRequestHeader(response, 'content-security-policy') ?? '')?.[1]).toBe(nonce);
  });

  it('uses a different nonce for every request', async () => {
    const nonces = await Promise.all(
      Array.from({ length: 20 }, async () =>
        NONCE_IN_POLICY.exec((await proxy(pageRequest('/'))).headers.get('content-security-policy-report-only') ?? '')?.[1],
      ),
    );
    expect(new Set(nonces).size).toBe(20);
  });

  it('ignores a nonce or policy the client sent', async () => {
    const response = await proxy(
      pageRequest('/', {
        'x-nonce': 'attacker',
        'content-security-policy': "script-src 'nonce-attacker'",
        'content-security-policy-report-only': "script-src 'nonce-attacker'",
      }),
    );
    expect(forwardedRequestHeader(response, 'x-nonce')).not.toBe('attacker');
    expect(forwardedRequestHeader(response, 'content-security-policy')).not.toContain('attacker');
    expect(response.headers.get('content-security-policy-report-only')).not.toContain('attacker');
  });

  it('never puts the nonce in a response header of its own', async () => {
    expect((await proxy(pageRequest('/'))).headers.get('x-nonce')).toBeNull();
  });
});

describe('proxy sign-in redirect for signed-out visitors (#56)', () => {
  const sessionCookie = { cookie: 'authjs.session-token=abc' };

  it.each([
    ['/dashboard', '/auth/signin?callbackUrl=%2Fdashboard'],
    ['/dashboard/settings', '/auth/signin?callbackUrl=%2Fdashboard%2Fsettings'],
    ['/dashboard/submit/m1?tab=y', '/auth/signin?callbackUrl=%2Fdashboard%2Fsubmit%2Fm1%3Ftab%3Dy'],
    ['/dashboard/broadcast', '/auth/signin?callbackUrl=%2Fdashboard%2Fbroadcast'],
    ['/teambuilder', '/auth/signin?callbackUrl=%2Fteambuilder'],
    ['/creator/studio', '/auth/signin?callbackUrl=%2Fcreator%2Fstudio'],
    ['/creator/studio/s1/solo', '/auth/signin?callbackUrl=%2Fcreator%2Fstudio%2Fs1%2Fsolo'],
    ['/admin', '/auth/signin?callbackUrl=%2Fadmin'],
    ['/admin/leagues?x=1', '/auth/signin?callbackUrl=%2Fadmin%2Fleagues%3Fx%3D1'],
    ['/draft-room/trainer-creator', '/auth/signin?callbackUrl=%2Fdraft-room%2Ftrainer-creator'],
  ])('answers a cookieless %s with a 307 to %s', async (path, target) => {
    const response = await proxy(pageRequest(path));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe('https://poketools.test');
    expect(location.pathname + location.search).toBe(target);
  });

  it('keeps the return path from a spoofed path header out of the redirect', async () => {
    const response = await proxy(pageRequest('/dashboard/settings', { 'x-poketools-path': 'https://evil.example/' }));
    expect(new URL(response.headers.get('location') ?? '').search).toBe('?callbackUrl=%2Fdashboard%2Fsettings');
  });

  it('drops the _rsc parameter of a client navigation from the return path', async () => {
    const response = await proxy(pageRequest('/dashboard?tab=a&_rsc=abc12'));
    expect(new URL(response.headers.get('location') ?? '').search).toBe('?callbackUrl=%2Fdashboard%3Ftab%3Da');
  });

  it.each([
    'authjs.session-token=a',
    '__Secure-authjs.session-token=a',
    'authjs.session-token.0=a; authjs.session-token.1=b',
    'next-auth.session-token=a',
  ])('leaves a request with the cookie %s to the guard', async (cookie) => {
    const response = await proxy(pageRequest('/dashboard', { cookie }));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not take another cookie for a session', async () => {
    expect((await proxy(pageRequest('/dashboard', { cookie: 'authjs.csrf-token=a; authjs.callback-url=b' }))).status).toBe(307);
  });

  it('leaves public pages, the sign-in page and lookalike prefixes alone', async () => {
    for (const path of ['/', '/leagues', '/auth/signin', '/dashboards', '/administrators', '/creator', '/creator/studio-x', '/draft-room']) {
      expect((await proxy(pageRequest(path))).status, path).toBe(200);
    }
  });

  it('redirects only reads, and not a request that has a session cookie', async () => {
    expect((await proxy(new NextRequest('https://poketools.test/dashboard', { method: 'POST' }))).status).toBe(200);
    expect((await proxy(pageRequest('/dashboard', sessionCookie))).status).toBe(200);
  });
});

describe('proxy CSP on the responses it answers itself (#37)', () => {
  it('keeps the static policy on the overlay 404 and on the sign-in redirect, which next.config.mjs no longer covers', async () => {
    const expected = buildStaticPolicy({ dev: process.env.NODE_ENV !== 'production' });
    expect((await proxy(pageRequest('/broadcast/wiki/moves/NotAMove'))).headers.get('content-security-policy')).toBe(expected);
    const redirect = await proxy(pageRequest('/dashboard'));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get('content-security-policy')).toBe(expected);
  });
});

describe('proxy wiki overlay 404 (VAL-SHELL-012)', () => {
  it.each([
    '/broadcast/wiki/moves/NotAMove',
    '/broadcast/wiki/abilities/NotAnAbility',
    '/broadcast/wiki/items/NotAnItem',
    '/broadcast/wiki/tera/NotAType',
  ])('answers %s with a transparent 404 document before the page streams', async (path) => {
    const response = await proxy(pageRequest(path));
    expect(response.status).toBe(404);
    // An empty 4xx body makes Chromium (and OBS's browser source) paint its own opaque "HTTP ERROR 404" page.
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('background:transparent');
    expect(body).not.toMatch(/<a[\s>]/i);
    expect(body).not.toMatch(/<script/i);
    expect(body).toContain('<body></body>');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it.each([
    '/broadcast/wiki/moves/Thunderbolt',
    '/broadcast/wiki/abilities/Static',
    '/broadcast/wiki/items/Leftovers',
    '/broadcast/wiki/tera/Fire',
    '/broadcast/wiki/pokemon/NotAMon',
  ])('lets %s through to the page', async (path) => {
    const response = await proxy(pageRequest(path));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('keeps the 404 for a HEAD request and leaves other methods to the page', async () => {
    expect((await proxy(new NextRequest('https://poketools.test/broadcast/wiki/moves/NotAMove', { method: 'HEAD' }))).status).toBe(404);
    expect((await proxy(new NextRequest('https://poketools.test/broadcast/wiki/moves/NotAMove', { method: 'POST' }))).status).toBe(200);
  });
});

describe('proxy matcher', () => {
  const matches = (url: string) => doesProxyMatch({ config, nextConfig: {}, url });

  it('runs for pages', () => {
    // The share page trusts `x-poketools-share-limit` only because the proxy runs for every request to it.
    for (const url of ['/', '/leagues', '/dashboard/settings', '/broadcast/match/m1/live', '/auth/signin', '/teams/shared/00000000-0000-4000-8000-000000000065']) {
      expect(matches(url), url).toBe(true);
    }
  });

  it('skips the API, static assets, images and the favicon', () => {
    for (const url of [
      '/api/csp-report',
      '/api/auth/session',
      '/_next/static/chunks/a.js',
      '/_next/image',
      '/favicon.ico',
      '/manifest.webmanifest',
      '/sw.js',
      '/models/world/a.glb',
    ]) {
      expect(matches(url), url).toBe(false);
    }
  });

  it('runs for a prefetch (either header the router sends) too, so a page never sees a client-supplied path header', () => {
    for (const url of ['/leagues', '/dashboard/settings', '/teams/shared/00000000-0000-4000-8000-000000000065']) {
      expect(doesProxyMatch({ config, nextConfig: {}, url, headers: { 'next-router-prefetch': '1' } }), url).toBe(true);
      expect(doesProxyMatch({ config, nextConfig: {}, url, headers: { purpose: 'prefetch' } }), url).toBe(true);
      expect(doesProxyMatch({ config, nextConfig: {}, url, headers: { rsc: '1', 'next-url': '/' } }), url).toBe(true);
      expect(matches(url), url).toBe(true);
    }
  });

  it('has the path pattern only, with no header condition that would let a request skip the proxy', () => {
    expect(config.matcher).toEqual([expect.any(String)]);
  });
});

describe('proxy prefetch requests (VAL-CSP-005)', () => {
  const PREFETCH = { 'next-router-prefetch': '1' };

  it.each([
    ['next-router-prefetch', PREFETCH],
    ['purpose: prefetch', { purpose: 'prefetch' }],
  ])('overwrites a forged x-poketools-path on a %s request', async (_label, marker) => {
    const response = await proxy(pageRequest('/dashboard/confirm/m1?tab=y', { ...marker, 'x-poketools-path': '/forged' }));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard/confirm/m1?tab=y');
  });

  it('drops a forged nonce, policy and share verdict from a prefetch, and adds none', async () => {
    const response = await proxy(
      pageRequest('/teams/shared/t1', {
        ...PREFETCH,
        'x-nonce': 'forged',
        'content-security-policy': "script-src 'nonce-forged'",
        'content-security-policy-report-only': "script-src 'nonce-forged'",
        'x-poketools-share-limit': 'ok',
      }),
    );
    for (const name of ['x-nonce', 'content-security-policy', 'content-security-policy-report-only', 'x-poketools-share-limit']) {
      expect(forwardedRequestHeader(response, name), name).toBeNull();
    }
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(response.headers.get('content-security-policy-report-only')).toBeNull();
  });

  it('keeps a prefetch out of the gates: no sign-in redirect, no page gate read, no 404', async () => {
    vi.mocked(pageGate).mockClear();
    const response = await proxy(pageRequest('/dashboard/settings', PREFETCH));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(pageGate).not.toHaveBeenCalled();
  });

  it('drops the _rsc parameter from the recorded path of a prefetch', async () => {
    const response = await proxy(pageRequest('/dashboard?tab=a&_rsc=abc12', PREFETCH));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard?tab=a');
  });

  it('still overwrites the path header on a request without a prefetch marker', async () => {
    const response = await proxy(pageRequest('/dashboard/settings', { cookie: 'authjs.session-token=a', 'x-poketools-path': '/forged' }));
    expect(forwardedRequestHeader(response, 'x-poketools-path')).toBe('/dashboard/settings');
  });
});

describe('proxy missing page 404 (#58, #65)', () => {
  const SHARE_LINK_ID = '00000000-0000-4000-8000-000000000065';

  afterEach(() => vi.mocked(pageGate).mockReset().mockResolvedValue({ status: null, shareLimit: null }));

  it('rewrites a dead team page to the not-found page with a 404 and the same nonce policy', async () => {
    vi.mocked(pageGate).mockResolvedValue({ status: 'not_found', shareLimit: null });
    const response = await proxy(pageRequest(`/teams/shared/${SHARE_LINK_ID}`));
    expect(response.status).toBe(404);
    expect(response.headers.get('x-middleware-rewrite')).toContain('/_not-found');
    const nonce = NONCE_IN_POLICY.exec(response.headers.get('content-security-policy-report-only') ?? '')?.[1];
    expect(nonce).toBeTruthy();
    expect(forwardedRequestHeader(response, 'x-nonce')).toBe(nonce);
    expect(pageGate).toHaveBeenCalledWith(`/teams/shared/${SHARE_LINK_ID}`, expect.any(Headers));
  });

  it('lets a live team page through to the page', async () => {
    const response = await proxy(pageRequest(`/teams/library/${SHARE_LINK_ID}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('tells the page it charged a share link, so the page does not charge it again', async () => {
    vi.mocked(pageGate).mockResolvedValue({ status: null, shareLimit: { allowed: true } });
    const response = await proxy(pageRequest(`/teams/shared/${SHARE_LINK_ID}`));
    expect(forwardedRequestHeader(response, 'x-poketools-share-limit')).toBe('allowed');
  });

  it('hands the page the retry time of a spent allowance', async () => {
    vi.mocked(pageGate).mockResolvedValue({ status: null, shareLimit: { allowed: false, retryAfterSeconds: 41 } });
    const response = await proxy(pageRequest(`/teams/shared/${SHARE_LINK_ID}`));
    expect(forwardedRequestHeader(response, 'x-poketools-share-limit')).toBe('denied:41');
  });

  it('never forwards a share-limit header the client sent when nothing was charged', async () => {
    for (const path of [`/teams/shared/${SHARE_LINK_ID}`, '/leagues', `/teams/library/${SHARE_LINK_ID}`]) {
      const response = await proxy(pageRequest(path, { 'x-poketools-share-limit': 'allowed' }));
      expect(forwardedRequestHeader(response, 'x-poketools-share-limit'), path).toBeNull();
    }
  });

  it('replaces a spoofed share-limit header with its own verdict', async () => {
    vi.mocked(pageGate).mockResolvedValue({ status: null, shareLimit: { allowed: false, retryAfterSeconds: 7 } });
    const response = await proxy(pageRequest(`/teams/shared/${SHARE_LINK_ID}`, { 'x-poketools-share-limit': 'allowed' }));
    expect(forwardedRequestHeader(response, 'x-poketools-share-limit')).toBe('denied:7');
  });

  it('checks reads only: a POST goes straight to the page', async () => {
    vi.mocked(pageGate).mockResolvedValue({ status: 'not_found', shareLimit: null });
    const response = await proxy(new NextRequest(`https://poketools.test/teams/shared/${SHARE_LINK_ID}`, { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(pageGate).not.toHaveBeenCalled();
  });
});