/**
 * How a domain entry (a @pkmn species id such as `ursalunabloodmoon`) is shown and searched on the player page.
 *
 * The views carry ids, not display names. German comes from the species name map (it resolves ids). English has no
 * full client-safe id-to-name map, so an id is shown with a capital first letter, except the ids whose canonical name
 * differs (`mrmime` is "Mr. Mime"), which `english-names.ts` lists. Only the species map is imported (not the names
 * barrel), so the page does not pay for the move, item and ability maps. The player page and the admin Live tab both
 * use this one function.
 */
import { IRREGULAR_ENGLISH_SPECIES } from './english-names';
import { foldForSearch } from '@/lib/pkmn/i18n/search';
import { germanSpecies, localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { DataLocale } from '@/lib/pkmn/i18n/types';

const PLAIN_ID = /^[a-z0-9]+$/;

/**
 * The English name of a plain id: the canonical name where it differs from the capitalised id, else the id with a capital
 * first letter. Anything that is not a plain id (already a name) is returned as it is.
 */
function englishName(id: string): string {
  if (!PLAIN_ID.test(id)) return id;
  return Object.prototype.hasOwnProperty.call(IRREGULAR_ENGLISH_SPECIES, id) ? IRREGULAR_ENGLISH_SPECIES[id]! : id.charAt(0).toUpperCase() + id.slice(1);
}

/** The name to show for entry `id` in the viewer's Pokémon-data language. */
export function speciesDisplayName(id: string, locale: DataLocale): string {
  if (locale === 'de') {
    const german = localizeSpecies(id, 'de');
    if (german !== id) return german;
  }
  return englishName(id);
}

const compact = (text: string): string => foldForSearch(text).replace(/ /g, '');

/** Whether entry `id` matches the typed search text, in English or German whatever the display language. */
export function entryMatchesSearch(id: string, query: string): boolean {
  const wanted = compact(query);
  if (wanted === '') return true;
  const german = germanSpecies(id);
  return compact(id).includes(wanted) || (german !== undefined && compact(german).includes(wanted));
}
