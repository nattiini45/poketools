import 'server-only';
/**
 * Swaps the German game text into a memoized, locale-neutral wiki entry (after the lookup, never inside the
 * memo: i18n-core §3 caching rule). Descriptions follow the UI locale (pkmn-l10n §3.4).
 */
import type { Locale } from '@/i18n/config';
import { localizeDesc, type DescKind } from '@/lib/pkmn/i18n/descriptions.server';

interface DescribedEntry {
  name: string;
  description: string;
  shortDesc: string;
}

export interface LocalizedWikiEntry<T extends DescribedEntry> {
  /** A copy of the entry with `description` / `shortDesc` in the viewer's language where game text exists. */
  entry: T;
  /** True when the page is German and no German game text exists (the English text is shown, tagged "EN"). */
  descFallback: boolean;
}

export function localizeWikiEntry<T extends DescribedEntry>(
  kind: DescKind,
  entry: T,
  locale: Locale,
): LocalizedWikiEntry<T> {
  if (locale === 'en') return { entry, descFallback: false };
  const description = localizeDesc(kind, entry.name, entry.description, locale);
  const shortDesc = localizeDesc(kind, entry.name, entry.shortDesc, locale);
  const hasEnglishText = entry.description !== '' || entry.shortDesc !== '';
  return {
    // The German game text is one text: description and summary become the same string, so the page shows
    // a single description block.
    entry: { ...entry, description: description.text, shortDesc: shortDesc.text },
    descFallback: hasEnglishText && description.lang === 'en',
  };
}
