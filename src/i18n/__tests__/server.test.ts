import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined),
  }),
}));

// React cache() only memoizes inside a React server request; outside one each call re-runs.
import {
  getDataLocale,
  getFormatter,
  getI18nProviderProps,
  getLocale,
  getRequestDataLocale,
  getRequestLocale,
  getT,
  getTimeZone,
} from '../server';
import { metaMessages } from '../messages/meta';

beforeEach(() => {
  cookieJar.clear();
});

describe('cookie readers', () => {
  it('getLocale: valid, invalid, absent', async () => {
    expect(await getLocale()).toBe('en');
    cookieJar.set('plc_locale', 'de');
    expect(await getLocale()).toBe('de');
    cookieJar.set('plc_locale', 'fr');
    expect(await getLocale()).toBe('en');
  });

  it('getDataLocale: plc_pkmn_lang=en with UI de gives data en; anything else follows the UI', async () => {
    cookieJar.set('plc_locale', 'de');
    expect(await getDataLocale()).toBe('de');
    cookieJar.set('plc_pkmn_lang', 'en');
    expect(await getDataLocale()).toBe('en');
    cookieJar.set('plc_pkmn_lang', 'de');
    expect(await getDataLocale()).toBe('de');
    cookieJar.set('plc_locale', 'en');
    cookieJar.set('plc_pkmn_lang', 'en');
    expect(await getDataLocale()).toBe('en');
  });

  it('getTimeZone: valid, invalid, absent', async () => {
    expect(await getTimeZone()).toBe('Europe/Berlin');
    cookieJar.set('plc_tz', 'America/New_York');
    expect(await getTimeZone()).toBe('America/New_York');
    cookieJar.set('plc_tz', 'Not/AZone');
    expect(await getTimeZone()).toBe('Europe/Berlin');
    cookieJar.set('plc_tz', '<script>');
    expect(await getTimeZone()).toBe('Europe/Berlin');
  });

  it('getT and getFormatter use the cookie locale unless given one', async () => {
    cookieJar.set('plc_locale', 'de');
    expect((await getT(metaMessages))('description')).toContain('Pokémon-Ligen');
    expect((await getT(metaMessages, 'en'))('description')).toBe('Competitive Pokémon league and tournament management');
    const formatter = await getFormatter();
    expect(formatter.locale).toBe('de');
    expect(formatter.timeZone).toBe('Europe/Berlin');
  });

  it('getI18nProviderProps bundles everything the provider needs', async () => {
    cookieJar.set('plc_locale', 'de');
    cookieJar.set('plc_pkmn_lang', 'en');
    cookieJar.set('plc_tz', 'UTC');
    const props = await getI18nProviderProps();
    expect(props).toMatchObject({ locale: 'de', dataLocale: 'en', timeZone: 'UTC' });
    expect(typeof props.requestTime).toBe('number');
  });
});

describe('route handler readers', () => {
  const req = (cookie?: string) => new Request('https://example.test/api/x', { headers: cookie ? { cookie } : {} });

  it('getRequestLocale parses the Cookie header', () => {
    expect(getRequestLocale(req())).toBe('en');
    expect(getRequestLocale(req('a=1; plc_locale=de; b=2'))).toBe('de');
    expect(getRequestLocale(req('plc_locale=xx'))).toBe('en');
  });

  it('getRequestDataLocale honours plc_pkmn_lang=en only', () => {
    expect(getRequestDataLocale(req('plc_locale=de'))).toBe('de');
    expect(getRequestDataLocale(req('plc_locale=de; plc_pkmn_lang=en'))).toBe('en');
    expect(getRequestDataLocale(req('plc_locale=de; plc_pkmn_lang=follow'))).toBe('de');
  });
});
