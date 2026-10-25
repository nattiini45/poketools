/**
 * AdminMatchList (server render): the URL is the source of truth, so a deep
 * link renders its status tab, league, phase and search text on the first
 * paint. The client-only behaviour (fetches, debounce, abort) needs a DOM and is
 * not rendered here; its URL parsing and query building are the pure helpers of
 * `src/lib/admin/__tests__/match-list.test.ts`.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

const nav = vi.hoisted(() => ({ search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/matches',
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import AdminMatchList, { MatchListPager, MatchListSelectionHeader, useMatchListUpdate } from '../AdminMatchList';
import { MatchListRow } from '../AdminMatchRowCard';
import type { AdminMatchRow } from '@/lib/supabase/queries/matches';
import type { AdminMatchViewer } from '@/lib/admin/match-row-actions';
import { ADMIN_MATCH_MAX_PAGE, parseMatchListUrl } from '@/lib/admin/match-list';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const PHASE = '22222222-2222-4222-8222-222222222222';
const ROUND = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  nav.search = '';
});

describe('AdminMatchList', () => {
  it('renders the search box, the League and Phase selects and all status tabs', () => {
    const html = renderWithI18n(<AdminMatchList />);
    expect(html).toContain('Search players or match ID...');
    expect(html).toContain('aria-label="League"');
    expect(html).toContain('aria-label="Phase"');
    expect(html).toContain('All leagues');
    expect(html).toContain('No league (standalone)');
    expect(html).toContain('All phases');
    for (const label of ['All', 'Scheduled', 'In Progress', 'Pending', 'Completed', 'Disputed']) {
      expect(html).toContain(`>${label}</button>`);
    }
  });

  it('disables the phase select until a league is chosen', () => {
    const none = renderWithI18n(<AdminMatchList />);
    expect(none).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Phase"|<select[^>]*aria-label="Phase"[^>]*disabled=""/);

    nav.search = `league=${LEAGUE}`;
    const chosen = renderWithI18n(<AdminMatchList />);
    expect(chosen).not.toMatch(/<select[^>]*disabled=""[^>]*aria-label="Phase"|<select[^>]*aria-label="Phase"[^>]*disabled=""/);
  });

  it('reads status, league, phase and q from the query string (deep link)', () => {
    nav.search = `league=${LEAGUE}&phase=${PHASE}&status=disputed&q=mara`;
    const html = renderWithI18n(<AdminMatchList />);
    expect(html).toContain('value="mara"');
    // The Disputed tab is the pressed one.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Disputed<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>All<\/button>/);
    // Options have not loaded yet: the selected league and phase stay selected, under a neutral label, not the id.
    expect(html).toContain(`<option value="${LEAGUE}" selected="">Loading...</option>`);
    expect(html).toContain(`<option value="${PHASE}" selected="">Loading...</option>`);
    expect(html).not.toContain(`>${LEAGUE}</option>`);
    expect(html).not.toContain(`>${PHASE}</option>`);
    const german = renderWithI18n(<AdminMatchList />, { locale: 'de' });
    expect(german).toContain(`<option value="${LEAGUE}" selected="">Wird geladen …</option>`);
  });

  it('selects the standalone group for league=standalone and labels the second select Tournament', () => {
    nav.search = 'league=standalone';
    const html = renderWithI18n(<AdminMatchList />);
    expect(html).toContain('<option value="standalone" selected="">No league (standalone)</option>');
    expect(html).toContain('aria-label="Tournament"');
    expect(html).toContain('All Tournaments');
  });

  it('ignores a hand-edited bad query string instead of failing', () => {
    nav.search = 'league=not-a-uuid&status=bogus&page=-3';
    const html = renderWithI18n(<AdminMatchList />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>All<\/button>/);
  });

  it('renders the new filters from the query string on the first paint (deep link)', () => {
    nav.search = `league=${LEAGUE}&phase=${PHASE}&round=${ROUND}&preset=overdue&sort=status_priority&test=1`;
    const html = renderWithI18n(<AdminMatchList />);
    // The round stays selected under a neutral label while the rounds load, like league and phase.
    expect(html).toContain(`<option value="${ROUND}" selected="">Loading...</option>`);
    expect(html).not.toContain(`>${ROUND}</option>`);
    expect(html.match(/aria-pressed="true"[^>]*>Overdue<\/button>/g)).toHaveLength(2);
    expect(html).toContain('<option value="status_priority" selected="">Needs attention first</option>');
    const checkbox = (label: string) => new RegExp(`(<input type="checkbox"[^>]*>)<span>${label}</span>`).exec(html)?.[1] ?? '';
    expect(checkbox('Show test leagues')).toContain('checked=""');
    expect(checkbox('Show archived leagues and tournaments')).toContain('<input');
    expect(checkbox('Show archived leagues and tournaments')).not.toContain('checked=""');
    // One chip per active filter, and the status tab "All" is still the pressed tab (the preset names its own status).
    expect(html).toContain('aria-label="Remove filter: Overdue"');
    expect(html).toContain('aria-label="Remove filter: Show test leagues"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>All<\/button>/);
  });

  it('collapses "More filters" and shows no chips on a plain visit', () => {
    const html = renderWithI18n(<AdminMatchList />);
    expect(html).toMatch(/aria-expanded="false"[^>]*>More filters/);
    expect(html).not.toContain('Clear all');
    expect(html).toContain('aria-label="Round"');
  });

  it('no longer offers the Override button (the whole row opens the admin page)', () => {
    nav.search = 'status=disputed';
    expect(renderWithI18n(<AdminMatchList />)).not.toContain('Override');
    expect(renderWithI18n(<AdminMatchList />, { locale: 'de' })).not.toContain('Korrigieren');
  });

  it('is translated to German', () => {
    const html = renderWithI18n(<AdminMatchList />, { locale: 'de' });
    expect(html).toContain('Alle Ligen');
    expect(html).toContain('Keine Liga (einzelnes Turnier)');
    expect(html).toContain('Alle Phasen');
    expect(html).toContain('Spieler oder Spiel-ID suchen');
    expect(html).toContain('>Strittig</button>');
    expect(html).toContain('Weitere Filter');
    expect(html).toContain('>Überfällig</button>');
    expect(html).toContain('aria-label="Runde"');
  });
});

describe('useMatchListUpdate', () => {
  /** The `update` function of one render, and the query strings it hands to the router. */
  function setup() {
    const replaced: string[] = [];
    const handle: { update?: ReturnType<typeof useMatchListUpdate> } = {};
    function Probe({ onRender }: { onRender: (update: ReturnType<typeof useMatchListUpdate>) => void }) {
      onRender(useMatchListUpdate(parseMatchListUrl(new URLSearchParams()), (search) => replaced.push(search)));
      return null;
    }
    renderToStaticMarkup(<Probe onRender={(update) => (handle.update = update)} />);
    if (!handle.update) throw new Error('the probe did not render');
    return { update: handle.update, replaced };
  }

  it('composes two updates made before the router has re-rendered with the first', () => {
    const { update, replaced } = setup();

    update({ status: 'completed', page: 1 });
    update({ q: 'mara', page: 1 });

    expect(replaced).toEqual(['status=completed', 'status=completed&q=mara']);
  });

  it('keeps a later page reset on top of an earlier filter', () => {
    const { update, replaced } = setup();

    update({ league: LEAGUE, page: 3 });
    update({ status: 'disputed', page: 1 });

    expect(replaced).toEqual(['league=' + LEAGUE + '&page=3', 'status=disputed&league=' + LEAGUE]);
  });
});

describe('MatchListPager', () => {
  const render = (props: Partial<Parameters<typeof MatchListPager>[0]>) =>
    renderWithI18n(
      <MatchListPager
        page={1}
        shownPage={props.page ?? 1}
        total={120}
        pageSize={50}
        from={1}
        to={50}
        onPageChange={() => {}}
        {...props}
      />,
    );

  /** Whether the button with this label is rendered disabled. */
  const disabled = (html: string, label: string) =>
    new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`).test(html);

  it('shows page x of y and steps through a short list', () => {
    const html = render({ page: 1 });
    expect(html).toContain('Page 1 of 3');
    expect(disabled(html, 'Previous')).toBe(true);
    expect(disabled(html, 'Next')).toBe(false);
    expect(disabled(render({ page: 3 }), 'Next')).toBe(true);
  });

  it('shows no pager for a single page', () => {
    const html = render({ total: 20 });
    expect(html).not.toContain('Previous');
    expect(html).not.toContain('Next');
  });

  it('caps the last page at ADMIN_MATCH_MAX_PAGE for a list longer than the API can page', () => {
    const total = ADMIN_MATCH_MAX_PAGE * 25 * 3;
    const middle = render({ page: 5, shownPage: 5, total, pageSize: 25 });
    expect(middle).toContain('Page 5 of 1,000');
    expect(disabled(middle, 'Next')).toBe(false);

    const last = render({ page: ADMIN_MATCH_MAX_PAGE, shownPage: ADMIN_MATCH_MAX_PAGE, total, pageSize: 25 });
    expect(last).toContain('Page 1,000 of 1,000');
    expect(disabled(last, 'Next')).toBe(true);
    expect(disabled(last, 'Previous')).toBe(false);
  });
});

describe('MatchListRow player shortcuts (Submit Result, View Prep)', () => {
  const MATCH_ID = '33333333-3333-4333-8333-333333333333';
  const row = (patch: Partial<AdminMatchRow> = {}) =>
    ({
      id: MATCH_ID,
      tournament_id: PHASE,
      season_id: LEAGUE,
      season_name: 'Spring League',
      tournament_name: 'Group stage',
      player_1_id: 'player-1',
      player_2_id: 'player-2',
      player_1_name: 'Mara',
      player_2_name: 'Jonas',
      winner_name: null,
      status: 'scheduled',
      games: [],
      round_name: null,
      round_number: 1,
      best_of: 3,
      scheduled_at: null,
      round_deadline: null,
      auto_confirm_at: null,
      season_is_test: false,
      archived: false,
      ...patch,
    }) as AdminMatchRow;
  const viewer = (patch: Partial<AdminMatchViewer>): AdminMatchViewer => ({
    playerId: 'resource-admin',
    isSiteAdmin: false,
    isSuperadmin: false,
    ...patch,
  });
  const render = (m: AdminMatchRow, v: AdminMatchViewer | null, locale: 'en' | 'de' = 'en') =>
    renderWithI18n(<MatchListRow row={m} backQuery="" viewer={v} />, { locale });

  it('shows neither Submit Result nor View Prep without a viewer, but keeps the link to the admin page', () => {
    const html = render(row(), null);
    expect(html).not.toContain('Submit Result');
    expect(html).not.toContain('View Prep');
    expect(html).not.toContain('/dashboard/');
    expect(html).toContain(`href="/admin/matches/${MATCH_ID}"`);
  });

  it('links both buttons to the player pages for a participant', () => {
    const html = render(row(), viewer({ playerId: 'player-2' }));
    expect(html).toContain(`href="/dashboard/submit/${MATCH_ID}"`);
    expect(html).toContain(`href="/dashboard/match-prep/${MATCH_ID}"`);
    expect(html).toContain('>Submit Result<');
    expect(html).toContain('>View Prep<');
  });

  it('shows neither for a resource admin who does not play, but keeps the link to the admin page', () => {
    const html = render(row(), viewer({}));
    expect(html).not.toContain('Submit Result');
    expect(html).not.toContain('View Prep');
  });

  it('gives a site admin Submit Result and the superadmin View Prep', () => {
    const siteAdmin = render(row(), viewer({ isSiteAdmin: true }));
    expect(siteAdmin).toContain('Submit Result');
    expect(siteAdmin).not.toContain('View Prep');
    const superadmin = render(row(), viewer({ isSuperadmin: true }));
    expect(superadmin).not.toContain('Submit Result');
    expect(superadmin).toContain('View Prep');
  });

  it('shows neither once the match is no longer open', () => {
    const html = render(row({ status: 'completed' }), viewer({ playerId: 'player-1', isSiteAdmin: true, isSuperadmin: true }));
    expect(html).not.toContain('Submit Result');
    expect(html).not.toContain('View Prep');
  });

  it('keeps the German labels', () => {
    const html = render(row(), viewer({ playerId: 'player-1' }), 'de');
    expect(html).toContain('>Ergebnis eintragen<');
    expect(html).toContain('>Vorbereitung ansehen<');
    expect(html).not.toContain('Korrigieren');
  });
});

describe('AdminMatchList live region', () => {
  it('always renders a polite status region for the selection and the action results', () => {
    const html = renderWithI18n(<AdminMatchList />);
    expect(html).toMatch(/<div role="status" aria-live="polite" class="sr-only"><\/div>/);
  });
});

describe('MatchListSelectionHeader', () => {
  const render = (props: Partial<Parameters<typeof MatchListSelectionHeader>[0]> = {}, locale: 'en' | 'de' = 'en') =>
    renderWithI18n(
      <MatchListSelectionHeader
        pageState="none"
        pageCount={50}
        from={1}
        to={50}
        total={312}
        onTogglePage={() => {}}
        exportState={null}
        onExport={() => {}}
        {...props}
      />,
      { locale },
    );
  const checkbox = (html: string) => /<input [^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? '';

  it('renders the page checkbox, the range, the Export button and the hint', () => {
    const html = render();
    expect(checkbox(html)).toContain('aria-label="Select all 50 matches on this page"');
    expect(html).toContain('Showing 1–50 of 312');
    expect(html).toContain('Export 312 matches (CSV)');
    expect(html).toContain(
      'The selection applies to this page and is cleared when the filters, the sort or the page change. Up to 100 matches per action.',
    );
  });

  it('groups a four-digit total and uses the singular for one match', () => {
    expect(render({ total: 3412 })).toContain('Export 3,412 matches (CSV)');
    expect(render({ total: 1, pageCount: 1, to: 1 })).toContain('Export 1 match (CSV)');
  });

  it('is translated to German', () => {
    const html = render({}, 'de');
    expect(checkbox(html)).toContain('aria-label="Alle 50 Spiele auf dieser Seite auswählen"');
    expect(html).toContain('312 Spiele exportieren (CSV)');
    expect(html).toContain('Die Auswahl gilt für diese Seite und wird zurückgesetzt');
    expect(html).toContain('Bis zu 100 Spiele pro Aktion.');
  });

  it('shows none, some and all on the checkbox', () => {
    expect(checkbox(render({ pageState: 'none' }))).toContain('data-state="none"');
    expect(checkbox(render({ pageState: 'none' }))).not.toContain('checked=""');
    expect(checkbox(render({ pageState: 'some' }))).toContain('data-state="some"');
    expect(checkbox(render({ pageState: 'some' }))).not.toContain('checked=""');
    expect(checkbox(render({ pageState: 'all' }))).toContain('data-state="all"');
    expect(checkbox(render({ pageState: 'all' }))).toContain('checked=""');
  });

  it('disables Export while it runs and for an empty set', () => {
    const working = render({ exportState: { kind: 'working' } });
    expect(working).toContain('Exporting...');
    expect(working).toMatch(/<button[^>]*disabled=""[^>]*>Exporting\.\.\.<\/button>/);
    // The status region is mounted for every state, so its text is announced when it appears.
    expect(working).toMatch(/<div role="status" class="sr-only"><p>Exporting\.\.\.<\/p><\/div>/);
    expect(render()).toContain('<div role="status" class="sr-only"></div>');
    expect(render({ total: 0 })).toMatch(/<button[^>]*disabled=""[^>]*>Export 0 matches \(CSV\)<\/button>/);
    expect(render()).not.toMatch(/<button[^>]*disabled=""/);
  });

  it('reports a finished export in a status line, with the limit when it was cut', () => {
    const done = render({ exportState: { kind: 'done', info: { count: 312, total: 312, truncated: false, searchTruncated: false } } });
    expect(done).toMatch(/<div role="status"[^>]*>.*Exported 312 matches/);
    expect(done).not.toContain('(limit)');

    const cut = render({ exportState: { kind: 'done', info: { count: 2500, total: 3412, truncated: true, searchTruncated: true } } });
    expect(cut).toContain('Exported 2,500 of 3,412 matches (limit)');
    expect(cut).toContain('The search matched many players, so only the first 40 are in the file.');
    expect(render({ exportState: { kind: 'done', info: { count: 2500, total: 3412, truncated: true, searchTruncated: false } } }, 'de')).toContain(
      '2.500 von 3.412 Spielen exportiert (Limit)',
    );
  });

  it('shows a failed export as an alert with the translated reason', () => {
    const html = render({ exportState: { kind: 'failed', error: { code: 'rate_limited', error: 'Rate limit exceeded' } } });
    expect(html).toMatch(/<p role="alert"[^>]*>The export failed: Rate limit exceeded<\/p>/);
  });
});
