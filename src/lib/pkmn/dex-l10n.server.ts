import 'server-only';
/**
 * Language-aware wrappers around the `dex.ts` rich and list functions (design pkmn-l10n.md §3.6, §4.1).
 *
 * Each function takes the same arguments as its `dex.ts` namesake plus an optional trailing `opts?: { lang }`.
 * With `lang === 'de'`, every row's English Showdown description is replaced by the German game text (Sword/Shield
 * era; SV-new entries keep the English text) and the row gains `shortDescLang` (`descLang` for the `getAll*`
 * listings) saying which language the text is in, so the UI can mark an English fallback. Without `lang`, or with
 * `'en'`, the rows are exactly the `dex.ts` rows. Names and ids stay English; clients localize them.
 *
 * Why a separate module: `dex.ts` is reached by client bundles through `formats.ts` → `tiers.ts` (a pre-existing
 * bridge, see `i18n/__tests__/client-boundary.test.ts`), so it must not import the server-only description maps.
 * Route handlers (PK-5) import the language-aware functions from here and read `lang` with `isLocale`.
 */
import type { Locale } from '@/i18n/config';
import * as dex from './dex';
import type { AbilitySearchResult, ItemSearchResult, MoveSearchResult } from './dex';
import { localizeDesc, type DescKind } from './i18n/descriptions.server';
import { germanAbility } from './i18n/names/abilities';
import { germanItem } from './i18n/names/items';
import { foldForSearch, transliterateGerman } from './i18n/search';

export interface DescLangOptions {
  /** The UI locale of the request; absent = 'en' (rows unchanged). */
  lang?: Locale;
}

/** A rich row whose `shortDesc` may have been localized; `shortDescLang` is set only for `lang: 'de'`. */
export type WithDescLang<T> = T & { shortDescLang?: Locale };

/** A `getAll*` listing row whose `desc` may have been localized; `descLang` is set only for `lang: 'de'`. */
export interface ListingRow {
  name: string;
  desc: string;
  descLang?: Locale;
}

function localizeRows<T extends { name: string; shortDesc: string }>(
  rows: T[],
  kind: DescKind,
  lang: Locale | undefined,
): WithDescLang<T>[] {
  if (lang !== 'de') return rows;
  return rows.map((row) => {
    const desc = localizeDesc(kind, row.name, row.shortDesc, lang);
    return { ...row, shortDesc: desc.text, shortDescLang: desc.lang };
  });
}

function localizeListing(rows: { name: string; desc: string }[], kind: DescKind, lang: Locale | undefined): ListingRow[] {
  if (lang !== 'de') return rows;
  return rows.map((row) => {
    const desc = localizeDesc(kind, row.name, row.desc, lang);
    return { ...row, desc: desc.text, descLang: desc.lang };
  });
}

export function searchMovesRich(
  query: string,
  gen: number = 9,
  limit: number = 100,
  opts?: DescLangOptions,
): WithDescLang<MoveSearchResult>[] {
  return localizeRows(dex.searchMovesRich(query, gen, limit), 'move', opts?.lang);
}

export function searchItemsRich(
  query: string,
  gen: number = 9,
  limit: number = 100,
  opts?: DescLangOptions,
): WithDescLang<ItemSearchResult>[] {
  return localizeRows(dex.searchItemsRich(query, gen, limit), 'item', opts?.lang);
}

export function searchAbilitiesRich(
  query: string,
  gen: number = 9,
  limit: number = 100,
  opts?: DescLangOptions,
): WithDescLang<AbilitySearchResult>[] {
  return localizeRows(dex.searchAbilitiesRich(query, gen, limit), 'ability', opts?.lang);
}

export async function searchMovesForSpecies(
  query: string,
  speciesName: string,
  gen: number = 9,
  limit: number = 20,
  opts?: DescLangOptions,
): Promise<WithDescLang<MoveSearchResult>[]> {
  return localizeRows(await dex.searchMovesForSpecies(query, speciesName, gen, limit), 'move', opts?.lang);
}

export async function listMovesForSpecies(
  speciesName: string,
  gen: number = 9,
  opts?: DescLangOptions,
): Promise<WithDescLang<MoveSearchResult>[]> {
  return localizeRows(await dex.listMovesForSpecies(speciesName, gen), 'move', opts?.lang);
}

export function searchAbilitiesForSpecies(
  query: string,
  speciesName: string,
  gen: number = 9,
  opts?: DescLangOptions,
): WithDescLang<AbilitySearchResult>[] {
  return localizeRows(dex.searchAbilitiesForSpecies(query, speciesName, gen), 'ability', opts?.lang);
}

export function getAllItems(gen: number = 9, opts?: DescLangOptions): ListingRow[] {
  return localizeListing(dex.getAllItems(gen), 'item', opts?.lang);
}

export function getAllAbilities(gen: number = 9, opts?: DescLangOptions): ListingRow[] {
  return localizeListing(dex.getAllAbilities(gen), 'ability', opts?.lang);
}

/* ─── Description search ─────────────────────────────────────────────
 *
 * 'en': exactly `dex.ts` (every whitespace-separated term occurs in the English description or name).
 * 'de': a term may also occur in the German description or the German name, folded (case, accents) and
 * transliterated (ä→ae …), so "schaden" and "überreste" / "ueberreste" both match; returned rows carry the
 * German description.
 */

function germanHaystacks(german: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const text of german) {
    if (!text) continue;
    out.push(foldForSearch(text), transliterateGerman(text));
  }
  return out;
}

function descriptionSearchDe<T extends { name: string; shortDesc: string }>(
  rows: readonly T[],
  kind: DescKind,
  germanNameOf: (englishName: string) => string | undefined,
  query: string,
  limit: number,
): WithDescLang<T>[] {
  const rawTerms = query.toLowerCase().split(/\s+/);
  const foldedTerms = rawTerms.map((t) => foldForSearch(t).replace(/ /g, ''));
  const results: WithDescLang<T>[] = [];
  for (const row of rows) {
    const desc = localizeDesc(kind, row.name, row.shortDesc, 'de');
    const english = [row.shortDesc.toLowerCase(), row.name.toLowerCase()];
    const german = germanHaystacks([desc.lang === 'de' ? desc.text : undefined, germanNameOf(row.name)]);
    const matches = rawTerms.every(
      (term, i) =>
        english.some((h) => h.includes(term)) ||
        german.some((h) => h.includes(term) || h.replace(/ /g, '').includes(foldedTerms[i])),
    );
    if (!matches) continue;
    results.push({ ...row, shortDesc: desc.text, shortDescLang: desc.lang });
    if (results.length >= limit) break;
  }
  return results;
}

export function searchItemsByDescription(
  query: string,
  gen: number = 9,
  limit: number = 100,
  opts?: DescLangOptions,
): WithDescLang<ItemSearchResult>[] {
  if (opts?.lang !== 'de') return dex.searchItemsByDescription(query, gen, limit);
  // Every item of the generation (an empty query matches all), then the bilingual term filter.
  return descriptionSearchDe(dex.searchItemsByDescription('', gen, Infinity), 'item', germanItem, query, limit);
}

export function searchAbilitiesByDescription(
  query: string,
  gen: number = 9,
  limit: number = 100,
  opts?: DescLangOptions,
): WithDescLang<AbilitySearchResult>[] {
  if (opts?.lang !== 'de') return dex.searchAbilitiesByDescription(query, gen, limit);
  return descriptionSearchDe(
    dex.searchAbilitiesByDescription('', gen, Infinity),
    'ability',
    germanAbility,
    query,
    limit,
  );
}
