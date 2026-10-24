import type { SeasonFormatType } from '@/types/season';
import type { SeasonWorld, WorldResolvableSeason, WorldSection } from './types';

/**
 * Gives each section its nav-label message key (`world/client` →
 * `nav.worlds.<worldId>.<sectionId>`, i18n-core §11.3 T19). `navLabel` stays
 * the English source label and the fallback; `WorldNav` shows the label in
 * the viewer's language.
 */
function withNavKeys(worldId: string, sections: readonly Omit<WorldSection, 'navKey'>[]): WorldSection[] {
  return sections.map((section) => ({ ...section, navKey: `${worldId}.${section.id}` }));
}

/**
 * Format-keyed season-world registry.
 *
 * Pure and server-safe: no DB calls, no client-only imports. Safe to call
 * from server components. To add a future world (e.g. Core Liga, draft),
 * append a new definition to WORLDS before the default fallback — no edits
 * to existing worlds.
 */

/**
 * The DOM-only fallback world — since the C-096 auto-map flip it matches NO
 * format: the regular non-EPB resolution is the sakura park below. This
 * world is reached only through `resolveWorld`'s unregistered-pick fallback
 * (a league pin naming no registered world; single `console.warn`, never a
 * crash) or the `?? defaultWorld` safety net in `getSeasonWorld` (a future
 * format missing every match list). Keeps the classic anchored-section
 * manifest with no 3D route theme.
 */
const defaultWorld: SeasonWorld = {
  id: 'default',
  matchesFormats: [],
  sections: withNavKeys('default', [
    { id: 'pulse', navLabel: 'Pulse' },
    { id: 'phases', navLabel: 'Phases' },
    { id: 'reports', navLabel: 'Reports' },
    { id: 'stats', navLabel: 'Stats' },
    { id: 'rules', navLabel: 'Rules' },
  ]),
  draftExperience: 'classic',
  tokenNamespace: 'default',
};

/** The EvoLiga arena world for the evolution_point_buy format. */
const evoligaWorld: SeasonWorld = {
  id: 'evoliga',
  matchesFormats: ['evolution_point_buy'],
  sections: withNavKeys('evoliga', [
    { id: 'pulse', navLabel: 'Pulse' },
    { id: 'roster', navLabel: 'Point-Buy list' },
    { id: 'teams', navLabel: 'Teams' },
    { id: 'schedule', navLabel: 'Schedule' },
    { id: 'rules', navLabel: 'Rules' },
  ]),
  draftExperience: 'evoliga',
  tokenNamespace: 'evoliga',
  routeThemeId: 'plaza',
};

/**
 * The Sakura Park world (C-093) — the cherry-blossom lakeside park (its words
 * follow the viewer, i18n D11). C-096 auto-map default: matches every non-EPB season format, so
 * leagues without an explicit `route_theme` pick resolve to the park, and
 * standalone tournaments get the same outcome via `getDefaultWorld`. The
 * flip is overridable at both existing layers: a league admin can pin any
 * registered theme over the default (`resolveWorld`'s explicit-pick branch),
 * and a viewer override beats both for the session — resolved HERE,
 * server-side (`resolveViewerWorld` reads `?world=` first, then the pick
 * `WorldOverrideRedirect` mirrored out of localStorage into that param).
 */
const sakuraWorld: SeasonWorld = {
  id: 'sakura',
  matchesFormats: ['singles', 'doubles', 'draft'],
  sections: withNavKeys('sakura', [
    { id: 'pulse', navLabel: 'Pulse' },
    { id: 'roster', navLabel: 'Point-Buy list' },
    { id: 'teams', navLabel: 'Teams' },
    { id: 'schedule', navLabel: 'Schedule' },
    { id: 'rules', navLabel: 'Rules' },
  ]),
  draftExperience: 'classic',
  tokenNamespace: 'sakura',
  routeThemeId: 'sakura',
};

/**
 * The Mountain Pass world (C-094) — the alpine valley.
 * Matches NO format in the format map: the valley is reachable only through
 * a league's explicit `route_theme: 'mountain'` pick (or the viewer
 * override / `?world=mountain` preview), so resolving it never changes what
 * any existing league renders.
 */
const mountainWorld: SeasonWorld = {
  id: 'mountain',
  matchesFormats: [],
  sections: withNavKeys('mountain', [
    { id: 'pulse', navLabel: 'Pulse' },
    { id: 'roster', navLabel: 'Point-Buy list' },
    { id: 'teams', navLabel: 'Teams' },
    { id: 'schedule', navLabel: 'Schedule' },
    { id: 'rules', navLabel: 'Rules' },
  ]),
  draftExperience: 'classic',
  tokenNamespace: 'mountain',
  routeThemeId: 'mountain',
};

/**
 * The Skyisle world (C-095) — the sky-island chain. Matches
 * NO format in the format map: the isles are reachable only through a
 * league's explicit `route_theme: 'clouds'` pick (or the viewer override /
 * `?world=clouds` preview), so resolving it never changes what any existing
 * league renders.
 */
const cloudsWorld: SeasonWorld = {
  id: 'clouds',
  matchesFormats: [],
  sections: withNavKeys('clouds', [
    { id: 'pulse', navLabel: 'Pulse' },
    { id: 'roster', navLabel: 'Point-Buy list' },
    { id: 'teams', navLabel: 'Teams' },
    { id: 'schedule', navLabel: 'Schedule' },
    { id: 'rules', navLabel: 'Rules' },
  ]),
  draftExperience: 'classic',
  tokenNamespace: 'clouds',
  routeThemeId: 'clouds',
};

/** Worlds are checked in order; the default world is the fallback. */
const WORLDS: readonly SeasonWorld[] = [evoligaWorld, sakuraWorld, mountainWorld, cloudsWorld, defaultWorld];

/**
 * Resolve the season world for a format type — the auto-map arm.
 * `evolution_point_buy` → the evoliga world (plaza theme); every other
 * format → the sakura park world (C-096 friendly-park default). This is the
 * lowest-precedence layer: a league's explicit `route_theme` pin
 * (`resolveWorld`) and the viewer's session override
 * (`WorldStateProvider`) both win over it.
 *
 * The Format Studio `custom` league type resolves to the sakura park by name (the classic draft experience), so it
 * never reaches the default-world safety net. It is not added to the sakura world's `matchesFormats`: that list
 * is part of the world payload the route data ships, which stays byte-identical for every existing league.
 */
export function getSeasonWorld(format: SeasonFormatType): SeasonWorld {
  if (format === 'custom') return sakuraWorld;
  return WORLDS.find((world) => world.matchesFormats.includes(format)) ?? defaultWorld;
}

/** localStorage key for the per-viewer 3D world override (repo's first
 *  localStorage use — session-scoped preference, see C-092/C-096). */
export const WORLD_OVERRIDE_STORAGE_KEY = 'poketools:world-override';

/** URL parameter that overrides the 3D world for one view (`?world=<id>`). */
export const WORLD_OVERRIDE_URL_PARAM = 'world';

/**
 * The route-theme ids this tree can actually resolve — derived from the world
 * registry, NOT from the DB CHECK list (which may name themes whose packages
 * have not landed yet). The admin picker and the viewer switcher both draw
 * their options from here, so they grow automatically as themes register.
 */
export function getRegisteredRouteThemeIds(): string[] {
  return [...new Set(WORLDS.map((world) => world.routeThemeId).filter(
    (id): id is string => typeof id === 'string',
  ))];
}

/**
 * Resolve the season world for a league, honoring its picked route theme.
 *
 * An explicit `route_theme` resolves ONLY when a registered world provides
 * that theme id; an unregistered pick (e.g. 'sakura' before its C-093
 * package lands) falls back to the default DOM world with a single
 * `console.warn` — never a crash, never a blank route. 'auto' (or absent)
 * follows the format map. Server-safe: the fallback list lives here, not in
 * the client theme registry.
 */
export function resolveWorld(season: WorldResolvableSeason): SeasonWorld {
  const requested = season.route_theme;
  if (requested && requested !== 'auto') {
    const themed = WORLDS.find((world) => world.routeThemeId === requested);
    if (themed) return themed;
    console.warn(
      `[worlds] route_theme "${requested}" is not registered; falling back to the default world`,
    );
    return defaultWorld;
  }
  return getSeasonWorld(season.format_type);
}

/**
 * The world that provides a given route-theme id, or null. The DOM-only
 * default world carries no `routeThemeId`, so it is never returned here — an
 * unknown id means "no world for this theme", and the caller decides the
 * fallback. Pure and server-safe.
 */
export function getWorldByRouteThemeId(routeThemeId: string): SeasonWorld | null {
  return WORLDS.find((world) => world.routeThemeId === routeThemeId) ?? null;
}

/**
 * Resolve the world a VIEWER should get, honoring the session override on top
 * of the league's own resolution.
 *
 * This is the single place the precedence chain is assembled, so the scene
 * root, the shell's token namespace, the station manifest and the palette can
 * never disagree: pages resolve through here and hand the SAME world to the
 * root and to `WorldShell`. A registered override wins; an unregistered or
 * absent one falls through to `resolveWorld` (admin pin, then format auto-map).
 *
 * Server-safe and pure — the viewer value arrives as a `?world=` search param
 * (the client mirrors a persisted preference into the URL so the server can
 * see it; see `WorldOverrideRedirect`).
 */
export function resolveViewerWorld(
  season: WorldResolvableSeason,
  viewerOverride?: string | string[] | null,
): SeasonWorld {
  const requested = Array.isArray(viewerOverride) ? viewerOverride[0] : viewerOverride;
  if (requested) {
    const themed = getWorldByRouteThemeId(requested);
    if (themed) return themed;
  }
  return resolveWorld(season);
}

/** The world for pages outside a season context (standalone tournaments):
 *  the sakura park outcome, matching the C-096 auto-map default for
 *  non-EPB seasons. The DOM-only default world remains the unregistered-pick
 *  fallback inside `resolveWorld` — it is deliberately NOT exported. */
export function getDefaultWorld(): SeasonWorld {
  return sakuraWorld;
}
