/**
 * Species names (design pkmn-l10n.md §3.2). Client-safe; imports only `data/species.de.json`.
 *
 * Inputs are the canonical English names the app stores ("Ursaluna-Bloodmoon"). An id also resolves in 'de',
 * but 'en' returns the input unchanged, so callers holding ids pass the English name.
 */
import species from '../data/species.de.json';
import type { DataLocale } from '../types';
import type { SearchKeys } from '../search';
import { makeLookup, makeSearchKeys } from './lookup';

const speciesLookup: (englishNameOrId: string) => string | undefined = makeLookup(species);

/** Team-preview wildcard suffix ("Urshifu-*"). */
const WILDCARD = '-*';

/** German name or undefined (no fallback). For search, tests and reverse maps. */
export function germanSpecies(englishNameOrId: string): string | undefined {
  return speciesLookup(englishNameOrId);
}

function germanWithPrefixFallback(name: string): string | undefined {
  const exact = speciesLookup(name);
  if (exact !== undefined) return exact;
  const parts = name.split('-');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('-');
    const found = speciesLookup(prefix);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 'en' returns the input unchanged. 'de': the German name; else the German name of the longest known "-" prefix
 * ("Charizard-Foo" → "Glurak"); else the input. A trailing "-*" (team-preview wildcard) is kept:
 * "Urshifu-*" → "Wulaosu-*". Never returns "" for a non-empty input.
 */
export function localizeSpecies(name: string, l: DataLocale): string {
  if (l === 'en' || !name) return name;
  if (name.endsWith(WILDCARD) && name.length > WILDCARD.length) {
    const base = name.slice(0, -WILDCARD.length);
    const german = germanWithPrefixFallback(base);
    return german !== undefined ? `${german}${WILDCARD}` : name;
  }
  return germanWithPrefixFallback(name) ?? name;
}

/**
 * The only display line label. `finalStage` null (or empty) → the localized base alone;
 * else "<base> → <finalStage>", the same shape as `formatLineLabel` (`src/lib/draft/line-identity.ts`).
 * The draft UIs choose which stage to pass.
 */
export function localizeLineLabel(base: string, finalStage: string | null, l: DataLocale): string {
  const localizedBase = localizeSpecies(base, l);
  return finalStage ? `${localizedBase} → ${localizeSpecies(finalStage, l)}` : localizedBase;
}

/** English + German + transliteration keys of a species. */
export const speciesSearchKeys: (englishName: string) => SearchKeys = makeSearchKeys(germanSpecies);
