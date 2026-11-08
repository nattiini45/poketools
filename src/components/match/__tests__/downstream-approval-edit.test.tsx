/** @vitest-environment jsdom */
/**
 * Both game editors (the admin edit page and the inline editor on the match page) when the edit affects bracket
 * matches that were already played: the API refuses the first save (409 `game_change_downstream_played`, nothing
 * written, so the loaded version is still current), the editor asks for approval listing those matches, and only the
 * approval sends the same save again with the confirm flag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import { encodeDownstreamMatches } from '@/lib/match/downstream-matches';
import type { BattleStat } from '@/types/game';
import EditGameForm from '@/app/admin/matches/[id]/games/[gid]/edit/EditGameForm';
import GameDetailEditForm from '@/components/match/GameDetailEditForm';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

// The inline picker validates names against the dex through an API route; this suite does not need it.
vi.mock('@/components/match/InlinePokemonPicker', () => ({
  default: ({ value }: { value: string }) => <input aria-label="Pokemon" value={value} readOnly />,
}));

const fetchMock = vi.fn();

const P1 = { id: 'p1', name: 'Ash' };
const P2 = { id: 'p2', name: 'Gary' };
const VERSION = '2026-10-19T08:00:00.123456+00:00';

const STAT: BattleStat = {
  id: 's1',
  game_id: 'g1',
  player_id: 'p1',
  pokemon_name: 'Charizard',
  was_brought: true,
  was_lead: true,
  kos_dealt: 2,
  was_koed: false,
  moves_used: ['Flamethrower'],
  turns_active: 5,
  match_won: true,
  created_at: '2026-10-01T18:00:00.000Z',
};

const LATER = [{ id: 'm-final', round_name: 'Finals', player_1_name: 'Ash', player_2_name: 'Misty', status: 'completed' as const }];

const refusal = {
  success: false,
  error: 'This change affects the rest of the bracket: 1 later bracket match was already played.',
  code: 'game_change_downstream_played',
  params: { count: 1, matches: encodeDownstreamMatches(LATER) },
};

const saved = {
  success: true,
  data: { match_status: 'pending_confirmation', match_winner_id: 'p2', evolution_events: [], downstream_reset_match_ids: ['m-final'] },
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bodyOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('the admin edit page', () => {
  function page() {
    return (
      <EditGameForm
        gameId="g1"
        matchId="m1"
        gameUpdatedAt={VERSION}
        currentWinnerId="p1"
        player1={P1}
        player2={P2}
        battleStats={[STAT]}
        isSiteAdmin
      />
    );
  }

  it('asks first, then saves again with the confirm flag and the same version', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => refusal }).mockResolvedValueOnce({ json: async () => saved });
    const user = userEvent.setup();
    render(withI18n(page()));

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    expect(within(dialog).getByText('Ash vs Misty (Finals, Completed)')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0])).not.toHaveProperty('confirm_downstream');

    await user.click(within(dialog).getByRole('button', { name: 'Reset them and apply the change' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const second = bodyOf(fetchMock.mock.calls[1]);
    expect(second).toMatchObject({ winner_id: 'p1', expected_updated_at: VERSION, confirm_downstream: true });
    expect(second.battle_stats).toEqual(bodyOf(fetchMock.mock.calls[0]).battle_stats);
    await screen.findByText('Game updated successfully');
    expect(screen.getByText('1 later bracket match was reset.')).toBeTruthy();
  });

  it('cancelling keeps the form as it was and sends nothing more', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => refusal });
    const user = userEvent.setup();
    render(withI18n(page()));

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save Changes' }).hasAttribute('disabled')).toBe(false);
  });

  it('any other refusal is an error, not a prompt', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ success: false, error: 'This game changed after you opened the editor.', code: 'admin_game_edit_stale' }),
    });
    const user = userEvent.setup();
    render(withI18n(page()));

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await screen.findByText(/This game changed after you opened the editor/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the inline editor on the match page', () => {
  function inline(onSaved = vi.fn()) {
    return (
      <GameDetailEditForm
        gameId="g1"
        source="manual"
        currentWinnerId="p1"
        player1={P1}
        player2={P2}
        battleStats={[STAT]}
        expectedUpdatedAt={VERSION}
        isSiteAdmin
        onCancel={vi.fn()}
        onSaved={onSaved}
      />
    );
  }

  it('asks first, then saves again with the confirm flag; a save that reset matches stays open to say so', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => refusal }).mockResolvedValueOnce({ json: async () => saved });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(withI18n(inline(onSaved)));

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole('button', { name: 'Reset them and apply the change' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock.mock.calls[1])).toMatchObject({ expected_updated_at: VERSION, confirm_downstream: true });
    await screen.findByText('1 later bracket match was reset.');
    expect(onSaved).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  it('cancelling the approval sends nothing more', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => refusal });
    const user = userEvent.setup();
    render(withI18n(inline()));

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'This change affects the rest of the bracket' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
