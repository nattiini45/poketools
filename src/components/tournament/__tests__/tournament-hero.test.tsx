import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { ...rest, href }, children) };
});
vi.mock('@/i18n/LocalTime', () => ({ LocalTime: ({ value }: { value: string }) => value }));

import TournamentHero from '../TournamentHero';
import type { TournamentHeroView } from '@/lib/tournament/page-view';

const TOURNAMENT = {
  id: 't-1',
  name: 'Regular Season',
  description: '',
  status: 'active',
  current_round: 3,
  bracket_type: 'round_robin',
  best_of_default: 3,
  is_doubles: false,
  ruleset_name: 'Gen 9 OU',
  participant_count: 6,
} as const;

const side = (playerId: string, name: string, rank: number, points: number) => ({ playerId, name, avatarUrl: null, ace: null, rank, points });
const LIVE: TournamentHeroView = {
  matchesPlayed: 6,
  match: { kind: 'live', matchId: 'm-1', scheduledAt: null, home: side('a', 'Aria', 1, 6), away: side('b', 'Bram', 6, 0) },
  leader: null,
};

const render = (props: Partial<Parameters<typeof TournamentHero>[0]> = {}) =>
  renderToStaticMarkup(<TournamentHero tournament={TOURNAMENT} league={null} roundCount={3} view={LIVE} locale="en" {...props} />);

describe('TournamentHero', () => {
  it('is the page heading: the name alone for a standalone tournament', () => {
    const html = render();
    expect(html).toMatch(/<h1 id="tournament-hero-heading"[^>]*>Regular Season<\/h1>/);
    expect(html).not.toContain('Back to league');
    expect(html).toContain('Active · Round 3');
    expect(html).toContain('Round robin · Bo3 · Gen 9 OU');
  });

  it('names the league in the heading of a phase and links back to its schedule', () => {
    const html = render({ league: { id: 's-1', name: 'Sakura Cup' } });
    expect(html).toMatch(/<h1[^>]*>Sakura Cup — Regular Season<\/h1>/);
    expect(html).toContain('href="/leagues/s-1#schedule"');
    expect(html).toContain('aria-label="Back to the league Sakura Cup"');
  });

  it('puts the live match on the slab with both places and a link to it', () => {
    const html = render();
    expect(html).toContain('data-tournament-hero="live"');
    expect(html).toContain('Live now');
    expect(html).toContain('#1 · 6 pts');
    expect(html).toContain('#6 · 0 pts');
    expect(html).toContain('href="/tournaments/t-1/matches/m-1"');
    expect(html).toContain('href="/players/a"');
  });

  it('shows the champion of a finished tournament, in German too', () => {
    const view: TournamentHeroView = { matchesPlayed: 15, match: null, leader: side('a', 'Aria', 1, 12) };
    const html = render({ tournament: { ...TOURNAMENT, status: 'completed' }, view, locale: 'de' });
    expect(html).toContain('data-tournament-hero="leader"');
    expect(html).toContain('Champion');
    expect(html).toContain('Platz 1 · 12 Pkt.');
    expect(html).toContain('Spiele gespielt');
    expect(html).not.toContain('Runde 3');
  });

  it('is a plain hero before anything has been played', () => {
    const html = render({ tournament: { ...TOURNAMENT, status: 'upcoming', current_round: 0 }, view: { matchesPlayed: 0, match: null, leader: null } });
    expect(html).toContain('data-tournament-hero="plain"');
    expect(html).not.toContain('league-hero-split');
    expect(html).toContain('Upcoming');
  });
});
