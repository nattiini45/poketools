/**
 * T18: the dashboard renders through the `dashboard` namespace, enum labels
 * through `enums`, and dates and the greeting through the viewer's formatter
 * (the greeting hour comes from the request time in the provider zone, so the
 * server render and hydration agree).
 */
import { describe, expect, it } from 'vitest';
import { createFormatter } from '@/i18n/format';
import { renderWithI18n } from '@/test/i18n';
import type { MatchWithPlayers } from '@/types/match';
import type { SeasonWithDetails } from '@/types/season';
import type { Team } from '@/types/team';
import DashboardContent, { greetingKey, hourInZone, type LeagueStandingSnapshot } from '../DashboardContent';

describe('greetingKey', () => {
  it('splits the day at 12 and 18', () => {
    expect(greetingKey(0)).toBe('morning');
    expect(greetingKey(11)).toBe('morning');
    expect(greetingKey(12)).toBe('afternoon');
    expect(greetingKey(17)).toBe('afternoon');
    expect(greetingKey(18)).toBe('evening');
    expect(greetingKey(23)).toBe('evening');
  });
});

describe('hourInZone', () => {
  const at = Date.UTC(2026, 9, 9, 16, 30); // 18:30 in Berlin (CEST)

  it('reads the hour in the formatter zone, in both locales', () => {
    expect(hourInZone(createFormatter({ locale: 'en', timeZone: 'UTC' }), at)).toBe(16);
    expect(hourInZone(createFormatter({ locale: 'de', timeZone: 'Europe/Berlin' }), at)).toBe(18);
    expect(hourInZone(createFormatter({ locale: 'en', timeZone: 'America/New_York' }), at)).toBe(12);
  });
});

const match = {
  id: 'm1',
  tournament_id: 't1',
  status: 'scheduled',
  round_status: 'active',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Misty',
  player_2_name: 'Ash',
  winner_id: null,
  scheduled_at: '2026-10-09T16:30:00.000Z',
} as unknown as MatchWithPlayers;

const league = {
  id: 'l1',
  name: 'EvoLiga',
  status: 'active',
  format_type: 'evolution_point_buy',
  participant_count: 1,
} as unknown as SeasonWithDetails;

const team = {
  id: 'team1',
  pokemon: [{}, {}, {}],
  locked: true,
  updated_at: '2026-10-09T10:00:00.000Z',
} as unknown as Team;

const standings: LeagueStandingSnapshot[] = [
  { leagueId: 'l1', leagueName: 'EvoLiga', snapshot: { rank: 3, total: 12, wins: 4, losses: 1 } },
];

function renderDashboard(locale: 'en' | 'de') {
  return renderWithI18n(
    <DashboardContent
      playerId="p1"
      playerName="Misty"
      initialPlayer={null}
      initialMatches={[match]}
      initialTeams={[team]}
      initialTournaments={[]}
      initialLeagues={[league]}
      playerRating={null}
      playerStreaks={null}
      leagueStandings={standings}
    />,
    { locale, timeZone: 'UTC' },
  );
}

describe('DashboardContent', () => {
  it('renders the English copy (request time 12:00 UTC: afternoon)', () => {
    const html = renderDashboard('en');
    expect(html).toContain('Good afternoon, Misty!');
    expect(html).toContain('1 match needs attention');
    expect(html).toContain('vs Ash');
    expect(html).toContain('Plan Team');
    expect(html).toContain('1 standing');
    expect(html).toMatch(/Rank <span[^>]*>#3<\/span> of 12<span[^>]*> · 4W–1L<\/span>/);
    expect(html).toContain('Active');
    expect(html).toContain('Evolution Point Buy');
    expect(html).toContain('1 player');
    expect(html).toContain('0W–0L · 1 team');
    expect(html).toContain('>0%<');
  });

  it('renders German copy, enum labels and the de number format', () => {
    const html = renderDashboard('de');
    expect(html).toContain('Guten Tag, Misty!');
    expect(html).toContain('1 Spiel wartet auf dich');
    expect(html).toContain('vs. Ash');
    expect(html).toContain('Team planen');
    expect(html).toContain('Angesetzt: 9. Okt., 16:30');
    expect(html).toMatch(/Platz <span[^>]*>3<\/span> von 12<span[^>]*> · 4S–1N<\/span>/);
    expect(html).toContain('Meine Ligen');
    expect(html).toContain('0S–0N · 1 Team');
    expect(html).toMatch(/>0 %</); // de-DE percent: no-break space before %
    expect(html).not.toContain('Good afternoon');
  });
});
