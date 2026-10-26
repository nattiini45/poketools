/**
 * Slugs (the stable address of a stored definition). Pure helpers, no I/O, shared by the format and ruleset libraries.
 *
 * `slugFromName` folds a name to ASCII (`NFKD`, marks dropped, plus ß æ œ ø đ ł), lower-cases it, turns every run of
 * other characters into one hyphen and cuts it to 63 characters; a name with nothing usable (emoji only) gives the
 * studio's `fallback`. `withSlugSuffix` makes the next candidate when a slug is taken: `-2` ... `-9`, then `-` plus four
 * hex characters the caller draws (so this module stays deterministic). Every result matches the kit's `SLUG_PATTERN`.
 */
import { SLUG_PATTERN } from './keys';

const MAX_SLUG_LENGTH = 63;
const HEX4 = /^[0-9a-f]{4}$/;

/** Letters that Unicode normalisation does not decompose into a base letter and a mark. */
const LETTER_FOLDS: Readonly<Record<string, string>> = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ł': 'l' };

function trimHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}

/** `fallback` must itself match `SLUG_PATTERN`. */
export function slugFromName(name: string, fallback: string): string {
  const folded = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøđł]/g, (letter) => LETTER_FOLDS[letter])
    .replace(/[^a-z0-9]+/g, '-');
  const trimmed = trimHyphens(trimHyphens(folded).slice(0, MAX_SLUG_LENGTH));
  return SLUG_PATTERN.test(trimmed) ? trimmed : fallback;
}

/**
 * The `attempt`-th candidate for `base`, a valid slug (attempt 1 is `base` itself). Attempts 2 to 9 add `-<attempt>`;
 * from 10 on the suffix is `-<hex4>`, which the caller draws at random (four lower-case hex characters; anything else
 * falls back to a value derived from the attempt).
 */
export function withSlugSuffix(base: string, attempt: number, hex4?: string): string {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('withSlugSuffix: attempt must be an integer >= 1');
  if (attempt === 1) return base;
  // Without a caller-supplied draw the suffix is derived from the attempt number, so the result stays deterministic.
  const suffix =
    attempt <= 9
      ? `-${attempt}`
      : `-${hex4 !== undefined && HEX4.test(hex4) ? hex4 : (attempt % 0x10000).toString(16).padStart(4, '0')}`;
  return `${trimHyphens(base.slice(0, MAX_SLUG_LENGTH - suffix.length))}${suffix}`;
}
