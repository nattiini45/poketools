import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  clearAggregatesForScope: vi.fn(),
  updateAggregatesForScope: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByGame: vi.fn(),
  getNewestGameCreatedAt: vi.fn(),
  listGamesForAggregateRebuild: vi.fn(),
}));

vi.mock('@/lib/match/aggregate-queue', () => ({
  getAggregateJobStats: vi.fn(),
  listGameIdsWithLiveIncrementJobs: vi.fn(),
  processAggregateJobs: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(async () => {}),
  revalidatePublicPath: vi.fn(),
}));

import { drainPendingAggregateJobs, rebuildAggregatesForScope } from '../aggregate-rebuild';
import {
  clearAggregatesForScope,
  updateAggregatesForScope,
} from '@/lib/supabase/queries/aggregates';
import {
  getBattleStatsByGame,
  getNewestGameCreatedAt,
  listGamesForAggregateRebuild,
} from '@/lib/supabase/queries/games';
import { getAggregateJobStats, listGameIdsWithLiveIncrementJobs, processAggregateJobs } from '@/lib/match/aggregate-queue';
import type { ScopeGameRow } from '@/lib/supabase/queries/games';
import type { BattleStat } from '@/types/game';

const stat = (playerId: string): BattleStat => ({
  id: `bs-${playerId}`,
  game_id: 'g1',
  player_id: playerId,
  pokemon_name: 'Garchomp',
  was_brought: true,
  was_lead: false,
  kos_dealt: 2,
  was_koed: false,
  match_won: true,
  moves_used: ['Earthquake'],
  turns_active: 5,
  created_at: '2024-01-01T00:00:00Z',
});

const gameRow = (
  game_id: string,
  tournament_id: string,
  season_id: string | null,
  exclude_all_time: boolean,
  live_increment_job = false,
): ScopeGameRow => ({ game_id, tournament_id, season_id, exclude_all_time, live_increment_job });

describe('rebuildAggregatesForScope — test-data isolation', () => {
  beforeEach(() => {
    // resetAllMocks clears call data AND any mockResolvedValueOnce queues.
    vi.resetAllMocks();
    // Re-establish persistent implementations cleared by resetAllMocks.
    vi.mocked(clearAggregatesForScope).mockResolvedValue({
      aggregatesDeleted: 0,
      playerAggregatesDeleted: 0,
    });
    vi.mocked(updateAggregatesForScope).mockResolvedValue(undefined);
    vi.mocked(getBattleStatsByGame).mockResolvedValue([stat('p1')]);
    vi.mocked(listGameIdsWithLiveIncrementJobs).mockResolvedValue(new Set());
    vi.mocked(getNewestGameCreatedAt).mockResolvedValue('2026-10-19T00:00:00Z');
  });

  it('skips test games during an all_time rebuild (reads frozen exclude_all_time)', async () => {
    const normalGame = gameRow('g1', 't1', 's-real', false);
    const testGame = gameRow('g2', 't2', 's-test', true);
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([normalGame, testGame])
      .mockResolvedValueOnce([]);

    const result = await rebuildAggregatesForScope('all_time', null);

    expect(result.gamesProcessed).toBe(1); // only the normal game
    expect(updateAggregatesForScope).toHaveBeenCalledTimes(1);
  });

  it('keeps local test data during a league rebuild (ignores exclude_all_time)', async () => {
    const game = gameRow('g1', 't1', 's-test', true);
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([game])
      .mockResolvedValueOnce([]);

    const result = await rebuildAggregatesForScope('league', 's-test');

    expect(result.gamesProcessed).toBe(1);
    expect(updateAggregatesForScope).toHaveBeenCalledTimes(1);
  });

  it('keeps local test data during a tournament rebuild (ignores exclude_all_time)', async () => {
    const game = gameRow('g1', 't1', 's-test', true);
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([game])
      .mockResolvedValueOnce([]);

    const result = await rebuildAggregatesForScope('tournament', 't1');

    expect(result.gamesProcessed).toBe(1);
    expect(updateAggregatesForScope).toHaveBeenCalledTimes(1);
  });
});
describe('rebuildAggregatesForScope — fence against the aggregate queue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(clearAggregatesForScope).mockResolvedValue({
      aggregatesDeleted: 0,
      playerAggregatesDeleted: 0,
    });
    vi.mocked(updateAggregatesForScope).mockResolvedValue(undefined);
    vi.mocked(getBattleStatsByGame).mockResolvedValue([stat('p1')]);
    vi.mocked(getNewestGameCreatedAt).mockResolvedValue('2026-10-19T00:00:00Z');
  });

  it('leaves a game whose increment job is still pending to the queue (counted once, not twice)', async () => {
    // g-pending was recorded and its job J is still pending (marker NULL).
    // Counting it here and then letting J apply counted it twice.
    vi.mocked(listGameIdsWithLiveIncrementJobs).mockResolvedValue(new Set());
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([
        gameRow('g-counted', 't1', null, false),
        gameRow('g-pending', 't1', null, false, true),
      ])
      .mockResolvedValueOnce([]);

    const result = await rebuildAggregatesForScope('tournament', 't1');

    expect(result.gamesProcessed).toBe(1);
    expect(getBattleStatsByGame).toHaveBeenCalledTimes(1);
    expect(getBattleStatsByGame).toHaveBeenCalledWith('g-counted');
  });

  it('skips a game whose job was live right after the clear, even if it applied before its page was read', async () => {
    vi.mocked(listGameIdsWithLiveIncrementJobs).mockResolvedValue(new Set(['g-applied-meanwhile']));
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([gameRow('g-applied-meanwhile', 't1', null, false, false)])
      .mockResolvedValueOnce([]);

    const result = await rebuildAggregatesForScope('tournament', 't1');

    expect(result.gamesProcessed).toBe(0);
    expect(updateAggregatesForScope).not.toHaveBeenCalled();
  });

  it('reads the fence after the clear and bounds every page by it', async () => {
    const order: string[] = [];
    vi.mocked(clearAggregatesForScope).mockImplementation(async () => {
      order.push('clear');
      return { aggregatesDeleted: 0, playerAggregatesDeleted: 0 };
    });
    vi.mocked(listGameIdsWithLiveIncrementJobs).mockImplementation(async () => {
      order.push('fence');
      return new Set();
    });
    vi.mocked(listGamesForAggregateRebuild).mockResolvedValueOnce([]);

    await rebuildAggregatesForScope('league', 's1');

    expect(order).toEqual(['clear', 'fence']);
    expect(listGamesForAggregateRebuild).toHaveBeenCalledWith('league', 's1', 0, 100, '2026-10-19T00:00:00Z');
  });
});

describe('drainPendingAggregateJobs', () => {
  const pending = (n: number) => ({ pending: n, processing: 0, completed: 0, failed: 0, cancelled: 0 });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(processAggregateJobs).mockResolvedValue({ processed: 1, failed: 0, reclaimed: 0 });
  });

  it('runs rounds until nothing is pending', async () => {
    vi.mocked(getAggregateJobStats)
      .mockResolvedValueOnce(pending(2)) // before round 1
      .mockResolvedValueOnce(pending(1)) // after round 1
      .mockResolvedValueOnce(pending(1)) // before round 2
      .mockResolvedValueOnce(pending(0)) // after round 2
      .mockResolvedValue(pending(0));

    const result = await drainPendingAggregateJobs({ batchSize: 1 });

    expect(processAggregateJobs).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ rounds: 2, processed: 2 });
  });

  it('starts no round once the deadline has passed and leaves the rest to the cron', async () => {
    vi.mocked(getAggregateJobStats).mockResolvedValue(pending(40));

    const result = await drainPendingAggregateJobs({ deadline: Date.now() - 1 });

    expect(processAggregateJobs).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rounds: 0, statsAfter: pending(40) });
  });
});
