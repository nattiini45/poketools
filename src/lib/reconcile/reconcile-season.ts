/**
 * Season derived-data reconciliation orchestrator (spec §22, Task T6).
 *
 * A reusable service that, for a season, LOADS its non-deleted matches + roster
 * + non-match sources, REBUILDS the derived values via the existing engines,
 * COMPARES them to the stored values, REPORTS mismatches, and optionally
 * REPAIRS. Dry-run by default; repair only when `opts.repair === true`.
 *
 * It orchestrates — it does NOT reimplement — the four derived-data engines:
 *   - EPB evolution rebuild (T3, `evolution-rebuild.ts`)
 *   - Rating curve rebuild  (T4, `updateRatings.ts`)
 *   - Aggregate rebuild     (`aggregate-rebuild.ts`)
 *   - Streak recompute       (`streaks.ts`)
 *
 * NON-TRANSACTIONAL: the orchestrator is NOT itself transactional across
 * EPB + ratings + aggregates + streaks. Each rebuilder manages its own writes
 * (sequential best-effort within each, consistent with the existing match
 * pipeline). In repair mode the rebuilders run sequentially; a mid-sequence
 * failure leaves the later rebuilders unrun. Callers may re-run reconcile,
 * which is idempotent — each rebuilder recomputes its derived values from the
 * authoritative sources (matches, battle_stats, non-match grants), so a partial
 * repair run completes the remaining work on the next pass.
 *
 * Aggregates scope note (spec §22): this orchestrator rebuilds the season's
 * `league`-scoped aggregates only. `all_time` aggregates are a separate global
 * operation owned by the existing aggregates admin tool — they are NOT rebuilt
 * per-season here (the all_time rebuild is global and heavy). The report's
 * `aggregates` section never carries a pre-diff (`checked = false`): there is
 * no cheap way to diff stored vs computed aggregates without doing the full
 * rebuild, so aggregates are repair-only and surfaced via rebuilt counts.
 */

import {
  computeSeasonEvolutionState,
  diffEvolutionState,
  repairSeasonEvolution,
  type EvolutionMismatch,
  type ImpossibleLineup,
} from '@/lib/reconcile/evolution-rebuild';
import {
  loadAndComputeRatingCurve,
  planRatingRebuild,
  rebuildRatingsForPlayers,
  RatingHistoryIntegrityError,
  RatingRebuildPlanTooLargeError,
  type ComputedRatingCurve,
  type RatingHistoryGap,
} from '@/lib/rating/updateRatings';
import { rebuildAggregatesForScope } from '@/lib/match/aggregate-rebuild';
import { recomputeStreaks } from '@/lib/gamification/streaks';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import {
  getSeasonById,
  getSeasonParticipants,
  listAllSeasonIds,
} from '@/lib/supabase/queries/seasons';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { listSeasonCompletedMatchPlayerIds } from '@/lib/supabase/queries/ratings';
import type { SeasonFormatType } from '@/types/season';
import type { PlayerRating } from '@/types/rating';

// ── Public types ──────────────────────────────────────────────────

export interface ReconcileOptions {
  /** Dry-run (report only, no writes). Defaults to true. */
  dryRun?: boolean;
  /** When true, writes are performed and dryRun is forced false. */
  repair?: boolean;
}

export interface RatingMismatch {
  playerId: string;
  field: 'rating' | 'rd' | 'volatility' | 'peak_rating' | 'wins' | 'losses' | 'draws';
  /** Stored value (null when the player has no stored row). */
  stored: number | null;
  /** Computed value from the replayed curve. */
  computed: number;
}

/**
 * What the rating replay found in `rating_history` for the season's players
 * (dry run and repair alike), so the dry run shows what a repair will heal
 * or refuse before anything is written.
 */
export interface RatingIntegrityReport {
  /** Matches where a player has a history row and the opponent has none
   * (healed by the repair, which rebuilds the missing side first). Unique by
   * match and player. */
  gaps: RatingHistoryGap[];
  /** Completed matches without any history row (never rated): the repair
   * replays them against the default opponent and rates both players. */
  unratedMatchIds: string[];
  /**
   * Set (dry run only) when the repair would refuse the ratings step: a gap
   * cycle no rebuild order can fill, or a plan that would pull in too many
   * players to heal the gaps. `code`/`params` are the catalogued refusal
   * (`rating_history_incomplete` or `rating_rebuild_plan_too_large`) the
   * repair would answer with 409.
   * Null when the repair can proceed (or in repair mode, where the refusal is
   * the request's own 409).
   */
  repairRefusal: { code: string; error: string; params?: Readonly<Record<string, string | number>> } | null;
}

export interface ReconcileReport {
  seasonId: string;
  dryRun: boolean;
  evolution: {
    checked: boolean;
    mismatches: EvolutionMismatch[];
    impossibleLineups: ImpossibleLineup[];
    repaired?: {
      trackersUpdated: number;
      eventsRewritten: number;
      evolutionPoints: number;
    };
  };
  ratings: {
    checked: boolean;
    mismatches: RatingMismatch[];
    integrity: RatingIntegrityReport;
    repaired?: { players: number };
  };
  aggregates: {
    checked: boolean;
    rebuilt?: { gamesProcessed: number; aggregatesDeleted: number };
  };
  streaks: {
    checked: boolean;
    rebuilt?: { players: number };
  };
  /** Union of player ids with any evolution/ratings mismatch, impossible lineup or rating-history gap. */
  playersAffected: string[];
  summary: { totalMismatches: number; repaired: boolean };
}

// ── Internals ─────────────────────────────────────────────────────

/** Rating fields compared between stored and computed state. */
const RATING_DIFF_FIELDS = [
  'rating',
  'rd',
  'volatility',
  'peak_rating',
  'wins',
  'losses',
  'draws',
] as const satisfies readonly RatingMismatch['field'][];

/** Resolve dryRun: repair forces it false; otherwise default true. */
function resolveDryRun(opts: ReconcileOptions): boolean {
  if (opts.repair === true) return false;
  return opts.dryRun ?? true;
}

/**
 * Resolve the season's player set. The roster (`season_participants`) is the
 * primary source; for EPB seasons the evolution tracker players are unioned in
 * so a tracker whose player dropped from the roster is still ratings-reconciled
 * (their tracker rows still participate in the evolution diff and their matches
 * still feed their rating curve). For every format the players of the league's
 * completed matches are unioned in last (`listSeasonCompletedMatchPlayerIds`,
 * the same set the test-league flag rebuild covers), so a player who played a
 * completed match and then left the roster is still repaired. Order is
 * preserved and ids are unique: roster first, then tracker players, then match
 * players not already present.
 */
async function resolveSeasonPlayers(
  seasonId: string,
  formatType: SeasonFormatType
): Promise<string[]> {
  const participants = await getSeasonParticipants(seasonId);
  const playerIds: string[] = [];
  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    playerIds.push(p.id);
  }

  if (isEvolutionPointBuy(formatType)) {
    const trackers = await getSeasonTrackers(seasonId);
    for (const t of trackers) {
      if (seen.has(t.player_id)) continue;
      seen.add(t.player_id);
      playerIds.push(t.player_id);
    }
  }

  for (const id of await listSeasonCompletedMatchPlayerIds(seasonId)) {
    if (seen.has(id)) continue;
    seen.add(id);
    playerIds.push(id);
  }

  return playerIds;
}

/**
 * Diff the computed rating curve's final state against the stored
 * `player_ratings` row on {rating, rd, volatility, peak_rating, wins, losses,
 * draws}. Returns one mismatch per differing field. A player with no stored row
 * yields mismatches for every field whose computed value differs from the
 * canonical default-zero comparison (stored treated as null per the type).
 */
function diffRatingCurve(
  playerId: string,
  computed: ComputedRatingCurve,
  stored: PlayerRating | null
): RatingMismatch[] {
  const mismatches: RatingMismatch[] = [];
  const c = computed.finalState;
  for (const field of RATING_DIFF_FIELDS) {
    const storedValue = stored ? stored[field] : null;
    const computedValue = c[field];
    // Numeric equality with a small tolerance is unnecessary — the rebuild
    // reproduces the exact arithmetic; compare directly. Null stored vs a
    // computed non-default value is always a mismatch.
    if (storedValue === computedValue) continue;
    if (
      storedValue !== null &&
      typeof storedValue === 'number' &&
      storedValue === computedValue
    ) {
      continue;
    }
    mismatches.push({
      playerId,
      field,
      stored: storedValue,
      computed: computedValue,
    });
  }
  return mismatches;
}

/**
 * Reconcile a single season's derived data: load sources, rebuild, compare to
 * stored, report mismatches, and optionally repair.
 *
 *   1. Resolve the season's format_type + player set.
 *   2. EPB evolution (only for evolution_point_buy seasons): compute + diff
 *      always (even in repair mode, to report what was found); repair writes
 *      when `!dryRun`. Non-EPB seasons skip evolution (`checked = false`).
 *   3. Ratings: for each season player, load+compute the curve and diff the
 *      final state against the stored row; repair rewrites all season players.
 *   4. Aggregates: repair-only (no cheap pre-diff); rebuilds the `league`
 *      scope. `all_time` is a separate global operation, NOT rebuilt here.
 *   5. Streaks: repair-only; recomputed for each season player.
 *   6. Aggregate playersAffected + summary.
 */
export async function reconcileSeasonDerivedData(
  seasonId: string,
  opts: ReconcileOptions = {}
): Promise<ReconcileReport> {
  const dryRun = resolveDryRun(opts);

  const season = await getSeasonById(seasonId);
  if (!season) {
    // Distinct, logged cause — a missing season is an operator error, not a
    // silent skip. Throw so the caller (admin tool / all-seasons loop) can
    // surface it rather than producing a misleading empty report.
    const err = new Error(`reconcileSeasonDerivedData: season ${seasonId} not found`);
    console.error(err);
    throw err;
  }
  const formatType = season.format_type;

  const playerIds = await resolveSeasonPlayers(seasonId, formatType);
  const epb = isEvolutionPointBuy(formatType);

  const affectedPlayers = new Set<string>();

  // Rating preflight BEFORE the first write of a repair: the evolution repair
  // below writes before the rating rebuild runs, so a rating refusal there
  // would leave the season half-repaired. The plan heals history gaps by
  // ordering (and adding) players; only a gap cycle no order can fill is
  // refused here (RatingHistoryIntegrityError, 409), as is a plan past the
  // player cap (RatingRebuildPlanTooLargeError, 409), with nothing written.
  if (!dryRun && playerIds.length > 0) {
    await planRatingRebuild(playerIds);
  }

  // ── EPB evolution ──────────────────────────────────────────────────
  let evolutionMismatches: EvolutionMismatch[] = [];
  let impossibleLineups: ImpossibleLineup[] = [];
  let evolutionRepaired: { trackersUpdated: number; eventsRewritten: number; evolutionPoints: number } | undefined;
  if (epb) {
    // Always compute + diff, even in repair mode, so the report describes what
    // was found before the repair rewrote the rows.
    const computed = await computeSeasonEvolutionState(seasonId);
    evolutionMismatches = await diffEvolutionState(seasonId, computed);
    impossibleLineups = computed.impossibleLineups;

    for (const m of evolutionMismatches) {
      // Mismatches carry trackerId; resolve to the tracker's player_id lazily by
      // matching computed trackers. The tracker id → player_id map is built from
      // the computed state (already loaded).
      const tracker = computed.computedTrackers.find((t) => t.id === m.trackerId);
      if (tracker) affectedPlayers.add(tracker.player_id);
    }
    for (const imp of impossibleLineups) {
      affectedPlayers.add(imp.playerId);
    }

    if (!dryRun) {
      const repairResult = await repairSeasonEvolution(seasonId);
      evolutionRepaired = {
        trackersUpdated: repairResult.trackersUpdated,
        eventsRewritten: repairResult.eventsRewritten,
        evolutionPoints: repairResult.evolutionPoints.points_awarded,
      };
    }
  }

  // ── Ratings ────────────────────────────────────────────────────────
  // `loadAndComputeRatingCurve` fetches the stored `player_ratings` row as part
  // of its read pass (R2), so the diff reuses that `stored` value rather than
  // issuing a redundant second `getPlayerRating` query per player.
  const ratingMismatches: RatingMismatch[] = [];
  const gapKeys = new Set<string>();
  const integrity: RatingIntegrityReport = { gaps: [], unratedMatchIds: [], repairRefusal: null };
  for (const playerId of playerIds) {
    const { computed, stored, integrity: playerIntegrity } = await loadAndComputeRatingCurve(playerId);
    const mismatches = diffRatingCurve(playerId, computed, stored);
    if (mismatches.length > 0) {
      ratingMismatches.push(...mismatches);
      affectedPlayers.add(playerId);
    }
    for (const gap of playerIntegrity.gaps) {
      const key = `${gap.matchId}:${gap.playerId}`;
      if (gapKeys.has(key)) continue;
      gapKeys.add(key);
      integrity.gaps.push(gap);
      affectedPlayers.add(gap.playerId);
    }
    for (const matchId of playerIntegrity.unratedMatchIds) {
      if (!integrity.unratedMatchIds.includes(matchId)) integrity.unratedMatchIds.push(matchId);
    }
  }
  // Dry run: plan the repair's rating batch (reads only) when the history is
  // not clean, so the report says whether the repair would refuse. Without
  // gaps or never-rated matches the plan adds nobody and cannot refuse.
  if (dryRun && (integrity.gaps.length > 0 || integrity.unratedMatchIds.length > 0)) {
    try {
      await planRatingRebuild(playerIds);
    } catch (err) {
      if (!(err instanceof RatingHistoryIntegrityError) && !(err instanceof RatingRebuildPlanTooLargeError)) {
        throw err;
      }
      integrity.repairRefusal = {
        code: err.code ?? 'rating_history_incomplete',
        error: err.message,
        ...(err.params ? { params: err.params } : {}),
      };
    }
  }

  let ratingsRepaired: { players: number } | undefined;
  if (!dryRun && playerIds.length > 0) {
    // Counts every rebuilt player, including players the batch added to heal
    // history gaps or to pair a never-rated match.
    const results = await rebuildRatingsForPlayers(playerIds);
    ratingsRepaired = { players: results.length };
  }

  // ── Aggregates (repair-only, league scope) ─────────────────────────
  let aggregatesRebuilt: { gamesProcessed: number; aggregatesDeleted: number } | undefined;
  if (!dryRun) {
    const result = await rebuildAggregatesForScope('league', seasonId);
    aggregatesRebuilt = {
      gamesProcessed: result.gamesProcessed,
      aggregatesDeleted: result.aggregatesDeleted,
    };
  }

  // ── Streaks (repair-only) ──────────────────────────────────────────
  let streaksRebuilt: { players: number } | undefined;
  if (!dryRun && playerIds.length > 0) {
    for (const playerId of playerIds) {
      await recomputeStreaks(playerId);
    }
    streaksRebuilt = { players: playerIds.length };
  }

  const totalMismatches = evolutionMismatches.length + ratingMismatches.length;

  return {
    seasonId,
    dryRun,
    evolution: {
      checked: epb,
      mismatches: evolutionMismatches,
      impossibleLineups,
      repaired: evolutionRepaired,
    },
    ratings: {
      checked: true,
      mismatches: ratingMismatches,
      integrity,
      repaired: ratingsRepaired,
    },
    aggregates: {
      checked: false,
      rebuilt: aggregatesRebuilt,
    },
    streaks: {
      checked: false,
      rebuilt: streaksRebuilt,
    },
    playersAffected: Array.from(affectedPlayers).sort(),
    summary: { totalMismatches, repaired: !dryRun },
  };
}

/**
 * Reconcile derived data for every season. Loads all season ids and runs
 * `reconcileSeasonDerivedData` over each.
 *
 * Concurrency depends on mode — this is load-bearing:
 *   - DRY-RUN (read-only): seasons run in a bounded parallel chunk of 2.
 *     Reconciliation is heavy (each season replays its matches + rebuilds
 *     aggregates), but dry-run performs no writes, so cross-season overlap is
 *     safe. The chunk is kept small to avoid an unbounded fan-out of concurrent
 *     Supabase reads.
 *   - REPAIR (writes): seasons run STRICTLY SEQUENTIALLY (effective chunk size
 *     1). Ratings and `rating_history` are PLAYER-GLOBAL, not season-scoped: a
 *     player in two seasons has one `player_ratings` row and one shared
 *     `rating_history`. Each player's curve is written atomically
 *     (`replacePlayerRatingCurve`, one SQL transaction), but a rebuild READS
 *     its opponents' rows, so rebuilds of mutual opponents must not overlap:
 *     `rebuildRatingsForPlayers` runs players strictly sequentially and queues
 *     every rebuild in this process behind the previous one. Serializing the
 *     whole-season fan-out keeps the evolution, aggregate and streak repairs
 *     of two seasons from overlapping as well.
 *
 * Note: even serialized, a player in multiple seasons gets rebuilt once per
 * season (redundant but idempotent — each rebuild recomputes the full global
 * curve from all of the player's completed matches). That redundancy is
 * acceptable; the goal here is to prevent concurrent corruption.
 *
 * Returns the per-season reports in season order.
 */
export async function reconcileAllSeasons(
  opts: ReconcileOptions = {}
): Promise<ReconcileReport[]> {
  const seasonIds = await listAllSeasonIds();
  // Writes (anything with dryRun resolved false — repair OR dryRun: false) →
  // serialize (chunk 1) to avoid cross-season rating-history races. Dry-run →
  // bounded parallel (chunk 2) for throughput on read-only work. Key on the
  // RESOLVED dry-run state, not opts.repair, so `{ dryRun: false }` without
  // a repair flag also serializes.
  const CHUNK_SIZE = resolveDryRun(opts) ? 2 : 1;
  const reports: ReconcileReport[] = [];

  for (let i = 0; i < seasonIds.length; i += CHUNK_SIZE) {
    const chunk = seasonIds.slice(i, i + CHUNK_SIZE);
    const chunkReports = await Promise.all(
      chunk.map((seasonId) => reconcileSeasonDerivedData(seasonId, opts))
    );
    reports.push(...chunkReports);
  }

  return reports;
}