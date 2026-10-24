import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  updateMatchStatus: vi.fn(),
  setMatchScheduledAtIfOpen: vi.fn(),
  updateMatchNotesIfUnchanged: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({ cancelPendingMatchProposalsForMatch: vi.fn() }));
vi.mock('@/lib/match/finalize', () => ({ finalizeMatchCompletion: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ revalidateMatchPages: vi.fn() }));
// The real state machine, wrapped so the parity test can read the calls.
vi.mock('@/lib/tournament/match-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tournament/match-state')>();
  return { ...actual, validateTransition: vi.fn(actual.validateTransition) };
});

// What the single-match confirm route needs (parity test only).
vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', () => ({ checkRateLimit: vi.fn(), rateLimitedResponse: vi.fn() }));

import { POST as singleConfirm } from '@/app/api/confirm-match/[mid]/route';
import { BULK_DEFAULT_BUDGET_MS, runBulkAction, type BulkActionContext } from '@/lib/match/bulk-actions';
import type { AdminMatchBatchInput } from '@/lib/admin/match-bulk';
import { requirePlayer } from '@/lib/auth/helpers';
import {
  getMatchById,
  setMatchScheduledAtIfOpen,
  updateMatchNotesIfUnchanged,
  updateMatchStatus,
} from '@/lib/supabase/queries/matches';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import { finalizeMatchCompletion } from '@/lib/match/finalize';
import { revalidateMatchPages } from '@/lib/revalidation';
import { validateTransition } from '@/lib/tournament/match-state';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { MatchStatus, MatchWithPlayers } from '@/types/match';

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOURNAMENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BATCH = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const UPDATED_AT = '2026-10-24T10:00:00.123456+00:00';

function match(overrides: Partial<MatchWithPlayers> = {}): MatchWithPlayers {
  return {
    id: ID_1,
    round_id: 'round-1',
    tournament_id: TOURNAMENT,
    player_1_id: P1,
    player_2_id: P2,
    winner_id: P1,
    status: 'pending_confirmation',
    submitter_id: P1,
    date_played: null,
    scheduled_at: '2026-10-20T18:00:00.000Z',
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: UPDATED_AT,
    player_1_name: 'Mara',
    player_2_name: 'Nora',
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: 'Mara',
    round_status: 'active',
    games: [],
    ...overrides,
  } as MatchWithPlayers;
}

/** The slice of a mock the parity test reads. */
type MockLike = { mock: { calls: unknown[][]; invocationCallOrder: number[] } };

const ctx = (overrides: Partial<BulkActionContext> = {}): BulkActionContext => ({
  actor: { playerId: ADMIN, name: 'Admin Anna' },
  batchId: BATCH,
  ...overrides,
});

/** A confirm request that expects `winner` (player 1 by default) on every id, as the dialog preview would send. */
const confirm = (...ids: string[]): AdminMatchBatchInput => confirmExpecting(P1, ...ids);
const confirmExpecting = (winner: string, ...ids: string[]): AdminMatchBatchInput => ({
  action: 'confirm',
  match_ids: ids,
  params: { expected: ids.map((id) => ({ match_id: id, winner_id: winner, status: 'pending_confirmation' as const })) },
});
const mapOf = (...matches: MatchWithPlayers[]) => new Map(matches.map((m) => [m.id, m]));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(updateMatchStatus).mockResolvedValue({ id: ID_1 } as never);
  vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: true, failed_steps: [], complete: true });
  vi.mocked(setMatchScheduledAtIfOpen).mockResolvedValue({ id: ID_1 } as never);
  vi.mocked(updateMatchNotesIfUnchanged).mockResolvedValue({ id: ID_1 } as never);
  vi.mocked(cancelPendingMatchProposalsForMatch).mockResolvedValue([]);
  vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);
});

describe('runBulkAction: confirm', () => {
  it('validates the transition, writes with the expected status, then finalizes, in that order', async () => {
    const m = match();
    const outcomes = await runBulkAction(confirm(ID_1), mapOf(m), ctx());

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].result).toEqual({ id: ID_1, ok: true, code: 'ok' });
    expect(validateTransition).toHaveBeenCalledWith('pending_confirmation', 'completed', {
      actor_id: ADMIN,
      is_admin: true,
      winner_id: P1,
      player_1_id: P1,
      player_2_id: P2,
    });
    expect(updateMatchStatus).toHaveBeenCalledWith(ID_1, 'completed', P1, ADMIN, undefined, 'pending_confirmation');
    expect(finalizeMatchCompletion).toHaveBeenCalledWith({
      match: { ...m, winner_id: P1, status: 'completed' },
      winnerId: P1,
      previousStatus: 'pending_confirmation',
    });
    const order = [validateTransition, updateMatchStatus, finalizeMatchCompletion].map(
      (fn) => vi.mocked(fn).mock.invocationCallOrder[0]
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('audits the completion with the status and winner change, and the batch id', async () => {
    const [outcome] = await runBulkAction(confirm(ID_1), mapOf(match()), ctx());
    expect(outcome.audit).toEqual({
      action: 'match.bulk_confirm',
      resource_type: 'match',
      resource_id: ID_1,
      resource_name: 'Mara vs Nora',
      changes: {
        status: { before: 'pending_confirmation', after: 'completed' },
        winner_id: { before: P1, after: P1 },
      },
      metadata: { batch_id: BATCH, tournament_id: TOURNAMENT },
    });
  });

  it.each<[string, Partial<MatchWithPlayers>, string]>([
    ['scheduled', { status: 'scheduled', winner_id: null }, 'match_bulk_not_pending'],
    ['in progress', { status: 'in_progress' }, 'match_bulk_not_pending'],
    ['completed', { status: 'completed' }, 'match_bulk_not_pending'],
    ['disputed', { status: 'disputed' }, 'match_bulk_not_pending'],
    ['pending without a winner', { winner_id: null }, 'match_complete_no_winner'],
    ['pending with a winner who is not a participant', { winner_id: ADMIN }, 'match_winner_not_participant'],
  ])('skips a %s match without any write', async (_label, overrides, code) => {
    const outcomes = await runBulkAction(confirm(ID_1), mapOf(match(overrides)), ctx());
    expect(outcomes[0].result).toEqual({ id: ID_1, ok: false, code });
    expect(outcomes[0].audit).toBeUndefined();
    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
  });

  it('reports a conflict, and does not finalize, when the match moved meanwhile', async () => {
    vi.mocked(updateMatchStatus).mockResolvedValue(null);
    const outcomes = await runBulkAction(confirm(ID_1), mapOf(match()), ctx());
    expect(outcomes[0].result).toEqual({ id: ID_1, ok: false, code: 'match_bulk_conflict' });
    expect(outcomes[0].audit).toBeUndefined();
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
  });

  it('counts a half-finished finalize as done with a warning code, and audits it', async () => {
    vi.mocked(finalizeMatchCompletion).mockResolvedValue({
      finalized: true,
      failed_steps: ['ratings', 'streaks'],
      complete: false,
    });
    const [outcome] = await runBulkAction(confirm(ID_1), mapOf(match()), ctx());
    expect(outcome.result).toEqual({
      id: ID_1,
      ok: true,
      code: 'match_finalize_incomplete',
      params: { count: 2 },
    });
    expect(outcome.audit?.action).toBe('match.bulk_confirm');
    expect(outcome.audit?.metadata).toMatchObject({ finalize_failed_steps: 2 });
  });

  it('refuses an item whose reported winner changed since the preview, without a write', async () => {
    // The admin previewed player 1 as the winner; the fresh row now reports player 2.
    const m = match({ winner_id: P2, winner_name: 'Nora' });
    const [outcome] = await runBulkAction(confirmExpecting(P1, ID_1), mapOf(m), ctx());
    expect(outcome.result).toEqual({ id: ID_1, ok: false, code: 'match_bulk_conflict' });
    expect(outcome.audit).toBeUndefined();
    expect(updateMatchStatus).not.toHaveBeenCalled();
    expect(finalizeMatchCompletion).not.toHaveBeenCalled();
  });

  it('finalizes the previewed winner when it is still the reported one', async () => {
    const m = match({ winner_id: P2, winner_name: 'Nora' });
    const [outcome] = await runBulkAction(confirmExpecting(P2, ID_1), mapOf(m), ctx());
    expect(outcome.result).toEqual({ id: ID_1, ok: true, code: 'ok' });
    expect(updateMatchStatus).toHaveBeenCalledWith(ID_1, 'completed', P2, ADMIN, undefined, 'pending_confirmation');
  });

  it('refuses an item that has no expectation, and only that item', async () => {
    const input: AdminMatchBatchInput = {
      action: 'confirm',
      match_ids: [ID_1, ID_2],
      params: { expected: [{ match_id: ID_2, winner_id: P1, status: 'pending_confirmation' }] },
    };
    const outcomes = await runBulkAction(input, mapOf(match({ id: ID_1 }), match({ id: ID_2 })), ctx());
    expect(outcomes.map((o) => o.result)).toEqual([
      { id: ID_1, ok: false, code: 'match_bulk_conflict' },
      { id: ID_2, ok: true, code: 'ok' },
    ]);
    expect(updateMatchStatus).toHaveBeenCalledTimes(1);
  });

  it('reports a completed match with a warning, and audits it, when finalize throws after the completion write', async () => {
    vi.mocked(finalizeMatchCompletion).mockRejectedValue(new Error('rating service down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const [outcome] = await runBulkAction(confirm(ID_1), mapOf(match()), ctx());

    expect(updateMatchStatus).toHaveBeenCalledTimes(1);
    expect(outcome.result).toEqual({ id: ID_1, ok: true, code: 'match_finalize_incomplete', params: { count: 1 } });
    expect(outcome.audit).toMatchObject({
      action: 'match.bulk_confirm',
      resource_id: ID_1,
      changes: { status: { before: 'pending_confirmation', after: 'completed' } },
      metadata: { batch_id: BATCH, finalize_failed_steps: 1, finalize_threw: true },
    });
    // The original error is logged, and does not reach the result.
    expect(spy.mock.calls.flat().some((arg) => arg instanceof Error && arg.message.includes('rating service down'))).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain('rating service down');
    spy.mockRestore();
  });

  it('reports a completed match with a warning, and audits it, when finalize did not run', async () => {
    vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: false, reason: 'no_winner' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [outcome] = await runBulkAction(confirm(ID_1), mapOf(match()), ctx());
    expect(outcome.result).toEqual({ id: ID_1, ok: true, code: 'match_finalize_incomplete', params: { count: 1 } });
    expect(outcome.audit?.action).toBe('match.bulk_confirm');
    spy.mockRestore();
  });

  it('reports a missing match as not found and keeps going', async () => {
    const outcomes = await runBulkAction(confirm(ID_2, ID_1), mapOf(match()), ctx());
    expect(outcomes.map((o) => o.result)).toEqual([
      { id: ID_2, ok: false, code: 'match_not_found' },
      { id: ID_1, ok: true, code: 'ok' },
    ]);
  });

  it('returns one outcome per id in request order', async () => {
    const outcomes = await runBulkAction(
      confirm(ID_3, ID_1, ID_2),
      mapOf(match({ id: ID_1 }), match({ id: ID_2 }), match({ id: ID_3 })),
      ctx()
    );
    expect(outcomes.map((o) => o.result.id)).toEqual([ID_3, ID_1, ID_2]);
  });

  describe('failures and the time budget', () => {
    it('isolates a throwing item: the middle one fails with a generic code, the others are done', async () => {
      vi.mocked(updateMatchStatus)
        .mockResolvedValueOnce({} as never)
        .mockRejectedValueOnce(new Error('connection reset by 10.0.0.5'))
        .mockResolvedValueOnce({} as never);
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const outcomes = await runBulkAction(
        confirm(ID_1, ID_2, ID_3),
        mapOf(match({ id: ID_1 }), match({ id: ID_2 }), match({ id: ID_3 })),
        ctx()
      );

      expect(outcomes.map((o) => o.result)).toEqual([
        { id: ID_1, ok: true, code: 'ok' },
        { id: ID_2, ok: false, code: 'match_bulk_item_failed' },
        { id: ID_3, ok: true, code: 'ok' },
      ]);
      expect(JSON.stringify(outcomes)).not.toContain('connection reset');
      // The original error is logged, not swallowed.
      expect(spy.mock.calls.flat().some((arg) => arg instanceof Error && arg.message.includes('connection reset'))).toBe(true);
      spy.mockRestore();
    });

    it('uses a default budget below the 300 s route limit', () => {
      expect(BULK_DEFAULT_BUDGET_MS).toBeLessThan(300_000);
    });

    it('reports every item as not processed, without a write, when the budget is zero', async () => {
      const outcomes = await runBulkAction(
        confirm(ID_1, ID_2),
        mapOf(match({ id: ID_1 }), match({ id: ID_2 })),
        ctx({ budgetMs: 0 })
      );
      expect(outcomes.map((o) => o.result)).toEqual([
        { id: ID_1, ok: false, code: 'match_bulk_not_processed' },
        { id: ID_2, ok: false, code: 'match_bulk_not_processed' },
      ]);
      expect(validateTransition).not.toHaveBeenCalled();
      expect(updateMatchStatus).not.toHaveBeenCalled();
    });

    it('stops starting items once the budget is used up, and says so for the rest', async () => {
      let now = 0;
      vi.mocked(updateMatchStatus).mockImplementation(async () => {
        now += 60_000; // each confirm takes a minute
        return {} as never;
      });
      const outcomes = await runBulkAction(
        confirm(ID_1, ID_2, ID_3),
        mapOf(match({ id: ID_1 }), match({ id: ID_2 }), match({ id: ID_3 })),
        ctx({ nowMs: () => now, budgetMs: 100_000 })
      );
      expect(outcomes.map((o) => o.result.code)).toEqual(['ok', 'ok', 'match_bulk_not_processed']);
      expect(updateMatchStatus).toHaveBeenCalledTimes(2);
    });
  });
});

describe('runBulkAction: confirm parity with the single admin confirm', () => {
  const SINGLE_PLAYER = { playerId: ADMIN, isAdmin: true, name: 'Admin Anna' };

  async function runSingleConfirm(m: MatchWithPlayers) {
    vi.mocked(requirePlayer).mockResolvedValue(SINGLE_PLAYER as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    vi.mocked(getMatchById).mockResolvedValue(m);
    const res = await singleConfirm(
      { json: async () => ({ action: 'confirm' }) } as unknown as NextRequest,
      { params: Promise.resolve({ mid: m.id }) }
    );
    expect(res.status).toBe(200);
  }

  /** Every call of the three state-changing collaborators, in the order they happened. */
  function callSequence() {
    const fns = [
      ['validateTransition', vi.mocked(validateTransition) as unknown as MockLike],
      ['updateMatchStatus', vi.mocked(updateMatchStatus) as unknown as MockLike],
      ['finalizeMatchCompletion', vi.mocked(finalizeMatchCompletion) as unknown as MockLike],
    ] as const;
    return fns
      .flatMap(([name, fn]) => fn.mock.calls.map((args, i) => ({ name, args, order: fn.mock.invocationCallOrder[i] })))
      .sort((a, b) => a.order - b.order)
      .map(({ name, args }) => ({ name, args }));
  }

  // The league format is resolved inside finalize (mocked here), so every fixture reaches the same calls: there is
  // no format branch on the bulk path. The second fixture has the other seat winning, with a game recorded.
  it.each([
    ['player 1 won', match()],
    [
      'player 2 won, a game recorded',
      match({
        winner_id: P2,
        winner_name: 'Nora',
        games: [
          { id: 'g1', game_number: 1, winner_id: P2, replay_url: 'https://replay.example/1', source: 'ps_replay', stats_locked: false },
        ],
      }),
    ],
  ])('makes the same calls with the same arguments (%s)', async (_label, m) => {
    vi.mocked(updateMatchStatus).mockResolvedValue({ id: m.id } as never);

    await runSingleConfirm(m);
    const single = callSequence();
    expect(single.map((c) => c.name)).toEqual(['validateTransition', 'updateMatchStatus', 'finalizeMatchCompletion']);

    vi.mocked(validateTransition).mockClear();
    vi.mocked(updateMatchStatus).mockClear();
    vi.mocked(finalizeMatchCompletion).mockClear();

    await runBulkAction(confirmExpecting(m.winner_id as string, m.id), mapOf(m), ctx());
    expect(callSequence()).toEqual(single);
  });
});

describe('runBulkAction: schedule', () => {
  const SCHEDULED_AT = '2026-11-02T18:30:00.000Z';
  const schedule = (...ids: string[]): AdminMatchBatchInput => ({
    action: 'schedule',
    match_ids: ids,
    params: { scheduled_at: SCHEDULED_AT },
  });

  it('sets the time, cancels pending proposals, revalidates and audits before and after', async () => {
    const [outcome] = await runBulkAction(schedule(ID_1), mapOf(match({ status: 'scheduled', winner_id: null })), ctx());

    expect(outcome.result).toEqual({ id: ID_1, ok: true, code: 'ok' });
    expect(setMatchScheduledAtIfOpen).toHaveBeenCalledWith(ID_1, SCHEDULED_AT);
    expect(cancelPendingMatchProposalsForMatch).toHaveBeenCalledWith(ID_1);
    expect(revalidateMatchPages).toHaveBeenCalledWith(TOURNAMENT, ID_1);
    expect(outcome.audit).toEqual({
      action: 'match.bulk_schedule',
      resource_type: 'match',
      resource_id: ID_1,
      resource_name: 'Mara vs Nora',
      changes: { scheduled_at: { before: '2026-10-20T18:00:00.000Z', after: SCHEDULED_AT } },
      metadata: { batch_id: BATCH, tournament_id: TOURNAMENT },
    });
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('skips a completed match without a write', async () => {
    const [outcome] = await runBulkAction(schedule(ID_1), mapOf(match({ status: 'completed' })), ctx());
    expect(outcome.result).toEqual({ id: ID_1, ok: false, code: 'match_bulk_schedule_completed' });
    expect(setMatchScheduledAtIfOpen).not.toHaveBeenCalled();
    expect(cancelPendingMatchProposalsForMatch).not.toHaveBeenCalled();
  });

  it.each<MatchStatus>(['scheduled', 'in_progress', 'pending_confirmation', 'disputed'])(
    'reschedules a %s match',
    async (status) => {
      const [outcome] = await runBulkAction(schedule(ID_1), mapOf(match({ status })), ctx());
      expect(outcome.result.ok).toBe(true);
      expect(setMatchScheduledAtIfOpen).toHaveBeenCalledTimes(1);
    }
  );

  it('reports a conflict when no row matched and the match is not completed', async () => {
    vi.mocked(setMatchScheduledAtIfOpen).mockResolvedValue(null);
    vi.mocked(getMatchById).mockResolvedValue(match({ status: 'in_progress' }));
    const [outcome] = await runBulkAction(schedule(ID_1), mapOf(match({ status: 'scheduled' })), ctx());
    expect(outcome.result).toEqual({ id: ID_1, ok: false, code: 'match_bulk_conflict' });
    expect(outcome.audit).toBeUndefined();
    expect(cancelPendingMatchProposalsForMatch).not.toHaveBeenCalled();
    expect(revalidateMatchPages).not.toHaveBeenCalled();
  });

  it('reports a completed-meanwhile match as completed, not as a conflict', async () => {
    vi.mocked(setMatchScheduledAtIfOpen).mockResolvedValue(null);
    vi.mocked(getMatchById).mockResolvedValue(match({ status: 'completed' }));
    const [outcome] = await runBulkAction(schedule(ID_1), mapOf(match({ status: 'scheduled' })), ctx());
    expect(outcome.result).toEqual({ id: ID_1, ok: false, code: 'match_bulk_schedule_completed' });
  });

  it('reports a conflict when the match is gone', async () => {
    vi.mocked(setMatchScheduledAtIfOpen).mockResolvedValue(null);
    vi.mocked(getMatchById).mockResolvedValue(null);
    const [outcome] = await runBulkAction(schedule(ID_1), mapOf(match({ status: 'scheduled' })), ctx());
    expect(outcome.result.code).toBe('match_bulk_conflict');
  });

  it('still counts the item as done when cancelling the proposals fails', async () => {
    vi.mocked(cancelPendingMatchProposalsForMatch).mockRejectedValue(new Error('proposals unavailable'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [outcome] = await runBulkAction(schedule(ID_1), mapOf(match({ status: 'scheduled' })), ctx());
    expect(outcome.result).toEqual({ id: ID_1, ok: true, code: 'ok' });
    expect(outcome.audit?.action).toBe('match.bulk_schedule');
    expect(revalidateMatchPages).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('still counts the item as done when revalidation fails', async () => {
    vi.mocked(revalidateMatchPages).mockRejectedValue(new Error('cache down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [outcome] = await runBulkAction(schedule(ID_1), mapOf(match({ status: 'scheduled' })), ctx());
    expect(outcome.result.ok).toBe(true);
    spy.mockRestore();
  });
});

describe('runBulkAction: note', () => {
  const NOW = Date.UTC(2026, 9, 24, 15, 7, 59);
  const note = (...ids: string[]): AdminMatchBatchInput => ({
    action: 'note',
    match_ids: ids,
    params: { note: 'Check the replay' },
  });
  const LINE = '[2026-10-24 15:07 UTC, Admin Anna] Check the replay';

  it('appends the stamped line after the existing notes on a new line, compare-and-set on updated_at', async () => {
    const m = match({ notes: 'Earlier note', status: 'scheduled' });
    const [outcome] = await runBulkAction(note(ID_1), mapOf(m), ctx({ nowMs: () => NOW }));

    expect(outcome.result).toEqual({ id: ID_1, ok: true, code: 'ok' });
    expect(updateMatchNotesIfUnchanged).toHaveBeenCalledWith(ID_1, UPDATED_AT, `Earlier note\n${LINE}`);
    expect(revalidateMatchPages).not.toHaveBeenCalled();
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('writes just the line when there are no notes yet', async () => {
    await runBulkAction(note(ID_1), mapOf(match({ notes: '' })), ctx({ nowMs: () => NOW }));
    expect(updateMatchNotesIfUnchanged).toHaveBeenCalledWith(ID_1, UPDATED_AT, LINE);
  });

  it('audits only the appended line, never the whole notes', async () => {
    const [outcome] = await runBulkAction(
      note(ID_1),
      mapOf(match({ notes: 'private earlier text' })),
      ctx({ nowMs: () => NOW })
    );
    expect(outcome.audit).toEqual({
      action: 'match.bulk_note',
      resource_type: 'match',
      resource_id: ID_1,
      resource_name: 'Mara vs Nora',
      metadata: { batch_id: BATCH, tournament_id: TOURNAMENT, note_line: LINE },
    });
    expect(JSON.stringify(outcome.audit)).not.toContain('private earlier text');
  });

  it('reports a conflict when the match was written meanwhile', async () => {
    vi.mocked(updateMatchNotesIfUnchanged).mockResolvedValue(null);
    const [outcome] = await runBulkAction(note(ID_1), mapOf(match()), ctx({ nowMs: () => NOW }));
    expect(outcome.result).toEqual({ id: ID_1, ok: false, code: 'match_bulk_conflict' });
    expect(outcome.audit).toBeUndefined();
  });

  it('refuses an append that would exceed the notes limit, without a write', async () => {
    const [outcome] = await runBulkAction(
      note(ID_1),
      mapOf(match({ notes: 'x'.repeat(9990) })),
      ctx({ nowMs: () => NOW })
    );
    expect(outcome.result).toEqual({ id: ID_1, ok: false, code: 'match_bulk_notes_full' });
    expect(updateMatchNotesIfUnchanged).not.toHaveBeenCalled();
  });
});
