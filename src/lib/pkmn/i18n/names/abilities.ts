/**
 * Ability names (design pkmn-l10n.md §3.2). Client-safe; imports only `data/abilities.de.json`.
 */
import abilities from '../data/abilities.de.json';
import type { DataLocale } from '../types';
import type { SearchKeys } from '../search';
import { makeLookup, makeSearchKeys } from './lookup';

const abilityLookup: (englishNameOrId: string) => string | undefined = makeLookup(abilities);

/** German name or undefined (no fallback). */
export function germanAbility(englishNameOrId: string): string | undefined {
  return abilityLookup(englishNameOrId);
}

/** 'en' returns the input unchanged; 'de' the German name, else the input. "Guts" → "Adrenalin". */
export function localizeAbility(name: string, l: DataLocale): string {
  if (l === 'en') return name;
  return germanAbility(name) ?? name;
}

/** English + German + transliteration keys of an ability. */
export const abilitySearchKeys: (englishName: string) => SearchKeys = makeSearchKeys(germanAbility);
