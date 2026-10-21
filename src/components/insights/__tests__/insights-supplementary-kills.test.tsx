/**
 * The global kills tab of supplementary records (docs/format-packs.md, "Pack extensions"): the
 * global scope keeps no kills tab unless the active pack supplies earlier records; then the tab
 * lists them (or says they failed) under their own label. Scoped kill rankings are untouched.
 */
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement('a', { href, ...props }, children),
}));

import InsightsTabs from '../InsightsTabs';

type Props = Parameters<typeof InsightsTabs>[0];

const GLOBAL: Props = {
  initialTab: 'kills',
  scope: { type: 'global' },
  title: 'Global Insights',
  usageRows: [],
  isDoubles: false,
  standings: [],
  killRanking: [],
  participants: [],
  tournamentId: null,
  aggregateScopeType: 'all_time',
  aggregateScopeId: null,
  ratingRows: [],
  streakEntries: [],
};

describe('InsightsTabs: supplementary kill ranking', () => {
  it('has no kills tab in the global scope without supplementary records (unchanged)', () => {
    const html = renderWithI18n(<InsightsTabs {...GLOBAL} />);
    expect(html).not.toContain('Kill Ranking');
    expect(html).not.toContain('Earlier records');
  });

  it('shows the kills tab with the earlier records when the pack supplies them', () => {
    const html = renderWithI18n(
      <InsightsTabs {...GLOBAL} supplementaryKills={{ state: 'ready', rows: [{ pokemonName: 'Garchomp', kos: 12 }] }} />,
    );
    expect(html).toContain('Earlier records');
    expect(html).toContain('Garchomp');
  });

  it('keeps the tab hidden for an empty supplementary ranking', () => {
    const html = renderWithI18n(<InsightsTabs {...GLOBAL} supplementaryKills={{ state: 'ready', rows: [] }} />);
    expect(html).not.toContain('Earlier records');
  });

  it('shows the notice when the provider failed', () => {
    const html = renderWithI18n(<InsightsTabs {...GLOBAL} supplementaryKills={{ state: 'failed' }} />);
    expect(html).toContain('Earlier records could not be loaded right now.');
  });

  it('ignores supplementary records outside the global scope', () => {
    const html = renderWithI18n(
      <InsightsTabs
        {...GLOBAL}
        scope={{ type: 'league', id: 's1' }}
        supplementaryKills={{ state: 'ready', rows: [{ pokemonName: 'Garchomp', kos: 12 }] }}
      />,
    );
    expect(html).not.toContain('Earlier records');
  });
});
