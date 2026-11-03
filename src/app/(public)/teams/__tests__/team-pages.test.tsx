import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { teamRowWithShareSecrets, expectNoPrivateTeamData } from '@/lib/team/__tests__/private-team-fields';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'de' }));
const mocks = vi.hoisted(() => ({
  getTeamByShareToken: vi.fn(),
  getTeamById: vi.fn(),
  checkPublicRateLimit: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  const { createFormatter } = await import('@/i18n/format');
  return {
    getLocale: async () => state.locale,
    getDataLocale: async () => state.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, state.locale),
    getFormatter: async () => createFormatter({ locale: state.locale, timeZone: 'UTC' }),
  };
});
vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamByShareToken: mocks.getTeamByShareToken,
  getTeamById: mocks.getTeamById,
}));
vi.mock('@/lib/utils/rate-limit', () => ({ checkPublicRateLimit: mocks.checkPublicRateLimit }));

import SharedTeamPage, { generateMetadata as sharedMetadata } from '../shared/[token]/page';
import LibraryEntryPage, { generateMetadata as libraryMetadata } from '../library/[id]/page';

const SHARE_LINK_ID = '00000000-0000-4000-8000-000000000065';
const TEAM_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const OWNER_ID = '0b1c2d3e-4f5a-4b6c-9d7e-1f2a3b4c5d6e';

function team(over = {}) {
  return teamRowWithShareSecrets({
    id: TEAM_ID,
    player_id: OWNER_ID,
    library_title: 'Rain Offense',
    library_description: 'Fast and mean',
    library_tags: ['rain'],
    library_published_at: '2026-10-01T10:00:00Z',
    pokemon: [
      {
        name: '',
        species: 'Garchomp',
        gender: '',
        item: 'Rocky Helmet',
        ability: 'Rough Skin',
        evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: 'Jolly',
        level: 100,
        moves: ['Earthquake', 'Dragon Claw'],
        tera_type: 'Steel',
      },
      { name: '', species: 'Pelipper', gender: '', item: '', ability: '', evs: undefined, ivs: undefined, nature: '', level: 100, moves: [] },
    ] as never,
    ...over,
  });
}

const sharedParams = { params: Promise.resolve({ token: SHARE_LINK_ID }) };
const libraryParams = { params: Promise.resolve({ id: TEAM_ID }) };

async function renderShared(locale: 'en' | 'de' = 'en') {
  return renderWithI18n(await SharedTeamPage(sharedParams), { locale });
}

async function renderLibrary(locale: 'en' | 'de' = 'en') {
  return renderWithI18n(await LibraryEntryPage(libraryParams), { locale });
}

beforeEach(() => {
  vi.resetAllMocks();
  state.locale = 'en';
  mocks.checkPublicRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
});

describe('shared team page', () => {
  it('renders the roster, the sets and the Showdown paste in the first response', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(team());
    const html = await renderShared();
    expect(html).toContain('Rain Offense');
    expect(html).toContain('Garchomp');
    expect(html).toContain('Pelipper');
    expect(html).toContain('Earthquake');
    expect(html).toContain('Rocky Helmet');
    expect(html).toContain('Garchomp @ Rocky Helmet');
    expect(html).toContain('Copy Paste');
  });

  it('localizes the names on the server for a German visitor and keeps the paste English', async () => {
    state.locale = 'de';
    mocks.getTeamByShareToken.mockResolvedValue(team());
    const html = await renderShared('de');
    expect(localizeSpecies('Garchomp', 'de')).not.toBe('Garchomp');
    expect(html).toContain(localizeSpecies('Garchomp', 'de'));
    expect(html).toContain(localizeMove('Earthquake', 'de'));
    expect(html).toContain('Garchomp @ Rocky Helmet');
  });

  it('serializes nothing outside the share allowlist', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(team());
    const html = await renderShared();
    expectNoPrivateTeamData(html);
    expect(html).not.toContain(OWNER_ID);
    expect(html).not.toContain('player_id');
    expect(html).not.toContain(SHARE_LINK_ID);
  });

  it('answers not found for a malformed token without a query', async () => {
    await expect(SharedTeamPage({ params: Promise.resolve({ token: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getTeamByShareToken).not.toHaveBeenCalled();
  });

  it('answers not found for a missing or disabled link', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(null);
    await expect(SharedTeamPage(sharedParams)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the rate-limited notice and sends no team data past the limit', async () => {
    mocks.checkPublicRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 41 });
    const html = await renderShared();
    expect(html).toContain('Too many requests');
    expect(html).toContain('41 seconds');
    expect(html).not.toContain('Garchomp');
    expect(mocks.getTeamByShareToken).not.toHaveBeenCalled();
  });

  it('titles the page by the team, lists the Pokémon in the description and is noindex', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(team());
    const meta = await sharedMetadata(sharedParams);
    expect(meta.title).toBe('Rain Offense');
    expect(meta.description).toBe('A shared team: Garchomp, Pelipper.');
    expect(meta.openGraph).toMatchObject({ title: 'Rain Offense', description: 'A shared team: Garchomp, Pelipper.' });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expectNoPrivateTeamData(meta);
    expect(JSON.stringify(meta)).not.toContain(OWNER_ID);
  });

  it('names the species in German in the description', async () => {
    state.locale = 'de';
    mocks.getTeamByShareToken.mockResolvedValue(team());
    const meta = await sharedMetadata(sharedParams);
    expect(meta.description).toBe(`Ein geteiltes Team: ${localizeSpecies('Garchomp', 'de')}, ${localizeSpecies('Pelipper', 'de')}.`);
  });

  it('keeps a missing or rate-limited link out of the index and names nothing', async () => {
    mocks.getTeamByShareToken.mockResolvedValue(null);
    expect(await sharedMetadata(sharedParams)).toEqual({ robots: { index: false, follow: false } });
  });
});

describe('library entry page', () => {
  it('renders the roster in the first response, with fork as the only action', async () => {
    mocks.getTeamById.mockResolvedValue(team());
    const html = await renderLibrary();
    expect(html).toContain('Rain Offense');
    expect(html).toContain('Fast and mean');
    expect(html).toContain('Garchomp');
    expect(html).toContain('Earthquake');
    expect(html).toContain('Fork This Team');
  });

  it('carries no owner or share data', async () => {
    mocks.getTeamById.mockResolvedValue(team());
    const html = await renderLibrary();
    expectNoPrivateTeamData(html);
    expect(html).not.toContain(OWNER_ID);
    expect(html).not.toContain('player_id');
    expect(html).not.toContain(SHARE_LINK_ID);
  });

  it('localizes the names on the server for a German visitor', async () => {
    state.locale = 'de';
    mocks.getTeamById.mockResolvedValue(team());
    const html = await renderLibrary('de');
    expect(html).toContain(localizeSpecies('Garchomp', 'de'));
    expect(html).toContain('Team forken');
  });

  it('answers not found for an unpublished, missing or malformed id', async () => {
    mocks.getTeamById.mockResolvedValue(team({ library_published_at: null }));
    await expect(LibraryEntryPage(libraryParams)).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.getTeamById.mockResolvedValue(null);
    await expect(LibraryEntryPage(libraryParams)).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(LibraryEntryPage({ params: Promise.resolve({ id: 'nope' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('titles the page by the entry and describes its Pokémon', async () => {
    mocks.getTeamById.mockResolvedValue(team());
    const meta = await libraryMetadata(libraryParams);
    expect(meta.title).toBe('Rain Offense');
    expect(meta.description).toBe('A team published to the library: Garchomp, Pelipper.');
    expect(meta.robots).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain(OWNER_ID);
  });
});