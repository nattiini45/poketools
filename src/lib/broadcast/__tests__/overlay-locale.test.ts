import { describe, it, expect, vi, beforeEach } from 'vitest';

const { resolveContentLocale, cookies } = vi.hoisted(() => ({
  resolveContentLocale: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale }));
// Any cookie read would go through next/headers; the spy proves there is none.
vi.mock('next/headers', () => ({ cookies, headers: vi.fn() }));

import { overlayI18nProps, resolveOverlayLocale } from '../overlay-locale';
import { parseOverlayConfig } from '../overlay-config';
import { LEAGUE_TIME_ZONE } from '@/i18n/config';

const configFor = (qs: string) => parseOverlayConfig(new URLSearchParams(qs));

beforeEach(() => {
  vi.clearAllMocks();
  resolveContentLocale.mockResolvedValue('de');
  cookies.mockImplementation(() => {
    throw new Error('overlays must never read the language cookie');
  });
});

describe('resolveOverlayLocale', () => {
  it('?lang= beats the league language and reads no league', async () => {
    resolveContentLocale.mockResolvedValue('de');
    await expect(resolveOverlayLocale(configFor('lang=en'), { seasonId: 's1' })).resolves.toBe('en');
    await expect(resolveOverlayLocale(configFor('lang=de'), { matchId: 'm1' })).resolves.toBe('de');
    expect(resolveContentLocale).not.toHaveBeenCalled();
  });

  it('without ?lang= a league overlay follows the season language', async () => {
    resolveContentLocale.mockResolvedValue('en');
    await expect(resolveOverlayLocale(configFor(''), { seasonId: 's1' })).resolves.toBe('en');
    expect(resolveContentLocale).toHaveBeenCalledWith({ seasonId: 's1' });
  });

  it('without ?lang= a match overlay follows the match league language', async () => {
    resolveContentLocale.mockResolvedValue('en');
    await expect(resolveOverlayLocale(configFor(''), { matchId: 'm1' })).resolves.toBe('en');
    expect(resolveContentLocale).toHaveBeenCalledWith({ matchId: 'm1' });
  });

  it('an invalid ?lang= is ignored (falls through to the league)', async () => {
    resolveContentLocale.mockResolvedValue('en');
    await expect(resolveOverlayLocale(configFor('lang=fr'), { seasonId: 's1' })).resolves.toBe('en');
  });

  it('solo, player and wiki overlays (no ref) default to German without a DB read', async () => {
    await expect(resolveOverlayLocale(configFor(''), {})).resolves.toBe('de');
    await expect(resolveOverlayLocale(configFor(''), { seasonId: '', matchId: null })).resolves.toBe('de');
    expect(resolveContentLocale).not.toHaveBeenCalled();
  });

  it('never reads the cookie, whichever branch runs', async () => {
    await resolveOverlayLocale(configFor('lang=en'), { seasonId: 's1' });
    await resolveOverlayLocale(configFor(''), { seasonId: 's1' });
    await resolveOverlayLocale(configFor(''), {});
    expect(cookies).not.toHaveBeenCalled();
  });
});

describe('overlayI18nProps', () => {
  it('pins Pokémon terms to the overlay language and uses the league time zone', () => {
    const props = overlayI18nProps('de');
    expect(props.locale).toBe('de');
    expect(props.dataLocale).toBe('de');
    expect(props.timeZone).toBe(LEAGUE_TIME_ZONE);
    // Pinned: the OBS machine's browser zone never replaces the league zone.
    expect(props.pinTimeZone).toBe(true);
    expect(typeof props.requestTime).toBe('number');
  });
});
