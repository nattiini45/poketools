/**
 * Bilingual text search of the finder (draft-frontend §4.3, critique S7). Client-safe, pure.
 *
 * Folding is the pkmn layer's (`foldForSearch`, `transliterateGerman`); this module only adds the draft's
 * word-prefix semantics on top of `SearchKeys`:
 * - a stage matches when a query variant's compact form is a prefix of one of the stage's compact keys, or
 *   when every query word is a prefix of a DISTINCT word of the stage's keys;
 * - substrings inside a word never match, so "Samurott-Hisui" never matches plain Samurott;
 * - only stage names are searched (never the line label as one string), which keeps forms apart.
 */
import { foldForSearch, transliterateGerman, type SearchKeys } from '@/lib/pkmn/i18n/search';
import type { PreparedLine } from './prepare';

export interface FoldedQuery {
  variants: { compact: string; words: string[] }[];
}

/** The query folded plainly and with German transliteration, deduped. An empty query has no variants. */
export function foldQuery(q: string): FoldedQuery {
  const variants: FoldedQuery['variants'] = [];
  const seen = new Set<string>();
  for (const folded of [foldForSearch(q), transliterateGerman(q)]) {
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    const words = folded.split(' ').filter((w) => w.length > 0);
    variants.push({ compact: words.join(''), words });
  }
  return { variants };
}

/** True when the query matches everything (blank or punctuation only). */
export function isEmptyQuery(q: FoldedQuery): boolean {
  return q.variants.length === 0;
}

/**
 * Whether each query word can take its own key word that it prefixes (a bipartite matching; query word
 * counts are tiny, so plain backtracking is fine).
 */
function wordsMatchDistinct(queryWords: readonly string[], keyWords: readonly string[]): boolean {
  const used = new Array<boolean>(keyWords.length).fill(false);
  const assign = (i: number): boolean => {
    if (i === queryWords.length) return true;
    for (let k = 0; k < keyWords.length; k++) {
      if (used[k] || !keyWords[k].startsWith(queryWords[i])) continue;
      used[k] = true;
      if (assign(i + 1)) return true;
      used[k] = false;
    }
    return false;
  };
  return queryWords.length <= keyWords.length && assign(0);
}

export function stageMatchesText(keys: SearchKeys, q: FoldedQuery): boolean {
  if (isEmptyQuery(q)) return true;
  return q.variants.some(
    (v) => keys.compact.some((c) => c.startsWith(v.compact)) || wordsMatchDistinct(v.words, keys.words),
  );
}

/** Some stage of the line matches. */
export function lineMatchesText(line: PreparedLine, q: FoldedQuery): boolean {
  if (isEmptyQuery(q)) return true;
  return line.stageKeys.some((keys) => stageMatchesText(keys, q));
}
