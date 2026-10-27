/**
 * What the league routes do around the recycle bin's database functions. Server only.
 *
 * - `trashLeague` moves a league to the trash and settles a request deadline: the delete is one transaction behind one
 *   PostgREST call, so a `LEAGUE_TRASH_TIMEOUT` may still have committed. It then reads the trash back (by the season
 *   id) and carries on as a success when the entry exists, so the caller still runs the derived-data rebuild.
 * - `restoreLeague` brings a league back from the trash and settles a request deadline the same way: after a
 *   `LEAGUE_TRASH_TIMEOUT` it looks for the restore's rebuild tombstone (written in the restore's own transaction) and
 *   carries on as a success when it exists. The restore's details (paused drafts, warnings, counts) are lost then.
 * - `finishLeagueDeleteRebuild` / `finishLeagueRestoreRebuild` run the derived-data rebuild that follows a committed
 *   delete or restore and confirm it to the database (`markLeagueTrashRebuildDone` /
 *   `markLeagueRestoreRebuildDone`), which is what lets the expiry purge an entry. A rebuild that fails, or a restore
 *   whose ratings did not settle or whose aggregate jobs failed for good, stays UNconfirmed and comes back as a typed warning; the superadmin runs it again
 *   from the trash page (`getPendingLeagueRebuild`). The delete committed either way, so none of this throws.
 *
 * Cache expiry is NOT here: the write-route-tags rule wants the route handler itself to call the expiry helpers.
 */
import 'server-only';

import {
  rebuildAfterSeasonDelete,
  rebuildAfterSeasonRestore,
  type EntityDeleteRebuildSummary,
  type EntityRestoreRebuildSummary,
} from '@/lib/reconcile/entity-delete-rebuild';
import {
  restoreRebuildAggregateJobsFailedWarning,
  restoreRebuildUnsettledWarning,
  toDeleteRebuildWarning,
  toRestoreRebuildWarning,
  type DeleteRebuildWarning,
} from '@/lib/api/delete-rebuild-warning';
import {
  getLeagueTrashBySeason,
  getPendingLeagueRebuild,
  markLeagueRestoreRebuildDone,
  markLeagueTrashRebuildDone,
  moveLeagueToTrash,
  restoreLeagueFromTrash,
  type LeagueTrashCounts,
  type LeagueTrashRestoreResult,
} from '@/lib/supabase/queries/league-trash';
import { toLeagueTrashDbError, type LeagueTrashDbError } from './db-error';

/** A league that sits in the trash, as the routes need it after the delete. */
export interface TrashedLeague {
  trash_id: string;
  season_name: string;
  purge_after: string;
  /** The league's phases and every player it touched: the inputs of the rebuild. */
  phase_ids: string[];
  player_ids: string[];
  /** Row counts per captured table; empty when the delete was settled after a request deadline. */
  counts: LeagueTrashCounts;
  /** Running queue drafts the delete paused; null when the delete was settled after a request deadline. */
  frozen_pools: number | null;
}

/**
 * Moves a league to the trash. Throws the typed `LeagueTrashDbError` for a database refusal (no league, busy,
 * inventory out of date, ...), and for a deadline that did not commit.
 */
export async function trashLeague(seasonId: string, actorId: string): Promise<TrashedLeague> {
  try {
    const moved = await moveLeagueToTrash(seasonId, actorId);
    return {
      trash_id: moved.trash_id,
      season_name: moved.season_name,
      purge_after: moved.purge_after,
      phase_ids: moved.phase_ids,
      player_ids: moved.player_ids,
      counts: moved.counts,
      frozen_pools: moved.frozen_pools,
    };
  } catch (err) {
    const dbError = toLeagueTrashDbError(err);
    if (dbError?.code !== 'LEAGUE_TRASH_TIMEOUT') throw err;
    return settleTimedOutDelete(seasonId, dbError);
  }
}

/**
 * The settle read after a lost answer. A read that fails leaves the outcome unknown, so the caller keeps the timeout
 * (504, "the result is unknown, reload") instead of reporting an action that may have committed as a plain failure.
 */
async function settleRead<T>(what: string, read: () => Promise<T>, timeout: LeagueTrashDbError): Promise<T> {
  try {
    return await read();
  } catch (readError) {
    console.error(`[league-trash] ${what} settle read failed; the result stays unknown`, readError);
    throw timeout;
  }
}

/** A delete whose answer was lost: committed when the league's trash entry exists, otherwise it did not happen. */
async function settleTimedOutDelete(seasonId: string, timeout: LeagueTrashDbError): Promise<TrashedLeague> {
  const entry = await settleRead('delete', () => getLeagueTrashBySeason(seasonId), timeout);
  if (!entry) throw timeout;
  return {
    trash_id: entry.id,
    season_name: entry.season_name,
    purge_after: entry.purge_after,
    phase_ids: entry.phase_ids,
    player_ids: entry.player_ids,
    counts: {},
    frozen_pools: null,
  };
}

/**
 * A league back from the trash, as the restore route needs it. The detail fields are null when the restore was settled
 * after a request deadline: it committed, but its answer (and with it those details) was lost.
 */
export interface RestoredLeague
  extends Omit<LeagueTrashRestoreResult, 'shift_seconds' | 'paused_pools' | 'queued_aggregate_jobs'> {
  shift_seconds: number | null;
  paused_pools: number | null;
  queued_aggregate_jobs: number | null;
  /** True when the answer was lost to a request deadline and the restore was confirmed by its tombstone. */
  settled_after_timeout: boolean;
}

/**
 * Restores a league from the trash. Throws the typed `LeagueTrashDbError` for a database refusal (not in the trash,
 * busy, rebuild pending, ...), and for a deadline that did not commit.
 */
export async function restoreLeague(trashId: string): Promise<RestoredLeague> {
  try {
    return { ...(await restoreLeagueFromTrash(trashId)), settled_after_timeout: false };
  } catch (err) {
    const dbError = toLeagueTrashDbError(err);
    if (dbError?.code !== 'LEAGUE_TRASH_TIMEOUT') throw err;
    return settleTimedOutRestore(trashId, dbError);
  }
}

/** A restore whose answer was lost: committed when its rebuild tombstone (keyed by this trash id) exists. */
async function settleTimedOutRestore(trashId: string, timeout: LeagueTrashDbError): Promise<RestoredLeague> {
  const pending = await settleRead('restore', () => getPendingLeagueRebuild(trashId), timeout);
  if (pending?.kind !== 'restore') throw timeout;
  console.error(`league restore of trash ${trashId} answered after the request deadline; settled by its tombstone`);
  return {
    season_id: pending.season_id,
    season_name: pending.season_name,
    restored: {},
    shift_seconds: null,
    player_ids: pending.player_ids,
    phase_ids: pending.phase_ids,
    paused_pools: null,
    queued_aggregate_jobs: null,
    schema_version_at_delete: null,
    warnings: [],
    settled_after_timeout: true,
  };
}

export interface DeleteRebuildOutcome {
  summary: EntityDeleteRebuildSummary | null;
  warning: DeleteRebuildWarning | null;
}

/** Rebuilds the derived data of a deleted league and confirms it. A failure is a warning, never a throw. */
export async function finishLeagueDeleteRebuild(input: {
  trashId: string;
  seasonId: string;
  playerIds: string[];
  phaseIds: string[];
}): Promise<DeleteRebuildOutcome> {
  try {
    const summary = await rebuildAfterSeasonDelete({
      seasonId: input.seasonId,
      playerIds: input.playerIds,
      phaseIds: input.phaseIds,
    });
    await markLeagueTrashRebuildDone(input.trashId);
    return { summary, warning: null };
  } catch (err) {
    console.error('league delete derived-data rebuild failed:', err);
    return { summary: null, warning: toDeleteRebuildWarning(err) };
  }
}

export interface RestoreRebuildOutcome {
  summary: EntityRestoreRebuildSummary | null;
  warning: DeleteRebuildWarning | null;
}

/**
 * Rebuilds the derived data of a restored league and confirms it. Aggregate jobs of the league that failed for good, and
 * ratings that did not settle, are a warning and leave the rebuild pending (running it again re-queues those jobs and
 * continues the settle loop). Jobs still queued are the cron's and do not hold the confirmation back. A failure is a
 * warning, never a throw.
 */
export async function finishLeagueRestoreRebuild(input: {
  seasonId: string;
  playerIds: string[];
}): Promise<RestoreRebuildOutcome> {
  try {
    const summary = await rebuildAfterSeasonRestore({ seasonId: input.seasonId, playerIds: input.playerIds });
    if (summary.aggregateJobs.failedForGood > 0) {
      return { summary, warning: restoreRebuildAggregateJobsFailedWarning(summary.aggregateJobs.failedForGood) };
    }
    if (!summary.ratingsSettled) return { summary, warning: restoreRebuildUnsettledWarning() };
    await markLeagueRestoreRebuildDone(input.seasonId);
    return { summary, warning: null };
  } catch (err) {
    console.error('league restore derived-data rebuild failed:', err);
    return { summary: null, warning: toRestoreRebuildWarning(err) };
  }
}
