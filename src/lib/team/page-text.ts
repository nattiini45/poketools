import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import type { PokemonSet } from '@/types/team';

/** The sets a visitor sees: an empty slot or a hidden one (team-preview) names nothing. */
export function filledSets(pokemon: PokemonSet[]): PokemonSet[] {
  return pokemon.filter((set) => set?.species && set.species !== 'hidden');
}

/** Distinct species of a team in the viewer's data language, for a page description. */
export function speciesList(pokemon: PokemonSet[], locale: DataLocale): string {
  const names = filledSets(pokemon).map((set) => localizeSpecies(set.species, locale));
  return [...new Set(names)].join(', ');
}