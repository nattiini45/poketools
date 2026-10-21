/**
 * Per-locale caches of `Intl` objects shared by `core.ts`, `rich.tsx` and
 * `format.ts`. Internal to `src/i18n`.
 */
import { INTL_TAG, type Locale } from './config';

const pluralRules = new Map<Locale, Intl.PluralRules>();
const integerFormats = new Map<Locale, Intl.NumberFormat>();

export function pluralRulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(INTL_TAG[locale]);
    pluralRules.set(locale, rules);
  }
  return rules;
}

/**
 * Formats a number param the way messages print it: `12345.5` -> `12,345.5` |
 * `12.345,5`. Grouping starts at five digits (`min2`), so a year or a
 * four-digit count prints as `2026` in both languages.
 */
export function formatParamNumber(value: number, locale: Locale): string {
  let format = integerFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(INTL_TAG[locale], { maximumFractionDigits: 20, useGrouping: 'min2' });
    integerFormats.set(locale, format);
  }
  return format.format(value);
}
