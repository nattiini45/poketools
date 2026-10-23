/**
 * `DashboardView` renders what the dashboard API returns: a `null` figure is
 * not available for the viewer's role and is hidden (no zero, no empty panel),
 * the attention list shows "N of M" when truncated and names the league.
 */
import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { DashboardView, type DashboardData } from '../AdminDashboardContent';

const MATCH = {
  id: 'm-1',
  tournament_id: 't-1',
  tournament_name: 'Group stage',
  season_name: 'Summer League',
  player_1_name: 'Mara',
  player_2_name: 'Nora',
  status: 'disputed' as const,
  created_at: '2026-02-01T00:00:00Z',
};

const SITE_DATA: DashboardData = {
  counts: { players: 120, tournaments: 9, active_matches: 7, seasons: 4, games: 800 },
  attention_required: [MATCH],
  attention_total: 1,
  recent_activity: [
    {
      id: 'a-1',
      actor_name: 'Admin',
      action: 'player.suspend',
      resource_type: 'player',
      resource_id: 'p-9',
      resource_name: 'Mara',
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
};

const RESOURCE_DATA: DashboardData = {
  counts: { players: null, tournaments: 3, active_matches: 2, seasons: 1, games: null },
  attention_required: [MATCH],
  attention_total: 1,
  recent_activity: null,
};

describe('DashboardView', () => {
  it('shows every stat and the activity panel to a site admin', () => {
    const html = renderWithI18n(<DashboardView data={SITE_DATA} />);
    for (const label of ['Players', 'Tournaments', 'Active Matches', 'Seasons', 'Games']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Recent Activity');
    expect(html).toContain('lg:grid-cols-5');
  });

  it('hides the site-wide stats and the activity panel from a resource admin', () => {
    const html = renderWithI18n(<DashboardView data={RESOURCE_DATA} />);
    expect(html).toContain('Tournaments');
    expect(html).toContain('Active Matches');
    expect(html).toContain('Seasons');
    expect(html).not.toContain('Players');
    expect(html).not.toContain('Games');
    expect(html).not.toContain('Recent Activity');
    expect(html).not.toContain('No recent activity');
    expect(html).toContain('Attention Required');
  });

  it('treats a response without recent_activity like a null one', () => {
    const { recent_activity: _omitted, ...rest } = RESOURCE_DATA;
    const html = renderWithI18n(<DashboardView data={rest as DashboardData} />);
    expect(html).not.toContain('Recent Activity');
    expect(html).not.toContain('lg:grid-cols-2');
    expect(html).toContain('Attention Required');
  });

  it('names the league next to the phase of an attention row', () => {
    const html = renderWithI18n(<DashboardView data={RESOURCE_DATA} />);
    expect(html).toContain('Summer League · Group stage');
  });

  it('shows only the tournament name for a standalone tournament', () => {
    const data = { ...RESOURCE_DATA, attention_required: [{ ...MATCH, season_name: null }] };
    const html = renderWithI18n(<DashboardView data={data} />);
    expect(html).toContain('Group stage');
    expect(html).not.toContain('·');
  });

  it('shows N of M when the attention list is truncated', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...MATCH, id: `m-${i}` }));
    const html = renderWithI18n(<DashboardView data={{ ...SITE_DATA, attention_required: rows, attention_total: 57 }} />);
    expect(html).toContain('20 of 57 matches');
  });

  it('shows the plain count when nothing is truncated', () => {
    const html = renderWithI18n(<DashboardView data={SITE_DATA} />);
    expect(html).toContain('1 match');
    expect(html).not.toContain(' of ');
  });

  it('renders the German copy', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...MATCH, id: `m-${i}` }));
    const html = renderWithI18n(
      <DashboardView data={{ ...RESOURCE_DATA, attention_required: rows, attention_total: 57 }} />,
      { locale: 'de' },
    );
    expect(html).toContain('20 von 57 Spielen');
    expect(html).toContain('Handlungsbedarf');
  });

  it('shows the empty state for a resource admin without resources', () => {
    const data: DashboardData = {
      counts: { players: null, tournaments: 0, active_matches: 0, seasons: 0, games: null },
      attention_required: [],
      attention_total: 0,
      recent_activity: null,
    };
    const html = renderWithI18n(<DashboardView data={data} />);
    expect(html).toContain('No matches need attention');
  });
});
