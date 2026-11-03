import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  seasonList: vi.fn(),
  tournamentList: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/site-url', () => ({ siteUrl: () => new URL('https://poketools.example') }));
vi.mock('@/lib/cache/public-reads', () => ({
  publicReads: { seasonList: mocks.seasonList, tournamentList: mocks.tournamentList },
}));
vi.mock('@/lib/wiki/index-rows.server', () => ({
  getWikiIndexRows: (kind: string) =>
    ({
      species: [{ name: 'Garchomp' }, { name: 'Mr. Mime' }],
      moves: [{ name: 'Earthquake' }],
      abilities: [{ name: 'Intimidate' }],
      items: [{ name: 'Leftovers' }],
    })[kind],
  getWikiTeraTypes: () => ['Fire', 'Water'],
}));

import sitemap, { dynamic } from '../sitemap';

const LIVE = '11111111-1111-4111-8111-111111111111';
const TEST = '22222222-2222-4222-8222-222222222222';
const ARCHIVED = '33333333-3333-4333-8333-333333333333';
const CUP = '44444444-4444-4444-8444-444444444444';
const OLD_CUP = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.seasonList.mockResolvedValue([
    { id: LIVE, name: 'Live', is_test_season: false, archived: false },
    { id: TEST, name: 'Test', is_test_season: true, archived: false },
    { id: ARCHIVED, name: 'Old', is_test_season: false, archived: true },
  ]);
  mocks.tournamentList.mockResolvedValue([
    { id: CUP, name: 'Cup', archived: false },
    { id: OLD_CUP, name: 'Old Cup', archived: true },
  ]);
});

describe('sitemap()', () => {
  it('reads nothing at build time', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('lists absolute URLs on the site origin only', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.length).toBeGreaterThan(10);
    for (const url of urls) expect(url.startsWith('https://poketools.example/')).toBe(true);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('includes the static pages and the wiki index pages', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    for (const path of ['/', '/leagues', '/tournaments', '/insights', '/wiki', '/wiki/pokemon', '/wiki/moves', '/wiki/items', '/wiki/abilities', '/wiki/tera']) {
      expect(urls).toContain(`https://poketools.example${path === '/' ? '/' : path}`);
    }
  });

  it('includes wiki and Pokémon detail pages with encoded names', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain('https://poketools.example/pokemon/Garchomp');
    expect(urls).toContain('https://poketools.example/pokemon/Mr.%20Mime');
    expect(urls).toContain('https://poketools.example/wiki/moves/Earthquake');
    expect(urls).toContain('https://poketools.example/wiki/abilities/Intimidate');
    expect(urls).toContain('https://poketools.example/wiki/items/Leftovers');
    expect(urls).toContain('https://poketools.example/wiki/tera/Fire');
  });

  it('lists live leagues and tournaments but never a test or archived one', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain(`https://poketools.example/leagues/${LIVE}`);
    expect(urls).toContain(`https://poketools.example/tournaments/${CUP}`);
    for (const id of [TEST, ARCHIVED, OLD_CUP]) {
      expect(urls.some((url) => url.includes(id)), id).toBe(false);
    }
  });

  it('never lists a player profile', async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.filter((url) => url.includes('/players'))).toEqual([]);
  });

  it('lets a failed read fail the request instead of serving a sitemap without leagues', async () => {
    mocks.seasonList.mockRejectedValue(new Error('db down'));
    await expect(sitemap()).rejects.toThrow('db down');
  });
});