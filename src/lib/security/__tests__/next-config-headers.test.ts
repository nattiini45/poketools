import { nextConfigHeaders } from './next-config-response';
import { describe, expect, it } from 'vitest';
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server';
import { config } from '../../../proxy';
import { buildStaticPolicy } from '../csp-policy.mjs';

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function nextConfig() {
  return (await import('../../../../next.config.mjs')).default;
}

async function headerRules(): Promise<HeaderRule[]> {
  return (await (await nextConfig()).headers?.()) as HeaderRule[];
}

const value = (rule: HeaderRule, key: string) => rule.headers.find((header) => header.key === key)?.value;

async function configHeader(path: string, key: string) {
  return (await nextConfigHeaders(path)).get(key);
}

const PAGES = ['/', '/leagues', '/leagues/abc', '/wiki', '/auth/signin', '/dashboard/settings', '/broadcast/match/m1/live'];
const NOT_PAGES = [
  '/api/csp-report',
  '/api/auth/session',
  '/_next/static/chunks/a.js',
  '/_next/image',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/avatar/a.png',
  '/basis/a.wasm',
  '/characters/a.glb',
  '/fonts/a.woff2',
  '/models/world/a.glb',
  '/pwa/icon-192.png',
  '/textures/a.ktx2',
  '/offline.html',
  '/sw.js',
  '/sw-routing.js',
];

describe('next.config.mjs security headers (#37)', () => {
  it('sends the static policy on the API and the service worker files, with the directives #37 asks for', async () => {
    const rules = await headerRules();
    for (const source of ['/api/:path*', '/sw.js']) {
      const rule = rules.find((candidate) => candidate.source === source);
      expect(rule, source).toBeDefined();
      const policy = value(rule!, 'Content-Security-Policy');
      expect(policy).toBe(buildStaticPolicy({ dev: process.env.NODE_ENV !== 'production' }));
      expect(policy).toContain("object-src 'none'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain('report-uri /api/csp-report');
    }
  });

  it('names the report endpoint that report-to refers to', async () => {
    const rule = (await headerRules()).find((candidate) => candidate.source === '/:path*');
    expect(value(rule!, 'Reporting-Endpoints')).toBe('csp="/api/csp-report"');
  });

  it('keeps the worker policy on the service worker files', async () => {
    const rules = await headerRules();
    const worker = rules.find((candidate) => candidate.source === '/sw.js');
    expect(value(worker!, 'Content-Security-Policy')).toContain("worker-src 'self' blob:");
  });

  it('sends no Content-Security-Policy on a page: a header of that name from the config reaches the render instead of the proxy nonce policy on Vercel', async () => {
    for (const path of PAGES) {
      expect(await configHeader(path, 'content-security-policy'), path).toBeNull();
    }
  });

  it('sends the static policy on every path the proxy skips, and the proxy runs for no path that gets it', async () => {
    const expected = buildStaticPolicy({ dev: process.env.NODE_ENV !== 'production' });
    for (const path of NOT_PAGES) {
      expect(doesProxyMatch({ config, nextConfig: {}, url: path }), `proxy ${path}`).toBe(false);
      expect(await configHeader(path, 'content-security-policy'), path).toBe(expected);
    }
    for (const path of PAGES) {
      expect(doesProxyMatch({ config, nextConfig: {}, url: path }), `proxy ${path}`).toBe(true);
    }
  });

  it('keeps the other security headers on pages', async () => {
    for (const key of ['x-frame-options', 'strict-transport-security', 'x-content-type-options', 'reporting-endpoints']) {
      expect(await configHeader('/leagues', key), key).not.toBeNull();
    }
  });
});
