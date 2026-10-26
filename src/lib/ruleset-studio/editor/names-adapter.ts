/**
 * Name lists for the ruleset entry list editor. A few places store a list of English display names (the draft league's
 * banned moves and items: `format_rules`), while the picker works on ids (`toID` of the English name). This module converts
 * between the two without losing anything the stored list holds:
 *
 *  - names to ids on load: a name the catalog does not know still has an id, so it shows as an "unknown entry" chip instead of
 *    vanishing; two names that fold to one id show once;
 *  - ids to names on change: a name that was stored keeps its exact spelling (an edit of another entry never rewrites it);
 *    a newly added id becomes the catalog's English name.
 *
 * Client-safe and pure: the only import is the id fold.
 */
import { toID } from '@/lib/pkmn/i18n/id';

/** The ids of a list of names, in order, without duplicates and without names that fold to nothing. */
export function namesToIds(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const name of names) {
    const id = toID(name);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * The names of an edited id list. `previous` is the stored list the ids were made from (its spellings are kept);
 * `nameOfId` is the catalog's English name of an id (`undefined` when unknown, which keeps the id itself).
 */
export function idsToNames(ids: readonly string[], previous: readonly string[], nameOfId: (id: string) => string | undefined): string[] {
  const stored = new Map<string, string>();
  for (const name of previous) {
    const id = toID(name);
    if (id !== '' && !stored.has(id)) stored.set(id, name);
  }
  return ids.map((id) => stored.get(id) ?? nameOfId(id) ?? id);
}
