/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { Locale } from '@/i18n/config';
import AdminLadders from '../AdminLadders';
import { MATCH, SEASON, challengeView, failResponse, okResponse, sent, text } from './helpers';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const fetchMock = vi.fn();
const PHASES = [{ id: 'p1', label: text('Ladder') }];

function mount(challenges = [challengeView()], phases = PHASES, locale: Locale = 'en') {
  return render(withI18n(<AdminLadders seasonId={SEASON} phases={phases} challenges={challenges} />, { locale }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  mocks.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('AdminLadders', () => {
  it('lists the open challenges of each ladder phase', () => {
    mount([challengeView(), challengeView({ id: 'c2', phase_id: 'other' })], [...PHASES, { id: 'other', label: text('Second ladder') }]);
    expect(screen.getByRole('heading', { name: 'Ladder' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Second ladder' })).toBeTruthy();
    const rows = within(screen.getByRole('table', { name: 'Open challenges in Ladder' })).getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('Mara')).toBeTruthy();
    expect(within(rows[1]).getByText('Misty')).toBeTruthy();
  });

  it('a phase without challenges says so', () => {
    mount([]);
    expect(screen.getByText('No open challenges.')).toBeTruthy();
  });

  it('a format without a ladder says so', () => {
    mount([], []);
    expect(screen.getByText('This format has no challenge ladder.')).toBeTruthy();
  });

  it('a challenge past its accept window is shown as expired and cannot be withdrawn', () => {
    mount([challengeView({ lapsed: true })]);
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Withdraw/ })).toBeNull();
  });

  it.each(['accepted', 'declined', 'expired', 'cancelled'] as const)('a %s challenge cannot be withdrawn', (state) => {
    mount([challengeView({ state })]);
    expect(screen.queryByRole('button', { name: /Withdraw/ })).toBeNull();
  });

  it('withdraws as admin after a confirmation, then reads the page again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ challenge: challengeView({ state: 'cancelled' }) }));
    mount();
    await user.click(screen.getByRole('button', { name: 'Withdraw the challenge of Mara against Misty' }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw' }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(sent(fetchMock)).toEqual({ url: `/api/seasons/${SEASON}/format/challenges/c1?as=admin`, method: 'DELETE', body: undefined });
    expect(screen.getByText('Challenge withdrawn.')).toBeTruthy();
  });

  it('a later failure does not sit next to the success line of the earlier withdrawal', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(okResponse({ challenge: challengeView({ state: 'cancelled' }) }))
      .mockResolvedValueOnce(failResponse(409, 'challenge_not_open', 'This challenge has already been answered, withdrawn or has expired.'));
    mount();
    const withdrawButton = () => screen.getByRole('button', { name: /Withdraw the challenge/ });
    await user.click(withdrawButton());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText('Challenge withdrawn.')).toBeTruthy();

    await user.click(withdrawButton());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Challenge withdrawn.')).toBeNull();
  });

  it('cancelling the confirmation sends nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: /Withdraw the challenge/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an answered challenge (409) shows the words and reads the page again', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(failResponse(409, 'challenge_not_open', 'This challenge has already been answered, withdrawn or has expired.'));
    mount();
    await user.click(screen.getByRole('button', { name: /Withdraw the challenge/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This challenge has already been answered, withdrawn or has expired.');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('links to the match of a challenge that has one', () => {
    mount([challengeView({ state: 'accepted', match_id: MATCH })]);
    expect(screen.getByRole('link', { name: 'Open the match' }).getAttribute('href')).toBe(`/admin/matches/${MATCH}`);
    expect(screen.getByText('The match of an accepted challenge is handled in the match admin.')).toBeTruthy();
  });

  it('a former player is named as one', () => {
    mount([challengeView({ defender: { id: 'x', name: null } })]);
    expect(screen.getByText('former player')).toBeTruthy();
  });

  it('renders in German', () => {
    mount([challengeView()], PHASES, 'de');
    expect(screen.getByRole('table', { name: 'Offene Herausforderungen in Ladder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Herausforderung von Mara gegen Misty zurückziehen' })).toBeTruthy();
  });
});

describe('AdminLadders: focus', () => {
  it('after a withdrawal the row and its button go, so focus goes to the status line', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(okResponse({ challenge: challengeView({ state: 'cancelled' }) }));
    mount();
    await user.click(screen.getByRole('button', { name: 'Withdraw the challenge of Mara against Misty' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw' }));
    await screen.findByText('Challenge withdrawn.');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('status')));
  });
});
