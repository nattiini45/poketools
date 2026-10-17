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
import type { TournamentWithDetails } from '@/types/tournament';
import DashboardContent, {
  greetingKey,
  hourInZone,
  TeamsUsedList,
  type LeagueStandingSnapshot,
} from '../DashboardContent';
import type { TeamUsed } from '../teams-used';

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

const standings: LeagueStandingSnapshot[] = [
  {
    leagueId: 'l1',
    leagueName: 'EvoLiga',
    status: 'active',
    formatType: 'evolution_point_buy',
    participantCount: 1,
    snapshot: { rank: 3, total: 12, wins: 4, losses: 1 },
  },
  {
    leagueId: 'l2',
    leagueName: 'Type Triangle League',
    status: 'completed',
    formatType: 'draft',
    participantCount: 12,
    snapshot: null,
  },
];

const tournaments = [
  { id: 'stage1', name: 'EvoLiga Stage 1', season_id: 'l1', status: 'active', bracket_type: 'round_robin', participant_count: 12 },
  { id: 't9', name: 'Winter Cup', season_id: null, status: 'completed', bracket_type: 'swiss', participant_count: 8 },
] as unknown as TournamentWithDetails[];

const teamsUsed: TeamUsed[] = [
  {
    kind: 'league',
    id: 'l2',
    name: 'Type Triangle League',
    status: 'completed',
    pokemon: [
      { name: 'Great Tusk', brought: 5 },
      { name: 'Iron Valiant', brought: 2 },
    ],
  },
  { kind: 'tournament', id: 't9', name: 'Winter Cup', status: 'completed', pokemon: [{ name: 'Gholdengo', brought: 3 }] },
];

function renderDashboard(locale: 'en' | 'de', teams: TeamUsed[] = teamsUsed) {
  return renderWithI18n(
    <DashboardContent
      playerId="p1"
      playerName="Misty"
      initialPlayer={null}
      initialMatches={[match]}
      initialTournaments={tournaments}
      playerRating={null}
      playerStreaks={null}
      leagueStandings={standings}
      teamsUsed={teams}
    />,
    { locale, timeZone: 'UTC' },
  );
}

/** The HTML of one dashboard section, from its title to the next section title. */
function section(html: string, title: string, nextTitle: string): string {
  const start = html.indexOf(title);
  const end = html.indexOf(nextTitle, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('DashboardContent', () => {
  it('renders the English copy (request time 12:00 UTC: afternoon)', () => {
    const html = renderDashboard('en');
    expect(html).toContain('Good afternoon, Misty!');
    expect(html).toContain('1 match needs attention');
    expect(html).toContain('vs Ash');
    expect(html).toContain('Plan Team');
    expect(html).toContain('2 leagues');
    expect(html).toMatch(/Rank <span[^>]*>#3<\/span> of 12<span[^>]*> · 4W–1L<\/span>/);
    expect(html).toContain('Active');
    expect(html).toContain('Evolution Point Buy');
    expect(html).toContain('1 player');
    expect(html).toContain('0W–0L · 2 teams');
    expect(html).toContain('>0%<');
  });

  it('lists every league under My Leagues and only standalone tournaments under My Tournaments', () => {
    const html = renderDashboard('en');
    const leagues = section(html, 'My Leagues', 'My Tournaments');
    const tournamentsHtml = section(html, 'My Tournaments', 'History');

    expect(leagues).toContain('EvoLiga');
    expect(leagues).toContain('Type Triangle League');
    expect(leagues).toContain('Completed');
    expect(leagues).toContain('No final standing recorded.');
    expect(leagues).not.toContain('Stats coming soon');

    expect(tournamentsHtml).toContain('1 tournament');
    expect(tournamentsHtml).toContain('Winter Cup');
    expect(tournamentsHtml).not.toContain('Type Triangle League');
    expect(tournamentsHtml).not.toContain('EvoLiga');
  });

  it('counts the teams used in the banner stat and the History summary', () => {
    const html = renderDashboard('en');
    expect(html).toMatch(/>2<\/p><p[^>]*>Teams</);
    expect(html).toContain('0W–0L · 2 teams');
    expect(renderDashboard('en', [])).toContain('0W–0L · 0 teams');
  });
});

// History is collapsed on first render, so its body is rendered on its own here.
describe('TeamsUsedList', () => {
  it('shows each team used with its Pokémon and times brought', () => {
    const html = renderWithI18n(<TeamsUsedList teamsUsed={teamsUsed} />, { locale: 'en', timeZone: 'UTC' });
    expect(html).toContain('href="/leagues/l2"');
    expect(html).toContain('href="/tournaments/t9"');
    expect(html).toContain('League');
    expect(html).toContain('Tournament');
    expect(html).toContain('2 Pokémon brought');
    expect(html).toContain('Great Tusk ×5');
    expect(html).toContain('Gholdengo ×3');
    expect(html).not.toContain('/dashboard/team/');
  });

  it('localizes species names in German', () => {
    const html = renderWithI18n(<TeamsUsedList teamsUsed={teamsUsed} />, { locale: 'de', timeZone: 'UTC' });
    expect(html).toContain('Liga');
    expect(html).toContain('2 Pokémon eingesetzt');
    expect(html).toContain('Riesenzahn ×5');
  });

  it('says so when no battle stats exist yet', () => {
    const html = renderWithI18n(<TeamsUsedList teamsUsed={[]} />, { locale: 'en', timeZone: 'UTC' });
    expect(html).toContain('No battle stats recorded for your matches yet.');
  });
});

describe('DashboardContent (de)', () => {

  it('renders German copy, enum labels, localized species and the de number format', () => {
    const html = renderDashboard('de');
    expect(html).toContain('Guten Tag, Misty!');
    expect(html).toContain('1 Spiel wartet auf dich');
    expect(html).toContain('vs. Ash');
    expect(html).toContain('Team planen');
    expect(html).toContain('Angesetzt: 9. Okt., 16:30');
    expect(html).toMatch(/Platz <span[^>]*>3<\/span> von 12<span[^>]*> · 4S–1N<\/span>/);
    expect(html).toContain('Meine Ligen');
    expect(html).toContain('2 Ligen');
    expect(html).toContain('1 Turnier');
    expect(html).toContain('Kein Endstand erfasst.');
    expect(html).toContain('0S–0N · 2 Teams');
    expect(html).toMatch(/>0\u00a0%</); // de-DE percent: no-break space before %
    expect(html).not.toContain('Good afternoon');
  });
});
