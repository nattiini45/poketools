/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';
import PhaseRosterManager from '../PhaseRosterManager';
import type { AdminTournamentParticipant } from '@/lib/players/public-player';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const alice: AdminTournamentParticipant = {
  id: 'alice', name: 'Alice', avatar_url: null, seed: 2, starting_bracket: 'winners', is_guest: true,
};
const river: AdminTournamentParticipant = {
  id: 'river', name: 'River', avatar_url: null, seed: null, starting_bracket: 'winners', is_guest: false,
};
const url = '/api/seasons/league/phases/phase/participants';
const mount = (editable = true, rosterSeatsLocked = false) => render(withI18n(
  <PhaseRosterManager
    seasonId="league" phaseId="phase" bracketType="double_elim" editable={editable} startedFormatPhase={false}
    rosterSeatsLocked={rosterSeatsLocked}
    initialParticipants={[alice]} candidates={[alice, river]} ratings={{}} initialEnrollment={null} sourcePhaseName={null}
  />,
));
const ok = (data: unknown) => Response.json({ success: true, data });

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
  refresh.mockClear();
});

it('does not sync on mount and only enrolls a candidate from the owning league', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(ok(null))
    .mockResolvedValueOnce(ok([alice, river]))
    .mockResolvedValueOnce(ok(null));
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  mount();
  expect(fetch).not.toHaveBeenCalled();
  const picker = screen.getByRole('combobox', { name: 'Add Player' });
  await user.type(picker, 'River');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch).toHaveBeenNthCalledWith(1, url, expect.objectContaining({ method: 'POST', body: '{"player_id":"river"}' }));
  expect(fetch).toHaveBeenNthCalledWith(2, `${url}?view=admin`);
  const row = (await screen.findByText('River')).closest('li');
  expect(row).not.toBeNull();
  await user.click(within(row!).getByRole('button', { name: 'Remove' }));
  expect(fetch).toHaveBeenNthCalledWith(3, url, expect.objectContaining({ method: 'DELETE', body: '{"player_id":"river"}' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
});

it('reads the native admin roster after importing standings, preserving the guest badge', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(ok({ enrolled_count: 1, enrollment_source: { type: 'roster', frozen: false } }))
    .mockResolvedValueOnce(ok([{ ...alice, seed: 1 }]));
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'Re-import from table' }));
  expect(fetch).toHaveBeenNthCalledWith(1, `${url}/sync-standings`, expect.objectContaining({ method: 'POST', body: '{}' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(fetch).toHaveBeenNthCalledWith(2, `${url}?view=admin`);
  expect(screen.getByText('Guest')).toBeTruthy();
});

it('does not offer enrollment or enable seeds on a read-only phase', () => {
  mount(false);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('This phase’s roster and seeds are read-only.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Seed by rating' }) as HTMLButtonElement).disabled).toBe(true);
});

it('explains the elimination seat lock and leaves same-roster re-import available', () => {
  mount(true, true);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('The elimination rounds are already set. To change who plays, use a substitution.')).toBeTruthy();
  expect(screen.getByText('Re-importing standings can update seeds, but cannot add or remove players.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Re-import from table' }) as HTMLButtonElement).disabled).toBe(false);
});
