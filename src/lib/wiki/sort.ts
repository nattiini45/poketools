/**
 * Client-safe sort comparator of the wiki index tables (`WikiIndexTable`).
 *
 * Numbers compare numerically; strings (display names, localized labels) collate with the pkmn layer's
 * `compareDisplayNames` for the viewer's data locale, so "Äpfel"-style German names sort next to "A…" and
 * "Bisaflor" sorts before "Glurak" whatever their English order. Null / undefined / non-finite values sort last.
 */
import { compareDisplayNames } from '@/lib/pkmn/i18n/search';
import type { DataLocale } from '@/lib/pkmn/i18n/types';

export type WikiSortValue = string | number | null | undefined;

export function compareWikiSortValues(a: WikiSortValue, b: WikiSortValue, locale: DataLocale): number {
  const aMissing = a === null || a === undefined || (typeof a === 'number' && !Number.isFinite(a));
  const bMissing = b === null || b === undefined || (typeof b === 'number' && !Number.isFinite(b));
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return compareDisplayNames(String(a), String(b), locale);
}
