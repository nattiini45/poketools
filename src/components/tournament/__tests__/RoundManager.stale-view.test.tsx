/** @vitest-environment jsdom */
/**
 * RoundManager after a refusal that says its round list is stale (another admin changed a round), and after a round delete
 * whose league-format revert failed: the list is read again, and the warning is shown instead of dropped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoundManager from '../RoundManager';
import { withI18n } from '@/test/i18n';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';

const ROUND: Round = {
  id: 'r-1',
  tournament_id: 't-1',
  name: 'Round 1',
  round_number: 1,
  best_of: 3,
  status: 'pending',
  pairings_generated: true,
  deadline: null,
  bracket_side: null,
  bye_player_ids: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};
const tournament = { id: 't-1', name: 'Weekly', bracket_type: 'swiss', best_of_default: 3, status: 'active' } as unknown as Tournament;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('RoundManager: stale view and revert warning', () => {
  it('reads the round list again after a refusal that names a round another admin changed', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return json({ success: false, error: 'Round not found', code: 'round_not_found' }, 404);
      if (url === '/api/tournaments/t-1/rounds') return json({ success: true, data: [] });
      return json({ success: true, data: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(withI18n(<RoundManager tournament={tournament} initialRounds={[ROUND]} />));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getAllByRole('button').at(-1) as HTMLElement);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tournaments/t-1/rounds'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull());
  });

  it('shows the warning of a round delete whose format revert failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'DELETE' ? json({ success: true, data: { deleted: true, format_revert_failed: true } }) : json({ success: true, data: [] }),
      ),
    );
    const user = userEvent.setup();
    render(withI18n(<RoundManager tournament={tournament} initialRounds={[ROUND]} />));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getAllByRole('button').at(-1) as HTMLElement);

    expect(await screen.findByText(/could not be taken back/)).toBeTruthy();
  });
});
