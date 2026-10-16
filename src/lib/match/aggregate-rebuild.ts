/**
 * Admin aggregate maintenance: drain pending jobs and rebuild scopes from battle_stats.
 */

import {
  clearAggregatesForScope,
  updateAggregatesForScope,
} from '@/lib/supabase/queries/aggregates';
import {
  getBattleStatsByGame,
  listGamesForAggregateRebuild,
} from '@/lib/supabase/queries/games';
import { revalidateMatchPages, revalidatePublicPath } from '@/lib/revalidation';
import {
  getAggregateJobStats,
  processAggregateJobs,
  type AggregateJobStats,
  type ProcessAggregateJobsResult,
} from '@/lib/match/aggregate-queue';
import type { AggregateScope } from '@/types/game';

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ROUNDS = 100;
const REBUILD_PAGE_SIZE = 100;

export interface DrainAggregateJobsResult extends ProcessAggregateJobsResult {
  rounds: number;
  statsAfter: AggregateJobStats;
}

export interface RebuildAggregatesForScopeResult {
  gamesProcessed: number;
  aggregatesDeleted: number;
  playerAggregatesDeleted: number;
}

export async function drainPendingAggregateJobs(options?: {
  batchSize?: number;
  maxRounds?: number;
}): Promise<DrainAggregateJobsResult> {
  const batchSize = Math.min(Math.max(options?.batchSize ?? DEFAULT_BATCH_SIZE, 1), 100);
  const maxRounds = Math.min(Math.max(options?.maxRounds ?? DEFAULT_MAX_ROUNDS, 1), 500);

  const totals: ProcessAggregateJobsResult = {
    processed: 0,
    failed: 0,
    reclaimed: 0,
  };
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    const statsBefore = await getAggregateJobStats();
    if (statsBefore.pending === 0 && statsBefore.processing === 0) {
      break;
    }

    const result = await processAggregateJobs(batchSize);
    totals.processed += result.processed;
    totals.failed += result.failed;
    totals.reclaimed += result.reclaimed;
    rounds++;

    const statsAfterRound = await getAggregateJobStats();
    if (statsAfterRound.pending === 0 && statsAfterRound.processing === 0) {
      break;
    }
  }

  return {
    ...totals,
    rounds,
    statsAfter: await getAggregateJobStats(),
  };
}

export async function rebuildAggregatesForScope(
  scopeType: AggregateScope,
  scopeId: string | null
): Promise<RebuildAggregatesForScopeResult> {
  if (scopeType !== 'all_time' && !scopeId) {
    throw new Error('scope_id required for tournament and league rebuilds');
  }

  // Consistency window: deletes scope rows before recompute. Readers may see
  // empty/partial usage until this finishes — operators are warned in Admin UI.
  const cleared = await clearAggregatesForScope(scopeType, scopeId);

  let offset = 0;
  let gamesProcessed = 0;
  const tournamentIds = new Set<string>();

  while (true) {
    const games = await listGamesForAggregateRebuild(
      scopeType,
      scopeId,
      offset,
      REBUILD_PAGE_SIZE
    );
    if (games.length === 0) break;

    for (const game of games) {
      const stats = await getBattleStatsByGame(game.game_id);
      if (stats.length === 0) continue;

      // all_time rebuilds must never reintroduce test data. The frozen
      // exclude_all_time flag on the games row carries the creation-time
      // decision, so flipping test flags after the match exists cannot
      // resurrect previously-excluded games. Tournament/league rebuilds keep
      // local test data — a test league still shows its own stats.
      if (scopeType === 'all_time' && game.exclude_all_time) continue;

      await updateAggregatesForScope(stats, scopeType, scopeId);
      gamesProcessed++;
      tournamentIds.add(game.tournament_id);
    }

    offset += games.length;
    if (games.length < REBUILD_PAGE_SIZE) break;
  }

  await revalidateAfterScopeRebuild(scopeType, scopeId, tournamentIds);

  return {
    gamesProcessed,
    aggregatesDeleted: cleared.aggregatesDeleted,
    playerAggregatesDeleted: cleared.playerAggregatesDeleted,
  };
}

/**
 * Pages and public read-cache tags of a rebuilt scope. Every path goes
 * through `revalidatePublicPath`, which also expires the path's cache tags
 * (`tagsForPath` in `src/lib/revalidation.ts`).
 */
async function revalidateAfterScopeRebuild(
  scopeType: AggregateScope,
  scopeId: string | null,
  tournamentIds: Set<string>
): Promise<void> {
  switch (scopeType) {
    case 'tournament':
      if (scopeId) {
        await revalidateMatchPages(scopeId);
      }
      break;
    case 'league':
      if (scopeId) {
        revalidatePublicPath(`/leagues/${scopeId}`);
        revalidatePublicPath(`/leagues/${scopeId}/stats`);
        revalidatePublicPath('/leagues');
      }
      await Promise.all([...tournamentIds].map((id) => revalidateMatchPages(id)));
      break;
    case 'all_time':
      revalidatePublicPath('/insights');
      revalidatePublicPath('/leaderboard');
      revalidatePublicPath('/');
      await Promise.all([...tournamentIds].map((id) => revalidateMatchPages(id)));
      break;
    default: {
      const _exhaustive: never = scopeType;
      return _exhaustive;
    }
  }
}
