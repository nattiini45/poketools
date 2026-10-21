/**
 * Station and loader copy of the route themes (T21, i18n D11: worlds follow
 * the viewer). The words live in `world-themes.stations.<themeId>` and
 * `world-themes.loader`; a theme definition carries no language of its own.
 *
 * Pure and client-safe. Engine surfaces that show a station's kicker title
 * or beat (`StationCard`) or the loader lines (`BallLoader`,
 * `RouteSceneRecovery`) read them through `localizeThemeStations` /
 * `themeLoaderCopy` with `useLocale()`.
 */
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/core';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import type { RouteLoaderCopy, RouteThemeStation } from '@/lib/route-world/theme-types';

/** The themes whose copy lives in `world-themes.stations`. */
export const ROUTE_THEME_COPY_IDS = ['plaza', 'sakura', 'mountain', 'clouds'] as const;
export type RouteThemeCopyId = (typeof ROUTE_THEME_COPY_IDS)[number];

/** The five station ids every route theme scrolls through. */
export const THEME_STATION_IDS = ['pulse', 'roster', 'teams', 'schedule', 'rules'] as const;
export type ThemeStationId = (typeof THEME_STATION_IDS)[number];

export interface ThemeStationText {
  /** The Station Card kicker title (the nav label). */
  title: string;
  /** The station's one-line beat. */
  beat: string;
}

export function isRouteThemeCopyId(id: string): id is RouteThemeCopyId {
  return (ROUTE_THEME_COPY_IDS as readonly string[]).includes(id);
}

function isThemeStationId(id: string): id is ThemeStationId {
  return (THEME_STATION_IDS as readonly string[]).includes(id);
}

/** Every station's title and beat of one theme, in `locale`. */
export function themeStationTexts(themeId: RouteThemeCopyId, locale: Locale): Readonly<Record<ThemeStationId, ThemeStationText>> {
  return getMessages(worldThemesMessages, locale).stations[themeId];
}

/** One station's title and beat; null for an unknown theme or station. */
export function themeStationText(themeId: string, stationId: string, locale: Locale): ThemeStationText | null {
  if (!isRouteThemeCopyId(themeId) || !isThemeStationId(stationId)) return null;
  return themeStationTexts(themeId, locale)[stationId];
}

/**
 * A theme's stations with the beat and the card title in `locale`. Stations
 * of a theme without copy here (the dev gallery, route-preview probes) come
 * back unchanged.
 */
export function localizeThemeStations<S extends RouteThemeStation>(
  themeId: string,
  stations: readonly S[],
  locale: Locale,
): readonly S[] {
  return stations.map((station) => {
    const text = themeStationText(themeId, station.id, locale);
    if (!text) return station;
    return {
      ...station,
      beat: text.beat,
      ...(station.card ? { card: { ...station.card, title: text.title } } : {}),
    };
  });
}

/** The loading-ceremony and recovery lines (one wording for every theme), in `locale`. */
export function themeLoaderCopy(locale: Locale): RouteLoaderCopy {
  const loader = getMessages(worldThemesMessages, locale).loader;
  return { loading: loader.loading, ready: loader.ready, failed: loader.failed, retry: loader.retry };
}
