/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '@ui-sdk/react/agent';
import { withI18n } from '@/test/i18n';
import type { PhaseRound } from '@/types/league-phase';
import type { ComponentProps } from 'react';
import PhaseRoundManager from '../PhaseRoundManager';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const base = '/api/seasons/league-1/phases/phase-1';
const address = { season_id: 'league-1', phase_id: 'phase-1' };
const pending: PhaseRound = {
  id: 'round-1', phase_id: address.phase_id, round_number: 1, name: 'Round 1',
  best_of: 3, status: 'pending', deadline: null, bracket_side: null, bye_player_ids: ['p3'],
  pairings_generated: true, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z',
};
const fixture = {
  id: 'match-1', phase_id: address.phase_id, round_id: pending.id,
  player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'Jade', player_2_name: 'Rune',
  status: 'scheduled', winner_id: null, date_played: null, scheduled_at: null,
  social_image_url: null, bracket_side: null, bracket_pos: null, games: [],
};
const props: ComponentProps<typeof PhaseRoundManager> = {
  address,
  phase: {
    status: 'active', archived: false, bracket_type: 'round_robin', current_round: 1, best_of_default: 3,
  },
  rounds: [pending],
  participants: [
    { id: 'p1', name: 'Jade', seed: 1 }, { id: 'p2', name: 'Rune', seed: 2 }, { id: 'p3', name: 'Vale', seed: 3 },
  ],
  leagueHasGroups: false,
  phaseAllowsDeletion: true,
};

const fetchMock = vi.fn<typeof fetch>();
function success(data: unknown) {
  return Response.json({ success: true, data });
}

beforeAll(() => {
  HTMLElement.prototype.showPopover = function () {};
  HTMLElement.prototype.hidePopover = function () {};
  Element.prototype.getAnimations = () => [];
  Element.prototype.checkVisibility = () => true;
  document.head.append(Object.assign(document.createElement('style'), { textContent: '[popover] { display: block !important }' }));
});

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error('Unmocked request'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('native phase round manager', () => {
  it('loads only the expanded round, distinguishes errors from empty rounds, and links its public matches', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(success({ ...pending, matches: [fixture] }));
    render(withI18n(<PhaseRoundManager {...props} />));
    expect(screen.getByText('Bye: Vale')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    const disclosure = screen.getByRole('button', { name: /Round 1/ });
    await user.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load this round');
    expect(screen.queryByText('No matches in this round.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findByRole('link', { name: /Jade.*Rune/ })).getAttribute('href'))
      .toBe('/leagues/league-1/phases/phase-1/matches/match-1');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(Array(2).fill(`${base}/rounds/round-1`));
    await user.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('uses an explicit opt-in for eligible deletion and preserves a late server refusal', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(success({ ...pending, matches: [fixture] }))
      .mockResolvedValueOnce(Response.json({
        success: false, error: 'This round cannot be deleted while one of its matches has linked teams.',
        code: 'phase_round_delete_teams',
      }, { status: 409 }))
      .mockResolvedValueOnce(success({ deleted: true }));
    render(withI18n(<PhaseRoundManager {...props} />));
    await user.click(screen.getByRole('button', { name: /Round 1/ }));
    const trigger = await screen.findByRole('button', { name: 'Delete' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Round' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(dialog.textContent).toContain('unplayed matches');
    expect(createAgent().snapshot().some(entry => entry.label === 'Delete Round')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Delete Round' }).getAttribute('data-agent-confirm'))
      .toContain('unplayed matches');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete Round' }));
    expect((await screen.findByRole('alert')).textContent).toContain('linked teams');
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}/rounds/round-1`, expect.objectContaining({
      method: 'DELETE', body: '{"confirm":true}',
    }));
    expect(refresh).toHaveBeenCalledTimes(1);
    await user.click(trigger);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete Round' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: /Round 1/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('never offers destructive actions on played, earlier or phase-locked rounds', async () => {
    const user = userEvent.setup();
    const later = { ...pending, id: 'round-2', name: 'Round 2', round_number: 2 };
    for (const options of [
      { matches: [{ ...fixture, games: [{ id: 'game-1' }] }], overrides: {} },
      { matches: [fixture], overrides: { rounds: [pending, later] } },
      { matches: [fixture], overrides: { phaseAllowsDeletion: false } },
    ]) {
      fetchMock.mockResolvedValueOnce(success({ ...pending, matches: options.matches }));
      const view = render(withI18n(<PhaseRoundManager {...props} {...options.overrides} />));
      await user.click(screen.getByRole('button', { name: /Round 1/ }));
      await screen.findByRole('link');
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
      expect(screen.queryByRole('button', { name: /reset|repair|regenerate|generate all/i })).toBeNull();
      view.unmount();
    }
  });

  it('creates manual pairings with the seeded native roster and no legacy participant lookup', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(success(pending));
    render(withI18n(<PhaseRoundManager {...props} rounds={[]} />));
    await user.click(screen.getByRole('button', { name: 'Create Manual Round' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'First player in match 1' }).value).toBe('p1');
    const name = screen.getByRole('textbox', { name: 'Round Name (optional)' });
    expect(document.activeElement).toBe(name);
    await user.type(name, 'Opening Heat{Enter}');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${base}/rounds/manual`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ name: 'Opening Heat', best_of: 3, pairings: [{ player_1_id: 'p1', player_2_id: 'p3' }] }),
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('uses the distinct native generation endpoints and only offers an initial bracket', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(success(pending)).mockResolvedValueOnce(success({ rounds_created: 1, matches_materialized: 1 }));
    const view = render(withI18n(<PhaseRoundManager {...props} rounds={[]} />));
    await user.click(screen.getByRole('button', { name: 'Generate Next Round' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${base}/rounds/generate`, { method: 'POST' });
    const bracket = { ...props.phase, bracket_type: 'double_elim' } as const;
    view.rerender(withI18n(<PhaseRoundManager {...props} phase={bracket} rounds={[]} />));
    await user.click(screen.getByRole('button', { name: 'Generate Bracket' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${base}/generate-bracket`, { method: 'POST' });
    view.rerender(withI18n(<PhaseRoundManager {...props} phase={bracket} rounds={[{ ...pending, bracket_side: 'winners' }]} />));
    expect(screen.queryByRole('button', { name: /generate|repair|manual/i })).toBeNull();
  });

  it('patches best-of, deadline and start through the owned round and refreshes the workspace', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async () => success(pending));
    render(withI18n(<PhaseRoundManager {...props} rounds={[{ ...pending, deadline: '2026-11-19T12:00:00Z' }]} />));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Best of for Round 1' }), '5');
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.map(([url, request]) => [url, request?.method, request?.body])).toEqual([
      [`${base}/rounds/round-1`, 'PATCH', '{"best_of":5}'],
      [`${base}/rounds/round-1`, 'PATCH', '{"deadline":null}'],
      [`${base}/rounds/round-1`, 'PATCH', '{"status":"active"}'],
    ]);
  });

  it('keeps completed or archived phases read-only and blocks Swiss generation before completion', async () => {
    const user = userEvent.setup();
    const active = { ...pending, status: 'active' } as const;
    const swiss = { ...props.phase, bracket_type: 'swiss' } as const;
    fetchMock.mockResolvedValueOnce(success({ ...active, matches: [fixture] }));
    const view = render(withI18n(<PhaseRoundManager {...props} rounds={[active]} phase={swiss} />));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Generate Next Round' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create Manual Round' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /Round 1/ }));
    expect(await screen.findByText('1 match is still open')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /complete/i })).toBeNull();
    view.rerender(withI18n(<PhaseRoundManager {...props} rounds={[active]} phase={{ ...swiss, status: 'completed' }} />));
    expect(screen.queryByRole('button', { name: /generate|manual|deadline|start|complete|delete/i })).toBeNull();
    view.rerender(withI18n(<PhaseRoundManager {...props} phase={{ ...swiss, archived: true }} />));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /generate|manual|deadline|start|delete/i })).toBeNull();
  });

  it('offers completion only for an active round with no open matches and no manual pairing in a grouped table', async () => {
    const user = userEvent.setup();
    const round = { ...pending, status: 'active' } as const;
    fetchMock.mockResolvedValueOnce(success({ ...round, matches: [{ ...fixture, status: 'completed' }] }))
      .mockResolvedValueOnce(success({ ...round, status: 'completed' }));
    render(withI18n(<PhaseRoundManager {...props} rounds={[round]} leagueHasGroups />));
    expect(screen.queryByRole('button', { name: 'Create Manual Round' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Round 1/ }));
    await user.click(await screen.findByRole('button', { name: 'Complete' }));
    expect(fetchMock).toHaveBeenLastCalledWith(`${base}/rounds/round-1`, expect.objectContaining({
      method: 'PATCH', body: '{"status":"completed"}',
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
