import 'server-only';
import type { I18nProviderProps } from '@/i18n/client';
import { DEFAULT_CONTENT_LOCALE, LEAGUE_TIME_ZONE, type Locale } from '@/i18n/config';
import { resolveContentLocale, type ContentRef } from '@/i18n/content-locale';
import type { OverlayConfig } from '@/types/broadcast';

/**
 * The language of an OBS overlay (i18n-core §6.5, critique S12).
 *
 * Overlays are viewerless: a browser source in OBS has no meaningful language
 * cookie, so this never reads it. Order:
 * 1. `?lang=` (`config.lang`, set by the creator's URL builder);
 * 2. the league language (`seasons.language`) when the overlay belongs to a
 *    season, tournament or match;
 * 3. `DEFAULT_CONTENT_LOCALE` (`'de'`) for solo, player and wiki overlays.
 *
 * Refs per overlay family: league `{ seasonId }`, draft `{ seasonId: <pool's
 * season> }` (DF9), match `{ matchId }`, solo / player / wiki `{}`.
 */
export async function resolveOverlayLocale(
  config: Pick<OverlayConfig, 'lang'>,
  ref: ContentRef,
): Promise<Locale> {
  if (config.lang) return config.lang;
  if (ref.seasonId || ref.tournamentId || ref.matchId) return resolveContentLocale(ref);
  return DEFAULT_CONTENT_LOCALE;
}

/**
 * Props for the nested `I18nProvider` an overlay mounts (`OverlayShell` does
 * it). Pokémon terms follow the overlay language (`dataLocale = locale`): the
 * viewer's "keep Pokémon terms in English" preference never applies to
 * viewerless output. Times render in the league zone, pinned so the OBS
 * machine's own zone never replaces it after hydration.
 */
export function overlayI18nProps(locale: Locale): Omit<I18nProviderProps, 'children'> {
  return { locale, dataLocale: locale, timeZone: LEAGUE_TIME_ZONE, pinTimeZone: true, requestTime: Date.now() };
}
