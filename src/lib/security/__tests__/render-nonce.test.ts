import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { parseRequestHeaders } from 'next/dist/server/route-modules/app-page/parse-request-headers';
import { proxy } from '../../../proxy';

// Next's work-store module picks a stub unless the runtime exposes this global, as its own servers do.
await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  Object.assign(globalThis, { AsyncLocalStorage });
});
const { unstable_getResponseFromNextConfig: responseFromNextConfig } = await import('next/experimental/testing/server');

/**
 * What the app-page render parses its nonce from (issue #37). On Vercel no Next script got the nonce: the platform hands
 * the render the response headers of the proxy and of `next.config.mjs` as request headers, and the static
 * `Content-Security-Policy` of the config replaced the policy the proxy overrides. `next start` copies the proxy's
 * response headers onto the request too (`resolve-routes.js`), so this is the least favourable platform of the two.
 */
async function headersSeenByRender(request: NextRequest, response: Response) {
  const seen: Record<string, string> = Object.fromEntries(request.headers);
  const overridden = new Set((response.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean));
  for (const key of Object.keys(seen)) if (!overridden.has(key)) delete seen[key];
  for (const key of overridden) seen[key] = response.headers.get(`x-middleware-request-${key}`) ?? '';
  for (const [key, value] of response.headers) if (!key.startsWith('x-middleware-')) seen[key] = value;
  const config = (await import('../../../../next.config.mjs')).default;
  const fromConfig = await responseFromNextConfig({ url: request.url, nextConfig: config });
  for (const [key, value] of fromConfig.headers) seen[key] = value;
  return seen;
}

async function nonceOfRender(path: string) {
  const request = new NextRequest(`https://poketools.test${path}`);
  const response = proxy(request);
  const parsed = parseRequestHeaders(await headersSeenByRender(request, response), {
    isRoutePPREnabled: false,
    previewModeId: undefined,
  });
  return { rendered: parsed.nonce, proxied: response.headers.get('x-middleware-request-x-nonce') };
}

describe('the nonce the render stamps on Next.js scripts (#37)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['/', '/leagues', '/leagues/abc', '/wiki', '/auth/signin'])('is the proxy nonce on %s in report-only mode, the default', async (path) => {
    const { rendered, proxied } = await nonceOfRender(path);
    expect(proxied).toBeTruthy();
    expect(rendered).toBe(proxied);
  });

  it.each(['/', '/leagues', '/auth/signin'])('is the proxy nonce on %s when CSP_ENFORCE is set', async (path) => {
    vi.stubEnv('CSP_ENFORCE', '1');
    const { rendered, proxied } = await nonceOfRender(path);
    expect(proxied).toBeTruthy();
    expect(rendered).toBe(proxied);
  });
});
