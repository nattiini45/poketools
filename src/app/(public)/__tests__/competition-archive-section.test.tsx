import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PackExtensions } from '@/lib/pack-extensions/types';

const mocks = vi.hoisted(() => ({
  extensions: {} as PackExtensions,
  seasonList: vi.fn(),
  tournamentList: vi.fn(),
}));

vi.mock('@/lib/pack-extensions', () => ({ packExtensions: mocks.extensions }));
vi.mock('@/lib/cache/public-reads', () => ({
  publicReads: { seasonList: mocks.seasonList, tournamentList: mocks.tournamentList },
}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
    getFormatter: async () => ({ calendarDate: (value: string) => value }),
  };
});

import LeaguesPage from '../leagues/page';
import TournamentsPage from '../tournaments/page';

beforeEach(() => {
  delete mocks.extensions.CompetitionArchiveSection;
  mocks.seasonList.mockResolvedValue([]);
  mocks.tournamentList.mockResolvedValue([]);
});

describe('competition archive section', () => {
  it.each([
    ['league', LeaguesPage],
    ['tournament', TournamentsPage],
  ] as const)('renders the optional %s archive separately, even with no live rows', async (kind, page) => {
    mocks.extensions.CompetitionArchiveSection = ({ kind: sectionKind }) => (
      <section data-archive-kind={sectionKind}>Archived competitions</section>
    );
    const html = renderToStaticMarkup(await page({ searchParams: Promise.resolve({ status: 'active' }) }));
    expect(html).toContain(`data-archive-kind="${kind}"`);
    expect(html).toContain(kind === 'league' ? 'No leagues yet.' : 'No tournaments yet.');
  });

  it.each([LeaguesPage, TournamentsPage])('keeps the ordinary empty list without an extension', async (page) => {
    expect(renderToStaticMarkup(await page())).not.toContain('data-archive-kind');
  });
});
