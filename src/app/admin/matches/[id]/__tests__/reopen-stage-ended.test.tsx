/** @vitest-environment jsdom */
/**
 * The reopen section when the match belongs to a phase whose stage already ended: the reopen still succeeds, and the
 * section says which players advanced to the next phase (a notice in the success data, or flat params when the reopen
 * ended as `match_reopen_incomplete`, an error response that has no data).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import MatchReopenSection from '../MatchReopenSection';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const fetchMock = vi.fn();

const notice = {
  phase_id: 'groups',
  phase_name: 'Group stage',
  advanced: [{ phase_id: 'playoffs', phase_name: 'Playoffs', players: [{ id: 'p1', name: 'Ash' }, { id: 'p2', name: 'Misty' }] }],
};

/** The page refreshes to the new status after a reopen; the section then shows the outcome in place of its controls. */
function section(status: 'completed' | 'in_progress', locale?: 'de') {
  return withI18n(<MatchReopenSection matchId="m1" status={status} />, locale ? { locale } : {});
}

async function reopenWithReason(user: ReturnType<typeof userEvent.setup>, rerender: (ui: ReturnType<typeof section>) => void) {
  await user.click(screen.getByRole('button', { name: 'Reopen match' }));
  const dialog = screen.getByRole('dialog');
  await user.type(within(dialog).getByRole('textbox'), 'Wrong winner');
  await user.click(within(dialog).getByRole('button', { name: 'Reopen match' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  rerender(section('in_progress'));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reopening a match of a phase whose stage already ended', () => {
  it('shows the success and, next to it, who advanced on the strength of the old result', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: true,
        data: { from_status: 'completed', ratings_rebuilt_players: 2, bracket_matches_removed: 0, failed_steps: [], stage_already_ended: notice },
      }),
    });
    const user = userEvent.setup();
    const { rerender } = render(section('completed'));

    await reopenWithReason(user, rerender);

    await screen.findByText('The match was reopened.');
    expect(screen.getByText(/the stage of the phase Group stage had already ended/)).toBeTruthy();
    expect(screen.getByText(/Playoffs: Ash, Misty/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it('a plain reopen shows no stage notice', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: true,
        data: { from_status: 'completed', ratings_rebuilt_players: 2, bracket_matches_removed: 0, failed_steps: [] },
      }),
    });
    const user = userEvent.setup();
    const { rerender } = render(section('completed'));

    await reopenWithReason(user, rerender);

    await screen.findByText('The match was reopened.');
    expect(screen.queryByText(/had already ended/)).toBeNull();
  });

  it('an incomplete reopen keeps its warning and still shows the stage notice from the error params', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: false,
        error: 'The match was reopened, but 1 follow-up step failed.',
        code: 'match_reopen_incomplete',
        params: { count: 1, stage_phase: 'Group stage', stage_advanced: 'Playoffs: Ash' },
      }),
    });
    const user = userEvent.setup();
    const { rerender } = render(section('completed'));

    await reopenWithReason(user, rerender);

    await waitFor(() => expect(screen.getByText(/1 follow-up step failed/)).toBeTruthy());
    expect(screen.getByText(/the stage of the phase Group stage had already ended/)).toBeTruthy();
    expect(screen.getByText(/Playoffs: Ash/)).toBeTruthy();
  });

  it('speaks German', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        success: true,
        data: { from_status: 'completed', ratings_rebuilt_players: 2, bracket_matches_removed: 0, failed_steps: [], stage_already_ended: { ...notice, advanced: [] } },
      }),
    });
    const user = userEvent.setup();
    const { rerender } = render(section('completed', 'de'));

    await user.click(screen.getAllByRole('button')[0]);
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Falscher Sieger');
    await user.click(within(dialog).getAllByRole('button').at(-1)!);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    rerender(section('in_progress', 'de'));

    await screen.findByText(/Noch kein Spieler ist in eine nächste Phase aufgestiegen/);
  });
});
