/**
 * The Champions roster by category, assembled from the generated lists (`champions-roster.generated.ts`, read from
 * Showdown's `champions` mod at `CHAMPIONS_ROSTER_PIN`). Every Pokémon id the mod makes legal is in `pokemon`: the
 * selectable species, their Mega Evolutions, the battle-only formes and the cosmetic formes; `abilities` are the
 * ones some selectable species has plus the Mega-only ones.
 */
import {
  CHAMPIONS_ABILITIES,
  CHAMPIONS_ITEMS,
  CHAMPIONS_MEGA_ABILITIES,
  CHAMPIONS_MOVES,
  CHAMPIONS_SPECIES_BATTLE_ONLY,
  CHAMPIONS_SPECIES_COSMETIC,
  CHAMPIONS_SPECIES_MEGA,
  CHAMPIONS_SPECIES_SELECTABLE,
} from './champions-roster.generated';

export const CHAMPIONS_ROSTER: Readonly<Record<'pokemon' | 'moves' | 'items' | 'abilities', readonly string[]>> = {
  pokemon: [...CHAMPIONS_SPECIES_SELECTABLE, ...CHAMPIONS_SPECIES_MEGA, ...CHAMPIONS_SPECIES_BATTLE_ONLY, ...CHAMPIONS_SPECIES_COSMETIC],
  moves: CHAMPIONS_MOVES,
  items: CHAMPIONS_ITEMS,
  abilities: [...CHAMPIONS_ABILITIES, ...CHAMPIONS_MEGA_ABILITIES],
};
