/**
 * Redraft helpers for Evolution Point Buy format.
 *
 * The redraft itself is the secret-drop draft (redraft pool, `redraft_*` RPCs). The free swap and the consented trades are retired
 * (`POST /api/seasons/[id]/redraft` answers 410); only the eligibility read stays.
 */

import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { isRedraftExcluded } from '@/lib/draft/special-rules';
import { entryForTracker } from '@/lib/draft/point-buy-pool';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';

// ── Eligibility ───────────────────────────────────────────────────

/**
 * Get all trackers for a player that are eligible for the redraft.
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
