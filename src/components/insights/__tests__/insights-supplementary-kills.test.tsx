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
  activeTab: 'kills',
  scope: { type: 'global' },
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
  it('keeps a requested empty kills tab explicit without supplementary records', () => {
    const html = renderWithI18n(<InsightsTabs {...GLOBAL} />);
    expect(html).toContain('Kill Ranking');
    expect(html).toMatch(/tab=kills"[^>]*aria-current="page"/);
    expect(html).toContain('No kill data yet');
    expect(html).not.toContain('Earlier records');
  });

  it('shows the kills tab with the earlier records when the pack supplies them', () => {
    const html = renderWithI18n(
      <InsightsTabs {...GLOBAL} supplementaryKills={{ state: 'ready', rows: [{ pokemonName: 'Garchomp', kos: 12 }] }} />,
    );
    expect(html).toContain('Earlier records');
    expect(html).toContain('Garchomp');
  });

  it('does not label an empty supplementary ranking as earlier records', () => {
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
