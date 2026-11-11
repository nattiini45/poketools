/** @vitest-environment jsdom */
/**
 * CompetitionList (redesign A4): the segmented and filter links between the five URLs, the search over the rows the
 * page already loaded, the empty state of each view, and the trash view's shared search.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';

vi.mock('next/link', () => ({
  default: ({ href, children, className, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; className?: string; prefetch?: boolean }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));

import CompetitionList from '../CompetitionList';
import { useCompetitionQuery } from '../competition-query';
import type { CompetitionRow } from '@/lib/admin/competition-list';

function row(over: Partial<CompetitionRow> = {}): CompetitionRow {
  return {
    id: 's1',
    name: 'Sakura Cup',
    href: '/admin/leagues/s1',
    actionHref: '/admin/leagues/s1',
    action: 'manage',
    formatLabel: 'Singles',
    rulesetName: 'Gen 9 OU',
    detail: '1 stage',
    status: 'active',
    statusLabel: 'Active',
    archived: false,
    test: false,
    players: 6,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    createdAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const ROWS = [
  row(),
  row({ id: 's2', name: 'EvoLiga', href: '/admin/leagues/s2', actionHref: '/admin/leagues/s2', formatLabel: 'Evolution Point Buy', rulesetName: null, players: 4, startDate: null, endDate: null, test: true }),
  row({ id: 's3', name: 'Kit League', href: '/admin/leagues/s3', actionHref: '/admin/leagues/s3?tab=format', action: 'setup', formatLabel: 'Custom format', status: 'upcoming', statusLabel: 'Upcoming', startDate: '2026-12-01', endDate: null }),
];

/** The links of a nav by accessible name (a skewed plate repeats its label in a hidden ghost, so textContent would double it). */
function linksOf(nav: HTMLElement): Record<string, string | null> {
  const names = new Map(within(nav).getAllByRole('link').map((a) => [a, a.getAttribute('aria-label') ?? a.textContent ?? '']));
  return Object.fromEntries(
    [...names].map(([a, text]) => [a.querySelector('[aria-hidden="true"].invisible') ? text.slice(0, text.length / 2) : text, a.getAttribute('href')]),
  );
}

describe('the segmented and filter links', () => {
  it('leagues, active: Leagues and Active are current; Tournaments and Archived are links between the existing URLs', () => {
    render(withI18n(<CompetitionList kind="league" view="active" rows={ROWS} />));
    const kinds = screen.getByRole('navigation', { name: 'Competition type' });
    expect(linksOf(kinds)).toEqual({ Leagues: '/admin/leagues', Tournaments: '/admin/tournaments' });
    expect(within(kinds).getByRole('link', { name: 'Leagues' }).getAttribute('aria-current')).toBe('page');
    expect(within(kinds).getByRole('link', { name: 'Tournaments' }).getAttribute('aria-current')).toBeNull();
    const views = screen.getByRole('navigation', { name: 'Show' });
    expect(linksOf(views)).toEqual({ Active: '/admin/leagues', Archived: '/admin/leagues/archived' });
    expect(within(views).getByRole('link', { name: 'Active' }).getAttribute('aria-current')).toBe('page');
  });

  it('switching the kind keeps the view: archived leagues link to archived tournaments', () => {
    render(withI18n(<CompetitionList kind="league" view="archived" rows={[]} />));
    expect(linksOf(screen.getByRole('navigation', { name: 'Competition type' }))).toEqual({
      Leagues: '/admin/leagues/archived',
      Tournaments: '/admin/tournaments/archived',
    });
  });

  it('tournaments: no Trash link, even for the superadmin', () => {
    render(withI18n(<CompetitionList kind="tournament" view="active" rows={[]} canViewTrash />));
    expect(linksOf(screen.getByRole('navigation', { name: 'Show' }))).toEqual({
      Active: '/admin/tournaments',
      Archived: '/admin/tournaments/archived',
    });
  });

  it('the Trash link is the superadmin\'s, on leagues', () => {
    const { unmount } = render(withI18n(<CompetitionList kind="league" view="active" rows={[]} />));
    expect(screen.queryByRole('link', { name: 'Trash' })).toBeNull();
    unmount();
    render(withI18n(<CompetitionList kind="league" view="active" rows={[]} canViewTrash />));
    expect(screen.getByRole('link', { name: 'Trash' }).getAttribute('href')).toBe('/admin/leagues/trash');
  });

  it('on the trash view, Tournaments leads to the active tournaments (there is no tournament trash)', () => {
    render(
      withI18n(
        <CompetitionList kind="league" view="trash" canViewTrash>
          <p>panel</p>
        </CompetitionList>,
      ),
    );
    expect(linksOf(screen.getByRole('navigation', { name: 'Competition type' }))).toEqual({
      Leagues: '/admin/leagues/trash',
      Tournaments: '/admin/tournaments',
    });
    expect(screen.getByRole('link', { name: 'Trash' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('the table', () => {
  it('shows name, format, status, players, dates and the next step of every row', () => {
    render(withI18n(<CompetitionList kind="league" view="active" rows={ROWS} />));
    const table = screen.getByRole('table', { name: 'Leagues' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Name', 'Format', 'Status', 'Players', 'Dates', 'Next action']);
    const [first, second, third] = within(table).getAllByRole('row').slice(1);
    expect(within(first).getByRole('link', { name: 'Sakura Cup' }).getAttribute('href')).toBe('/admin/leagues/s1');
    expect(first.textContent).toContain('Singles');
    expect(first.textContent).toContain('Gen 9 OU');
    expect(first.textContent).toContain('Active');
    expect(first.textContent).toContain('6');
    expect(first.textContent).toContain('1 Oct 2026 – 31 Oct 2026');
    expect(within(first).getByRole('link', { name: 'Manage: Sakura Cup' }).getAttribute('href')).toBe('/admin/leagues/s1');
    expect(second.textContent).toContain('Test');
    expect(second.textContent).toContain('Not set');
    expect(within(third).getByRole('link', { name: 'Set up: Kit League' }).getAttribute('href')).toBe('/admin/leagues/s3?tab=format');
    expect(third.textContent).toContain('From 1 Dec 2026');
  });

  it('a tournament row shows when it was created, an archived row says so', () => {
    render(
      withI18n(
        <CompetitionList
          kind="tournament"
          view="archived"
          rows={[row({ id: 't1', name: 'Friday Open', href: '/admin/tournaments/t1/rounds', archived: true, action: 'open', startDate: null, endDate: null, createdAt: '2026-10-03T08:00:00Z' })]}
        />,
      ),
    );
    const [only] = screen.getAllByRole('row').slice(1);
    expect(only.textContent).toContain('Created 3 Oct 2026');
    expect(only.textContent).toContain('Archived');
    expect(within(only).getByRole('link', { name: 'Open: Friday Open' })).toBeTruthy();
  });

  it('German: column heads, next step and dates', () => {
    render(withI18n(<CompetitionList kind="league" view="active" rows={ROWS} />, { locale: 'de' }));
    const table = screen.getByRole('table', { name: 'Ligen' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Name', 'Format', 'Status', 'Spieler', 'Zeitraum', 'Nächster Schritt']);
    expect(screen.getByRole('link', { name: 'Verwalten: Sakura Cup' })).toBeTruthy();
    expect(screen.getByText('Ab 1. Dez. 2026')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Archiviert' })).toBeTruthy();
  });
});

describe('the search filters the rows already loaded', () => {
  it('narrows by any word of name, format, ruleset or status, and counts them', async () => {
    const user = userEvent.setup();
    render(withI18n(<CompetitionList kind="league" view="active" rows={ROWS} />));
    expect(screen.getByText('3 leagues')).toBeTruthy();
    const box = screen.getByRole('searchbox', { name: 'Search competitions' });
    await user.type(box, 'point buy');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'EvoLiga' })).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    await user.clear(box);
    await user.type(box, 'upcoming');
    expect(screen.getByRole('link', { name: 'Kit League' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sakura Cup' })).toBeNull();
  });

  it('when nothing matches it says so and a button clears the search', async () => {
    const user = userEvent.setup();
    render(withI18n(<CompetitionList kind="league" view="active" rows={ROWS} />));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Nothing matches "zzz"')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });
});

describe('the empty state of each view names what is missing and the next step', () => {
  it.each([
    ['league', 'active', 'No leagues yet', '/admin/leagues/new', 'New league'],
    ['tournament', 'active', 'No tournaments yet', '/admin/tournaments/new', 'New tournament'],
  ] as const)('%s, %s: a button to create one', (kind, view, title, href, label) => {
    render(withI18n(<CompetitionList kind={kind} view={view} rows={[]} />));
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it.each([
    ['league', 'No archived leagues'],
    ['tournament', 'No archived tournaments'],
  ] as const)('%s, archived: %s, with no create button', (kind, title) => {
    render(withI18n(<CompetitionList kind={kind} view="archived" rows={[]} />));
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^New/ })).toBeNull();
  });

  it('German', () => {
    render(withI18n(<CompetitionList kind="league" view="archived" rows={[]} />, { locale: 'de' }));
    expect(screen.getByText('Keine archivierten Ligen')).toBeTruthy();
  });
});

describe('the trash view', () => {
  function Panel() {
    return <p data-testid="panel">{'query=' + useCompetitionQuery()}</p>;
  }

  it('renders the trash panel inside the frame and hands it the search text', async () => {
    const user = userEvent.setup();
    render(
      withI18n(
        <CompetitionList kind="league" view="trash" canViewTrash>
          <Panel />
        </CompetitionList>,
      ),
    );
    expect(screen.getByTestId('panel').textContent).toBe('query=');
    await user.type(screen.getByRole('searchbox'), 'winter');
    expect(screen.getByTestId('panel').textContent).toBe('query=winter');
  });
});
