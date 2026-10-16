import { describe, it, expect } from 'vitest';
import { buildOverlayUrl, OVERLAY_DEFAULTS, serializeConfig } from '../url-builder';
import { parseOverlayConfig } from '../overlay-config';

// T14 (i18n-core §6.5): `lang` in generated overlay URLs.
describe('overlay URL language', () => {
  it('has no default language: absent means "follow the league"', () => {
    expect(OVERLAY_DEFAULTS.lang).toBeNull();
    expect(serializeConfig({}).has('lang')).toBe(false);
    expect(serializeConfig({ lang: null }).has('lang')).toBe(false);
  });

  it('always writes a chosen language, including the content default', () => {
    expect(serializeConfig({ lang: 'de' }).get('lang')).toBe('de');
    expect(serializeConfig({ lang: 'en' }).get('lang')).toBe('en');
  });

  it('round-trips through buildOverlayUrl and parseOverlayConfig', () => {
    const url = buildOverlayUrl('standings', 'season-1', { lang: 'en', theme: 'light' });
    expect(url).toBe('/broadcast/league/season-1/standings?theme=light&lang=en');
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(parseOverlayConfig(qs).lang).toBe('en');
  });
});
