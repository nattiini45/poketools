/**
 * Internal helpers shared by the per-kind name modules (design pkmn-l10n.md §3.2). Imports no JSON.
 */
import { toID } from '../id';
import { buildSearchKeys, type SearchKeys } from '../search';

/** A lookup into one generated map (keyed by @pkmn id): `lookup('Choice Scarf')` = `map['choicescarf']`. Own keys only. */
export function makeLookup(map: Readonly<Record<string, string>>): (englishNameOrId: string) => string | undefined {
  return (englishNameOrId: string) => {
    const id = toID(englishNameOrId);
    if (!id || !Object.prototype.hasOwnProperty.call(map, id)) return undefined;
    return map[id];
  };
}

const KEY_CACHE_LIMIT = 4096;

/**
 * Memoized `buildSearchKeys([english, german(english)])`. Bounded: cleared when it outgrows `KEY_CACHE_LIMIT`
 * (the universe of one kind is at most ~1,400 names, so normal use never clears it).
 */
export function makeSearchKeys(german: (englishName: string) => string | undefined): (englishName: string) => SearchKeys {
  const cache = new Map<string, SearchKeys>();
  return (englishName: string) => {
    const hit = cache.get(englishName);
    if (hit) return hit;
    const keys = buildSearchKeys([englishName, german(englishName)]);
    if (cache.size >= KEY_CACHE_LIMIT) cache.clear();
    cache.set(englishName, keys);
    return keys;
  };
}
