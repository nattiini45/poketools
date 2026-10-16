/**
 * Redraft helpers for Evolution Point Buy format.
 *
 * The redraft itself is the secret-drop draft (redraft pool, `redraft_*` RPCs,
 * draft-backend §6.8); the free-swap path is retired. What stays here are the
 * helpers consented trades need (`prepareRedraftSwap`), keyed by `line_id`.
 */

import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { isRedraftExcluded, toCumulativeThresholds } from '@/lib/draft/special-rules';
import { computeMissingKillsTransfer } from '@/lib/draft/point-buy-engine';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import { entryForTracker, trackerHoldsEntry } from '@/lib/draft/point-buy-pool';
import type { RedraftSwapPayload } from '@/lib/supabase/queries/redraft';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';

// ── Eligibility ───────────────────────────────────────────────────

/**
 * Get all trackers for a player that are eligible for redraft / trade.
 * Excludes redraft-locked lines (`isRedraftExcluded`: the no_redraft flag or the format
 * pack's participation / redraft-locked lines).
 */
export async function getRedraftEligibleLines(
  seasonId: string,
  playerId: string,
  listEntries: PointBuyListEntry[]
): Promise<EvolutionTracker[]> {
  const trackers = await getSeasonTrackers(seasonId);
  const playerTrackers = trackers.filter((t) => t.player_id === playerId);

  return playerTrackers.filter((tracker) => {
    const entry = entryForTracker(tracker, listEntries);
    return !isRedraftExcluded(tracker.base_pokemon, entry?.special_rules ?? null);
  });
}

/**
 * Get the point-buy list lines no player holds (one tracker per line per
 * season; the two branches of one base are two lines).
 */
export async function getFreeLines(
  seasonId: string,
  listVersionId: string
): Promise<PointBuyListEntry[]> {
  const [entries, trackers] = await Promise.all([
    getListEntries(listVersionId),
    getSeasonTrackers(seasonId),
  ]);

  return entries.filter((entry) => !trackers.some((t) => trackerHoldsEntry(t, entry)));
}

// ── Swap preparation (trades) ─────────────────────────────────────

export interface RedraftInput {
  season_id: string;
  player_id: string;
  from_tracker_id: string;
  to_line: PointBuyListEntry;
  /** Only consented trades swap lines (the free swap is retired: its route answers 410). */
  transfer_type: 'trade';
  trade_partner_id?: string | null;
  remaining_points: number;
}

export interface PreparedRedraftSwap {
  payload: RedraftSwapPayload;
  points_spent: number;
}

/**
 * Codes for the swap refusals (draft-backend DL-API hand-off): keys of the
 * `errors/draft-legacy` catalog, which routes forward as `code` / `params`.
 */
export type RedraftSwapRefusal =
  | { code: 'redraft_line_excluded'; params: { pokemon: string } }
  | { code: 'redraft_source_missing'; params?: undefined }
  | { code: 'redraft_line_not_owned'; params?: undefined }
  | { code: 'redraft_line_untradeable'; params: { pokemon: string } }
  | { code: 'redraft_insufficient_points'; params: { cost: number; remaining: number } };

/**
 * Validate one side of a trade and compute its swap payload (no writes).
 *
 * Validates:
 * 1. Redraft-lock exclusion (`isRedraftExcluded`, both directions)
 * 2. Price difference vs remaining points (upgrade costs points, downgrade gives no refund)
 * 3. Computes the missing-kills transfer, clamped to the target line's max stage
 *
 * The carried-over amount is evolution progress only: the new tracker gets it
 * as `transferred_evo_progress` with `real_kills = 0` (SPEC Prompt 6 §12;
 * draft-backend §6.10), and `line_id` names the target line.
 */
export async function prepareRedraftSwap(
  input: RedraftInput
): Promise<{ swap?: PreparedRedraftSwap; error?: string; refusal?: RedraftSwapRefusal }> {
  const { season_id, player_id, from_tracker_id, to_line, transfer_type, trade_partner_id } = input;

  // 1. Validate the redraft-lock exclusion
  if (isRedraftExcluded(to_line.base_pokemon, to_line.special_rules)) {
    return {
      error: `${to_line.base_pokemon} cannot be obtained via redraft`,
      refusal: { code: 'redraft_line_excluded', params: { pokemon: to_line.base_pokemon } },
    };
  }

  // 2. Get the source tracker
  const trackers = await getSeasonTrackers(season_id);
  const fromTracker = trackers.find((t) => t.id === from_tracker_id);
  if (!fromTracker) {
    return { error: 'Source tracker not found', refusal: { code: 'redraft_source_missing' } };
  }
  if (fromTracker.player_id !== player_id) {
    return { error: 'You do not own this line', refusal: { code: 'redraft_line_not_owned' } };
  }

  // Validate source is not excluded
  const allEntries = await getListEntries(to_line.list_version_id);
  const fromEntry = entryForTracker(fromTracker, allEntries);
  if (fromEntry && isRedraftExcluded(fromTracker.base_pokemon, fromEntry.special_rules)) {
    return {
      error: `${fromTracker.base_pokemon} cannot be traded away`,
      refusal: { code: 'redraft_line_untradeable', params: { pokemon: fromTracker.base_pokemon } },
    };
  }

  // 3. Validate price difference
  const fromPrice = fromEntry?.price ?? 0;
  const toPrice = to_line.price;
  let pointsSpent = 0;

  if (toPrice > fromPrice) {
    // Upgrade: must have enough remaining points
    const cost = toPrice - fromPrice;
    if (cost > input.remaining_points) {
      return {
        error: `Not enough points for upgrade. Need ${cost}, have ${input.remaining_points}`,
        refusal: {
          code: 'redraft_insufficient_points',
          params: { cost, remaining: input.remaining_points },
        },
      };
    }
    pointsSpent = cost;
  }
  // Downgrade: allowed, no refund

  // 4. Compute missing-kills transfer
  const fromKillsToStage2 = fromEntry?.kills_to_stage2 ?? 0;
  const fromAdditionalToStage3 = fromEntry?.additional_kills_to_stage3 ?? null;
  const fromThresholds = toCumulativeThresholds(fromKillsToStage2, fromAdditionalToStage3);

  // Determine current progress toward next stage
  let currentRequirement: number;
  let currentProgress: number;
  if (fromTracker.current_stage === 1) {
    currentRequirement = fromThresholds.stage2_kos;
    currentProgress = fromTracker.total_kos;
  } else if (fromTracker.current_stage === 2) {
    currentRequirement = fromThresholds.stage3_kos !== null
      ? fromThresholds.stage3_kos - fromThresholds.stage2_kos
      : 0;
    currentProgress = fromTracker.total_kos - fromThresholds.stage2_kos;
  } else {
    currentRequirement = 0;
    currentProgress = 0;
  }

  const transfer = computeMissingKillsTransfer(
    fromTracker.current_stage,
    currentProgress,
    currentRequirement,
    to_line.kills_to_stage2,
    to_line.additional_kills_to_stage3
  );

  // Clamp to the target line's maximum: a 2-stage line cannot be stage 3
  // (e.g. fully-evolved source → 2-stage target lands at stage 2)
  const maxStage = to_line.stage3_pokemon ? 3 : 2;
  const newStage = Math.min(transfer.stage, maxStage);

  // 5. Compute new tracker's total_kos (cumulative)
  const toThresholds = toCumulativeThresholds(to_line.kills_to_stage2, to_line.additional_kills_to_stage3);
  let newTotalKos: number;
  if (newStage === 3) {
    newTotalKos = toThresholds.stage3_kos ?? toThresholds.stage2_kos;
  } else if (newStage === 2) {
    newTotalKos = toThresholds.stage2_kos + (transfer.stage === 2 ? transfer.progress : 0);
  } else {
    newTotalKos = transfer.progress;
  }

  // 6. Determine current form
  let currentForm: string;
  if (newStage >= 3 && to_line.stage3_pokemon) {
    currentForm = to_line.stage3_pokemon;
  } else if (newStage >= 2) {
    currentForm = to_line.stage2_pokemon;
  } else {
    currentForm = to_line.base_pokemon;
  }

  // The carried-over amount is evolution progress, never kills: a trade puts it
  // into transferred_evo_progress (real_kills 0), so total_kos = the five-term
  // sum still holds and public kill rankings stay on real kills.
  // The player-level evolution_points_awarded counter moves to the new
  // tracker so trading the line that carries it cannot erase it.
  return {
    swap: {
      points_spent: pointsSpent,
      payload: {
        player_id,
        from_tracker_id,
        new_tracker: {
          base_pokemon: to_line.base_pokemon,
          current_form: currentForm,
          current_stage: newStage,
          total_kos: newTotalKos,
          real_kills: 0,
          transferred_evo_progress: newTotalKos,
          line_id: lineIdOfEntry(to_line),
          evolution_points_awarded: fromTracker.evolution_points_awarded,
          locked_stage3_pokemon: to_line.stage3_pokemon,
        },
        history: {
          to_base_pokemon: to_line.base_pokemon,
          to_stage3_pokemon: to_line.stage3_pokemon,
          transfer_type,
          trade_partner_id: trade_partner_id ?? null,
          missing_kills_transferred: currentRequirement - currentProgress,
          points_spent: pointsSpent,
        },
      },
    },
  };
}
