/**
 * The live rating update's writer (code review CR-4, closed in round 3): both
 * players' ratings and both history rows go out as ONE RPC,
 * `rating_apply_match_result`, which commits them in one transaction under
 * the per-player advisory locks and fences on the stored values the caller
 * computed from (supabase/migrations/20261018170100_rating_apply_atomic.sql;
 * SQL proofs in the round-3 evidence). Errors are thrown unchanged; an
 * unknown outcome code is an error too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: rpcMock } }));
vi.mock('@/lib/supabase/queries/test-accounts', () => ({
  getTestAccountIds: vi.fn().mockResolvedValue([]),
}));

import { applyMatchRatingResult, toExpectedRatingState, type MatchRatingResultEntry } from '../ratings';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';

const state = {
  rating: 1550,
  rd: 300,
  volatility: 0.06,
  peak_rating: 1550,
  peak_date: '2026-10-18T00:00:00.000Z',
  wins: 1,
  losses: 0,
  draws: 0,
  last_match_at: '2026-10-18T00:00:00.000Z',
  updated_at: '2026-10-18T00:00:00.000Z',
};

const entry = (playerId: string, opponentId: string, result: 'win' | 'loss'): MatchRatingResultEntry => ({
  playerId,
  expected: playerId === 'p1' ? { rating: 1500, rd: 350, volatility: 0.06, wins: 0, losses: 0, draws: 0 } : null,
  state,
  history: {
    rating_before: 1500,
    rating_after: 1550,
    rd_before: 350,
    rd_after: 300,
    opponent_id: opponentId,
    opponent_rating: 1500,
    result,
  },
});

const pair = [entry('p1', 'p2', 'win'), entry('p2', 'p1', 'loss')] as const;

beforeEach(() => {
  rpcMock.mockReset();
});

describe('applyMatchRatingResult', () => {
  it('sends ONE rating_apply_match_result call with both players, their fences, states and history rows', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'applied', error: null });

    await expect(applyMatchRatingResult(MATCH_ID, pair)).resolves.toBe('applied');

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, args] = rpcMock.mock.calls[0];
    expect(name).toBe('rating_apply_match_result');
    expect(args.p_match_id).toBe(MATCH_ID);
    expect(args.p_players).toEqual([
      {
        player_id: 'p1',
        expected: { rating: 1500, rd: 350, volatility: 0.06, wins: 0, losses: 0, draws: 0 },
        state,
        history: {
          opponent_id: 'p2', rating_before: 1500, rating_after: 1550, rd_before: 350, rd_after: 300,
          opponent_rating: 1500, result: 'win',
        },
      },
      {
        player_id: 'p2',
        expected: null,
        state,
        history: {
          opponent_id: 'p1', rating_before: 1500, rating_after: 1550, rd_before: 350, rd_after: 300,
          opponent_rating: 1500, result: 'loss',
        },
      },
    ]);
  });

  it('stamps updated_at when the state carries none', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'applied', error: null });
    const { updated_at: _omit, ...withoutStamp } = state;

    await applyMatchRatingResult(MATCH_ID, [{ ...pair[0], state: withoutStamp }, pair[1]]);

    const sent = rpcMock.mock.calls[0][1].p_players as Array<{ state: { updated_at: string } }>;
    expect(typeof sent[0].state.updated_at).toBe('string');
    expect(Number.isNaN(Date.parse(sent[0].state.updated_at))).toBe(false);
  });

  it.each(['applied', 'already_applied', 'stale', 'history_incomplete', 'match_missing', 'match_not_completed', 'skipped_test_season'] as const)(
    'passes the %s outcome through',
    async (outcome) => {
      rpcMock.mockResolvedValueOnce({ data: outcome, error: null });
      await expect(applyMatchRatingResult(MATCH_ID, pair)).resolves.toBe(outcome);
    },
  );

  it('throws on an outcome this build does not know instead of treating it as success', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'half_applied', error: null });
    await expect(applyMatchRatingResult(MATCH_ID, pair)).rejects.toThrow(
      'rating_apply_match_result returned an unknown outcome: "half_applied"',
    );
  });

  it('throws the RPC error unchanged (the transaction rolled back, nothing was written)', async () => {
    const error = { message: 'violates check constraint "rating_history_result_check"', code: '23514' };
    rpcMock.mockResolvedValueOnce({ data: null, error });
    await expect(applyMatchRatingResult(MATCH_ID, pair)).rejects.toBe(error);
  });

  it('refuses a malformed match id before any request', async () => {
    await expect(applyMatchRatingResult('not-a-uuid', pair)).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('toExpectedRatingState', () => {
  it('projects the fenced columns of a stored row, and null for no row', () => {
    expect(toExpectedRatingState(null)).toBeNull();
    expect(
      toExpectedRatingState({
        id: 'r', player_id: 'p1', rating: 1523.47, rd: 81.2, volatility: 0.059871, peak_rating: 1600,
        peak_date: null, wins: 3, losses: 2, draws: 1, last_match_at: null,
      }),
    ).toEqual({ rating: 1523.47, rd: 81.2, volatility: 0.059871, wins: 3, losses: 2, draws: 1 });
  });
});
