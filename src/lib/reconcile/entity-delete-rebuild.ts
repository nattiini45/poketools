/**
 * Derived-data rebuild after entity deletion (EPB spec §18 "leave the league
 * as if that match had never been imported" + §22 reconcile intent).
 *
 * Hard-deleting a tournament or season cascades away the raw rows
 * (matches → games → battle_stats), but the data DERIVED from those rows is
 * not cascade-deleted and must be rebuilt from what remains:
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
 * A failed step throws `EntityDeleteRebuildStepError` naming the step
 * (aggregates, ratings, streaks, evolution) with the step's own error as its
 * `cause`, so the DELETE routes report a distinct warning code per cause
 * (`toDeleteRebuildWarning`).
 */

import { clearAggregatesForScope } from '@/lib/supabase/queries/aggregates';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { rebuildAggregatesForScope } from '@/lib/match/aggregate-rebuild';
import { rebuildRatingsForPlayers } from '@/lib/rating/updateRatings';
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
 * Rebuild derived data after a season hard-delete. Call AFTER the delete
 * committed; `playerIds` must be the season's participants captured BEFORE
 * the delete. The season FK is ON DELETE NO ACTION, so a season can only be
 * deleted once it has no tournaments left — no tournament scopes to clear.
 * Evolution state cascades with the season row and needs no repair.
 */
export async function rebuildAfterSeasonDelete(input: {
  seasonId: string;
  playerIds: string[];
}): Promise<EntityDeleteRebuildSummary> {
  const { seasonId, playerIds } = input;

  const { cleared, allTime } = await step('aggregates', async () => {
    // 1. The season's league-scope aggregates are now orphaned — clear them
    //    (no rebuild: nothing feeds the scope anymore).
    const cleared = await clearAggregatesForScope('league', seasonId);

    // 2. all_time spans every scope — rebuild globally.
    const allTime = await rebuildAggregatesForScope('all_time', null);
    return { cleared, allTime };
  });

  // 3. Ratings + streaks for the deleted season's participants.
  const players = await rebuildPlayers(playerIds);

  return {
    scope: 'season',
    ...players,
    tournamentScopeCleared: null,
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
