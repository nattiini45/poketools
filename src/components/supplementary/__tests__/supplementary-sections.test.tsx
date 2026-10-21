/**
 * The public surfaces of supplementary records (docs/format-packs.md, "Pack extensions"): the
 * profile section, the Pokémon page line, the global kill ranking and the head-to-head line.
 * Nothing renders (and no provider runs) without a provider or when the records do not count;
 * a failed provider shows the notice instead of partial numbers; labels come from the
 * `supplementary-records` namespace in both languages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { renderWithI18n } from '@/test/i18n';

const mocks = vi.hoisted(() => ({
  extensions: {} as Record<string, unknown>,
  getSessionPlayer: vi.fn(),
}));

vi.mock('@pack-extensions', () => ({ default: mocks.extensions }));
vi.mock('@/lib/auth/helpers', () => ({ getSessionPlayer: mocks.getSessionPlayer }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});
// The collapsible primitive renders a collapsed body lazily; the stub shows title and body.
vi.mock('@/components/profile/ProfileSection', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import SupplementaryRecordSection from '../SupplementaryRecordSection';
import SupplementaryPokemonKos from '../SupplementaryPokemonKos';
import SupplementaryKillRanking from '../SupplementaryKillRanking';
import { HeadToHeadCard, HeadToHeadLoaded, HeadToHeadSupplementLine, summarizeHeadToHead } from '@/components/stats/HeadToHeadMatrix';

function setExtensions(ext: Record<string, unknown>): void {
  for (const key of Object.keys(mocks.extensions)) delete mocks.extensions[key];
  Object.assign(mocks.extensions, ext);
}

async function render(node: Promise<ReactElement | null>): Promise<string> {
  const element = await node;
  return element ? renderWithI18n(element) : '';
}

beforeEach(() => {
  setExtensions({});
  mocks.getSessionPlayer.mockReset();
  mocks.getSessionPlayer.mockResolvedValue({ playerId: 'viewer-1' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SupplementaryRecordSection (profile)', () => {
  it('renders nothing and reads nothing without a provider', async () => {
    expect(await render(SupplementaryRecordSection({ playerId: 'p1' }))).toBe('');
    expect(mocks.getSessionPlayer).not.toHaveBeenCalled();
  });

  it("shows the player's earlier record, titles and runner-up finishes, labelled as earlier records", async () => {
    const provider = vi.fn().mockResolvedValue({ played: 6, wins: 3, draws: 1, losses: 2, titles: 2, runnerUps: 1 });
    setExtensions({ supplementaryPlayerRecord: provider });
    const html = await render(SupplementaryRecordSection({ playerId: 'p1' }));
    expect(provider).toHaveBeenCalledWith('p1', { viewerPlayerId: 'viewer-1' });
    expect(html).toContain('Earlier records');
    expect(html).toContain('3 W · 1 D · 2 L');
    expect(html).toContain('6 matches');
    expect(html).toContain('2 titles');
    expect(html).toContain('1 runner-up finish');
    expect(html).toContain('not part of the live statistics');
  });

  it('leaves out zero titles and runner-up finishes', async () => {
    setExtensions({
      supplementaryPlayerRecord: vi.fn().mockResolvedValue({ played: 1, wins: 1, draws: 0, losses: 0, titles: 0, runnerUps: 0 }),
    });
    const html = await render(SupplementaryRecordSection({ playerId: 'p1' }));
    expect(html).toContain('1 match');
    expect(html).not.toContain('title');
    expect(html).not.toContain('runner-up');
  });

  it('shows titles without a W / D / L line when no played matches are known (nothing invented)', async () => {
    setExtensions({
      supplementaryPlayerRecord: vi.fn().mockResolvedValue({ played: 0, wins: 0, draws: 0, losses: 0, titles: 1, runnerUps: 0 }),
    });
    const html = await render(SupplementaryRecordSection({ playerId: 'p1' }));
    expect(html).toContain('Earlier records');
    expect(html).toContain('1 title');
    expect(html).not.toContain('0 W');
    expect(html).not.toContain('0 matches');
  });

  it('renders nothing for a player without earlier records or when they do not count', async () => {
    setExtensions({ supplementaryPlayerRecord: vi.fn().mockResolvedValue(null) });
    expect(await render(SupplementaryRecordSection({ playerId: 'p1' }))).toBe('');
    const provider = vi.fn();
    setExtensions({ includeSupplementaryRecords: vi.fn().mockResolvedValue(false), supplementaryPlayerRecord: provider });
    expect(await render(SupplementaryRecordSection({ playerId: 'p1' }))).toBe('');
    expect(provider).not.toHaveBeenCalled();
  });

  it('says the records could not be loaded when the provider fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setExtensions({ supplementaryPlayerRecord: vi.fn().mockRejectedValue(new Error('down')) });
    const html = await render(SupplementaryRecordSection({ playerId: 'p1' }));
    expect(html).toContain('Earlier records could not be loaded right now.');
    expect(html).not.toContain(' W ·');
  });
});

describe('SupplementaryPokemonKos (Pokémon page)', () => {
  it('renders nothing without a provider', async () => {
    expect(await render(SupplementaryPokemonKos({ species: 'Garchomp' }))).toBe('');
  });

  it('shows the all-time earlier KO total', async () => {
    const provider = vi.fn().mockResolvedValue({ kos: 12 });
    setExtensions({ supplementaryPokemonKos: provider });
    expect(await render(SupplementaryPokemonKos({ species: 'Garchomp' }))).toContain('Earlier records: 12 KOs');
    expect(provider).toHaveBeenCalledWith('Garchomp', { viewerPlayerId: 'viewer-1' });
  });

  it('renders nothing for no or zero KOs', async () => {
    setExtensions({ supplementaryPokemonKos: vi.fn().mockResolvedValue(null) });
    expect(await render(SupplementaryPokemonKos({ species: 'Garchomp' }))).toBe('');
    setExtensions({ supplementaryPokemonKos: vi.fn().mockResolvedValue({ kos: 0 }) });
    expect(await render(SupplementaryPokemonKos({ species: 'Garchomp' }))).toBe('');
  });

  it('says the records could not be loaded when the provider fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setExtensions({ supplementaryPokemonKos: vi.fn().mockRejectedValue(new Error('down')) });
    expect(await render(SupplementaryPokemonKos({ species: 'Garchomp' }))).toContain('could not be loaded');
  });
});

describe('SupplementaryKillRanking (Insights, global scope)', () => {
  it('lists species and KOs under the earlier-records label, in both languages', () => {
    const rows = [{ pokemonName: 'Garchomp', kos: 12 }, { pokemonName: 'Gholdengo', kos: 7 }];
    const en = renderWithI18n(<SupplementaryKillRanking rows={rows} />);
    expect(en).toContain('Earlier records');
    expect(en).toContain('Garchomp');
    expect(en).toContain('12');
    const de = renderWithI18n(<SupplementaryKillRanking rows={rows} />, { locale: 'de' });
    expect(de).toContain('Frühere Ergebnisse');
    expect(de).toContain('Knakrack');
  });

  it('shows the notice instead of a table when the provider failed', () => {
    const html = renderWithI18n(<SupplementaryKillRanking rows={[]} failed />);
    expect(html).toContain('could not be loaded');
    expect(html).not.toContain('<table');
  });
});

describe('HeadToHeadSupplementLine', () => {
  it('renders the earlier record from player 1 side, nothing when absent, excluded or empty', () => {
    expect(
      renderWithI18n(<HeadToHeadSupplementLine supplement={{ state: 'ready', record: { wins: 2, draws: 0, losses: 1 } }} />),
    ).toContain('Earlier records: 2 W · 0 D · 1 L');
    expect(renderWithI18n(<HeadToHeadSupplementLine supplement={undefined} />)).toBe('');
    expect(renderWithI18n(<HeadToHeadSupplementLine supplement={{ state: 'excluded' }} />)).toBe('');
    expect(renderWithI18n(<HeadToHeadSupplementLine supplement={{ state: 'ready', record: null }} />)).toBe('');
    expect(renderWithI18n(<HeadToHeadSupplementLine supplement={{ state: 'failed' }} />)).toContain('could not be loaded');
  });
});

describe('HeadToHeadLoaded', () => {
  const props = { player1Id: 'p1', player2Id: 'p2', player1Name: 'Alice', player2Name: 'Bob' };

  it('is the bare live card without a supplement (no wrapper: the markup of a pack without the seam)', () => {
    const bare = renderWithI18n(<HeadToHeadCard player1Name="Alice" player2Name="Bob" summary={summarizeHeadToHead([], 'p1', 'p2')} />);
    expect(renderWithI18n(<HeadToHeadLoaded {...props} load={{ ok: true, matches: [] }} />)).toBe(bare);
  });

  it('wraps the card and the supplement line when the route sent one', () => {
    const html = renderWithI18n(
      <HeadToHeadLoaded {...props} load={{ ok: true, matches: [], supplement: { state: 'ready', record: { wins: 1, draws: 0, losses: 0 } } }} />,
    );
    expect(html.startsWith('<div class="space-y-2">')).toBe(true);
    expect(html).toContain('Earlier records: 1 W · 0 D · 0 L');
  });
});
