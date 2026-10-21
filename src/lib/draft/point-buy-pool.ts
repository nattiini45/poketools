import type { DraftPoolEntry } from '@/types/draft-pool';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';
import { lineIdOfEntry } from '@/lib/draft/line-identity';

export type TrackerLineRef = Pick<EvolutionTracker, 'base_pokemon' | 'locked_stage3_pokemon'> & {
  line_id?: string | null;
};

/**
 * True when a tracker holds this list line: by `line_id` when the tracker has
 * one (one tracker per line per season, M1), else — trackers written before
 * M1 — by base + stage-3 branch.
 */
export function trackerHoldsEntry(tracker: TrackerLineRef, entry: PointBuyListEntry): boolean {
  if (tracker.line_id) return tracker.line_id === lineIdOfEntry(entry);
  return (
    tracker.base_pokemon === entry.base_pokemon &&
    (tracker.locked_stage3_pokemon ?? null) === (entry.stage3_pokemon ?? null)
  );
}

/**
 * The list entry of a tracker's line: by `line_id`, else the base's entry whose
 * stage 3 equals the tracker's locked stage 3, else the base's first entry.
 */
export function entryForTracker(
  tracker: TrackerLineRef,
  entries: readonly PointBuyListEntry[]
): PointBuyListEntry | undefined {
  if (tracker.line_id) {
    const exact = entries.find((e) => lineIdOfEntry(e) === tracker.line_id);
    if (exact) return exact;
  }
  const sameBase = entries.filter((e) => e.base_pokemon === tracker.base_pokemon);
  return (
    sameBase.find((e) => e.stage3_pokemon === tracker.locked_stage3_pokemon) ?? sameBase[0]
  );
}

/**
 * Adapter: derive the draft pool from a bound Point Buy list.
 *
 * When a season has a point_buy_list_id, the available draft picks come
 * from that list — no second manually-maintained pool is needed.
 * Already-drafted lines (those with an evolution tracker) are excluded.
 * Branched lines (same base, different stage-3) are distinct options.
 */
export function pointBuyListToDraftPool(
  entries: PointBuyListEntry[],
  seasonId: string,
  existingTrackers: EvolutionTracker[] = [],
): DraftPoolEntry[] {
  return entries
    .filter((entry) => !isEntryDrafted(entry, existingTrackers))
    .map((entry) => ({
      id: entry.id,
      season_id: seasonId,
      pokemon_name: entry.base_pokemon,
      stage3_pokemon: entry.stage3_pokemon,
      power_tier: null,
      point_cost: entry.price,
      created_at: new Date().toISOString(),
    }));
}

/** Check whether a point-buy list line is already drafted (keyed by its line id). */
export function isEntryDrafted(
  entry: PointBuyListEntry,
  existingTrackers: readonly TrackerLineRef[],
): boolean {
  return existingTrackers.some((t) => trackerHoldsEntry(t, entry));
}
