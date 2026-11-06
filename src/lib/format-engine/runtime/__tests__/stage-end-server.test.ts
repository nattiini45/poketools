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

  it('still counts matches that are not completed, and ignores other rounds', async () => {
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      match('m-1'),
      match('m-2', { status: 'in_progress', winner_id: null }),
      match('m-3', { round_id: 'r-2', status: 'scheduled', winner_id: null }),
    ] as never);
    const check = await checkStageEnd(context(['match_completed:m-1']), phase, 'r-1');
    expect(check?.openInRound).toBe(1);
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
