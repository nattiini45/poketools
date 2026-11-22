import { describe, expect, it, vi } from 'vitest';
import {
  createStreaksReconciler,
  type StreaksReconcileStorage,
} from '@/lib/reconcile/reconcile-streaks';
import { createRatingScope } from '@/lib/rating/rating-scope';
import type { StreakHistoryMatch } from '@/lib/gamification/streaks';
import type { PlayerStreaks } from '@/types/streak';

const SEASON_ID = '11111111-1111-4111-8111-111111111111';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function match(id: string, winnerId: string | null, createdAt: string): StreakHistoryMatch {
  return {
    id,
    winner_id: winnerId,
    tournament_id: 't1',
    date_played: createdAt,
    created_at: createdAt,
  };
}

const P1_HISTORY = [
  match('m1', P1, '2026-01-01T10:00:00Z'),
  match('m2', P1, '2026-01-02T10:00:00Z'),
];

/** The row `computeStreaksFromHistory` produces for P1_HISTORY. */
const P1_CURRENT_ROW: PlayerStreaks = {
  id: 'streak-row-1',
  player_id: P1,
  current_win_streak: 2,
  best_win_streak: 2,
  current_loss_streak: 0,
  best_loss_streak: 0,
  current_ko_streak: 0,
  best_ko_streak: 0,
  current_flawless_streak: 0,
  best_flawless_streak: 0,
  last_match_id: 'm2',
};

function makeStorage(over: Partial<StreaksReconcileStorage> = {}): StreaksReconcileStorage {
  return {
    getSeasonById: vi.fn(async () => ({ id: SEASON_ID, format_type: 'singles' }) as never),
    getSeasonParticipants: vi.fn(async () => [{ id: P1 }, { id: P2 }] as never),
    getSeasonTrackers: vi.fn(async () => [] as never),
    listAllSeasonIds: vi.fn(async () => [SEASON_ID]),
    listSeasonCompletedMatchPlayerIds: vi.fn(async () => [P1, P2]),
    loadScope: vi.fn(async () => createRatingScope([])),
    getCompletedMatches: vi.fn(async (playerId: string) =>
      playerId === P1 ? P1_HISTORY : []
    ) as never,
    getPlayerStreaks: vi.fn(async (playerId: string) =>
      playerId === P1 ? P1_CURRENT_ROW : null
    ) as never,
    getStatTotals: vi.fn(async () => new Map()) as never,
    recomputeStreaks: vi.fn(async () => ({
      win_streak: { before: 2, after: 2 },
      loss_streak: { before: 0, after: 0 },
      ko_streak: { before: 0, after: 0 },
      flawless_streak: { before: 0, after: 0 },
      new_records: [],
    })) as never,
    ...over,
  };
}

describe('reconcileStreaks', () => {
  it('dry run marks each player stale or current and writes nothing', async () => {
    const storage = makeStorage();
    const { reconcileStreaks } = createStreaksReconciler(storage);

    const report = await reconcileStreaks({ seasonId: SEASON_ID });

    expect(report.dryRun).toBe(true);
    expect(report.checked).toBe(2);
    const [p1, p2] = report.players;
    expect(p1).toMatchObject({ playerId: P1, status: 'current', mismatchedFields: [] });
    // P2 has no stored row but a stored-vs-replay contract says a missing row
    // is stale only when the replay produced counters — here P2 has no
    // matches, so a missing row agrees with EMPTY_COUNTERS → current.
    expect(p2.status).toBe('current');
    expect(report.summary.stale).toBe(0);
    expect(storage.recomputeStreaks).not.toHaveBeenCalled();
  });

  it('flags a stored row that disagrees with the replay', async () => {
    const storage = makeStorage({
      getPlayerStreaks: vi.fn(async (playerId: string) =>
        playerId === P1
          ? { ...P1_CURRENT_ROW, best_win_streak: 5 }
          : null
      ) as never,
    });
    const { reconcileStreaks } = createStreaksReconciler(storage);

    const report = await reconcileStreaks({ seasonId: SEASON_ID });

    const p1 = report.players.find((p) => p.playerId === P1);
    expect(p1?.status).toBe('stale');
    expect(p1?.mismatchedFields).toEqual(['best_win_streak']);
    expect(report.summary.stale).toBe(1);
    expect(storage.recomputeStreaks).not.toHaveBeenCalled();
  });

  it('flags a missing row when the replay produced counters', async () => {
    const storage = makeStorage({
      getPlayerStreaks: vi.fn(async () => null) as never,
    });
    const { reconcileStreaks } = createStreaksReconciler(storage);

    const report = await reconcileStreaks({ seasonId: SEASON_ID });

    const p1 = report.players.find((p) => p.playerId === P1);
    expect(p1?.status).toBe('stale');
    expect(storage.recomputeStreaks).not.toHaveBeenCalled();
  });

  it('repair calls recomputeStreaks per player and reads nothing else', async () => {
    const storage = makeStorage();
    const { reconcileStreaks } = createStreaksReconciler(storage);

    const report = await reconcileStreaks({ seasonId: SEASON_ID, repair: true });

    expect(report.dryRun).toBe(false);
    expect(report.rebuilt).toEqual({ players: 2 });
    // The repair delegates to the fenced per-player rebuild — the rating,
    // aggregate and evolution rebuilders are not part of this storage at all.
    expect(storage.recomputeStreaks).toHaveBeenCalledTimes(2);
    expect(vi.mocked(storage.recomputeStreaks).mock.calls.map((c) => c[0])).toEqual([P1, P2]);
    expect(storage.getCompletedMatches).not.toHaveBeenCalled();
    expect(storage.getStatTotals).not.toHaveBeenCalled();
    expect(storage.getPlayerStreaks).not.toHaveBeenCalled();
  });

  it('without season_id unions the player set of every season', async () => {
    const storage = makeStorage();
    const { reconcileStreaks } = createStreaksReconciler(storage);

    await reconcileStreaks({});

    expect(storage.listAllSeasonIds).toHaveBeenCalled();
    expect(storage.getSeasonParticipants).toHaveBeenCalledWith(SEASON_ID);
    expect(storage.listSeasonCompletedMatchPlayerIds).toHaveBeenCalledWith(SEASON_ID);
  });
});
