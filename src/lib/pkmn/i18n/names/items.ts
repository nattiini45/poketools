/**
 * Item names (design pkmn-l10n.md §3.2). Client-safe; imports only `data/items.de.json`.
 */
import items from '../data/items.de.json';
import type { DataLocale } from '../types';
import type { SearchKeys } from '../search';
import { makeLookup, makeSearchKeys } from './lookup';

const itemLookup: (englishNameOrId: string) => string | undefined = makeLookup(items);

/** German name or undefined (no fallback). The 14 allowlisted Gen-2 relics have none. */
export function germanItem(englishNameOrId: string): string | undefined {
  return itemLookup(englishNameOrId);
}

/** 'en' returns the input unchanged; 'de' the German name, else the input. "Choice Scarf" → "Wahlschal". */
export function localizeItem(name: string, l: DataLocale): string {
  if (l === 'en') return name;
  return germanItem(name) ?? name;
}

/** English + German + transliteration keys of an item. */
export const itemSearchKeys: (englishName: string) => SearchKeys = makeSearchKeys(germanItem);
