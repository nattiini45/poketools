/** @vitest-environment jsdom */
/**
 * RoundManager's Generate buttons and a 409 `format_not_ready`: the refusal opens "Start anyway?", the confirmation
 * repeats the same call with `?force=true`, and a refusal of the forced call does not open the dialog again. (The pure
 * pieces are in RoundManager.force-start.test.tsx.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoundManager from '../RoundManager';
import { withI18n } from '@/test/i18n';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';

const tournament = (bracket_type: string) =>
  ({ id: 't-1', name: 'Weekly', bracket_type, best_of_default: 3, ruleset_id: 'rs-1', status: 'active', bracket_reset_enabled: true }) as unknown as Tournament;

const ROUND = { id: 'r-1', tournament_id: 't-1', name: 'Round 1', round_number: 1, best_of: 3, status: 'pending', pairings_generated: true } as unknown as Round;
const PARTICIPANTS = { count: 4, seededCount: 4, playerIds: ['p1', 'p2', 'p3', 'p4'] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const notReady = () =>
  json({ success: false, error: 'The format is not ready.', code: 'format_not_ready', params: { reasons: 'relation_undrawn' } }, 409);

/** Answers every POST with the next queued response (a success once the queue is empty) and records its URL. */
function stubApi(answers: Response[], success: unknown) {
  const posts: string[] = [];
  const queue = [...answers];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(url);
        return queue.shift() ?? json({ success: true, data: success });
      }
      return json({ success: true, data: [] });
    }),
  );
  return posts;
}

const mount = (bracketType: string) =>
  render(withI18n(<RoundManager tournament={tournament(bracketType)} initialRounds={[]} initialParticipants={PARTICIPANTS} />));

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['Generate Next Round', 'swiss', '/api/generate-round/t-1', ROUND],
  ['Generate All Rounds', 'round_robin', '/api/tournaments/t-1/generate-all-rounds', [ROUND]],
])('RoundManager: %s refused with format_not_ready', (button, bracketType, url, created) => {
  it('opens "Start anyway?" and repeats the call with ?force=true after the confirmation', async () => {
    const posts = stubApi([notReady()], created);
    const user = userEvent.setup();
    mount(bracketType);
    await user.click(await screen.findByRole('button', { name: button }));

    const dialog = await screen.findByRole('dialog', { name: 'Start anyway?' });
    expect(within(dialog).getByText(/The draw the format needs has not been made yet/)).toBeTruthy();
    expect(posts).toEqual([url]);

    await user.click(within(dialog).getByRole('button', { name: 'Start anyway' }));
    await waitFor(() => expect(posts).toEqual([url, `${url}?force=true`]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sends nothing more when the dialog is cancelled', async () => {
    const posts = stubApi([notReady()], created);
    const user = userEvent.setup();
    mount(bracketType);
    await user.click(await screen.findByRole('button', { name: button }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Start anyway?' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts).toEqual([url]);
  });

  it('does not reopen the dialog when the forced call is refused again', async () => {
    const posts = stubApi([notReady(), notReady()], created);
    const user = userEvent.setup();
    mount(bracketType);
    await user.click(await screen.findByRole('button', { name: button }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Start anyway?' })).getByRole('button', { name: 'Start anyway' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
