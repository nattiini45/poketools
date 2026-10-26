/**
 * Bilingual text (`LText`): the builder, the language resolution and immutable edit helpers.
 * Zero zod, safe in client bundles. Nothing here mutates its input.
 *
 * Resolution order (`resolveLText`): the viewer's language, the season language, the text's own
 * `base` language, then English, then German. The order is by language only: the translation
 * status never reorders it. A `machine` text is returned like any other (the UI marks it) and is
 * never preferred over a `human` or `reviewed` text of ANOTHER language, so a viewer who reads
 * German gets the machine German text before the human English one.
 */
import { LOCALES } from '@/i18n/config';
import { hasOwn } from './keys';
import type { LText, LTextStatus, LTextValue, Locale } from './types';

export interface ResolveOptions {
  /** The reader's language; omit for viewerless text (Discord, exports). */
  viewer?: Locale;
  /** The season's language, used when there is no viewer or the viewer's language is missing. */
  seasonLanguage?: Locale;
}

export interface ResolvedLText {
  value: string;
  locale: Locale;
  /** True when the returned language is not the first one asked for. */
  fallback: boolean;
}

function entryOf(text: unknown, locale: Locale): LTextValue | null {
  if (typeof text !== 'object' || text === null || !hasOwn(text, locale)) return null;
  const entry = (text as Record<string, unknown>)[locale];
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
  const v = (entry as Record<string, unknown>).v;
  const s = (entry as Record<string, unknown>).s;
  if (typeof v !== 'string' || v === '') return null;
  return { v, s: s === 'machine' || s === 'reviewed' ? s : 'human' };
}

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'de';
}

/**
 * Builds a text. `base` names the language the author wrote in and must have a value. `status`
 * applies to every language given.
 */
export function ltext(base: Locale, en?: string, de?: string, status: LTextStatus = 'human'): LText {
  const out: LText = { base };
  if (en !== undefined) out.en = { v: en, s: status };
  if (de !== undefined) out.de = { v: de, s: status };
  if (out[base] === undefined) throw new Error(`ltext: no ${base} text given for base language ${base}`);
  return out;
}

/** The text to show, or null when no language has a value (a document that skipped validation). */
export function resolveLText(text: LText, opts: ResolveOptions = {}): ResolvedLText | null {
  const base: Locale = isLocale((text as { base?: unknown } | null)?.base) ? text.base : 'en';
  const wanted: Locale = opts.viewer ?? opts.seasonLanguage ?? base;
  const order: Locale[] = [];
  const push = (locale: Locale | undefined) => {
    if (locale !== undefined && !order.includes(locale)) order.push(locale);
  };
  push(opts.viewer);
  push(opts.seasonLanguage);
  push(base);
  for (const locale of LOCALES) push(locale);
  for (const locale of order) {
    const entry = entryOf(text, locale);
    if (entry) return { value: entry.v, locale, fallback: locale !== wanted };
  }
  return null;
}

/** Languages without a value, in `LOCALES` order. */
export function missingLocales(text: LText): Locale[] {
  return LOCALES.filter((locale) => entryOf(text, locale) === null);
}

/** True when the language has a value. */
export function isTranslated(text: LText, locale: Locale): boolean {
  return entryOf(text, locale) !== null;
}

/** A copy with the language marked `reviewed`; the same object when there is nothing to mark. */
export function markReviewed(text: LText, locale: Locale): LText {
  const entry = entryOf(text, locale);
  if (!entry || entry.s === 'reviewed') return text;
  return { ...text, [locale]: { v: entry.v, s: 'reviewed' } };
}

/** A copy with one language set (added or replaced). */
export function withTranslation(text: LText, locale: Locale, value: string, status: LTextStatus): LText {
  return { ...text, [locale]: { v: value, s: status } };
}

/** Same base and same value and status in every language. */
export function ltextEquals(a: LText, b: LText): boolean {
  if (a.base !== b.base) return false;
  for (const locale of LOCALES) {
    const left = entryOf(a, locale);
    const right = entryOf(b, locale);
    if (left === null || right === null) {
      if (left !== right) return false;
      continue;
    }
    if (left.v !== right.v || left.s !== right.s) return false;
  }
  return true;
}
