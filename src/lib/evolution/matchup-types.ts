/**
 * Client-safe matchup payload types (no @pkmn / dex imports).
 * Server composition lives in matchup-payload.ts.
 */

export interface MatchupSpeciesTypeInfo {
  species: string;
  types: string[];
  weaknesses: string[];
  resistances: string[];
  immunities: string[];
}

export interface MatchupSpeciesDetail extends MatchupSpeciesTypeInfo {
  baseStats: {
    hp: number;
    atk: number;
    def: number;
    spa: number;
    spd: number;
    spe: number;
  };
  abilities: string[];
}

/** Precomputed dex data for all current forms in a season matchup view. */
export interface MatchupDexPayload {
  typeInfo: Record<string, MatchupSpeciesTypeInfo>;
  speciesDetails: Record<string, MatchupSpeciesDetail>;
  /** Keyed as `${attacker}::${defender}` */
  stabMultipliers: Record<string, number>;
}

export function stabPairKey(attacker: string, defender: string): string {
  return `${attacker}::${defender}`;
}
