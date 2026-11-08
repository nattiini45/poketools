/** @vitest-environment jsdom */
/**
 * The manual route of a grouped league's phase refuses with league-group codes that live in the seasons error catalog
 * (PHASE_GROUPS_STALE, PHASE_PLAYER_WITHOUT_LEAGUE_GROUP). The form resolves them for the German locale too, like RoundManager.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManualRoundForm from '../ManualRoundForm';
import { withI18n } from '@/test/i18n';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const PLAYERS = [
  { id: 'p-1', name: 'Mara', seed: 1, starting_bracket: 'winners' },
  { id: 'p-2', name: 'Misty', seed: 2, starting_bracket: 'winners' },
];

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('ManualRoundForm: league-group refusals', () => {
  it('shows PHASE_GROUPS_STALE in German for a German admin, not the server\'s English text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? json({ success: false, error: 'The league groups changed while the round was being created.', code: 'PHASE_GROUPS_STALE' }, 409)
          : json({ success: true, data: PLAYERS }),
      ),
    );
    const user = userEvent.setup();
    render(withI18n(<ManualRoundForm tournamentId="t-1" bestOfDefault={3} onRoundCreated={vi.fn()} onCancel={vi.fn()} />, { locale: 'de' }));
    const submit = (await screen.findAllByRole('button')).find((b) => b.getAttribute('type') === 'submit') ?? (await screen.findAllByRole('button'))[0];
    await user.click(submit);
    expect(await screen.findByText(/Die Ligagruppen haben sich geändert/)).toBeTruthy();
  });
});
