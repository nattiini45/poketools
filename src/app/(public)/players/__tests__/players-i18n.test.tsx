import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  locale: undefined as string | undefined,
  playerDirectory: vi.fn(),
  getPublicPlayers: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'plc_locale' && mocks.locale !== undefined ? { name, value: mocks.locale } : undefined,
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement('a', { href, ...props }, children),
}));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: { playerDirectory: mocks.playerDirectory } }));
vi.mock('@/lib/supabase/queries/players', () => ({ getPublicPlayers: mocks.getPublicPlayers }));

import PlayersDirectoryPage from '../page';

const PLAYERS = [
  { id: 'p1', name: 'Mara', avatar_url: null, is_creator: true, is_guest: false, rating: null, rd: null },
];

describe('PlayersDirectoryPage', () => {
  beforeEach(() => {
    mocks.locale = undefined;
    mocks.playerDirectory.mockResolvedValue({ data: PLAYERS, total: 100 });
  });

  it('renders English by default', async () => {
    const html = renderToStaticMarkup(await PlayersDirectoryPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Browse league competitors');
    expect(html).toContain('placeholder="Search by name…"');
    expect(html).toContain('Unrated');
    expect(html).toContain('Page 1 of 3');
  });

  it('renders German from the language cookie', async () => {
    mocks.locale = 'de';
    const html = renderToStaticMarkup(await PlayersDirectoryPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Entdecke die Spieler der Liga');
    expect(html).toContain('Ohne Wertung');
    expect(html).toContain('Seite 1 von 3');
    expect(html).toContain('Weiter');
  });
});
