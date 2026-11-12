/** @vitest-environment jsdom */
/**
 * A game delete from the admin match page that affects bracket matches that were already played: the API refuses the
 * first request (409 `game_change_downstream_played`, nothing written), the page asks the admin to approve resetting
 * those matches, and only the approval sends the delete again, with the confirm flag and the same reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import { encodeDownstreamMatches } from '@/lib/match/downstream-matches';
import type { GameSummary } from '@/types/match';
import AdminMatchActions from '../AdminMatchActions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const fetchMock = vi.fn();

const GAME: GameSummary = {
  id: 'g1',
  game_number: 1,
  winner_id: 'p1',
  replay_url: '',
  source: 'manual',
  stats_locked: false,
};

const LATER = [
  { id: 'm-semi', round_name: 'Semifinals', player_1_name: 'Ash', player_2_name: 'Brock', status: 'completed' as const },
  { id: 'm-final', round_name: 'Finals', player_1_name: 'Ash', player_2_name: 'Misty', status: 'in_progress' as const },
];

const refusal = {
  success: false,
  error: 'This change affects the rest of the bracket: 2 later bracket matches were already played.',
  code: 'game_change_downstream_played',
  params: { count: 2, matches: encodeDownstreamMatches(LATER) },
};

function ui() {
  return (
    <AdminMatchActions
      matchId="m1"
      currentStatus="completed"
      player1={{ id: 'p1', name: 'Ash' }}
      player2={{ id: 'p2', name: 'Gary' }}
      currentWinnerId="p1"
      games={[GAME]}
      tournamentId="t1"
      bestOf={1}
      isSiteAdmin
    />
  );
}

/** Opens the delete dialog of game 1 and confirms it with `reason`. */
async function deleteGameWithReason(user: ReturnType<typeof userEvent.setup>, reason: string) {
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await user.type(screen.getByRole('textbox'), reason);
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: /^Delete/ }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deleting a game that affects the played part of the bracket', () => {
  it('asks for approval, listing the later matches, before anything else is sent', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => refusal });
    const user = userEvent.setup();
    render(withI18n(ui()));

    await deleteGameWithReason(user, 'Wrong replay');

    const dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    expect(within(dialog).getByText(/has already played 2 later bracket matches/)).toBeTruthy();
    expect(within(dialog).getByText('Ash vs Brock (Semifinals, Completed)')).toBeTruthy();
    expect(within(dialog).getByText('Ash vs Misty (Finals, In progress)')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, first] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(first.method).toBe('DELETE');
    expect(JSON.parse(first.body as string)).toEqual({ reason: 'Wrong replay' });
    // The refusal is a question, not an error banner.
    expect(screen.queryByText(/Failed to delete/)).toBeNull();
  });

  it('approving sends the same delete again with the confirm flag and the same reason, then reports the reset matches', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => refusal })
      .mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: { match_status: 'scheduled', games_remaining: 0, evolution_events: [], downstream_reset_match_ids: ['m-final', 'm-semi'] },
        }),
      });
    const user = userEvent.setup();
    render(withI18n(ui()));

    await deleteGameWithReason(user, 'Wrong replay');
    const dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset them and apply the change' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, second] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/admin/games/g1');
    expect(second.method).toBe('DELETE');
    expect(JSON.parse(second.body as string)).toEqual({ reason: 'Wrong replay', confirm_downstream: ['m-semi', 'm-final'] });
    await screen.findByText('2 later bracket matches were reset.');
    // The dialog leaves after its closing motion.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks again, with the new list, when a later match was played since the prompt', async () => {
    const newer = [...LATER, { id: 'm-grand', round_name: 'Grand Finals', player_1_name: 'Ash', player_2_name: 'Lance', status: 'completed' as const }];
    fetchMock
      .mockResolvedValueOnce({ json: async () => refusal })
      .mockResolvedValueOnce({ json: async () => ({ ...refusal, params: { count: 3, matches: encodeDownstreamMatches(newer) } }) });
    const user = userEvent.setup();
    render(withI18n(ui()));

    await deleteGameWithReason(user, 'Wrong replay');
    let dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset them and apply the change' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    await within(dialog).findByText(/Grand Finals/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancelling the approval sends nothing more', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => refusal });
    const user = userEvent.setup();
    render(withI18n(ui()));

    await deleteGameWithReason(user, 'Wrong replay');
    const dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('speaks German', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => refusal });
    const user = userEvent.setup();
    render(withI18n(ui(), { locale: 'de' }));

    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    await user.type(screen.getByRole('textbox'), 'Falsches Replay');
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button').at(-1)!);

    const dialog = await screen.findByRole('dialog', { name: 'Diese Änderung betrifft den restlichen Turnierbaum' });
    expect(within(dialog).getByText('Zurücksetzen und Änderung anwenden')).toBeTruthy();
    expect(within(dialog).getByText('Ash vs Brock (Semifinals, Beendet)')).toBeTruthy();
  });

  it('a refused approved delete closes the prompt and shows the error', async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => refusal })
      .mockResolvedValueOnce({
        json: async () => ({ success: false, error: 'The match changed to in_progress while you were editing it.', code: 'match_state_changed', params: { status: 'in_progress' } }),
      });
    const user = userEvent.setup();
    render(withI18n(ui()));

    await deleteGameWithReason(user, 'Wrong replay');
    const dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset them and apply the change' }));

    await screen.findByText(/while you were editing it/);
    // The dialog leaves after its closing motion.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
