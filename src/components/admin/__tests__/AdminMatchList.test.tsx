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

import AdminMatchList, { MatchListPager, useMatchListUpdate } from '../AdminMatchList';
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
