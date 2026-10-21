/**
 * i18n configuration: client-safe constants and guards (docs: i18n-core §1.1).
 *
 * No `server-only`, no `next/*`, no React: `src/lib/draft/time.ts` and
 * `src/lib/draft-ui/clock.ts` re-export `LEAGUE_TIME_ZONE` from here, and
 * pure modules (Discord embeds, painters) import the guards.
 */

export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

/** First-time visitors (product decision). */
export const DEFAULT_LOCALE: Locale = 'en';
/** Viewerless text with no league (Discord, social, overlays without ?lang=). Existing leagues are German. */
export const DEFAULT_CONTENT_LOCALE: Locale = 'de';

export const LOCALE_COOKIE = 'plc_locale';
/** Value `'en'`, or absent = Pokémon terms follow the UI language. */
export const PKMN_LANG_COOKIE = 'plc_pkmn_lang';
/** IANA zone written by the browser (`TimeZoneSync`). */
export const TZ_COOKIE = 'plc_tz';
/** One year, in seconds. */
export const LANGUAGE_COOKIE_MAX_AGE = 31_536_000;

/** Server snapshot of the viewer's zone when `plc_tz` is absent. */
export const DEFAULT_TIME_ZONE = 'Europe/Berlin';
/** The ONLY declaration of the league zone; draft `time.ts` / `clock.ts` re-export it. */
export const LEAGUE_TIME_ZONE = 'Europe/Berlin';
/** `useRequestTime()` without a provider (D13); deterministic for tests. */
export const FALLBACK_REQUEST_TIME = Date.UTC(2026, 9, 9, 12);

export const INTL_TAG = { en: 'en-GB', de: 'de-DE' } as const satisfies Record<Locale, string>;
export type IntlTag = (typeof INTL_TAG)[Locale];

export type PkmnTermsPreference = 'follow' | 'en';

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'de';
}

const TIME_ZONE_SHAPE = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$|^UTC$/;
const zoneCache = new Map<string, boolean>();

/** A plausible IANA zone name that this runtime's Intl accepts. */
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) return false;
  if (!TIME_ZONE_SHAPE.test(v)) return false;
  const cached = zoneCache.get(v);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: v });
    ok = true;
  } catch {
    ok = false;
  }
  if (zoneCache.size < 256) zoneCache.set(v, ok);
  return ok;
}

export function isPkmnTermsPreference(v: unknown): v is PkmnTermsPreference {
  return v === 'follow' || v === 'en';
}

/**
 * The Pokémon-data (names) locale: the UI locale, or English when the viewer
 * opted into English Pokémon terms. English UI never shows German data names.
 */
export function resolveDataLocale(ui: Locale, pref: PkmnTermsPreference): Locale {
  return pref === 'en' ? 'en' : ui;
}
