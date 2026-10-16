/**
 * Dictionary-free search folding and ranking for Pokémon names (design pkmn-l10n.md §3.3).
 *
 * Pure and client-safe. It imports no name map and no `@pkmn/*` module: callers build the keys of an entity
 * (English + German + transliteration) with `pkmnSearchKeys` / the per-kind `xSearchKeys` from `./names` and
 * hand them to `rankedSearch`. A query matches both languages whatever the data locale.
 *
 * Its only runtime imports are `./id` and the client-safe constants of `@/i18n/config` (for the collator tag).
 */
import { INTL_TAG } from '@/i18n/config';
import type { DataLocale } from './types';

export { toID } from './id';

/** The match keys of one entity: `compact` = folded variants without spaces; `words` = every token of every variant. */
export interface SearchKeys {
  readonly compact: readonly string[];
  readonly words: readonly string[];
}

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Folds text for matching: lowercase; ♀ → f, ♂ → m; ß → ss; accents stripped (NFKD, so ä → a);
 * every run of non-alphanumerics → one space; trimmed.
 * `'Flabébé'` → `'flabebe'`, `'Type: Null'` → `'type null'`, `'U-turn'` → `'u turn'`.
 */
export function foldForSearch(text: string): string {
  return text
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** German transliteration first (ä → ae, ö → oe, ü → ue, ß → ss, any case), then `foldForSearch`. `'Brüllschweif'` → `'bruellschweif'`. */
export function transliterateGerman(text: string): string {
  return foldForSearch(
    text
      .normalize('NFC')
      .replace(/[äÄ]/g, 'ae')
      .replace(/[öÖ]/g, 'oe')
      .replace(/[üÜ]/g, 'ue')
      .replace(/[ßẞ]/g, 'ss'),
  );
}

/** Folded variants of the given names: `foldForSearch(n)` and `transliterateGerman(n)` for each; deduped; `undefined` and empty skipped. */
export function searchVariantsOf(names: readonly (string | undefined)[]): readonly string[] {
  const out: string[] = [];
  for (const name of names) {
    if (!name) continue;
    for (const variant of [foldForSearch(name), transliterateGerman(name)]) {
      if (variant && !out.includes(variant)) out.push(variant);
    }
  }
  return out;
}

/** `compact` = the variants with spaces removed; `words` = every token of every variant. Both deduped. */
export function buildSearchKeys(names: readonly (string | undefined)[]): SearchKeys {
  const compact: string[] = [];
  const words: string[] = [];
  for (const variant of searchVariantsOf(names)) {
    const joined = variant.replace(/ /g, '');
    if (joined && !compact.includes(joined)) compact.push(joined);
    for (const word of variant.split(' ')) {
      if (word && !words.includes(word)) words.push(word);
    }
  }
  return { compact, words };
}

export const MATCH_EXACT = 0;
export const MATCH_PREFIX = 1;
export const MATCH_WORD_PREFIX = 2;
export const MATCH_SUBSTRING = 3;
export const NO_MATCH = -1;

/**
 * How well `query` matches `keys`; lower is better, `NO_MATCH` (-1) when it does not match at all.
 * The query is folded with `foldForSearch`, then compared with the compact keys (exact, prefix, substring) and,
 * token by token, with the words (word-prefix: every query token is a prefix of some word).
 * An empty (or all-punctuation) query matches everything at `MATCH_SUBSTRING`, so a picker with no query lists all.
 */
export function matchRank(query: string, keys: SearchKeys): number {
  const folded = foldForSearch(query);
  const compactQuery = folded.replace(/ /g, '');
  if (!compactQuery) return MATCH_SUBSTRING;

  let substring = false;
  for (const key of keys.compact) {
    if (key === compactQuery) return MATCH_EXACT;
  }
  for (const key of keys.compact) {
    if (key.startsWith(compactQuery)) return MATCH_PREFIX;
    if (!substring && key.includes(compactQuery)) substring = true;
  }
  const tokens = folded.split(' ');
  if (tokens.every((token) => keys.words.some((word) => word.startsWith(token)))) return MATCH_WORD_PREFIX;
  return substring ? MATCH_SUBSTRING : NO_MATCH;
}

/**
 * Drops non-matches, sorts by rank, then by `tieBreak` (default: input order), and slices to `limit` after ranking.
 * Stable. Returns a new array.
 */
export function rankedSearch<T>(
  items: readonly T[],
  query: string,
  keysOf: (item: T) => SearchKeys,
  opts?: { limit?: number; tieBreak?: (a: T, b: T) => number },
): T[] {
  const ranked: { item: T; rank: number; index: number }[] = [];
  items.forEach((item, index) => {
    const rank = matchRank(query, keysOf(item));
    if (rank !== NO_MATCH) ranked.push({ item, rank, index });
  });
  const tieBreak = opts?.tieBreak;
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const byTie = tieBreak ? tieBreak(a.item, b.item) : 0;
    return byTie !== 0 ? byTie : a.index - b.index;
  });
  const limit = opts?.limit;
  const sliced = limit !== undefined && limit >= 0 ? ranked.slice(0, limit) : ranked;
  return sliced.map((r) => r.item);
}

const collators = new Map<DataLocale, Intl.Collator>();

/** Display-name collation for the locale (`sensitivity: 'base'`, `numeric: true`); cached per locale. */
export function compareDisplayNames(a: string, b: string, l: DataLocale): number {
  let collator = collators.get(l);
  if (!collator) {
    collator = new Intl.Collator(INTL_TAG[l], { sensitivity: 'base', numeric: true });
    collators.set(l, collator);
  }
  return collator.compare(a, b);
}
