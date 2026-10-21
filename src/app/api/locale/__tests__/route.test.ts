import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/locale/route';

const ORIGIN = 'https://poketools.test';

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGIN}/api/locale`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieLine(res: Response, name: string): string | undefined {
  return setCookies(res).find((line) => line.startsWith(`${name}=`));
}

describe('POST /api/locale', () => {
  it('sets plc_locale with the agreed attributes', async () => {
    const res = await POST(makeRequest({ locale: 'de' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { locale: 'de', pkmnTerms: 'follow' } });
    const line = cookieLine(res, 'plc_locale');
    expect(line).toBeDefined();
    expect(line).toMatch(/^plc_locale=de;/);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Max-Age=31536000/);
    expect(line).toMatch(/SameSite=lax/i);
    expect(line).not.toMatch(/HttpOnly/i);
    expect(cookieLine(res, 'plc_pkmn_lang')).toBeUndefined();
  });

  it('marks the cookies Secure in production only', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const res = await POST(makeRequest({ locale: 'en' }));
      expect(cookieLine(res, 'plc_locale')).toMatch(/Secure/);
    } finally {
      vi.unstubAllEnvs();
    }
    const dev = await POST(makeRequest({ locale: 'en' }));
    expect(cookieLine(dev, 'plc_locale')).not.toMatch(/Secure/);
  });

  it('pkmnTerms "en" sets plc_pkmn_lang=en', async () => {
    const res = await POST(makeRequest({ pkmnTerms: 'en' }, { cookie: 'plc_locale=de' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { locale: 'de', pkmnTerms: 'en' } });
    expect(cookieLine(res, 'plc_pkmn_lang')).toMatch(/^plc_pkmn_lang=en;.*Max-Age=31536000/);
    expect(cookieLine(res, 'plc_locale')).toBeUndefined();
  });

  it('pkmnTerms "follow" deletes plc_pkmn_lang', async () => {
    const res = await POST(makeRequest({ pkmnTerms: 'follow' }, { cookie: 'plc_locale=de; plc_pkmn_lang=en' }));
    expect(res.status).toBe(200);
    const line = cookieLine(res, 'plc_pkmn_lang');
    expect(line).toMatch(/^plc_pkmn_lang=;/);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('sets both cookies in one request', async () => {
    const res = await POST(makeRequest({ locale: 'de', pkmnTerms: 'en' }));
    expect(await res.json()).toEqual({ success: true, data: { locale: 'de', pkmnTerms: 'en' } });
    expect(cookieLine(res, 'plc_locale')).toMatch(/^plc_locale=de;/);
    expect(cookieLine(res, 'plc_pkmn_lang')).toMatch(/^plc_pkmn_lang=en;/);
  });

  const invalidBodies: [string, unknown][] = [
    ['empty object', {}],
    ['unknown locale', { locale: 'fr' }],
    ['unknown pkmnTerms', { pkmnTerms: 'de' }],
    ['unknown key', { locale: 'de', theme: 'dark' }],
    ['array', ['de']],
    ['string', '"de"'],
    ['malformed JSON', '{not json'],
    ['null', 'null'],
  ];
  for (const [label, body] of invalidBodies) {
    it(`400 locale_invalid for ${label}`, async () => {
      const res = await POST(makeRequest(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        success: false,
        error: "locale must be 'en' or 'de'; pkmnTerms must be 'follow' or 'en'.",
        code: 'locale_invalid',
      });
      expect(setCookies(res)).toEqual([]);
    });
  }

  it('403 locale_cross_origin for a foreign Origin', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ locale: 'de' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Cross-origin language change refused.',
      code: 'locale_cross_origin',
    });
    expect(setCookies(res)).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('accepts a same-origin Origin header', async () => {
    const res = await POST(makeRequest({ locale: 'de' }, { origin: ORIGIN }));
    expect(res.status).toBe(200);
    expect(cookieLine(res, 'plc_locale')).toMatch(/^plc_locale=de;/);
  });

  it('500 locale_save_failed (fallbackCode) when the handler throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = makeRequest({ locale: 'de' });
    vi.spyOn(req.headers, 'get').mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Failed to save the language setting',
      code: 'locale_save_failed',
    });
    expect(setCookies(res)).toEqual([]);
    expect(error).toHaveBeenCalledWith('[API] Failed to save the language setting:', expect.any(Error));
    error.mockRestore();
  });
});
