import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement('a', { href, ...props }, children),
}));

import InsightsTabs from '../InsightsTabs';
import ScopedInsightsView, { DEFAULT_SCOPED_INSIGHTS_LABELS } from '../ScopedInsightsView';

const BASE = {
  usageRows: [],
  isDoubles: false,
  killRanking: [],
  aggregateScopeType: 'league' as const,
  aggregateScopeId: 's1',
};

describe('ScopedInsightsView', () => {
  it('renders English tab names without a provider (no labels prop)', () => {
    const html = renderToStaticMarkup(<ScopedInsightsView {...BASE} />);
    expect(html).toContain('Pokémon Usage');
    expect(html).toContain('Move Usage');
  });

  it('renders German tab names in German', () => {
    const html = renderWithI18n(<ScopedInsightsView {...BASE} />, { locale: 'de' });
    expect(html).toContain('Pokémon-Nutzung');
    expect(html).toContain('Attacken-Nutzung');
  });

  it('a labels override still wins', () => {
    const labels = { ...DEFAULT_SCOPED_INSIGHTS_LABELS, tabs: { ...DEFAULT_SCOPED_INSIGHTS_LABELS.tabs, usage: 'Custom' } };
    const html = renderWithI18n(<ScopedInsightsView {...BASE} labels={labels} />, { locale: 'de' });
    expect(html).toContain('Custom');
  });
});

describe('InsightsTabs', () => {
  const props = {
    initialTab: 'streaks' as const,
    scope: { type: 'global' as const },
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
    streakEntries: [
      {
        player_id: 'p1',
        player_name: 'Mara',
        player_avatar_url: null,
        current_win_streak: 3,
        best_win_streak: 6,
      },
    ] as unknown as Parameters<typeof InsightsTabs>[0]['streakEntries'],
  };

  it('renders English tab names and the streak line', () => {
    const html = renderWithI18n(<InsightsTabs {...props} />);
    expect(html).toContain('Insights &amp; statistics');
    expect(html).toContain('Ratings');
    expect(html).toContain('Win streak: 3 (best 6)');
  });

  it('renders German tab names and the streak line', () => {
    const html = renderWithI18n(<InsightsTabs {...props} />, { locale: 'de' });
    expect(html).toContain('Insights &amp; Statistiken');
    expect(html).toContain('Wertungen');
    expect(html).toContain('Siegesserie: 3 (Rekord 6)');
  });

  it('the ratings tab renders the leaderboard in German', () => {
    const html = renderWithI18n(<InsightsTabs {...props} initialTab="ratings" />, { locale: 'de' });
    expect(html).toContain('Globale Wertungen');
    expect(html).toContain('Min. Spiele');
  });
});
