/**
 * Server-only matchup dex composition.
 * Uses existing dex helpers — does not grow dex.ts.
 */

import {
  getSpeciesTypeInfo,
  getBaseStats,
  getLegalAbilities,
  getBestTypeEffectivenessBatch,
} from '@/lib/pkmn/dex';
import type { MatchupDexPayload, MatchupSpeciesDetail } from '@/lib/evolution/matchup-types';

/**
 * Build type info, species details, and pairwise type-effectiveness multipliers
 * for the given species names (typically current forms on season trackers).
 */
export function buildMatchupDexPayload(
  speciesNames: string[],
  gen: number = 9,
): MatchupDexPayload {
  const unique = [...new Set(speciesNames.filter(Boolean))];
  const typeInfo: MatchupDexPayload['typeInfo'] = {};
  const speciesDetails: Record<string, MatchupSpeciesDetail> = {};

  for (const name of unique) {
    const info = getSpeciesTypeInfo(name, gen);
    if (!info) continue;
    typeInfo[info.species] = info;

    const stats = getBaseStats(info.species, gen);
    const abilities = getLegalAbilities(info.species, gen).map((a) => a.name);
    speciesDetails[info.species] = {
      species: info.species,
      types: info.types,
      weaknesses: info.weaknesses,
      resistances: info.resistances,
      immunities: info.immunities,
      baseStats: stats?.baseStats ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      abilities,
    };
  }

  const pairs: { attacker: string; defender: string }[] = [];
  const resolved = Object.keys(typeInfo);
  for (const attacker of resolved) {
    for (const defender of resolved) {
      pairs.push({ attacker, defender });
    }
  }

  const stabMultipliers =
    pairs.length > 0 ? getBestTypeEffectivenessBatch(pairs, gen) : {};

  return { typeInfo, speciesDetails, stabMultipliers };
}
