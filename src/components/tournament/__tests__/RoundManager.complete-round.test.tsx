/** @vitest-environment jsdom */
/**
 * RoundManager's Complete control: with open matches it is disabled and says how many, and the admin
 * can complete the round anyway through a dialog that needs a reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoundManager from '../RoundManager';
import { withI18n } from '@/test/i18n';
import { toPublicMatch } from '@/lib/match/public-match';
import { fullMatchRow } from '@/lib/match/__tests__/private-match-fields';
import type { Round } from '@/types/round';
import type { Tournament } from '@/types/tournament';

const ACTIVE_ROUND: Round = {
  id: 'r-1',
  tournament_id: 't-1',
  name: 'Round 1',
  round_number: 1,
  best_of: 3,
  status: 'active',
  pairings_generated: true,
  deadline: null,
  bracket_side: null,
  bye_player_ids: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const tournament = {
  id: 't-1',
  name: 'Weekly',
  bracket_type: 'swiss',
  best_of_default: 3,
  status: 'active',
} as unknown as Tournament;

const done = (id: string) => toPublicMatch(fullMatchRow({ id, status: 'completed', winner_id: 'p-1' }));
const open = (id: string) => toPublicMatch(fullMatchRow({ id, status: 'scheduled', winner_id: null }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Patch {
  body: Record<string, unknown>;
}

function stubApi(matches: ReturnType<typeof open>[], patches: Patch[], patchAnswer?: () => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patches.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return patchAnswer ? patchAnswer() : json({ success: true, data: { ...ACTIVE_ROUND, status: 'completed' } });
    }
    if (url === '/api/tournaments/t-1/rounds/r-1') return json({ success: true, data: { ...ACTIVE_ROUND, matches } });
    return json({ success: true, data: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const mount = (locale: 'en' | 'de' = 'en') =>
  render(withI18n(<RoundManager tournament={tournament} initialRounds={[ACTIVE_ROUND]} />, { locale }));

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RoundManager complete control', () => {
  it('disables Complete and names the open-match count while matches are open', async () => {
    stubApi([done('m-1'), open('m-2'), open('m-3')], []);
    mount();

    expect(await screen.findByText('2 matches are still open')).toBeTruthy();
    const complete = screen.getByRole('button', { name: 'Complete' });
    expect((complete as HTMLButtonElement).disabled).toBe(true);
    expect(complete.getAttribute('aria-describedby')).toBe(screen.getByText('2 matches are still open').id);
  });

  it('says it in German', async () => {
    stubApi([open('m-1')], []);
    mount('de');

    expect(await screen.findByText('1 Spiel ist noch offen')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Abschließen' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Trotzdem abschließen' })).toBeTruthy();
  });

  it('keeps Complete enabled when every match is finished, and sends a plain completion', async () => {
    const patches: Patch[] = [];
    stubApi([done('m-1'), done('m-2')], patches);
    const user = userEvent.setup();
    mount();

    const complete = screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement;
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/tournaments/t-1/rounds/r-1'));
    expect(screen.queryByText(/still open/)).toBeNull();
    expect(complete.disabled).toBe(false);

    await user.click(complete);

    await waitFor(() => expect(patches).toEqual([{ body: { status: 'completed' } }]));
  });

  it('needs a reason before completing anyway, then sends force with the reason', async () => {
    const patches: Patch[] = [];
    stubApi([open('m-1')], patches);
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: 'Complete anyway' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Complete round' }) as HTMLButtonElement;
    const reason = within(dialog).getByLabelText('Reason');

    expect(confirm.disabled).toBe(true);
    await user.type(reason, '   ');
    expect(confirm.disabled).toBe(true);

    await user.type(reason, 'Opponent withdrew');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);

    await waitFor(() =>
      expect(patches).toEqual([{ body: { status: 'completed', force: true, reason: 'Opponent withdrew' } }]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
  });

  it('reloads the list when the server still refuses a plain completion', async () => {
    const refused = () =>
      json(
        { success: false, error: 'Round has unfinished matches', code: 'round_matches_unfinished', params: { round: 'Round 1', count: 1 } },
        409,
      );
    const fetchMock = stubApi([done('m-1')], [], refused);
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tournaments/t-1/rounds/r-1'));

    // Another admin reopened a match after the list was read.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return refused();
      if (url === '/api/tournaments/t-1/rounds/r-1') return json({ success: true, data: { ...ACTIVE_ROUND, matches: [open('m-1')] } });
      return json({ success: true, data: [] });
    });
    await user.click(screen.getByRole('button', { name: 'Complete' }));

    expect(await screen.findByText('1 match is still open')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
