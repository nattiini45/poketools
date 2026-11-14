import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const { listReplayLibraryRows, listReplayLibraryPage, listReplayLibraryFacetRows } = vi.hoisted(
  () => ({
    listReplayLibraryRows: vi.fn(),
    listReplayLibraryPage: vi.fn(),
    listReplayLibraryFacetRows: vi.fn(),
  }),
);

const cookieJar = vi.hoisted(() => ({ locale: undefined as string | undefined }));

// The page reads the language cookie through `getLocale()` / `getT()`.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'plc_locale' && cookieJar.locale !== undefined ? { name, value: cookieJar.locale } : undefined,
  }),
}));

vi.mock('@/lib/supabase/queries/replay-library', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/supabase/queries/replay-library')>(),
  listReplayLibraryRows,
  listReplayLibraryPage,
  listReplayLibraryFacetRows,
  UNKNOWN_PLAYER: 'Unknown',
  UNKNOWN_LEAGUE: 'Unknown league',
  UNKNOWN_ROUND: 'Unknown round',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...props }, children),
}));

import ReplaysPage from '../page';

const ALICE_BOB = {
  label: 'Alice vs Bob, Summer League, Round 2, match 1',
  date: '2026-06-12T10:00:00Z',
  league: 'Summer League',
  tournamentName: 'Summer Open',
  round: 'Round 2',
  matchNumber: 1,
  player1Name: 'Alice',
  player1PsUsername: 'aliceps',
  player2Name: 'Bob',
  player2PsUsername: 'bobby',
  matchUrl: '/tournaments/t-1/matches/m-1',
  replayUrl: 'https://replay.example/1',
};

const ZARA_BEA = {
  label: 'Zara vs Bea, Winter League, Finals, match 3',
  date: '2026-02-03T10:00:00Z',
  league: 'Winter League',
  tournamentName: 'Winter Playoffs',
  round: 'Finals',
  matchNumber: 3,
  player1Name: 'Zara',
  player1PsUsername: 'zaraps',
  player2Name: 'Bea',
  player2PsUsername: 'beaps',
  matchUrl: '/tournaments/t-2/matches/m-2',
  replayUrl: 'https://replay.example/2',
};

const ALICE_CHRIS = {
  label: 'Alice vs Chris, Summer League, Round 3, match 2',
  date: '2026-06-14T10:00:00Z',
  league: 'Summer League',
  tournamentName: 'Summer Open',
  round: 'Round 3',
  matchNumber: 2,
  player1Name: 'Alice',
  player1PsUsername: 'aliceps',
  player2Name: 'Chris',
  player2PsUsername: 'chris_alt',
  matchUrl: '/tournaments/t-1/matches/m-2',
  replayUrl: 'https://replay.example/3',
};

function facetsOf(rows: Array<{ league: string; tournamentName: string; round: string }>) {
  return rows.map(({ league, tournamentName, round }) => ({ league, tournamentName, round }));
}

describe('ReplaysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.locale = undefined;
  });

  it.each([
    ['en', 'League/Tournament', 'Unknown league/tournament'],
    ['de', 'Liga/Turnier', 'Liga/Turnier unbekannt'],
  ])('identifies league stages, standalone tournaments and missing metadata in %s', async (locale, heading, unknown) => {
    cookieJar.locale = locale;
    const rows = [
      { ...ALICE_BOB, competitionUrl: '/leagues/league-1' },
      { ...ZARA_BEA, league: 'Unknown league', tournamentName: 'Autumn Cup', competitionUrl: '/tournaments/t-2' },
      { ...ALICE_CHRIS, league: 'Unknown league', tournamentName: '', competitionUrl: null },
    ];
    listReplayLibraryPage.mockResolvedValueOnce({ rows, total: rows.length, page: 1 });
    listReplayLibraryFacetRows.mockResolvedValueOnce(facetsOf(rows));

    const html = renderToStaticMarkup(await ReplaysPage({ searchParams: Promise.resolve({}) }));
    const body = html.slice(html.indexOf('<tbody'));

    expect(html).toContain(heading);
    expect(body).toMatch(/href="\/leagues\/league-1"[^>]*>[\s\S]*?Summer League/);
    expect(body).toMatch(/href="\/tournaments\/t-2"[^>]*>[\s\S]*?Autumn Cup/);
    expect(body).toContain(unknown);
    expect(body).not.toContain('href="null"');
    expect(body).not.toContain('href="/leagues/undefined"');
    expect(body).not.toContain('Winter Playoffs');
    expect(body).toContain(locale === 'de'
      ? 'Zara vs. Bea, Autumn Cup, Finale, Partie 3'
      : 'Zara vs Bea, Autumn Cup, Finals, match 3');
  });

  it('renders the public replay library heading and empty state', async () => {
    listReplayLibraryPage.mockResolvedValueOnce({ rows: [], total: 0, page: 1 });
    listReplayLibraryFacetRows.mockResolvedValueOnce([]);

    const html = renderToStaticMarkup(await ReplaysPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('Replay Library');
    expect(html).toContain('No replays match the current filters.');
  });

  it('renders filtered replay rows using URL query params', async () => {
    listReplayLibraryRows.mockResolvedValueOnce([ALICE_BOB, ZARA_BEA]);

    const html = renderToStaticMarkup(
      await ReplaysPage({
        searchParams: Promise.resolve({
          q: 'alice',
          username: 'bobby',
          league: 'Summer League',
          tournament: 'Summer Open',
          round: 'Round 2',
          start: '2026-06-01',
          end: '2026-06-30',
          sort: 'players-asc',
        }),
      }),
    );

    expect(html).toContain('Alice vs Bob, Summer League, Round 2, match 1');
    expect(html).not.toContain('Zara vs Bea');
    expect(html).toContain('value="alice bobby"');
    expect(html).not.toContain('name="username"');
    expect(html).toContain('value="2026-06-01"');
    expect(html).toContain('value="2026-06-30"');
    expect(html).toContain('Summer League');
    expect(html).toContain('Summer Open');
    expect(html).toContain('Round 2');
    expect(html).toContain('match 1');
    expect(html).not.toContain('Game 1');
    expect(html).toContain('Open replay');
    // The controls are the site Button: a submit button, a reset link and the two row links.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>(?:<[^>]+>)*Apply/);
    expect(html).toMatch(/<a[^>]*href="\/replays"[^>]*>(?:<[^>]+>)*Reset/);
    expect(html).toMatch(/<a[^>]*href="\/tournaments\/t-1\/matches\/m-1"[^>]*>(?:<[^>]+>)*Match page/);
    expect(html).toContain(
      'href="https://replay.example/1" target="_blank" rel="noreferrer"',
    );
  });

  it('renders the full required naming format for every visible row', async () => {
    listReplayLibraryPage.mockResolvedValueOnce({ rows: [ALICE_BOB, ALICE_CHRIS], total: 2, page: 1 });
    listReplayLibraryFacetRows.mockResolvedValueOnce(facetsOf([ALICE_BOB, ALICE_CHRIS]));

    const html = renderToStaticMarkup(await ReplaysPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('Alice vs Bob, Summer League, Round 2, match 1');
    expect(html).toContain('Alice vs Chris, Summer League, Round 3, match 2');
  });

  it('serves the unfiltered view from one database page instead of every replay', async () => {
    listReplayLibraryPage.mockResolvedValueOnce({ rows: [ALICE_CHRIS], total: 45, page: 3 });
    listReplayLibraryFacetRows.mockResolvedValueOnce(facetsOf([ALICE_BOB, ZARA_BEA, ALICE_CHRIS]));

    const html = renderToStaticMarkup(
      await ReplaysPage({ searchParams: Promise.resolve({ page: '3', sort: 'date-asc' }) }),
    );

    expect(listReplayLibraryRows).not.toHaveBeenCalled();
    expect(listReplayLibraryPage).toHaveBeenCalledWith({ page: 3, perPage: 20, ascending: true });
    expect(html).toContain('Alice vs Chris, Summer League, Round 3, match 2');
    expect(html).not.toContain('Alice vs Bob, Summer League, Round 2, match 1');
    // Dropdowns still list every league from the lean facet read.
    expect(html).toContain('<option value="Winter League">Winter League</option>');
    expect(html).toContain('<option value="Finals">Finals</option>');
    // The pager counts the whole library (45 rows over 20 per page = 3 pages).
    expect(html).toContain('href="/replays?sort=date-asc&amp;perPage=20&amp;page=2"');
  });

  it('defaults the unfiltered view to newest first', async () => {
    listReplayLibraryPage.mockResolvedValueOnce({ rows: [], total: 0, page: 1 });
    listReplayLibraryFacetRows.mockResolvedValueOnce([]);

    await ReplaysPage({ searchParams: Promise.resolve({ perPage: '50' }) });

    expect(listReplayLibraryPage).toHaveBeenCalledWith({ page: 1, perPage: 50, ascending: false });
  });

  it('renders the date as an en-GB calendar date in a <time> element', async () => {
    listReplayLibraryPage.mockResolvedValueOnce({ rows: [ALICE_BOB], total: 1, page: 1 });
    listReplayLibraryFacetRows.mockResolvedValueOnce(facetsOf([ALICE_BOB]));

    const html = renderToStaticMarkup(await ReplaysPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('<time dateTime="2026-06-12T10:00:00.000Z">');
    expect(html).toContain('12 Jun 2026');
  });

  it('renders in German from the language cookie', async () => {
    cookieJar.locale = 'de';
    listReplayLibraryPage.mockResolvedValueOnce({ rows: [ALICE_BOB], total: 1, page: 1 });
    listReplayLibraryFacetRows.mockResolvedValueOnce(facetsOf([ALICE_BOB]));

    const html = renderToStaticMarkup(await ReplaysPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('Replay-Bibliothek');
    expect(html).toContain('Alice vs. Bob, Summer League, Runde 2, Partie 1');
    expect(html).toContain('Replay öffnen');
    // Round options keep the stored English value and show the German name.
    expect(html).toContain('<option value="Round 2">Runde 2</option>');
  });

  it('reads the full library when a filter or non-date sort is active', async () => {
    for (const searchParams of [{ q: 'alice' }, { league: 'Summer League' }, { sort: 'players-asc' }]) {
      vi.clearAllMocks();
      listReplayLibraryRows.mockResolvedValueOnce([ALICE_BOB, ZARA_BEA]);

      await ReplaysPage({ searchParams: Promise.resolve(searchParams) });

      expect(listReplayLibraryRows).toHaveBeenCalledTimes(1);
      expect(listReplayLibraryPage).not.toHaveBeenCalled();
      expect(listReplayLibraryFacetRows).not.toHaveBeenCalled();
    }
  });
});
