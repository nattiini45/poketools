import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYERS, SEED, giftDef, stateFor } from './helpers';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByTournament: vi.fn() }));

import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import type { KitContext } from '../load';
import { checkStageEnd } from '../stage-end-server';

const def = giftDef();
const stage = { ...def.stages[0], end_when: { kind: 'rounds' as const, rounds: 1 } };
const phase = { id: 't-1', stage, members: PLAYERS };

function context(firedEventKeys: string[]): KitContext {
  return {
    seasonId: 's-1',
    seed: SEED,
    revision: 1,
    def,
    state: { ...stateFor(def), firedEventKeys },
    tunableIssues: [],
    phases: [phase],
  };
}

const match = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  round_id: 'r-1',
  tournament_id: 't-1',
  player_1_id: 'a',
  player_2_id: 'b',
  winner_id: 'a',
  status: 'completed',
  games: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-1', round_number: 1, status: 'completed' }] as never);
});

describe('checkStageEnd: openInRound', () => {
  it('counts a completed sibling whose match_completed event has not fired as open', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), match('m-2')] as never);
    // m-1 (the caller) fired; m-2 flipped to completed but its finalize and hook have not landed.
    const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
    expect(check?.openInRound).toBe(1);
  });

  it('is zero once every completed match of the round has fired its event', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), match('m-2')] as never);
    const check = await checkStageEnd(context(['match_completed:m-1', 'match_completed:m-2']), phase, 'r-1');
    expect(check?.openInRound).toBe(0);
  });

  it('still counts matches of the named round that are not completed while the round is open', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r-1', round_number: 1, status: 'active' }] as never);
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      match('m-1'),
      match('m-2', { status: 'in_progress', winner_id: null }),
    ] as never);
    const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
    expect(check?.openInRound).toBe(1);
  });

  describe('the named round was completed by force', () => {
    const unplayed = (id: string) => match(id, { status: 'scheduled', winner_id: null });

    it('does not count its unfinished matches, so a straggler that completes later is not blocked by its siblings', async () => {
      // r-1 is `completed` (beforeEach): the admin gave up on m-2 and m-3, then m-1 was played anyway.
      vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), unplayed('m-2'), unplayed('m-3')] as never);
      const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
      expect(check?.openInRound).toBe(0);
    });

    it('still lists them for the phase completion, which keeps accepting exactly these', async () => {
      vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), unplayed('m-2'), unplayed('m-3')] as never);
      const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
      expect(check?.unfinishedMatchIds).toEqual(['m-2', 'm-3']);
    });

    it('still waits for the match_completed effects of its completed matches', async () => {
      vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), match('m-2'), unplayed('m-3')] as never);
      // m-1 fired, m-2 flipped to completed but its hook has not landed: the stage end waits for that one only.
      const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
      expect(check?.openInRound).toBe(1);
    });
  });

  describe('other rounds of the phase', () => {
    const rounds = (status2: string, status3 = 'pending') =>
      [
        { id: 'r-1', round_number: 1, status: 'active' },
        { id: 'r-2', round_number: 2, status: status2 },
        { id: 'r-3', round_number: 3, status: status3 },
      ] as never;
    const open = (id: string, round: string, status = 'scheduled') => match(id, { round_id: round, status, winner_id: null });

    it('counts an unfinished match of a later round, so a straggler of round 1 cannot end the phase over round 2', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue(rounds('active'));
      vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), open('m-2', 'r-2')] as never);
      const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
      expect(check?.openInRound).toBe(1);
    });

    it('counts an unfinished match of an earlier round that is not completed (a round robin written in advance)', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue(rounds('active'));
      vi.mocked(getMatchesByTournament).mockResolvedValue([open('m-1', 'r-1', 'in_progress'), match('m-2', { round_id: 'r-2' })] as never);
      const check = await checkStageEnd(context(['match_completed:m-2']), phase, 'r-2');
      expect(check?.openInRound).toBe(1);
    });

    it('does not count the leftovers of a round the admin completed by force', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue(rounds('completed'));
      vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), open('m-2', 'r-2')] as never);
      const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
      expect(check?.openInRound).toBe(0);
      expect(check?.unfinishedMatchIds).toEqual(['m-2']);
    });

    it('does not count completed matches of another round, nor a round that holds no match yet', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue(rounds('active', 'pending'));
      vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), match('m-2', { round_id: 'r-2' })] as never);
      const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
      expect(check?.openInRound).toBe(0);
    });

    it('counts every unfinished match of every other open round', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue(rounds('active', 'active'));
      vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), open('m-2', 'r-2'), open('m-3', 'r-3'), open('m-4', 'r-3', 'disputed')] as never);
      const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
      expect(check?.openInRound).toBe(3);
    });

    it('counts nothing of other rounds when no round is named', async () => {
      vi.mocked(getRoundsByTournament).mockResolvedValue(rounds('active'));
      vi.mocked(getMatchesByTournament).mockResolvedValue([open('m-2', 'r-2')] as never);
      expect((await checkStageEnd(context([]), phase))?.openInRound).toBe(0);
    });
  });

  it('follows the generation of a match that was reverted and completed again', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1')] as never);
    // The first completion's key is fired but a revert advanced the generation: the second completion has not fired.
    const fired = ['match_completed:m-1', 'match_reverted:m-1:0'];
    expect((await checkStageEnd(context(fired), phase, 'r-1'))?.openInRound).toBe(1);
    expect((await checkStageEnd(context([...fired, 'match_completed:m-1:1']), phase, 'r-1'))?.openInRound).toBe(0);
  });

  it('does not wait for a completed match without a winner (the hook never fires for it)', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1', { winner_id: null })] as never);
    expect((await checkStageEnd(context([]), phase, 'r-1'))?.openInRound).toBe(0);
  });

  it('counts nothing when no round is named', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1')] as never);
    expect((await checkStageEnd(context([]), phase))?.openInRound).toBe(0);
  });
});

describe('checkStageEnd: unfinishedMatchIds', () => {
  it('lists every match of the phase that is not completed, in every round, so the completion can tell a new one from these', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      match('m-1'),
      match('m-2', { status: 'in_progress', winner_id: null }),
      match('m-3', { round_id: 'r-2', status: 'scheduled', winner_id: null }),
      match('m-4', { status: 'disputed', winner_id: null }),
    ] as never);
    const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
    expect(check?.unfinishedMatchIds).toEqual(['m-2', 'm-3', 'm-4']);
  });

  it('is empty when every match is completed', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([match('m-1'), match('m-2')] as never);
    expect((await checkStageEnd(context([]), phase))?.unfinishedMatchIds).toEqual([]);
  });
});
