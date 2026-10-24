/**
 * Format slugs (the stable address of a stored definition). Pure helpers, no I/O.
 *
 * `slugFromName` folds a name to ASCII (`NFKD`, marks dropped, plus ß æ œ ø đ ł), lower-cases it, turns every run of other characters
 * into one hyphen and cuts it to 63 characters; a name with nothing usable (emoji only) gives `format`.
 * `withSlugSuffix` makes the next candidate when a slug is taken: `-2` ... `-9`, then `-` plus four hex characters
 * the caller draws (so this module stays deterministic). Every result matches the kit's `SLUG_PATTERN`.
 */
import { SLUG_PATTERN } from '@/lib/format-kit/keys';

const MAX_SLUG_LENGTH = 63;
const FALLBACK_SLUG = 'format';
const HEX4 = /^[0-9a-f]{4}$/;

/** Letters that Unicode normalisation does not decompose into a base letter and a mark. */
const LETTER_FOLDS: Readonly<Record<string, string>> = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ł': 'l' };

function trimHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}

export function slugFromName(name: string): string {
  const folded = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøđł]/g, (letter) => LETTER_FOLDS[letter])
    .replace(/[^a-z0-9]+/g, '-');
  const slug = trimHyphens(folded).slice(0, MAX_SLUG_LENGTH);
  const trimmed = trimHyphens(slug);
  return SLUG_PATTERN.test(trimmed) ? trimmed : FALLBACK_SLUG;
}

/**
 * The `attempt`-th candidate for `base` (attempt 1 is `base` itself). Attempts 2 to 9 add `-<attempt>`; from 10 on
 * the suffix is `-<hex4>`, which the caller draws at random (four lower-case hex characters; anything else falls back to
 * a value derived from the attempt).
 */
export function withSlugSuffix(base: string, attempt: number, hex4?: string): string {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError('withSlugSuffix: attempt must be an integer >= 1');
  if (attempt === 1) return base;
  let suffix: string;
  if (attempt <= 9) {
    suffix = `-${attempt}`;
  } else {
    // Without a caller-supplied draw the suffix is derived from the attempt number, so the result stays deterministic.
    suffix = `-${hex4 !== undefined && HEX4.test(hex4) ? hex4 : (attempt % 0x10000).toString(16).padStart(4, '0')}`;
  }
  const head = trimHyphens(base.slice(0, MAX_SLUG_LENGTH - suffix.length));
  return `${head === '' ? FALLBACK_SLUG : head}${suffix}`;
}
