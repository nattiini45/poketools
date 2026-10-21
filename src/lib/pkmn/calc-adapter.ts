import type { PokemonSet } from '@/types/team';
import type { CalcPokemon } from '@/types/calc';

/**
 * Convert a PokemonSet (teambuilder format) to a CalcPokemon (calc API format).
 */
export function pokemonSetToCalcPokemon(
  set: PokemonSet,
  overrides?: Partial<CalcPokemon>
): CalcPokemon {
  return {
    species: set.species,
    item: set.item || undefined,
    ability: set.ability || undefined,
    nature: set.nature || undefined,
    evs: set.evs,
    ivs: set.ivs,
    level: set.level ?? 100,
    moves: (set.moves ?? []).filter(Boolean),
    tera_type: set.tera_type,
    ...overrides,
  };
}

/**
 * Convert a CalcPokemon back to a partial PokemonSet.
 */
export function calcPokemonToPartialSet(calc: CalcPokemon): Partial<PokemonSet> {
  return {
    species: calc.species,
    item: calc.item ?? '',
    ability: calc.ability ?? '',
    nature: calc.nature ?? 'Hardy',
    evs: calc.evs as PokemonSet['evs'],
    ivs: calc.ivs as PokemonSet['ivs'],
    level: calc.level ?? 100,
    moves: calc.moves ?? [],
    tera_type: calc.tera_type,
  };
}
