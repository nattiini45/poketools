/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import type { AdjustmentView } from '@/lib/format-engine/runtime/view-types';
import AdjustmentHistory from '../AdjustmentHistory';
import DomainsSummary from '../DomainsSummary';
import { MARA, MISTY, NAMES, SEASON, TARGETS, adjustment, okResponse, sent, text } from './helpers';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const fetchMock = vi.fn();

function mount(initial: readonly AdjustmentView[], total = initial.length, locale: Locale = 'en') {
  return render(withI18n(<AdjustmentHistory seasonId={SEASON} initial={initial} total={total} targets={TARGETS} names={NAMES} />, { locale }));
}

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('AdjustmentHistory', () => {
  it('says what each kind changed, with names and labels, the reason and the admin', () => {
    mount([
      adjustment({ id: 'a1' }),
      adjustment({ id: 'a2', kind: 'rank', target: { stage: 'cup' }, delta: { order: [MARA, MISTY] }, reason: 'Fixed order' }),
      adjustment({ id: 'a3', kind: 'resource', target: { resource: 'gifts', player_id: MISTY, item_id: 'eevee' }, delta: { amount: -1 }, reason: 'Wrong gift' }),
      adjustment({ id: 'a4', kind: 'resource', target: { resource: 'coins', player_id: MARA, item_id: null }, delta: { amount: 3 }, reason: 'Bonus' }),
      adjustment({ id: 'a5', kind: 'relation', target: { relation: 'santa' }, delta: { reveal: true, link_count: 3, draw: true }, reason: 'Draw' }),
      adjustment({ id: 'a6', kind: 'action', target: { action: 'gift' }, delta: { state: 'locked' }, reason: 'Late', admin: null }),
      adjustment({ id: 'a7', kind: 'domain', target: { domain: 'pool' }, delta: { domain: 'pool', add: [{ id: 'x' }], remove: ['a', 'b'] }, reason: 'Pool' }),
      adjustment({ id: 'a8', kind: 'outcome', target: { match_id: 'm' }, delta: {}, reason: 'Record' }),
    ]);
    const cells = bodyRows().map((row) => within(row).getAllByRole('cell').map((c) => c.textContent));
    expect(cells[0].slice(0, 4)).toEqual(['Points', '2.5 points for Mara in Cup', 'Penalty for a late team', 'Brock']);
    expect(cells[1][1]).toBe('New order of 2 players in Cup');
    expect(cells[2][1]).toBe('1 × Eevee (Gifts) taken from Misty');
    expect(cells[3][1]).toBe('3 × Coins given to Mara');
    expect(cells[4][1]).toBe('Secret Santa drawn (3 links); Secret Santa revealed');
    expect(cells[5][1]).toBe('Action Gift locked');
    expect(cells[5][3]).toBe('System');
    expect(cells[6][1]).toBe('List pool changed: 1 added, 2 removed');
    expect(cells[7][1]).toBe('Result recorded');
  });

  it('never prints a link pair: a relation row shows its count only', () => {
    mount([adjustment({ kind: 'relation', target: { relation: 'santa' }, delta: { link_count: 2 } })]);
    expect(screen.getByText('Secret Santa set (2 links)')).toBeTruthy();
    expect(document.body.textContent).not.toContain(MARA);
  });

  it('a row of a shape it does not know shows its kind and a plain line', () => {
    mount([adjustment({ target: { weird: true }, delta: {} })]);
    expect(bodyRows()[0].textContent).toContain('Adjustment');
  });

  it('a player the league no longer has is a former player, never an id', () => {
    mount([adjustment({ target: { stage: 'cup', player_id: 'ffffffff-0000-4000-8000-000000000009' } })]);
    expect(screen.getByText('2.5 points for former player in Cup')).toBeTruthy();
    expect(document.body.textContent).not.toContain('ffffffff');
  });

  it('an empty history says so', () => {
    mount([]);
    expect(screen.getByText('No adjustments yet.')).toBeTruthy();
  });

  it('loads the next page by the number of rows it has, and stops when it has them all', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      okResponse({ allowed: [], targets: TARGETS, history: [adjustment({ id: 'a9', reason: 'Older one' })], total: 2 }),
    );
    mount([adjustment({ id: 'a1' })], 2);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Older one')).toBeTruthy();
    expect(sent(fetchMock)).toEqual({ url: `/api/seasons/${SEASON}/format/adjustments?limit=20&offset=1`, method: 'GET', body: undefined });
    expect(bodyRows()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows a row once when a newer adjustment shifted the list between two pages', async () => {
    const user = userEvent.setup();
    // The first page was read before another admin recorded a row: the server list moved down by one, so the next page
    // starts with the row the first page ended on.
    fetchMock.mockResolvedValue(
      okResponse({
        allowed: [],
        targets: TARGETS,
        history: [adjustment({ id: 'a1', reason: 'Last of page one' }), adjustment({ id: 'a9', reason: 'Older one' })],
        total: 3,
      }),
    );
    mount([adjustment({ id: 'a1', reason: 'Last of page one' })], 3);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Older one')).toBeTruthy();
    expect(screen.getAllByText('Last of page one')).toHaveLength(1);
    expect(bodyRows()).toHaveLength(2);
  });

  it('a page read again by the server replaces what was paged in', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ allowed: [], targets: TARGETS, history: [adjustment({ id: 'a9', reason: 'Older one' })], total: 2 }));
    const first = [adjustment({ id: 'a1' })];
    const { rerender } = mount(first, 2);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Older one');
    rerender(
      withI18n(
        <AdjustmentHistory seasonId={SEASON} initial={[adjustment({ id: 'a0', reason: 'Brand new' }), ...first]} total={3} targets={TARGETS} names={NAMES} />,
      ),
    );
    expect(screen.getByText('Brand new')).toBeTruthy();
    expect(screen.queryByText('Older one')).toBeNull();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy();
  });

  it('renders in German', () => {
    mount([adjustment()], 1, 'de');
    expect(screen.getByRole('columnheader', { name: 'Grund' })).toBeTruthy();
    expect(screen.getByText('2,5 Punkte für Mara in Cup')).toBeTruthy();
  });
});

describe('scrollable tables', () => {
  it('the history table sits in a named region a keyboard can focus, so its right-hand columns can be reached', () => {
    mount([adjustment()]);
    const region = screen.getByRole('region', { name: 'Adjustments, newest first' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(within(region).getByRole('table')).toBeTruthy();
  });
});

describe('DomainsSummary', () => {
  const domains = [
    { key: 'pool', label: text('Normal pool'), visibility: 'public' as const, unlocked: true, entry_count: 40 },
    { key: 'gifts', label: text('Gift list'), visibility: 'admins' as const, unlocked: false, entry_count: 0 },
  ];

  it('lists each list with who sees it, whether it is unlocked and how many entries it has', () => {
    render(withI18n(<DomainsSummary domains={domains} />));
    const table = screen.getByRole('table');
    expect(table.closest('[role="region"]')?.getAttribute('tabindex')).toBe('0');
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['Normal pool', 'Everyone', 'Unlocked', '40'],
      ['Gift list', 'Admins only', 'Locked', '0'],
    ]);
  });

  it('says so when the format has no lists, and renders in German', () => {
    const { unmount } = render(withI18n(<DomainsSummary domains={[]} />));
    expect(screen.getByText('This format has no lists.')).toBeTruthy();
    unmount();
    render(withI18n(<DomainsSummary domains={domains} />, { locale: 'de' }));
    expect(screen.getByText('Nur Admins')).toBeTruthy();
  });
});
