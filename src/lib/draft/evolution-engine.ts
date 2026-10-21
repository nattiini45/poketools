import {
  getSeasonTrackers,
  getAllTiers,
  getSeasonKosForLine,
  updateTracker,
} from '@/lib/supabase/queries/evolutions';
import type { EvolutionTier, EvolutionEvent } from '@/types/evolution';

/**
 * Determine the correct form and stage for a given KO count against a tier.
 */
function resolveStage(
  tier: EvolutionTier,
  totalKos: number
): { form: string; stage: number } {
  // Check stage 3 first (higher threshold)
  if (
    tier.stage3_pokemon &&
    tier.stage3_kos !== null &&
    totalKos >= tier.stage3_kos
  ) {
    return { form: tier.stage3_pokemon, stage: 3 };
  }

  // Check stage 2
  if (totalKos >= tier.stage2_kos) {
    return { form: tier.stage2_pokemon, stage: 2 };
  }

  // Still base form
  return { form: tier.base_pokemon, stage: 1 };
}

/**
 * Get all form names for an evolution line (used for KO counting).
 */
function getLineFormNames(tier: EvolutionTier): string[] {
  const names = [tier.base_pokemon, tier.stage2_pokemon];
  if (tier.stage3_pokemon) {
    names.push(tier.stage3_pokemon);
  }
  return names;
}

/**
 * Check and update all evolution trackers for a season.
 *
 * Called after every game result (via recordGameResult pipeline).
 * Re-sums KOs for each tracked line and updates form/stage if thresholds are crossed.
 *
 * Returns a list of evolution events (evolutions or de-evolutions that happened).
 */
export async function checkEvolutions(
  seasonId: string
): Promise<EvolutionEvent[]> {
  const [trackers, allTiers] = await Promise.all([
    getSeasonTrackers(seasonId),
    getAllTiers(seasonId),
  ]);

  // If no evo league setup, skip
  if (allTiers.length === 0 || trackers.length === 0) {
    return [];
  }

  // Build tier lookup: base_pokemon + player_id → tier
  const tierMap = new Map<string, EvolutionTier>();
  for (const tier of allTiers) {
    // Player-specific wildcard key
    if (tier.player_id) {
      tierMap.set(`${tier.base_pokemon}::${tier.player_id}`, tier);
    }
    // General tier list key (only set if no player-specific exists)
    const generalKey = `${tier.base_pokemon}::`;
    if (!tier.player_id && !tierMap.has(generalKey)) {
      tierMap.set(generalKey, tier);
    }
  }

  const events: EvolutionEvent[] = [];

  for (const tracker of trackers) {
    // Find matching tier (prefer player-specific wildcard)
    const tier =
      tierMap.get(`${tracker.base_pokemon}::${tracker.player_id}`) ??
      tierMap.get(`${tracker.base_pokemon}::`);

    if (!tier) continue; // No tier found — shouldn't happen, but skip gracefully

    // Sum KOs across all forms in this line for this player
    const formNames = getLineFormNames(tier);
    const totalKos = await getSeasonKosForLine(
      seasonId,
      tracker.player_id,
      formNames
    );

    // Resolve what stage they should be at
    const resolved = resolveStage(tier, totalKos);

    // Check if anything changed
    if (
      resolved.form !== tracker.current_form ||
      resolved.stage !== tracker.current_stage ||
      totalKos !== tracker.total_kos
    ) {
      const isFormChange = resolved.form !== tracker.current_form;
      const previousForm = tracker.current_form;

      await updateTracker(tracker.id, {
        current_form: resolved.form,
        total_kos: totalKos,
        current_stage: resolved.stage,
        evolved_at: isFormChange ? new Date().toISOString() : tracker.evolved_at,
      });

      if (isFormChange) {
        events.push({
          player_id: tracker.player_id,
          base_pokemon: tracker.base_pokemon,
          previous_form: previousForm,
          new_form: resolved.form,
          new_stage: resolved.stage,
          total_kos: totalKos,
          is_devolution: resolved.stage < tracker.current_stage,
        });
      }
    }
  }

  return events;
}

/**
 * Check evolutions for a specific player only (optimization).
 * Used when we know only one player's KOs changed.
 */
export async function checkPlayerEvolutions(
  seasonId: string,
  playerId: string
): Promise<EvolutionEvent[]> {
  const [allTrackers, allTiers] = await Promise.all([
    getSeasonTrackers(seasonId),
    getAllTiers(seasonId),
  ]);

  const trackers = allTrackers.filter((t) => t.player_id === playerId);
  if (allTiers.length === 0 || trackers.length === 0) {
    return [];
  }

  const tierMap = new Map<string, EvolutionTier>();
  for (const tier of allTiers) {
    if (tier.player_id) {
      tierMap.set(`${tier.base_pokemon}::${tier.player_id}`, tier);
    }
    const generalKey = `${tier.base_pokemon}::`;
    if (!tier.player_id && !tierMap.has(generalKey)) {
      tierMap.set(generalKey, tier);
    }
  }

  const events: EvolutionEvent[] = [];

  for (const tracker of trackers) {
    const tier =
      tierMap.get(`${tracker.base_pokemon}::${tracker.player_id}`) ??
      tierMap.get(`${tracker.base_pokemon}::`);

    if (!tier) continue;

    const formNames = getLineFormNames(tier);
    const totalKos = await getSeasonKosForLine(
      seasonId,
      tracker.player_id,
      formNames
    );

    const resolved = resolveStage(tier, totalKos);

    if (
      resolved.form !== tracker.current_form ||
      resolved.stage !== tracker.current_stage ||
      totalKos !== tracker.total_kos
    ) {
      const isFormChange = resolved.form !== tracker.current_form;
      const previousForm = tracker.current_form;

      await updateTracker(tracker.id, {
        current_form: resolved.form,
        total_kos: totalKos,
        current_stage: resolved.stage,
        evolved_at: isFormChange ? new Date().toISOString() : tracker.evolved_at,
      });

      if (isFormChange) {
        events.push({
          player_id: tracker.player_id,
          base_pokemon: tracker.base_pokemon,
          previous_form: previousForm,
          new_form: resolved.form,
          new_stage: resolved.stage,
          total_kos: totalKos,
          is_devolution: resolved.stage < tracker.current_stage,
        });
      }
    }
  }

  return events;
}

/**
 * Validate that a draft pick is a valid base-form from the tier list.
 * Returns null if valid, or an error message.
 */
export function validateEvoLeaguePick(
  pokemonName: string,
  tiers: EvolutionTier[],
  playerId: string
): string | null {
  // Check if it's a tier list base form
  const tierListMatch = tiers.find(
    (t) => t.player_id === null && t.base_pokemon === pokemonName
  );
  if (tierListMatch) return null;

  // Check if it's a wildcard assigned to this player
  const wildcardMatch = tiers.find(
    (t) => t.player_id === playerId && t.base_pokemon === pokemonName
  );
  if (wildcardMatch) return null;

  return `${pokemonName} is not a valid base-form in the evolution tier list`;
}

/**
 * Check if a season has an evo-league tier list configured.
 * Fast-path: if the season format is evolution_point_buy, it's always an evo league.
 */
export async function isEvoLeague(seasonId: string): Promise<boolean> {
  // Fast-path: check format_type first (avoids getAllTiers query)
  const { supabase } = await import('@/lib/supabase/client');
  const { data: season } = await supabase
    .from('seasons')
    .select('format_type')
    .eq('id', seasonId)
    .maybeSingle();

  if (season && season.format_type === 'evolution_point_buy') {
    return true;
  }

  // Fallback: check if tiers exist (legacy evo-league detection)
  const tiers = await getAllTiers(seasonId);
  return tiers.length > 0;
}
