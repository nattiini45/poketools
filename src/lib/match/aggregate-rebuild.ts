/**
 * Admin aggregate maintenance: drain pending jobs and rebuild scopes from battle_stats.
 */

import {
  clearAggregatesForScope,
  updateAggregatesForScope,
} from '@/lib/supabase/queries/aggregates';
import {
  getBattleStatsByGame,
  getNewestGameCreatedAt,
  listGamesForAggregateRebuild,
} from '@/lib/supabase/queries/games';
import { expireSeasonReads, revalidateMatchPages, revalidatePublicPath } from '@/lib/revalidation';
import {
  getAggregateJobStats,
  listGameIdsWithLiveIncrementJobs,
  processAggregateJobs,
  processAllAggregateJobs,
  getAllAggregateJobStats,
  type AggregateJobStats,
  type ProcessAggregateJobsResult,
} from '@/lib/match/aggregate-queue';
import type { AggregateScope } from '@/types/game';
import {
  getPhaseAggregateJobStats, processPhaseAggregateJobs, getNewestPhaseGameCreatedAt,
  listPhaseGameIdsWithLiveIncrementJobs, listPhaseGamesForAggregateRebuild,
  getPhaseAggregateSeasonId,
  type PhaseAggregateOwner,
} from '@/lib/league-phase/phase-aggregate-storage';
import { getPhaseBattleStatsByGame } from '@/lib/supabase/queries/phase-games';

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

/**
 * Processes pending aggregate jobs in rounds until none is pending or processing, `maxRounds` rounds ran, or
 * `deadline` (epoch milliseconds) passed before a round started. A run cut short leaves the rest to the cron
 * (`statsAfter` says how much); a round that already started is never interrupted.
 */
export async function drainPendingAggregateJobs(options?: {
  batchSize?: number;
  maxRounds?: number;
  deadline?: number;
}): Promise<DrainAggregateJobsResult> {
  return drainAggregateQueue(options, getAggregateJobStats, processAggregateJobs);
}

type DrainOptions = Parameters<typeof drainPendingAggregateJobs>[0];

export async function drainAllPendingAggregateJobs(options?: DrainOptions,
  onPhaseApplied?: (owner: PhaseAggregateOwner) => Promise<void>): Promise<DrainAggregateJobsResult> {
  return drainAggregateQueue(options, getAllAggregateJobStats,
    onPhaseApplied ? (limit) => processAllAggregateJobs(limit, onPhaseApplied) : processAllAggregateJobs);
}

export async function drainPendingPhaseAggregateJobs(options?: DrainOptions,
  onApplied?: (owner: PhaseAggregateOwner) => Promise<void>): Promise<DrainAggregateJobsResult> {
  return drainAggregateQueue(options, getPhaseAggregateJobStats,
    onApplied ? (limit) => processPhaseAggregateJobs(limit, onApplied) : processPhaseAggregateJobs);
}

async function drainAggregateQueue(options: DrainOptions, stats: typeof getAggregateJobStats,
  process: typeof processAggregateJobs): Promise<DrainAggregateJobsResult> {
  const batchSize = Math.min(Math.max(options?.batchSize ?? DEFAULT_BATCH_SIZE, 1), 100);
  const maxRounds = Math.min(Math.max(options?.maxRounds ?? DEFAULT_MAX_ROUNDS, 1), 500);

  const totals: ProcessAggregateJobsResult = {
    processed: 0,
    failed: 0,
    reclaimed: 0,
  };
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    if (options?.deadline !== undefined && Date.now() >= options.deadline) break;
    const statsBefore = await stats();
    if (statsBefore.pending === 0 && statsBefore.processing === 0) {
      break;
    }

    const result = await process(batchSize);
    totals.processed += result.processed;
    totals.failed += result.failed;
    totals.reclaimed += result.reclaimed;
    rounds++;

    const statsAfterRound = await stats();
    if (statsAfterRound.pending === 0 && statsAfterRound.processing === 0) {
      break;
    }
  }

  return {
    ...totals,
    rounds,
    statsAfter: await stats(),
  };
}

export async function rebuildAggregatesForScope(
  scopeType: AggregateScope,
  scopeId: string | null
): Promise<RebuildAggregatesForScopeResult> {
  if (scopeType === 'phase') return rebuildMixedAggregatesForScope(scopeType, scopeId);
  if (scopeType !== 'all_time' && !scopeId) {
    throw new Error('scope_id required for tournament and league rebuilds');
  }

  // Consistency window: deletes scope rows before recompute. Readers may see
  // empty/partial usage until this finishes — operators are warned in Admin UI.
  const cleared = await clearAggregatesForScope(scopeType, scopeId);

  // Fence against the queue, read right after the clear. A game the queue will
  // still count (live increment job, its marker NULL) is left to the queue:
  // counting it here too would count it twice once the job applies (the
  // rebuild never sets the marker). The same holds for a game recorded after
  // the clear, whose own job counts it into the cleared scope; the
  // `createdUpTo` bound leaves those out and keeps the offset pages stable.
  // Overlaps that remain (docs/match.md, "Scope rebuilds and the queue"): a
  // job that applies between the clear and this read; a game whose recording
  // transaction started before this read (`created_at` is its start time) but
  // committed after it; and a game read between its battle-stats write and
  // its job enqueue. All need results recorded during the rebuild; re-running
  // the rebuild repairs them. A NULL-marker game without a job cannot be
  // skipped instead: games recorded before the queue existed look the same.
  const [queuedGameIds, createdUpTo] = await Promise.all([
    listGameIdsWithLiveIncrementJobs(),
    getNewestGameCreatedAt(),
  ]);

  let offset = 0;
  let gamesProcessed = 0;
  const tournamentIds = new Set<string>();

  while (true) {
    const games = await listGamesForAggregateRebuild(
      scopeType,
      scopeId,
      offset,
      REBUILD_PAGE_SIZE,
      createdUpTo
    );
    if (games.length === 0) break;

    for (const game of games) {
      if (game.live_increment_job || queuedGameIds.has(game.game_id)) continue;

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

export async function rebuildMixedAggregatesForScope(
  scopeType: AggregateScope, scopeId: string | null,
  onPhaseRebuilt?: (phaseId: string, seasonId: string) => Promise<void>,
): Promise<RebuildAggregatesForScopeResult> {
  if (scopeType === 'tournament') return rebuildAggregatesForScope(scopeType, scopeId);
  if (scopeType !== 'all_time' && !scopeId) throw new Error('scope_id required for phase and league rebuilds');
  const cleared = await clearAggregatesForScope(scopeType, scopeId);
  const [phaseLive, phaseBound, legacyLive, legacyBound] = await Promise.all([
    listPhaseGameIdsWithLiveIncrementJobs(), getNewestPhaseGameCreatedAt(),
    scopeType === 'phase' ? new Set<string>() : listGameIdsWithLiveIncrementJobs(),
    scopeType === 'phase' ? null : getNewestGameCreatedAt(),
  ]);
  const seen = new Set<string>();
  const phases = new Map<string, string>();
  if (scopeType === 'phase' && scopeId) {
    const seasonId = await getPhaseAggregateSeasonId(scopeId);
    if (seasonId) phases.set(scopeId, seasonId);
  }
  const tournaments = new Set<string>();
  let gamesProcessed = 0;
  const maxPages = 1000;
  for (const kind of scopeType === 'phase' ? ['phase'] as const : ['phase', 'tournament'] as const) {
    let offset = 0;
    for (let page = 0; ; page++) {
      if (page === maxPages) throw new Error('Aggregate rebuild exceeded its bounded game read; rerun in smaller scopes');
      const games = kind === 'phase'
        ? await listPhaseGamesForAggregateRebuild(scopeType, scopeId, offset, REBUILD_PAGE_SIZE, phaseBound)
        : await listGamesForAggregateRebuild(scopeType, scopeId, offset, REBUILD_PAGE_SIZE, legacyBound);
      for (const game of games) {
        if (seen.has(game.game_id)) continue;
        seen.add(game.game_id);
        if ('phase_id' in game) phases.set(game.phase_id, game.season_id);
        if (game.live_increment_job || phaseLive.has(game.game_id) || legacyLive.has(game.game_id)) continue;
        if (scopeType === 'all_time' && game.exclude_all_time) continue;
        const native = 'phase_id' in game;
        const stats = native ? await getPhaseBattleStatsByGame(game.game_id) : await getBattleStatsByGame(game.game_id);
        if (stats.length === 0) continue;
        await updateAggregatesForScope(stats, scopeType, scopeId);
        gamesProcessed++;
        if (!native) tournaments.add(game.tournament_id);
      }
      offset += games.length;
      if (games.length < REBUILD_PAGE_SIZE) break;
    }
  }
  for (const [phaseId, seasonId] of phases) {
    expireSeasonReads(seasonId);
    if (onPhaseRebuilt) await onPhaseRebuilt(phaseId, seasonId);
  }
  await revalidateAfterScopeRebuild(scopeType, scopeId, tournaments);
  return { gamesProcessed, ...cleared };
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
    case 'phase':
      revalidatePublicPath('/insights');
      break;
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
