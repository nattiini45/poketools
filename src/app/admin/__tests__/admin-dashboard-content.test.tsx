/**
 * `DashboardView` renders what the dashboard API returns: a `null` figure is
 * not available for the viewer's role and is hidden (no zero, no empty panel),
 * the counters open their lists, and the attention list shows "N of M" when
 * truncated, names the league, says how long a match has been waiting and links
 * into the Matches list per status.
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
  updated_at: '2026-10-06T12:00:00Z',
  note: null,
};

const SITE_DATA: DashboardData = {
  counts: { players: 120, tournaments: 9, active_matches: 7, leagues: 4, games: 800 },
  attention_required: [MATCH],
  attention_total: 1,
  attention_by_status: { disputed: 1, pending_confirmation: 0 },
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
  counts: { players: null, tournaments: 3, active_matches: 2, leagues: 1, games: null },
  attention_required: [MATCH],
  attention_total: 1,
  attention_by_status: { disputed: 1, pending_confirmation: 0 },
  recent_activity: null,
};

/** Every `<a>...</a>` of the markup, so a test can ask what a link contains. */
function anchors(html: string): string[] {
  return html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? [];
}

function anchorTo(html: string, href: string): string | undefined {
  return anchors(html).find((a) => a.includes(`href="${href}"`));
}

describe('DashboardView', () => {
  it('shows every stat and the activity panel to a site admin', () => {
    const html = renderWithI18n(<DashboardView data={SITE_DATA} />);
    for (const label of ['Players', 'Tournaments', 'Active Matches', 'Leagues', 'Games']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('Seasons');
    expect(html).toContain('Recent Activity');
    expect(html).toContain('lg:grid-cols-5');
  });

  it('hides the site-wide stats and the activity panel from a resource admin', () => {
    const html = renderWithI18n(<DashboardView data={RESOURCE_DATA} />);
    expect(html).toContain('Tournaments');
    expect(html).toContain('Active Matches');
    expect(html).toContain('Leagues');
    expect(html).not.toContain('Players');
    expect(html).not.toContain('Games');
    expect(html).not.toContain('Recent Activity');
    expect(html).not.toContain('No recent activity');
    expect(html).toContain('Attention Required');
    expect(anchorTo(html, '/admin/players')).toBeUndefined();
  });

  it('treats a response without recent_activity like a null one', () => {
    const { recent_activity: _omitted, ...rest } = RESOURCE_DATA;
    const html = renderWithI18n(<DashboardView data={rest as DashboardData} />);
    expect(html).not.toContain('Recent Activity');
    expect(html).not.toContain('lg:grid-cols-2');
    expect(html).toContain('Attention Required');
  });

  it('calls the league total Ligen in German', () => {
    const de = renderWithI18n(<DashboardView data={SITE_DATA} />, { locale: 'de' });
    expect(de).toContain('Ligen');
    expect(de).not.toContain('Saisons');
  });

  it('makes each counter card a link to its list', () => {
    const html = renderWithI18n(<DashboardView data={SITE_DATA} />);
    expect(anchorTo(html, '/admin/players')).toContain('Players');
    expect(anchorTo(html, '/admin/tournaments')).toContain('Tournaments');
    expect(anchorTo(html, '/admin/leagues')).toContain('Leagues');
    expect(anchorTo(html, '/admin/matches')).toContain('Active Matches');
  });

  it('keeps the games card a plain card', () => {
    const html = renderWithI18n(<DashboardView data={SITE_DATA} />);
    expect(html).toContain('Games');
    expect(anchors(html).filter((a) => a.includes('Games'))).toEqual([]);
  });

  it('names the league next to the phase of an attention row', () => {
    const html = renderWithI18n(<DashboardView data={RESOURCE_DATA} />);
    expect(html).toContain('Summer League · Group stage');
  });

  it('shows only the tournament name for a standalone tournament', () => {
    const data = { ...RESOURCE_DATA, attention_required: [{ ...MATCH, season_name: null }] };
    const html = renderWithI18n(<DashboardView data={data} />);
    expect(html).toContain('Group stage');
    expect(html).not.toContain('Summer League');
    expect(html).not.toContain('Group stage ·');
  });

  it('links a row title to the admin match page and offers the public page', () => {
    const html = renderWithI18n(<DashboardView data={RESOURCE_DATA} />);
    expect(anchorTo(html, '/admin/matches/m-1')).toContain('Mara');
    expect(anchorTo(html, '/tournaments/t-1/matches/m-1')).toContain('Public page');
    expect(anchorTo(html, '/tournaments/t-1')).toContain('Tournament');
    expect(html).not.toContain('>View<');
    expect(renderWithI18n(<DashboardView data={RESOURCE_DATA} />, { locale: 'de' })).toContain(
      'Öffentliche Seite',
    );
  });

  it('shows the dispute note of a disputed row, clamped, and never one on a pending row', () => {
    const disputed = {
      ...RESOURCE_DATA,
      attention_required: [{ ...MATCH, note: 'Player 2 says the replay was cut short' }],
    };
    const html = renderWithI18n(<DashboardView data={disputed} />);
    expect(html).toContain('Player 2 says the replay was cut short');
    expect(html).toContain('line-clamp-2');

    const pending = {
      ...RESOURCE_DATA,
      attention_required: [{ ...MATCH, status: 'pending_confirmation' as const, note: 'Stale remark' }],
      attention_by_status: { disputed: 0, pending_confirmation: 1 },
    };
    const pendingHtml = renderWithI18n(<DashboardView data={pending} />);
    expect(pendingHtml).not.toContain('Stale remark');
    expect(pendingHtml).not.toContain('line-clamp-2');
  });

  it('says how long a match has been waiting', () => {
    // The test clock is Date.UTC(2026, 9, 9, 12): three days after updated_at.
    const html = renderWithI18n(<DashboardView data={RESOURCE_DATA} />);
    expect(html).toContain('Waiting · 3 days ago');
    const de = renderWithI18n(<DashboardView data={RESOURCE_DATA} />, { locale: 'de' });
    expect(de).toContain('Wartet · vor 3 Tagen');
  });

  it('keeps the order the API sends (oldest first)', () => {
    const rows = [
      { ...MATCH, id: 'm-old', player_1_name: 'Olga', updated_at: '2026-09-01T00:00:00Z' },
      { ...MATCH, id: 'm-new', player_1_name: 'Nico', updated_at: '2026-10-08T00:00:00Z' },
    ];
    const html = renderWithI18n(
      <DashboardView
        data={{
          ...RESOURCE_DATA,
          attention_required: rows,
          attention_total: 2,
          attention_by_status: { disputed: 2, pending_confirmation: 0 },
        }}
      />,
    );
    expect(html.indexOf('Olga')).toBeGreaterThan(-1);
    expect(html.indexOf('Olga')).toBeLessThan(html.indexOf('Nico'));
  });

  it('shows N of M when the attention list is truncated', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...MATCH, id: `m-${i}` }));
    const html = renderWithI18n(
      <DashboardView
        data={{
          ...SITE_DATA,
          attention_required: rows,
          attention_total: 57,
          attention_by_status: { disputed: 40, pending_confirmation: 17 },
        }}
      />,
    );
    expect(html).toContain('20 of 57 matches');
  });

  it('wraps the match line and the league line instead of truncating them', () => {
    const html = renderWithI18n(<DashboardView data={SITE_DATA} />);
    const link = anchorTo(html, '/admin/matches/m-1') ?? '';
    expect(link).toContain('Mara vs Nora');
    expect(link).toContain('break-words');
    expect(link).not.toContain('truncate');
    const league = html.match(/<p[^>]*>Summer League[^<]*<\/p>/)?.[0] ?? '';
    expect(league).toContain('break-words');
    expect(league).not.toContain('truncate');
  });

  it('does not hide attention rows behind an inner scroll', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...MATCH, id: `m-${i}` }));
    const html = renderWithI18n(
      <DashboardView data={{ ...SITE_DATA, attention_required: rows, attention_total: 5 }} />,
    );
    const start = html.indexOf('Attention Required');
    const end = html.indexOf('Recent Activity');
    expect(html.slice(start, end)).not.toContain('overflow-y-auto');
  });

  it('shows the plain count when nothing is truncated', () => {
    const html = renderWithI18n(<DashboardView data={SITE_DATA} />);
    expect(html).toContain('1 match');
    expect(html).not.toContain(' of ');
  });

  it('links See all only for a status that has matches', () => {
    const data = {
      ...RESOURCE_DATA,
      attention_total: 3,
      attention_by_status: { disputed: 3, pending_confirmation: 0 },
    };
    const html = renderWithI18n(<DashboardView data={data} />);
    expect(anchorTo(html, '/admin/matches?status=disputed')).toContain('See all disputed (3)');
    expect(html).not.toContain('status=pending_confirmation');
    expect(html).not.toContain('See all awaiting confirmation');
  });

  it('offers both See all links when both statuses have matches', () => {
    const data = {
      ...RESOURCE_DATA,
      attention_total: 5,
      attention_by_status: { disputed: 2, pending_confirmation: 3 },
    };
    const html = renderWithI18n(<DashboardView data={data} />);
    expect(anchorTo(html, '/admin/matches?status=disputed')).toContain('See all disputed (2)');
    expect(anchorTo(html, '/admin/matches?status=pending_confirmation')).toContain(
      'See all awaiting confirmation (3)',
    );
    const de = renderWithI18n(<DashboardView data={data} />, { locale: 'de' });
    expect(de).toContain('Alle strittigen anzeigen (2)');
    expect(de).toContain('Alle mit fehlender Bestätigung anzeigen (3)');
  });

  it('shows no See all link when nothing needs attention', () => {
    const data: DashboardData = {
      ...RESOURCE_DATA,
      attention_required: [],
      attention_total: 0,
      attention_by_status: { disputed: 0, pending_confirmation: 0 },
    };
    const html = renderWithI18n(<DashboardView data={data} />);
    expect(html).not.toContain('See all');
    expect(html).not.toContain('status=');
  });

  it('shows a translated placeholder for a missing tournament or player name', () => {
    const data = {
      ...RESOURCE_DATA,
      attention_required: [
        { ...MATCH, season_name: null, tournament_name: null, player_1_name: null, player_2_name: null },
      ],
    };
    const html = renderWithI18n(<DashboardView data={data} />);
    expect(html).toContain('Unknown vs Unknown');
    const de = renderWithI18n(<DashboardView data={data} />, { locale: 'de' });
    expect(de).toContain('Unbekannt');
    expect(de).not.toContain('Unknown');
  });

  it('renders the German copy', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...MATCH, id: `m-${i}` }));
    const html = renderWithI18n(
      <DashboardView
        data={{
          ...RESOURCE_DATA,
          attention_required: rows,
          attention_total: 57,
          attention_by_status: { disputed: 40, pending_confirmation: 17 },
        }}
      />,
      { locale: 'de' },
    );
    expect(html).toContain('20 von 57 Spielen');
    expect(html).toContain('Handlungsbedarf');
  });

  it('lists every recent event without a hidden inner scroll', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      id: `a-${i}`,
      actor_name: `Actor ${i}`,
      action: 'player.suspend',
      resource_type: 'player',
      resource_id: `p-${i}`,
      resource_name: `Target ${i}`,
      created_at: '2026-01-01T00:00:00Z',
    }));
    const html = renderWithI18n(<DashboardView data={{ ...SITE_DATA, recent_activity: entries }} />);
    for (let i = 0; i < 20; i++) {
      expect(html).toContain(`Actor ${i}`);
    }
    expect(html).not.toContain('overflow-y-auto');
    expect(html).not.toMatch(/max-h-\[/);
  });

  it('shows the empty state for a resource admin without resources', () => {
    const data: DashboardData = {
      counts: { players: null, tournaments: 0, active_matches: 0, leagues: 0, games: null },
      attention_required: [],
      attention_total: 0,
      attention_by_status: { disputed: 0, pending_confirmation: 0 },
      recent_activity: null,
    };
    const html = renderWithI18n(<DashboardView data={data} />);
    expect(html).toContain('No matches need attention');
  });
});
