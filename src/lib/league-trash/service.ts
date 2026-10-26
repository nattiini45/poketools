/**
 * What the league routes do around the recycle bin's database functions. Server only.
 *
 * - `trashLeague` moves a league to the trash and settles a request deadline: the delete is one transaction behind one
 *   PostgREST call, so a `LEAGUE_TRASH_TIMEOUT` may still have committed. It then reads the trash back (by the season
 *   id) and carries on as a success when the entry exists, so the caller still runs the derived-data rebuild.
 * - `finishLeagueDeleteRebuild` / `finishLeagueRestoreRebuild` run the derived-data rebuild that follows a committed
 *   delete or restore and confirm it to the database (`markLeagueTrashRebuildDone` /
 *   `markLeagueRestoreRebuildDone`), which is what lets the expiry purge an entry. A rebuild that fails, or a restore
 *   whose ratings did not settle, stays UNconfirmed and comes back as a typed warning; the superadmin runs it again
 *   from the trash page (`findPendingLeagueRebuild`). The delete committed either way, so none of this throws.
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
  restoreRebuildUnsettledWarning,
  toDeleteRebuildWarning,
  toRestoreRebuildWarning,
  type DeleteRebuildWarning,
} from '@/lib/api/delete-rebuild-warning';
import {
  getLeagueTrashBySeason,
  listPendingLeagueRebuilds,
  markLeagueRestoreRebuildDone,
  markLeagueTrashRebuildDone,
  moveLeagueToTrash,
  type LeagueTrashCounts,
  type PendingLeagueRebuild,
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

/** The pending rebuild of a trash entry (delete) or a restored league (restore), by trash id. */
export async function findPendingLeagueRebuild(trashId: string): Promise<PendingLeagueRebuild | null> {
  const pending = await listPendingLeagueRebuilds();
  return pending.find((rebuild) => rebuild.trash_id === trashId) ?? null;
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

/** A delete whose answer was lost: committed when the league's trash entry exists, otherwise it did not happen. */
async function settleTimedOutDelete(seasonId: string, timeout: LeagueTrashDbError): Promise<TrashedLeague> {
  const entry = await getLeagueTrashBySeason(seasonId);
  if (!entry) throw timeout;
  // The delete left its rebuild marker, which carries the league's name and the rebuild inputs.
  const pending = await findPendingLeagueRebuild(entry.id);
  return {
    trash_id: entry.id,
    season_name: pending?.season_name ?? seasonId,
    purge_after: entry.purge_after,
    phase_ids: pending?.phase_ids ?? [],
    player_ids: pending?.player_ids ?? [],
    counts: {},
    frozen_pools: null,
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
 * Rebuilds the derived data of a restored league and confirms it. Ratings that did not settle are a warning and leave
 * the rebuild pending (running it again continues the settle loop). A failure is a warning, never a throw.
 */
export async function finishLeagueRestoreRebuild(input: {
  seasonId: string;
  playerIds: string[];
}): Promise<RestoreRebuildOutcome> {
  try {
    const summary = await rebuildAfterSeasonRestore({ seasonId: input.seasonId, playerIds: input.playerIds });
    if (!summary.ratingsSettled) return { summary, warning: restoreRebuildUnsettledWarning() };
    await markLeagueRestoreRebuildDone(input.seasonId);
    return { summary, warning: null };
  } catch (err) {
    console.error('league restore derived-data rebuild failed:', err);
    return { summary: null, warning: toRestoreRebuildWarning(err) };
  }
}
