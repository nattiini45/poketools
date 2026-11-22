import type { PkmnKind } from '@/lib/pkmn/i18n/types';
import type { WikiSearchResult, WikiEntityType } from '@/types/wiki';

/**
 * Result-shape helpers shared by the wiki API route and the search UIs.
 *
 * Deliberately map-free: `/api/wiki/search` resolves `label` server-side with
 * the viewer's data locale, so clients — including the NavBar's SiteSearch —
 * render `result.label` and never import a `data/*.de.json` name map for it
 * (issue #140). Anything that needs the maps imports `names/*` itself.
 */

/** The pkmn-layer kind of each result type, for localizing the display name. */
export const RESULT_KIND: Record<WikiEntityType, PkmnKind> = {
  pokemon: 'species',
  move: 'move',
  item: 'item',
  ability: 'ability',
  tera: 'type',
};

/** Display label of a result: the API's localized `label`, else the English name. */
export function resultLabel(result: WikiSearchResult): string {
  return result.label ?? result.name;
}

export function getWikiPath(result: WikiSearchResult): string {
  const encodedName = encodeURIComponent(result.name);
  switch (result.type) {
    case 'pokemon':
      return `/pokemon/${encodedName}`;
    case 'move':
      return `/wiki/moves/${encodedName}`;
    case 'item':
      return `/wiki/items/${encodedName}`;
    case 'ability':
      return `/wiki/abilities/${encodedName}`;
    case 'tera':
      return `/wiki/tera/${encodedName}`;
  }
}
