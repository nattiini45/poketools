import { getRegisteredRouteThemeIds } from './registry';

/**
 * Shared 3D World Theme select options: Auto + every REGISTERED route theme
 * (derived from the world registry, so options appear as theme packages land —
 * never from the DB CHECK list, which may name unregistered ids). Used by both
 * the create form (`LeagueForm`) and the post-create admin control
 * (`LeagueThemeControl`) so the two pickers grow in lockstep.
 *
 * Pure and client-safe — no DB calls, no client-only imports.
 */

export interface RouteThemeOption {
  value: string;
  label: string;
}

export function getRouteThemeOptions(): RouteThemeOption[] {
  return [
    { value: 'auto', label: 'Auto (format default)' },
    ...getRegisteredRouteThemeIds().map((id) => ({
      value: id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
    })),
  ];
}
