/**
 * Resolves a Smogon Moveset with slash options into a concrete PokemonSet.
 * Strategy: pick the first option in each slash (Smogon orders by preference).
 */

import type { PokemonSet, StatSpread } from '@/types/team';
import type { SmogonMoveset } from '@/types/sample-sets';
import { getSpecies } from '@/lib/pkmn/dex';

function resolveSlash<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function fillDefaultEVs(partial?: Partial<StatSpread>): StatSpread {
  return {
    hp: partial?.hp ?? 0,
    atk: partial?.atk ?? 0,
    def: partial?.def ?? 0,
    spa: partial?.spa ?? 0,
    spd: partial?.spd ?? 0,
    spe: partial?.spe ?? 0,
  };
}

function fillDefaultIVs(partial?: Partial<StatSpread>): StatSpread {
  return {
    hp: partial?.hp ?? 31,
    atk: partial?.atk ?? 31,
    def: partial?.def ?? 31,
    spa: partial?.spa ?? 31,
    spd: partial?.spd ?? 31,
    spe: partial?.spe ?? 31,
  };
}

export function resolveMoveset(
  pokemonName: string,
  moveset: SmogonMoveset,
  gen: number
): PokemonSet {
  return {
    name: '',
    species: pokemonName,
    gender: '',
    item: resolveSlash(moveset.item) || '',
    ability: resolveSlash(moveset.ability) || (getSpecies(pokemonName, gen)?.abilities as unknown as Record<string, string>)?.['0'] || '',
    nature: resolveSlash(moveset.nature) || 'Hardy',
    evs: fillDefaultEVs(moveset.evs),
    ivs: fillDefaultIVs(moveset.ivs),
    level: moveset.level ?? (gen >= 9 ? 100 : 100),
    moves: moveset.moves.map((m) => resolveSlash(m)),
    tera_type: moveset.teratypes?.[0],
  };
}
