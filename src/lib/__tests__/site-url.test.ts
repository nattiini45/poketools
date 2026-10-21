import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_SITE_URL, siteUrl } from '../site-url';

const KEYS = ['NEXT_PUBLIC_SITE_URL', 'NEXTAUTH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const;
let saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('siteUrl', () => {
  it('falls back to localhost when nothing is set', () => {
    expect(siteUrl().href).toBe(`${FALLBACK_SITE_URL}/`);
  });

  it('prefers NEXT_PUBLIC_SITE_URL over every other source', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://site.example';
    process.env.NEXTAUTH_URL = 'https://auth.example';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'vercel.example';
    expect(siteUrl().origin).toBe('https://site.example');
  });

  it('uses NEXTAUTH_URL before the Vercel host', () => {
    process.env.NEXTAUTH_URL = 'https://auth.example';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'vercel.example';
    expect(siteUrl().origin).toBe('https://auth.example');
  });

  it('prefixes VERCEL_PROJECT_PRODUCTION_URL with https://', () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'poketools.vercel.app';
    expect(siteUrl().href).toBe('https://poketools.vercel.app/');
  });

  it('accepts a Vercel value that already carries a protocol', () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'https://already.example' }).origin).toBe('https://already.example');
  });

  it('lets empty and malformed values fall through without throwing', () => {
    process.env.NEXT_PUBLIC_SITE_URL = '   ';
    process.env.NEXTAUTH_URL = 'not a url';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'vercel.example';
    expect(siteUrl().origin).toBe('https://vercel.example');

    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'localhost:3000', NEXTAUTH_URL: 'https://auth.example' }).origin).toBe(
      'https://auth.example'
    );
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: '', NEXTAUTH_URL: '', VERCEL_PROJECT_PRODUCTION_URL: 'bad host name' }).href).toBe(
      `${FALLBACK_SITE_URL}/`
    );
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: '' }).href).toBe(`${FALLBACK_SITE_URL}/`);
  });
});

describe('siteUrl in production', () => {
  let prodSiteUrl: typeof siteUrl;

  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    // a fresh module so the one-time warning state does not leak between tests
    vi.resetModules();
    ({ siteUrl: prodSiteUrl } = await import('../site-url'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('falls through a non-loopback http value with a one-time warning naming the variable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { NEXT_PUBLIC_SITE_URL: 'http://site.example', NEXTAUTH_URL: 'https://auth.example' };
    expect(prodSiteUrl(env).origin).toBe('https://auth.example');
    expect(prodSiteUrl(env).origin).toBe('https://auth.example');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('NEXT_PUBLIC_SITE_URL');
    expect(warn.mock.calls[0][0]).not.toContain('site.example');
  });

  it('falls through an http Vercel value and keeps https values', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(prodSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'http://vercel.example' }).href).toBe(`${FALLBACK_SITE_URL}/`);
    expect(prodSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://site.example' }).origin).toBe('https://site.example');
  });

  it('still accepts http for loopback hosts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(prodSiteUrl({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }).origin).toBe('http://localhost:3000');
    expect(prodSiteUrl({ NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000' }).origin).toBe('http://127.0.0.1:3000');
    expect(prodSiteUrl({ NEXT_PUBLIC_SITE_URL: 'http://[::1]:3000' }).origin).toBe('http://[::1]:3000');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('siteUrl outside production', () => {
  it('accepts http for any host in dev and test', () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: 'http://site.example' }).origin).toBe('http://site.example');
  });
});
