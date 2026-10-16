/**
 * Move names (design pkmn-l10n.md §3.2). Client-safe; imports only `data/moves.de.json`
 * (plus `./misc` for the type of a typed Hidden Power).
 */
import moves from '../data/moves.de.json';
import { toID } from '../id';
import type { DataLocale } from '../types';
import type { SearchKeys } from '../search';
import { makeLookup, makeSearchKeys } from './lookup';
import { germanType } from './misc';

const moveLookup: (englishNameOrId: string) => string | undefined = makeLookup(moves);

const HIDDEN_POWER_ID = 'hiddenpower';

/**
 * German name or undefined (no fallback). A typed Hidden Power ("Hidden Power Fire", "Hidden Power [Fire]",
 * id `hiddenpowerfire`) becomes "Kraftreserve (Feuer)".
 */
export function germanMove(englishNameOrId: string): string | undefined {
  const exact = moveLookup(englishNameOrId);
  if (exact !== undefined) return exact;
  const id = toID(englishNameOrId);
  if (id.length > HIDDEN_POWER_ID.length && id.startsWith(HIDDEN_POWER_ID)) {
    const base = moveLookup(HIDDEN_POWER_ID);
    const type = germanType(id.slice(HIDDEN_POWER_ID.length));
    if (base !== undefined && type !== undefined) return `${base} (${type})`;
  }
  return undefined;
}

/** 'en' returns the input unchanged; 'de' the German name, else the input. "U-turn" → "Kehrtwende". */
export function localizeMove(name: string, l: DataLocale): string {
  if (l === 'en') return name;
  return germanMove(name) ?? name;
}

/** English + German + transliteration keys of a move. */
export const moveSearchKeys: (englishName: string) => SearchKeys = makeSearchKeys(germanMove);
