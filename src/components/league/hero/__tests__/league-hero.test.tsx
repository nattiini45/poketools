import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LeagueHero from '@/components/league/hero/LeagueHero';
import type { HeroSide, LeagueHeroView } from '@/lib/league-hub/hero';

const LEAGUE = { id: 'l1', name: 'Sakura Cup', status: 'active', format_type: 'singles', participant_count: 6 } as const;

const side = (playerId: string, rank: number | null): HeroSide => ({
  playerId,
  name: playerId,
  avatarUrl: null,
  ace: null,
  rank,
  points: rank === null ? null : 9 - rank,
});

const VIEW: LeagueHeroView = { matchday: 3, matchesPlayed: 6, daysLeft: 21, startsInDays: null, match: null, leader: null };

const match = (kind: 'yours' | 'live' | 'next', canSubmit = false): LeagueHeroView['match'] => ({
  kind,
  matchId: 'm1',
  tournamentId: 't1',
  status: 'scheduled',
  scheduledAt: null,
  home: side('Aria', 1),
  away: side('Bram', null),
  canSubmit,
});

const render = (view: LeagueHeroView, worldId = 'sakura', locale: 'en' | 'de' = 'en') =>
  renderToStaticMarkup(<LeagueHero league={LEAGUE} worldId={worldId} view={view} locale={locale} />);

describe('LeagueHero', () => {
  it('is the page heading, with status, matchday and the counts', () => {
    const html = render(VIEW);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Sakura Cup<\/h1>/);
    expect(html).toContain('Active · Matchday 3');
    expect(html).toContain('trainers');
    expect(html).toContain('days left');
    expect(html).toContain('data-league-hero="plain"');
  });

  it('carries the lore line of a themed world only', () => {
    expect(render(VIEW, 'sakura')).toContain('Sakura Park.');
    expect(render(VIEW, 'mountain')).toContain('Mountain Pass.');
    const plain = render(VIEW, 'default');
    for (const lore of ['Sakura Park.', 'Plaza world.', 'Mountain Pass.', 'Skyisle.']) expect(plain).not.toContain(lore);
  });

  it('the viewer\'s own match offers Submit, Match prep and the match page', () => {
    const html = render({ ...VIEW, match: match('yours', true) });
    expect(html).toContain('Your next match');
    expect(html).toContain('href="/dashboard/submit/m1"');
    expect(html).toContain('href="/dashboard/match-prep/m1"');
    expect(html).toContain('href="/tournaments/t1/matches/m1"');
    expect(html).toContain('#1 · 8 pts');
  });

  it('another trainer\'s match offers only the match page', () => {
    const html = render({ ...VIEW, match: match('live') });
    expect(html).toContain('Live now');
    expect(html).not.toContain('/dashboard/submit/');
    expect(html).not.toContain('/dashboard/match-prep/');
    expect(html).toContain('href="/tournaments/t1/matches/m1"');
  });

  it('without a match the leader stands on the slab, as champion once the league is over', () => {
    expect(render({ ...VIEW, leader: side('Aria', 1) })).toContain('Top of the table');
    const done = renderToStaticMarkup(
      <LeagueHero league={{ ...LEAGUE, status: 'completed' }} worldId="sakura" view={{ ...VIEW, leader: side('Aria', 1) }} locale="en" />,
    );
    expect(done).toContain('Champion');
    expect(done).toContain('data-league-hero="leader"');
  });

  it('renders German', () => {
    const html = render({ ...VIEW, match: match('yours', true) }, 'sakura', 'de');
    expect(html).toContain('Läuft · Spieltag 3');
    expect(html).toContain('Dein nächstes Spiel');
    expect(html).toContain('Ergebnis melden');
    expect(html).toContain('Platz 1 · 8 Pkt.');
  });
});
