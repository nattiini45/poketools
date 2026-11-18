/** @vitest-environment jsdom */
/**
 * One admin action at a time, and none again after a success until the refreshed page arrives (the refresh is 1.5 s
 * after the success banner).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import type { GameSummary, MatchStatus } from '@/types/match';
import AdminMatchActions from '../AdminMatchActions';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const fetchMock = vi.fn();
const game = (n: number): GameSummary => ({
  id: `g${n}`,
  game_number: n,
  winner_id: 'p1',
  replay_url: `https://replay.pokemonshowdown.com/x-${n}`,
  source: 'manual',
  stats_locked: false,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ui(status: MatchStatus, games: GameSummary[], correctionsOnly = false) {
  return withI18n(
    <AdminMatchActions
      matchId="m1"
      currentStatus={status}
      player1={{ id: 'p1', name: 'Ash' }}
      player2={{ id: 'p2', name: 'Gary' }}
      currentWinnerId="p1"
      games={games}
      correctionsOnly={correctionsOnly}
      bestOf={3}
      isSiteAdmin
    />,
  );
}

describe('AdminMatchActions action phase', () => {
  it('offers only native corrections and refreshes the reset preview before an approved cascade', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => ({
        success: true, data: { games_to_delete: 1, was_completed: false, downstream: [] },
      }) })
      .mockResolvedValueOnce({ json: async () => ({ success: false, code: 'DOWNSTREAM_PLAYED', params: { count: 1 } }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: { games_deleted: 1, format_revert_failed: true } }) });
    const user = userEvent.setup();
    render(ui('pending_confirmation', [game(1)], true));

    expect(screen.queryByRole('button', { name: /Complete Match|Mark Disputed|Record result/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/admin/matches/m1/games/g1/edit');
    await user.click(screen.getByRole('button', { name: 'Reset Match' }));
    let dialog = screen.getByRole('dialog', { name: 'Reset Match' });
    expect(within(dialog).getByRole('button', { name: 'Reset Match' })).toHaveProperty('disabled', true);
    await user.type(within(dialog).getByRole('textbox'), 'Wrong series');
    await user.click(within(dialog).getByRole('button', { name: 'Reset Match' }));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/matches/m1/reset-preview', expect.objectContaining({ cache: 'no-store' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/matches/m1/reset', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ cascade: false, reason: 'Wrong series' }),
    }));
    dialog = await screen.findByRole('dialog', { name: 'Reset Downstream Matches' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset All Downstream' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/admin/matches/m1/reset', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ cascade: true, reason: 'Wrong series' }),
    }));
    await screen.findByText(/old result .*could not be taken back/);
  });

  it('disables every action after a success until the refreshed props arrive', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: true, data: {} }) });
    const user = userEvent.setup();
    const { rerender } = render(ui('pending_confirmation', [game(1), game(2)]));

    await user.click(screen.getByRole('button', { name: 'Mark Disputed' }));
    await user.click(screen.getByRole('button', { name: "Mark disputed" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete Match' })).toHaveProperty('disabled', true));
    expect(screen.getByRole('button', { name: 'Mark Disputed' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Reset Match' })).toHaveProperty('disabled', true);

    // The refresh brings the disputed match: its actions are live again.
    rerender(ui('disputed', [game(1), game(2)]));
    expect(screen.getByRole('button', { name: 'Complete Match' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('button', { name: 'Mark Disputed' })).toBeNull();
  });

  it('a failed action leaves every action available', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: false, error: 'x', code: 'match_transition_invalid' }) });
    const user = userEvent.setup();
    render(ui('pending_confirmation', [game(1), game(2)]));

    await user.click(screen.getByRole('button', { name: 'Mark Disputed' }));
    await user.click(screen.getByRole('button', { name: "Mark disputed" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete Match' })).toHaveProperty('disabled', false));
    expect(screen.getByRole('button', { name: 'Reset Match' })).toHaveProperty('disabled', false);
  });
});
