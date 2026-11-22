/**
 * Streaks-only reconciliation (`scope: 'streaks'` on POST /api/admin/reconcile).
 *
 * `recomputeStreaks` is the cheapest of the four derived-data rebuilds and the
 * only one routinely needed alone — a streak row is derived from a player's
 * whole completed history, so a parser or fixpoint change can make every row
 * stale without touching a rating curve or an aggregate. The season/all
 * scopes rebuild ratings and aggregates with it, so this scope exists: dry
 * run diffs each player's stored `player_streaks` row against the replay;
 * repair calls `recomputeStreaks` (one fenced write) per player and nothing
 * else.
 *
 * Player set: with `seasonId`, the season roster plus the players of the
 * season's completed matches (EPB seasons union the tracker players, the same
 * set the season reconcile covers); without one, the union of that set over
 * every season — "every player" for the global repair.
 */

import { getSeasonById, getSeasonParticipants, listAllSeasonIds } from '@/lib/supabase/queries/seasons';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import {
  getCompletedMatchesForRatingReplay,
  listSeasonCompletedMatchPlayerIds,
  loadRatingScope,
} from '@/lib/supabase/queries/ratings';
import {
  getPlayerStatTotalsByMatch,
  getPlayerStreaks,
  type PlayerMatchStatTotals,
} from '@/lib/supabase/queries/streaks';
import {
  computeStreaksFromHistory,
  recomputeStreaks,
  type StreakCounters,
  type StreakStoragePort,
} from '@/lib/gamification/streaks';
import type { StreakChanges } from '@/types/streak';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
/** Counter fields the dry run compares between stored and replayed state. */
const STREAK_DIFF_FIELDS = [
  'current_win_streak',
  'best_win_streak',
  'current_loss_streak',
  'best_loss_streak',
  'current_ko_streak',
  'best_ko_streak',
  'current_flawless_streak',
  'best_flawless_streak',
  'last_match_id',
] as const;

export type StreakDiffField = (typeof STREAK_DIFF_FIELDS)[number];

export interface StreakPlayerReport {
  playerId: string;
  /** 'stale' when the stored row differs from the replay (or is missing/wrong); 'current' when it agrees. */
  status: 'stale' | 'current';
  /** The fields whose stored and computed values differ. Empty when current. */
  mismatchedFields: StreakDiffField[];
}

export interface StreaksReconcileReport {
  seasonId: string | null;
  dryRun: boolean;
  checked: number;
  players: StreakPlayerReport[];
  /** Present only when repair ran. */
  rebuilt?: { players: number };
  summary: { stale: number; repaired: boolean };
}

export interface StreaksReconcileStorage {
  getSeasonById: typeof getSeasonById;
  getSeasonParticipants: typeof getSeasonParticipants;
  getSeasonTrackers: typeof getSeasonTrackers;
  listAllSeasonIds: typeof listAllSeasonIds;
  listSeasonCompletedMatchPlayerIds: typeof listSeasonCompletedMatchPlayerIds;
  loadScope: StreakStoragePort['loadScope'];
  getCompletedMatches: StreakStoragePort['getCompletedMatches'];
  getPlayerStreaks: StreakStoragePort['getPlayerStreaks'];
  getStatTotals: (playerId: string, matchIds: readonly string[]) => Promise<Map<string, PlayerMatchStatTotals>>;
  recomputeStreaks: (playerId: string) => Promise<StreakChanges>;
}

function countersDiffer(
  stored: StreakCounters,
  computed: StreakCounters
): StreakDiffField[] {
  const fields: StreakDiffField[] = [];
  for (const field of STREAK_DIFF_FIELDS) {
    const s = stored[field] ?? null;
    const c = computed[field] ?? null;
    if (s !== c) fields.push(field);
  }
  return fields;
}

/** Read the stored row as counters, with the absent-row shape matching `countersOf`. */
function storedCounters(row: Awaited<ReturnType<typeof getPlayerStreaks>>): StreakCounters {
  if (!row) {
    return {
      current_win_streak: 0,
      best_win_streak: 0,
      current_loss_streak: 0,
      best_loss_streak: 0,
      current_ko_streak: 0,
      best_ko_streak: 0,
      current_flawless_streak: 0,
      best_flawless_streak: 0,
      last_match_id: null,
    };
  }
  return {
    current_win_streak: row.current_win_streak,
    best_win_streak: row.best_win_streak,
    current_loss_streak: row.current_loss_streak,
    best_loss_streak: row.best_loss_streak,
    current_ko_streak: row.current_ko_streak,
    best_ko_streak: row.best_ko_streak,
    current_flawless_streak: row.current_flawless_streak,
    best_flawless_streak: row.best_flawless_streak,
    last_match_id: row.last_match_id,
  };
}

export function createStreaksReconciler(storage: StreaksReconcileStorage) {
  async function seasonPlayerIds(seasonId: string): Promise<string[]> {
    const playerIds: string[] = [];
    const seen = new Set<string>();
    for (const p of await storage.getSeasonParticipants(seasonId)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      playerIds.push(p.id);
    }
    for (const id of await storage.listSeasonCompletedMatchPlayerIds(seasonId)) {
      if (seen.has(id)) continue;
      seen.add(id);
      playerIds.push(id);
    }
    return playerIds;
  }

  async function resolvePlayerIds(seasonId: string | null): Promise<string[]> {
    if (seasonId !== null) {
      const season = await storage.getSeasonById(seasonId);
      if (!season) {
        const err = new Error(`reconcileStreaks: season ${seasonId} not found`);
        console.error(err);
        throw err;
      }
      const ids = await seasonPlayerIds(seasonId);
      if (isEvolutionPointBuy(season.format_type)) {
        const seen = new Set(ids);
        for (const t of await storage.getSeasonTrackers(seasonId)) {
          if (seen.has(t.player_id)) continue;
          seen.add(t.player_id);
          ids.push(t.player_id);
        }
      }
      return ids;
    }

    // Every player = the union of each season's player set. Streaks are
    // player-global, so a player in two seasons is diffed/repaired once.
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const sid of await storage.listAllSeasonIds()) {
      const season = await storage.getSeasonById(sid);
      if (!season) continue;
      for (const id of await seasonPlayerIds(sid)) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
      if (isEvolutionPointBuy(season.format_type)) {
        for (const t of await storage.getSeasonTrackers(sid)) {
          if (seen.has(t.player_id)) continue;
          seen.add(t.player_id);
          ids.push(t.player_id);
        }
      }
    }
    return ids;
  }

  /**
   * Diff (dry run) or repair streak rows for the resolved player set. The dry
   * run performs the same reads `recomputeStreaksWithStorage` makes and writes
   * nothing; repair calls `recomputeStreaks` — its fenced replace re-reads and
   * refuses on a concurrent finalize — per player, strictly sequentially.
   */
  async function reconcileStreaks(opts: {
    seasonId?: string;
    repair?: boolean;
  }): Promise<StreaksReconcileReport> {
    const dryRun = opts.repair !== true;
    const seasonId = opts.seasonId ?? null;
    const playerIds = await resolvePlayerIds(seasonId);
    const scope = await storage.loadScope();

    const players: StreakPlayerReport[] = [];
    let stale = 0;
    for (const playerId of playerIds) {
      if (dryRun) {
        const [history, stored] = await Promise.all([
          storage.getCompletedMatches(playerId),
          storage.getPlayerStreaks(playerId),
        ]);
        const statTotals = await storage.getStatTotals(
          playerId,
          history.map((m) => m.id)
        );
        const computed = computeStreaksFromHistory(playerId, history, statTotals, scope);
        const fields = countersDiffer(storedCounters(stored), computed);
        if (fields.length > 0) stale += 1;
        players.push({
          playerId,
          status: fields.length > 0 ? 'stale' : 'current',
          mismatchedFields: fields,
        });
      } else {
        const changes = await storage.recomputeStreaks(playerId);
        const changed =
          changes.new_records.length > 0 ||
          changes.win_streak.before !== changes.win_streak.after ||
          changes.loss_streak.before !== changes.loss_streak.after ||
          changes.ko_streak.before !== changes.ko_streak.after ||
          changes.flawless_streak.before !== changes.flawless_streak.after;
        if (changed) stale += 1;
        players.push({
          playerId,
          status: changed ? 'stale' : 'current',
          mismatchedFields: [],
        });
      }
    }

    return {
      seasonId,
      dryRun,
      checked: playerIds.length,
      players,
      ...(dryRun ? {} : { rebuilt: { players: playerIds.length } }),
      summary: { stale, repaired: !dryRun },
    };
  }

  return { reconcileStreaks };
}

const defaultReconciler = createStreaksReconciler({
  getSeasonById,
  getSeasonParticipants,
  getSeasonTrackers,
  listAllSeasonIds,
  listSeasonCompletedMatchPlayerIds,
  loadScope: loadRatingScope,
  getCompletedMatches: getCompletedMatchesForRatingReplay,
  getPlayerStreaks,
  getStatTotals: (id, ids) => getPlayerStatTotalsByMatch(id, ids),
  recomputeStreaks,
});

export const { reconcileStreaks } = defaultReconciler;
