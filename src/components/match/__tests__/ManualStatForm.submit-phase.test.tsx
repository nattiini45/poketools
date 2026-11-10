/** @vitest-environment jsdom */
/**
 * A manual game has no content dedupe: once one is recorded and the page is about to redirect, the form cannot send
 * it again. Without a redirect the form stays usable for the next game.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import type { PokemonSet } from '@/types/team';
import ManualStatForm from '../ManualStatForm';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/components/shared/PokemonAutocomplete', () => ({
  default: ({ value }: { value: string }) => <input readOnly value={value} />,
}));

const fetchMock = vi.fn();
const PLAYERS: [{ id: string; name: string }, { id: string; name: string }] = [
  { id: 'p1', name: 'Mara' },
  { id: 'p2', name: 'Cilan' },
];
const set = (species: string) => ({ species, moves: [] }) as unknown as PokemonSet;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ json: async () => ({ success: true, data: { bo_reached: false } }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ui(redirectTo?: string) {
  return withI18n(
    <ManualStatForm
      matchId="m1"
      players={PLAYERS}
      initialTeams={{ player1: [set('Pikachu')], player2: [set('Eevee')] }}
      redirectTo={redirectTo}
    />,
  );
}

describe('ManualStatForm submit phase', () => {
  it('records the game once: the submit stays disabled until the redirect', async () => {
    const user = userEvent.setup();
    render(ui('/tournaments/t1/matches/m1'));

    await user.click(screen.getByRole('button', { name: 'Mara' }));
    await user.click(screen.getByRole('button', { name: 'Submit Result' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit Result' })).toHaveProperty('disabled', true));
    await user.click(screen.getByRole('button', { name: 'Submit Result' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('without a redirect, the form takes the next game', async () => {
    const user = userEvent.setup();
    render(ui());

    await user.click(screen.getByRole('button', { name: 'Mara' }));
    await user.click(screen.getByRole('button', { name: 'Submit Result' }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit Result' })).toHaveProperty('disabled', false));
  });
});
