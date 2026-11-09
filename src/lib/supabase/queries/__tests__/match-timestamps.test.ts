import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The timestamp patch every match status writer sends with its status (docs/state-machines.md, match machine):
// one row update per writer flow, as the writers call the query layer.
const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'update', 'eq', 'in', 'not', 'lte', 'order', 'limit']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));
vi.mock('@/lib/utils/uuid', () => ({ assertValidUuid: vi.fn() }));

import { resetMatchFields, transitionMatchStatus, updateMatchStatus } from '../matches';

const NOW = '2026-11-09T12:00:00.000Z';
const DEADLINE = '2026-11-10T12:00:00.000Z';
const ROW = {
  id: 'm1',
  round_id: 'r1',
  tournament_id: 't1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  winner_id: null,
  status: 'in_progress',
  submitter_id: null,
  date_played: null,
  scheduled_at: null,
  auto_confirm_at: null,
  confirmed_at: null,
  notes: '',
  social_image_url: null,
  created_at: NOW,
  updated_at: NOW,
};

function lastUpdate(): Record<string, unknown> {
  const calls = mockBuilder.update.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ['from', 'select', 'update', 'eq', 'in', 'not', 'lte', 'order', 'limit']) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
  mockBuilder.maybeSingle.mockResolvedValue({ data: ROW, error: null });
  mockBuilder.single.mockResolvedValue({ data: ROW, error: null });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('match status writes: the timestamps each writer flow sends', () => {
  it('scheduled → in_progress (first game): only the finalize marker', async () => {
    await updateMatchStatus('m1', 'in_progress', undefined, undefined, undefined, 'scheduled');
    expect(lastUpdate()).toEqual({ status: 'in_progress', finalized_at: null });
    expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'scheduled');
  });

  it('in_progress → pending_confirmation (best-of reached): the source deadline, no confirmation', async () => {
    await transitionMatchStatus('m1', {
      expectedStatus: 'in_progress',
      status: 'pending_confirmation',
      winnerId: 'p1',
      submitterId: 'p2',
      autoConfirmAt: DEADLINE,
      confirmedAt: null,
    });
    expect(lastUpdate()).toEqual({
      status: 'pending_confirmation',
      finalized_at: null,
      winner_id: 'p1',
      submitter_id: 'p2',
      auto_confirm_at: DEADLINE,
      confirmed_at: null,
    });
  });

  it('in_progress → disputed (replay engine tie): clears the timer', async () => {
    await transitionMatchStatus('m1', { expectedStatus: 'in_progress', status: 'disputed', autoConfirmAt: null });
    expect(lastUpdate()).toEqual({ status: 'disputed', finalized_at: null, auto_confirm_at: null });
  });

  it('pending_confirmation → disputed (participant dispute): status and submitter only', async () => {
    await updateMatchStatus('m1', 'disputed', undefined, 'p1', undefined, 'pending_confirmation');
    expect(lastUpdate()).toEqual({ status: 'disputed', finalized_at: null, submitter_id: 'p1' });
  });

  it.each(['pending_confirmation', 'disputed', 'in_progress', 'scheduled'] as const)(
    '%s → completed (confirm, resolve, override, settle, auto-confirm): confirmed and played now, no timer',
    async (from) => {
      await updateMatchStatus('m1', 'completed', 'p1', 'p2', 'note', from);
      expect(lastUpdate()).toEqual({
        status: 'completed',
        finalized_at: null,
        winner_id: 'p1',
        submitter_id: 'p2',
        notes: 'note',
        date_played: NOW,
        confirmed_at: NOW,
        auto_confirm_at: null,
      });
    },
  );

  it('completed → in_progress (reopen): clears the result timestamps', async () => {
    await transitionMatchStatus('m1', {
      expectedStatus: 'completed',
      status: 'in_progress',
      winnerId: null,
      autoConfirmAt: null,
      confirmedAt: null,
      datePlayed: null,
    });
    expect(lastUpdate()).toEqual({
      status: 'in_progress',
      finalized_at: null,
      winner_id: null,
      auto_confirm_at: null,
      confirmed_at: null,
      date_played: null,
    });
  });

  it('completed → in_progress (admin game change, best-of no longer reached): clears the timer only', async () => {
    await transitionMatchStatus('m1', {
      expectedStatus: 'completed',
      status: 'in_progress',
      winnerId: null,
      submitterId: 'admin',
      autoConfirmAt: null,
    });
    expect(lastUpdate()).toEqual({
      status: 'in_progress',
      finalized_at: null,
      winner_id: null,
      submitter_id: 'admin',
      auto_confirm_at: null,
    });
  });

  it('completed → pending_confirmation (admin game change, still decided): no timer', async () => {
    await transitionMatchStatus('m1', {
      expectedStatus: 'completed',
      status: 'pending_confirmation',
      winnerId: 'p1',
      submitterId: 'admin',
      autoConfirmAt: null,
    });
    expect(lastUpdate()).toEqual({
      status: 'pending_confirmation',
      finalized_at: null,
      winner_id: 'p1',
      submitter_id: 'admin',
      auto_confirm_at: null,
    });
  });

  it('pending_confirmation → pending_confirmation (admin game change, still decided): keeps the timer', async () => {
    await transitionMatchStatus('m1', {
      expectedStatus: 'pending_confirmation',
      status: 'pending_confirmation',
      winnerId: 'p1',
      submitterId: 'admin',
      autoConfirmAt: undefined,
    });
    expect(lastUpdate()).toEqual({
      status: 'pending_confirmation',
      finalized_at: null,
      winner_id: 'p1',
      submitter_id: 'admin',
    });
  });

  it('reset to scheduled: every result field cleared', async () => {
    await resetMatchFields('m1', 'completed');
    expect(lastUpdate()).toEqual({
      status: 'scheduled',
      winner_id: null,
      submitter_id: null,
      date_played: null,
      auto_confirm_at: null,
      confirmed_at: null,
      finalized_at: null,
    });
  });
});
