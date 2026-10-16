/**
 * The finder's port to the Pokémon name layer (draft-frontend §4.2, critique S7). Client-safe.
 *
 * The only file of `src/lib/draft-finder` that imports the name dictionaries (`@/lib/pkmn/i18n/names`);
 * `client-safe-imports.test.ts` enforces it. Every input is a canonical English name (never an id), so
 * `'en'` returns it unchanged; index ids become names through `moveNames` / `abilityNames`.
 */
import type { Locale } from '@/i18n/config';
import {
  localizeAbility,
  localizeLineLabel,
  localizeMove,
  localizeSpecies,
  localizeStat,
  localizeType,
  pkmnSearchKeys,
} from '@/lib/pkmn/i18n/names';
import { compareDisplayNames, type SearchKeys } from '@/lib/pkmn/i18n/search';
import type { StatKey } from './filter-types';
import type { TypeId } from './index-types';

export interface NameResolver {
  species(englishName: string, l: Locale): string;
  move(englishName: string, l: Locale): string;
  ability(englishName: string, l: Locale): string;
  type(t: TypeId, l: Locale): string;
  stat(s: StatKey, l: Locale, form: 'short' | 'long'): string;
  lineLabel(base: string, stage3: string | null, l: Locale): string;
  /** EN + DE + transliteration keys, whatever the locale. */
  searchKeys(kind: 'species' | 'move' | 'ability', englishName: string): SearchKeys;
  compare(a: string, b: string, l: Locale): number;
}

export const pkmnNameResolver: NameResolver = {
  species: localizeSpecies,
  move: localizeMove,
  ability: localizeAbility,
  type: localizeType,
  stat: localizeStat,
  lineLabel: localizeLineLabel,
  searchKeys: pkmnSearchKeys,
  compare: compareDisplayNames,
};

/** Index-aware helpers: the display name of a move / ability index of a search index. */
export function indexMoveName(
  ix: { moveNames: readonly string[]; moves: readonly string[] },
  idx: number,
  names: NameResolver,
  l: Locale,
): string {
  return names.move(ix.moveNames[idx] ?? ix.moves[idx] ?? '', l);
}

export function indexAbilityName(
  ix: { abilityNames: readonly string[]; abilities: readonly string[] },
  idx: number,
  names: NameResolver,
  l: Locale,
): string {
  return names.ability(ix.abilityNames[idx] ?? ix.abilities[idx] ?? '', l);
}
