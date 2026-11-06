/** @vitest-environment jsdom */
/**
 * ManualRoundForm's way out of a 409 `format_not_ready`: the refusal opens "Start anyway?", the confirmation repeats the
 * call with `?force=true` (the audited override), and a refusal of the forced call does not open the dialog again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManualRoundForm from '../ManualRoundForm';
import { withI18n } from '@/test/i18n';
import type { Round } from '@/types/round';

const ROUND = { id: 'r-1', tournament_id: 't-1', name: 'Round 1', round_number: 1, best_of: 3, status: 'pending' } as unknown as Round;
const PLAYERS = [
  { id: 'p-1', name: 'Mara', seed: 1, starting_bracket: 'winners' },
  { id: 'p-2', name: 'Misty', seed: 2, starting_bracket: 'winners' },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const notReady = (reasons = 'relation_undrawn') =>
  json({ success: false, error: 'The format is not ready.', code: 'format_not_ready', params: { reasons } }, 409);

function stubApi(answers: Response[]) {
  const posts: string[] = [];
  const queue = [...answers];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(url);
      return queue.shift() ?? json({ success: true, data: ROUND });
    }
    return json({ success: true, data: PLAYERS });
  });
  vi.stubGlobal('fetch', fetchMock);
  return posts;
}

async function submit() {
  const user = userEvent.setup();
  const onRoundCreated = vi.fn();
  render(withI18n(<ManualRoundForm tournamentId="t-1" bestOfDefault={3} onRoundCreated={onRoundCreated} onCancel={vi.fn()} />));
  await user.click(await screen.findByRole('button', { name: 'Create Round' }));
  return { user, onRoundCreated };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('ManualRoundForm: format_not_ready', () => {
  it('opens the "Start anyway?" dialog with the reasons instead of ending in a dead end', async () => {
    const posts = stubApi([notReady('relation_undrawn,action_incomplete')]);
    await submit();
    const dialog = await screen.findByRole('dialog', { name: 'Start anyway?' });
    expect(within(dialog).getByText(/The draw the format needs has not been made yet/)).toBeTruthy();
    expect(within(dialog).getByText(/Some players still owe an action/)).toBeTruthy();
    expect(posts).toEqual(['/api/tournaments/t-1/rounds/manual']);
  });

  it('retries with ?force=true after the confirmation, and reports the created round', async () => {
    const posts = stubApi([notReady()]);
    const { user, onRoundCreated } = await submit();
    const dialog = await screen.findByRole('dialog', { name: 'Start anyway?' });
    await user.click(within(dialog).getByRole('button', { name: 'Start anyway' }));

    await waitFor(() => expect(onRoundCreated).toHaveBeenCalledWith(ROUND));
    expect(posts).toEqual(['/api/tournaments/t-1/rounds/manual', '/api/tournaments/t-1/rounds/manual?force=true']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends nothing more when the dialog is cancelled', async () => {
    const posts = stubApi([notReady()]);
    const { user, onRoundCreated } = await submit();
    const dialog = await screen.findByRole('dialog', { name: 'Start anyway?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts).toHaveLength(1);
    expect(onRoundCreated).not.toHaveBeenCalled();
  });

  it('does not reopen the dialog when the forced call is refused again', async () => {
    const posts = stubApi([notReady(), notReady()]);
    const { user, onRoundCreated } = await submit();
    await user.click(within(await screen.findByRole('dialog', { name: 'Start anyway?' })).getByRole('button', { name: 'Start anyway' }));

    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onRoundCreated).not.toHaveBeenCalled();
  });

  it('opens no dialog for any other refusal', async () => {
    const posts = stubApi([json({ success: false, error: 'Rounds exist.', code: 'rounds_all_generated' }, 409)]);
    await submit();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts).toHaveLength(1);
  });
});
