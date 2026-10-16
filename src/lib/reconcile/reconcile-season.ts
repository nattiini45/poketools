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
  rebuildRatingsForPlayers,
  type ComputedRatingCurve,
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
  /** Union of player ids with any evolution/ratings mismatch + impossible-lineup player ids. */
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
 * still feed their rating curve). Order is preserved: roster first, then any
 * tracker players not already present.
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
  for (const playerId of playerIds) {
    const { computed, stored } = await loadAndComputeRatingCurve(playerId);
    const mismatches = diffRatingCurve(playerId, computed, stored);
    if (mismatches.length > 0) {
      ratingMismatches.push(...mismatches);
      affectedPlayers.add(playerId);
    }
  }

  let ratingsRepaired: { players: number } | undefined;
  if (!dryRun && playerIds.length > 0) {
    await rebuildRatingsForPlayers(playerIds);
    ratingsRepaired = { players: playerIds.length };
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
 *     `rating_history`. The rating rebuild writes are non-transactional
 *     (`upsertPlayerRating` → `deleteRatingHistoryByPlayer` →
 *     `insertRatingHistoryBatch`); if two seasons sharing a player were
 *     repaired concurrently, those writes would interleave and corrupt that
 *     player's history (the delete from one rebuild races the insert from the
 *     other). Serializing the whole-season fan-out prevents cross-season
 *     overlap of those writes. Within a single season, players are still
 *     fanned out in parallel by `rebuildRatingsForPlayers` (chunk of 4), which
 *     is safe because a single player's rebuild only touches that player's
 *     own rows.
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