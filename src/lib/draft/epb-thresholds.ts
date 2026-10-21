/**
 * Season line-threshold loading for Evolution Point Buy.
 * Shared by draft validation and match apply paths — kept out of the
 * match evaluator so draft modules do not import match orchestration.
 */

import { getAllTiers } from '@/lib/supabase/queries/evolutions';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { effectiveThresholds } from '@/lib/draft/line-catalog-data';
import type { LineThresholds } from '@/lib/match/epb-stage-resolution';
import { supabase } from '@/lib/supabase/client';
import type { PointBuyListEntry } from '@/types/point-buy';

export type { LineThresholds };

/**
 * Season thresholds of one line. `line_id` (draft-backend §2.2) lives on
 * `LineThresholds` itself; it is null for legacy evolution-tier leagues,
 * which have no list. Kept as an alias for existing importers.
 */
export type SeasonLineThresholds = LineThresholds;

/**
 * Point-buy list entries → cumulative season thresholds with league overrides
 * applied (the format pack's `epb.lineOverrides`). Pure; the shared replacement for
 * the pages' local `thresholdsOf` copies.
 */
export function lineThresholdsFromEntries(entries: readonly PointBuyListEntry[]): SeasonLineThresholds[] {
  return entries.map((e) => {
    const cumulative = effectiveThresholds(e);
    return {
      line_id: cumulative.line_id,
      base_pokemon: e.base_pokemon,
      stage2_pokemon: e.stage2_pokemon,
      stage3_pokemon: e.stage3_pokemon,
      stage2_kos: cumulative.stage2_kos,
      stage3_kos: cumulative.stage3_kos,
    };
  });
}

/**
 * Load line thresholds for a season: prefer the bound point-buy list
 * (league overrides of the format pack applied), fall back to
 * evolution_tiers (already cumulative).
 */
export async function getSeasonLineThresholds(seasonId: string): Promise<SeasonLineThresholds[]> {
  const { data: season } = await supabase
    .from('seasons')
    .select('point_buy_list_id')
    .eq('id', seasonId)
    .maybeSingle();

  if (season?.point_buy_list_id) {
    return lineThresholdsFromEntries(await getListEntries(season.point_buy_list_id));
  }

  // Fallback: evolution_tiers store cumulative thresholds already
  const tiers = await getAllTiers(seasonId);
  return tiers.map((t) => ({
    line_id: null,
    base_pokemon: t.base_pokemon,
    stage2_pokemon: t.stage2_pokemon,
    stage3_pokemon: t.stage3_pokemon,
    stage2_kos: t.stage2_kos,
    stage3_kos: t.stage3_kos,
  }));
}
