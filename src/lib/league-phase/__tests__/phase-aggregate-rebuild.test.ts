import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleStat } from '@/types/game';

vi.mock('@/lib/supabase/queries/aggregates', () => ({ clearAggregatesForScope: vi.fn(), updateAggregatesForScope: vi.fn() }));
vi.mock('@/lib/supabase/queries/games', () => ({ getBattleStatsByGame: vi.fn(), getNewestGameCreatedAt: vi.fn(), listGamesForAggregateRebuild: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-games', () => ({ getPhaseBattleStatsByGame: vi.fn() }));
vi.mock('@/lib/match/aggregate-queue', () => ({
  getAggregateJobStats: vi.fn(), processAggregateJobs: vi.fn(), listGameIdsWithLiveIncrementJobs: vi.fn(),
  processAllAggregateJobs: vi.fn(), getAllAggregateJobStats: vi.fn(),
}));
vi.mock('@/lib/league-phase/phase-aggregate-storage', () => ({
  getPhaseAggregateJobStats: vi.fn(), processPhaseAggregateJobs: vi.fn(), getNewestPhaseGameCreatedAt: vi.fn(),
  listPhaseGameIdsWithLiveIncrementJobs: vi.fn(), listPhaseGamesForAggregateRebuild: vi.fn(),
  getPhaseAggregateSeasonId: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({ revalidateMatchPages: vi.fn(), revalidatePublicPath: vi.fn(), expireSeasonReads: vi.fn() }));

import { clearAggregatesForScope, updateAggregatesForScope } from '@/lib/supabase/queries/aggregates';
import { getBattleStatsByGame, getNewestGameCreatedAt, listGamesForAggregateRebuild } from '@/lib/supabase/queries/games';
import { getPhaseBattleStatsByGame } from '@/lib/supabase/queries/phase-games';
import { listGameIdsWithLiveIncrementJobs, getAggregateJobStats, getAllAggregateJobStats, processAllAggregateJobs } from '@/lib/match/aggregate-queue';
import { listPhaseGameIdsWithLiveIncrementJobs, listPhaseGamesForAggregateRebuild, getNewestPhaseGameCreatedAt, getPhaseAggregateSeasonId } from '../phase-aggregate-storage';
import { rebuildMixedAggregatesForScope, rebuildAggregatesForScope, drainAllPendingAggregateJobs } from '@/lib/match/aggregate-rebuild';

const stats: BattleStat[] = [{
  id: 's', game_id: 'g', player_id: 'p', pokemon_name: 'Pikachu', was_brought: true, was_lead: false,
  kos_dealt: 1, was_koed: false, match_won: true, moves_used: [], turns_active: 1, created_at: '',
}];
const native = (game_id: string, live_increment_job = false, exclude_all_time = false) => ({
  game_id, phase_id: 'phase-1', season_id: 'league-1', live_increment_job, exclude_all_time,
});
const legacy = (game_id: string) => ({ game_id, tournament_id: 't-1', season_id: 'league-1', live_increment_job: false, exclude_all_time: false });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(clearAggregatesForScope).mockResolvedValue({ aggregatesDeleted: 2, playerAggregatesDeleted: 3 });
  vi.mocked(listPhaseGameIdsWithLiveIncrementJobs).mockResolvedValue(new Set());
  vi.mocked(listGameIdsWithLiveIncrementJobs).mockResolvedValue(new Set());
  vi.mocked(getNewestPhaseGameCreatedAt).mockResolvedValue('2026-11-17T01:00:00Z');
  vi.mocked(getPhaseAggregateSeasonId).mockResolvedValue('league-1');
  vi.mocked(getNewestGameCreatedAt).mockResolvedValue('2026-11-17T02:00:00Z');
  vi.mocked(listGamesForAggregateRebuild).mockResolvedValue([]);
  vi.mocked(listPhaseGamesForAggregateRebuild).mockResolvedValue([]);
  vi.mocked(getPhaseBattleStatsByGame).mockResolvedValue(stats);
  vi.mocked(getBattleStatsByGame).mockResolvedValue(stats);
});

describe('explicit mixed-store aggregate rebuild', () => {
  it('combines streams once, preferring native preserved IDs and skipping either family live jobs', async () => {
    vi.mocked(listPhaseGamesForAggregateRebuild).mockResolvedValueOnce([native('same'), native('native'), native('queued'), native('test', false, true)]);
    vi.mocked(listGamesForAggregateRebuild).mockResolvedValueOnce([legacy('same'), legacy('legacy'), legacy('queued')]);
    vi.mocked(listPhaseGameIdsWithLiveIncrementJobs).mockResolvedValue(new Set(['queued']));
    const hook = vi.fn(async () => {});
    expect(await rebuildMixedAggregatesForScope('all_time', null, hook)).toEqual({ gamesProcessed: 3, aggregatesDeleted: 2, playerAggregatesDeleted: 3 });
    expect(getPhaseBattleStatsByGame).toHaveBeenCalledTimes(2);
    expect(getBattleStatsByGame).toHaveBeenCalledExactlyOnceWith('legacy');
    expect(updateAggregatesForScope).toHaveBeenCalledTimes(3);
    expect(hook).toHaveBeenCalledWith('phase-1', 'league-1');
  });

  it('pages native games stably with a frozen bound and keeps test data in league scope', async () => {
    const first = Array.from({ length: 100 }, (_, i) => native(`g-${i}`, false, true));
    vi.mocked(listPhaseGamesForAggregateRebuild).mockResolvedValueOnce(first).mockResolvedValueOnce([native('last')]);
    expect((await rebuildMixedAggregatesForScope('league', 'league-1')).gamesProcessed).toBe(101);
    expect(listPhaseGamesForAggregateRebuild).toHaveBeenNthCalledWith(2, 'league', 'league-1', 100, 100, '2026-11-17T01:00:00Z');
  });

  it('phase scope never reads legacy games or jobs', async () => {
    vi.mocked(listPhaseGamesForAggregateRebuild).mockResolvedValueOnce([native('native')]);
    expect((await rebuildAggregatesForScope('phase', 'phase-1')).gamesProcessed).toBe(1);
    expect(listGamesForAggregateRebuild).not.toHaveBeenCalled();
    expect(listGameIdsWithLiveIncrementJobs).not.toHaveBeenCalled();
    expect(getNewestGameCreatedAt).not.toHaveBeenCalled();
  });

  it('legacy default rebuild remains explicitly legacy-bound', async () => {
    vi.mocked(listGamesForAggregateRebuild).mockResolvedValueOnce([legacy('legacy')]);
    await rebuildAggregatesForScope('league', 'league-1');
    expect(listPhaseGamesForAggregateRebuild).not.toHaveBeenCalled();
    expect(listPhaseGameIdsWithLiveIncrementJobs).not.toHaveBeenCalled();
  });

  it('invalidates an emptied native phase even when no game remains to identify its league', async () => {
    const hook = vi.fn(async () => {});
    await rebuildMixedAggregatesForScope('phase', 'phase-1', hook);
    expect(hook).toHaveBeenCalledWith('phase-1', 'league-1');
  });

  it('dual-store drain waits for both queues without probing legacy-only stats', async () => {
    const pending = { pending: 1, processing: 1, completed: 0, failed: 0, cancelled: 0 };
    const empty = { ...pending, pending: 0, processing: 0, completed: 2 };
    vi.mocked(getAllAggregateJobStats).mockResolvedValueOnce(pending).mockResolvedValue(empty);
    vi.mocked(processAllAggregateJobs).mockResolvedValue({ processed: 2, failed: 0, reclaimed: 1 });
    expect(await drainAllPendingAggregateJobs()).toEqual({ processed: 2, failed: 0, reclaimed: 1, rounds: 1, statsAfter: empty });
    expect(getAggregateJobStats).not.toHaveBeenCalled();
  });
});
