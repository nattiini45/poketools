/**
 * Route-theme registry — id → definition.
 *
 * `SeasonWorld.routeThemeId` (worlds registry) names a theme; the client-side
 * `WorldStateProvider` resolves it here. Adding a theme is an additive entry
 * (the same discipline as `src/lib/worlds/registry.ts`) — never an engine edit.
 *
 * Client-imported module: theme definitions carry functions
 * (`paletteExtension`), so server components pass the theme ID across the RSC
 * boundary and only client code touches this registry.
 */

import type { RouteThemeDefinition } from '@/lib/route-world/theme-types';
import { plazaTheme } from './plaza/theme';
import { sakuraTheme } from './sakura/theme';
import { mountainTheme } from './mountain/theme';
import { cloudsTheme } from './clouds/theme';

/**
 * Engine-facing view of a theme: the palette extension's concrete type is
 * erased to `object` (the generic only appears in `paletteExtension`'s
 * return, so every concrete theme is assignable). The provider merges the
 * extension into the palette structurally; theme scene code recovers the
 * concrete type through its own typed helper (plaza: `usePlazaPalette`,
 * sakura: `useSakuraPalette`).
 */
export type AnyRouteTheme = RouteThemeDefinition<object>;

const THEMES: Record<string, AnyRouteTheme> = {
  [plazaTheme.id]: plazaTheme,
  [sakuraTheme.id]: sakuraTheme,
  [mountainTheme.id]: mountainTheme,
  [cloudsTheme.id]: cloudsTheme,
};

/** Resolve a theme id; `null` for DOM-only worlds and unknown ids. */
export function resolveRouteTheme(id: string | undefined | null): AnyRouteTheme | null {
  if (!id) return null;
  return THEMES[id] ?? null;
}
