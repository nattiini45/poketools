/**
 * Canvas and route-chrome copy (T20, i18n D11: worlds follow the viewer).
 *
 * Painted words live in the `paint` namespace, the route engine's DOM words
 * in `world-route`. Both are stored in sentence case; a painter that letters
 * in capitals calls `paintCaps`, which upper-cases the TEMPLATE outside its
 * `{param}` placeholders (`upperForPaint`: `ß` → `SS`, never `ẞ`) and then
 * interpolates — so a name passed as a param keeps the case its caller gave
 * it, exactly as the old template literals did (`LÄUFT · ${home}`).
 *
 * Pure and client-safe (no React, no three). Every painter receives its
 * `locale` from the R3F component that builds the texture (`useLocale()` in
 * the texture's `useMemo` deps), so textures are painted in the viewer's
 * language during the ceremony and nothing repaints after the reveal (a
 * language switch is a full reload).
 */
import type { Locale } from '@/i18n/config';
import { createTranslator, getMessages, interpolate, isPluralForms, lookupPath, selectPlural, upperForPaint } from '@/i18n/core';
import { paintMessages } from '@/i18n/messages/paint';
import type paintEn from '@/i18n/messages/paint/en';
import { worldRouteMessages } from '@/i18n/messages/world-route';
import type { ArgsFor, At, Leaves, ParamValue } from '@/i18n/types';

type PaintMessages = typeof paintEn;
/** A dotted key under `paint`. */
export type PaintKey = Leaves<PaintMessages>;

/** The `paint` translator (sentence case; memoized per locale). */
export function paintT(locale: Locale) {
  return createTranslator(paintMessages, locale);
}

/** The `world-route` translator (DOM chrome; memoized per locale). */
export function routeT(locale: Locale) {
  return createTranslator(worldRouteMessages, locale);
}

const PLACEHOLDER = /^\{[A-Za-z0-9_]+\}$/;

/** Upper-case a template everywhere except inside its `{param}` placeholders. */
function upperOutsidePlaceholders(template: string, locale: Locale): string {
  return template
    .split(/(\{[A-Za-z0-9_]+\})/)
    .map((part) => (PLACEHOLDER.test(part) ? part : upperForPaint(part, locale)))
    .join('');
}

/**
 * A painted line in capitals: the `paint` message in `locale`, upper-cased
 * outside its placeholders, then interpolated (numbers formatted per locale,
 * string params kept as given). An unknown key paints the key itself.
 */
export function paintCaps<K extends PaintKey>(locale: Locale, key: K, ...args: ArgsFor<At<PaintMessages, K>>): string {
  const params = args[0] as Readonly<Record<string, ParamValue>> | undefined;
  const leaf = lookupPath(getMessages(paintMessages, locale), key);
  let template: string = key;
  if (typeof leaf === 'string') template = leaf;
  else if (isPluralForms(leaf)) template = selectPlural(leaf, typeof params?.count === 'number' ? params.count : 0, locale);
  return interpolate(upperOutsidePlaceholders(template, locale), params, locale);
}

/** A data value (a league or stage name, a species) lettered in capitals in `locale`. */
export function capsFor(text: string, locale: Locale): string {
  return upperForPaint(text, locale);
}
