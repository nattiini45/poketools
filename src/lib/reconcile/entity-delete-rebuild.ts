/**
 * Derived-data rebuild after an entity is deleted or a deleted league is
 * restored (EPB spec §18 "leave the league as if that match had never been
 * imported" + §22 reconcile intent).
 *
 * Hard-deleting a tournament or season (a season goes to the league trash,
 * see `src/lib/league-trash`) removes the raw rows (matches → games →
 * battle_stats), but the data DERIVED from those rows is not cascade-deleted
 * and must be rebuilt from what remains:
 *   - aggregates (tournament/league/all_time scopes, incl. player_aggregates)
 *   - player ratings + rating_history curves (deleted matches vanish from
 *     the chronological replay)
 *   - player streaks
 *   - EPB evolution state (only when the parent season still exists)
 *
 * Before this module, deletes left that derived data behind: deleting the
 * "Evo Liga Test" tournament/season (2026-08-13) left 60 phantom all_time
 * Pokemon appearances, 5 orphaned aggregate scopes, and 48 rating mismatches
 * that only a manual §28 audit + repair cleared.
 *
 * Every step is idempotent and re-runnable: if a rebuild fails midway, the
 * §28 season audit (`npm run audit:seasons`) detects the remaining drift and
 * `--repair` completes it. Orphaned scopes cannot recur because the deleted
 * entity's scopes are explicitly cleared here.
 *
 * `rebuildAfterSeasonRestore` is the mirror image for a league restored from
 * the trash. The database brings the rows back with their games marked as not
 * yet counted and one pending increment job per game (the aggregate queue's
 * own contract), so the aggregates step only DRAINS that queue (time-boxed; the
 * cron finishes the rest) and never rebuilds a scope globally. Ratings (the
 * settle loop of the test-league rebuild), streaks and the EPB evolution
 * repair run from the restored rows.
 *
 * A failed step throws `EntityDeleteRebuildStepError` naming the step
 * (aggregates, ratings, streaks, evolution) with the step's own error as its
 * `cause`, so the routes report a distinct warning code per cause
 * (`toDeleteRebuildWarning`, `toRestoreRebuildWarning`).
 */

import { clearAggregatesForScope } from '@/lib/supabase/queries/aggregates';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { drainPendingAggregateJobs, rebuildAggregatesForScope } from '@/lib/match/aggregate-rebuild';
import {
  countFailedIncrementJobsForSeason,
  requeueFailedIncrementJobsForSeason,
} from '@/lib/match/aggregate-queue';
import { rebuildRatingsForPlayers } from '@/lib/rating/updateRatings';
import { rebuildRatingsSettled } from '@/lib/rating/test-league-rebuild';
import { recomputeStreaks } from '@/lib/gamification/streaks';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { repairSeasonEvolution } from '@/lib/reconcile/evolution-rebuild';
import { EntityDeleteRebuildStepError, type EntityDeleteRebuildStep } from '@/lib/api/delete-rebuild-warning';

/** Run one rebuild step; a failure is rethrown tagged with the step. */
async function step<T>(name: EntityDeleteRebuildStep, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw new EntityDeleteRebuildStepError(name, err);
  }
}

/** Scope-clearing result as recorded in audit metadata (serializable). */
interface ScopeClear {
  aggregatesDeleted: number;
  playerAggregatesDeleted: number;
}

/** League-scope outcome: rebuilt when the season survives, cleared otherwise. */
interface LeagueScopeOutcome {
  seasonId: string;
  mode: 'rebuilt' | 'cleared';
  gamesProcessed?: number;
  aggregatesDeleted: number;
  playerAggregatesDeleted: number;
}

export interface EntityDeleteRebuildSummary {
  scope: 'tournament' | 'season';
  playerIds: string[];
  ratingsRebuilt: number;
  streaksRebuilt: number;
  /** The tournament's own scope; for a season delete the sum over all of the league's phases (null without phases). */
  tournamentScopeCleared: ScopeClear | null;
  leagueScope: LeagueScopeOutcome | null;
  allTime: ScopeClear & { gamesProcessed: number };
  evolutionRepair: { trackersUpdated: number; eventsRewritten: number; pointsAwarded: number } | null;
}

async function rebuildPlayers(playerIds: string[]): Promise<Pick<EntityDeleteRebuildSummary, 'playerIds' | 'ratingsRebuilt' | 'streaksRebuilt'>> {
  // rebuildRatingsForPlayers is strictly sequential (mutual opponents' frozen
  // rating_history rows are read while the player's own rows are rewritten).
  // It may add players to heal history gaps; ratingsRebuilt counts them all.
  let ratingsRebuilt = 0;
  if (playerIds.length > 0) {
    ratingsRebuilt = await step('ratings', async () => (await rebuildRatingsForPlayers(playerIds)).length);
  }
  await step('streaks', async () => {
    for (const playerId of playerIds) {
      await recomputeStreaks(playerId);
    }
  });
  return { playerIds, ratingsRebuilt, streaksRebuilt: playerIds.length };
}

async function maybeRepairEvolution(seasonId: string): Promise<EntityDeleteRebuildSummary['evolutionRepair']> {
  return step('evolution', async () => {
    const season = await getSeasonById(seasonId);
    if (!season || !isEvolutionPointBuy(season.format_type)) return null;
    const repair = await repairSeasonEvolution(seasonId);
    return {
      trackersUpdated: repair.trackersUpdated,
      eventsRewritten: repair.eventsRewritten,
      pointsAwarded: repair.evolutionPoints.points_awarded,
    };
  });
}

/**
 * Rebuild derived data after a tournament hard-delete. Call AFTER the delete
 * committed; `playerIds` must be the tournament's participants captured
 * BEFORE the delete (the cascade removes the participant rows).
 */
export async function rebuildAfterTournamentDelete(input: {
  tournamentId: string;
  /** Parent season id, null for standalone tournaments. */
  seasonId: string | null;
  playerIds: string[];
}): Promise<EntityDeleteRebuildSummary> {
  const { tournamentId, seasonId, playerIds } = input;

  const { tournamentScopeCleared, leagueScope, allTime } = await step('aggregates', async () => {
    // 1. The tournament's own aggregate scope is now orphaned — clear it.
    const tournamentScopeCleared = await clearAggregatesForScope('tournament', tournamentId);

    // 2. League scope: rebuild when the season survives (its remaining
    //    tournaments still feed it); clear when the season is gone too
    //    (concurrent delete) so no orphan rows remain.
    let leagueScope: LeagueScopeOutcome | null = null;
    if (seasonId) {
      const season = await getSeasonById(seasonId);
      if (season) {
        const rebuilt = await rebuildAggregatesForScope('league', seasonId);
        leagueScope = {
          seasonId,
          mode: 'rebuilt',
          gamesProcessed: rebuilt.gamesProcessed,
          aggregatesDeleted: rebuilt.aggregatesDeleted,
          playerAggregatesDeleted: rebuilt.playerAggregatesDeleted,
        };
      } else {
        const cleared = await clearAggregatesForScope('league', seasonId);
        leagueScope = {
          seasonId,
          mode: 'cleared',
          aggregatesDeleted: cleared.aggregatesDeleted,
          playerAggregatesDeleted: cleared.playerAggregatesDeleted,
        };
      }
    }

    // 3. all_time always spans every scope, so it is rebuilt globally (the
    //    rebuild skips games frozen with exclude_all_time).
    const allTime = await rebuildAggregatesForScope('all_time', null);
    return { tournamentScopeCleared, leagueScope, allTime };
  });

  // 4. Ratings + streaks for the deleted tournament's participants.
  const players = await rebuildPlayers(playerIds);

  // 5. EPB evolution state of the surviving season (match-derived kills and
  //    stage transitions of the deleted matches must not survive).
  const evolutionRepair = seasonId ? await maybeRepairEvolution(seasonId) : null;

  return {
    scope: 'tournament',
    ...players,
    tournamentScopeCleared,
    leagueScope,
    allTime: {
      gamesProcessed: allTime.gamesProcessed,
      aggregatesDeleted: allTime.aggregatesDeleted,
      playerAggregatesDeleted: allTime.playerAggregatesDeleted,
    },
    evolutionRepair,
  };
}

/**
 * Rebuild derived data after a league was deleted (moved to the trash). Call
 * AFTER the delete committed; `playerIds` and `phaseIds` come from the delete
 * itself (the participants and phases the league had). The database already
 * removed the league's and the phases' aggregate scope rows with the league;
 * clearing them again here is idempotent and keeps a re-run (the pending
 * rebuild) self-contained. Evolution state is gone with the league and needs
 * no repair.
 */
export async function rebuildAfterSeasonDelete(input: {
  seasonId: string;
  playerIds: string[];
  /** The league's phases (tournaments): each phase's own aggregate scope is cleared. */
  phaseIds: string[];
}): Promise<EntityDeleteRebuildSummary> {
  const { seasonId, playerIds, phaseIds } = input;

  const { phaseScopes, cleared, allTime } = await step('aggregates', async () => {
    // 1. The phases' tournament scopes and the league scope are orphaned —
    //    clear them (no rebuild: nothing feeds the scopes anymore).
    const phaseScopes: ScopeClear = { aggregatesDeleted: 0, playerAggregatesDeleted: 0 };
    for (const phaseId of phaseIds) {
      const phaseCleared = await clearAggregatesForScope('tournament', phaseId);
      phaseScopes.aggregatesDeleted += phaseCleared.aggregatesDeleted;
      phaseScopes.playerAggregatesDeleted += phaseCleared.playerAggregatesDeleted;
    }
    const cleared = await clearAggregatesForScope('league', seasonId);

    // 2. all_time spans every scope — rebuild globally.
    const allTime = await rebuildAggregatesForScope('all_time', null);
    return { phaseScopes, cleared, allTime };
  });

  // 3. Ratings + streaks for the deleted season's participants.
  const players = await rebuildPlayers(playerIds);

  return {
    scope: 'season',
    ...players,
    tournamentScopeCleared: phaseIds.length > 0 ? phaseScopes : null,
    leagueScope: {
      seasonId,
      mode: 'cleared',
      aggregatesDeleted: cleared.aggregatesDeleted,
      playerAggregatesDeleted: cleared.playerAggregatesDeleted,
    },
    allTime: {
      gamesProcessed: allTime.gamesProcessed,
      aggregatesDeleted: allTime.aggregatesDeleted,
      playerAggregatesDeleted: allTime.playerAggregatesDeleted,
    },
    evolutionRepair: null,
  };
}

/** Wall-clock budget of the aggregate queue drain inside the restore rebuild; the cron finishes what remains. */
export const RESTORE_AGGREGATE_DRAIN_BUDGET_MS = 90_000;

/** Jobs per drain round of the restore rebuild. */
const RESTORE_AGGREGATE_BATCH_SIZE = 50;

export interface EntityRestoreRebuildSummary {
  scope: 'season_restore';
  playerIds: string[];
  /**
   * The aggregate queue drain: failed jobs of the league re-queued before it, jobs applied and failed attempts this
   * run, how many are still queued for the cron, and how many of the league's jobs ended failed for good.
   */
  aggregateJobs: { requeued: number; processed: number; failed: number; remaining: number; failedForGood: number };
  ratingsRebuilt: number;
  ratingPasses: number;
  /** False when the settle loop hit its pass cap while a pass still changed ratings. */
  ratingsSettled: boolean;
  streaksRebuilt: number;
  evolutionRepair: { trackersUpdated: number; eventsRewritten: number; pointsAwarded: number } | null;
}

/**
 * Rebuild derived data after a league was restored from the trash. Call AFTER
 * the restore committed; `playerIds` come from the restore itself. Each step is
 * idempotent, so the pending rebuild can run it again after a failure:
 *   1. aggregates: re-queue the league's increment jobs that failed for good
 *      (a run before this one), drain the aggregate queue (the restore queued
 *      one increment job per game with stats) and count the league's jobs that
 *      failed for good again. League, tournament and all_time scopes are
 *      counted by the queue's own atomic apply, never rebuilt globally here.
 *   2. ratings: the settle loop of the test-league rebuild over the players.
 *   3. streaks: `recomputeStreaks` per player (the restored matches' streak
 *      pointers were not re-linked).
 *   4. evolution: the EPB repair of the restored season.
 */
export async function rebuildAfterSeasonRestore(input: {
  seasonId: string;
  playerIds: string[];
}): Promise<EntityRestoreRebuildSummary> {
  const { seasonId, playerIds } = input;

  const { requeued, drained, failedForGood } = await step('aggregates', async () => {
    const requeued = await requeueFailedIncrementJobsForSeason(seasonId);
    const drained = await drainPendingAggregateJobs({
      batchSize: RESTORE_AGGREGATE_BATCH_SIZE,
      deadline: Date.now() + RESTORE_AGGREGATE_DRAIN_BUDGET_MS,
    });
    return { requeued, drained, failedForGood: await countFailedIncrementJobsForSeason(seasonId) };
  });

  const ratings = await step('ratings', () => rebuildRatingsSettled(playerIds));

  await step('streaks', async () => {
    for (const playerId of playerIds) {
      await recomputeStreaks(playerId);
    }
  });

  const evolutionRepair = await maybeRepairEvolution(seasonId);

  return {
    scope: 'season_restore',
    playerIds,
    aggregateJobs: {
      requeued,
      processed: drained.processed,
      failed: drained.failed,
      remaining: drained.statsAfter.pending + drained.statsAfter.processing,
      failedForGood,
    },
    ratingsRebuilt: ratings.rebuiltPlayerIds.length,
    ratingPasses: ratings.passes,
    ratingsSettled: ratings.settled,
    streaksRebuilt: playerIds.length,
    evolutionRepair,
  };
}
