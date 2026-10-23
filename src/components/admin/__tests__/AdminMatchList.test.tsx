/**
 * AdminMatchList (server render): the URL is the source of truth, so a deep
 * link renders its status tab, league, phase and search text on the first
 * paint. The client-only behaviour (fetches, debounce, abort) needs a DOM and
 * is covered through the pure helpers in `src/lib/admin/__tests__/match-list.test.ts`.
 */
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

import AdminMatchList from '../AdminMatchList';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const PHASE = '22222222-2222-4222-8222-222222222222';

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
    // Options have not loaded yet, but the selected league and phase stay selected.
    expect(html).toContain(`<option value="${LEAGUE}" selected="">${LEAGUE}</option>`);
    expect(html).toContain(`<option value="${PHASE}" selected="">${PHASE}</option>`);
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

  it('is translated to German', () => {
    const html = renderWithI18n(<AdminMatchList />, { locale: 'de' });
    expect(html).toContain('Alle Ligen');
    expect(html).toContain('Keine Liga (einzelnes Turnier)');
    expect(html).toContain('Alle Phasen');
    expect(html).toContain('Spieler oder Spiel-ID suchen');
    expect(html).toContain('>Strittig</button>');
  });
});
