import type { SeasonFormatType, RouteThemeId } from '@/types/season';

/**
 * Season-world presentation system types.
 *
 * A "world" is the presentation context for a league season page: which
 * sections it shows, which draft experience key drives its interactions,
 * and which CSS token namespace skins it. Worlds are pure data — adding a
 * future world (e.g. Core Liga) is an additive registry entry, never an
 * edit to an existing world.
 */

/** One in-page section of a world: stable DOM id + nav label. */
export interface WorldSection {
  /** Stable section id — used as the `<section id>` and anchor target. */
  id: string;
  /** English nav label; the fallback when no `navKey` is set. */
  navLabel: string;
  /**
   * Registry sections only: the label's message key under `world/client`
   * `nav.worlds` (`<worldId>.<sectionId>`). `WorldNav` translates it into the
   * viewer's language; callers that build their own sections (tournament tabs,
   * the engine probe) pass already-translated `navLabel`s and no key.
   */
  navKey?: string;
}

/** Key selecting the draft-experience interaction set for a world. */
export type DraftExperienceKey = 'classic' | 'evoliga';

/**
 * A registered season world.
 *
 * Pure and server-safe: no DB calls, no client-only imports. Consumed by
 * `src/lib/worlds/registry.ts` and the `src/components/world/*` shells.
 */
export interface SeasonWorld {
  /** Stable world identifier (e.g. 'default', 'evoliga'). */
  id: string;
  /** Which season formats resolve to this world. */
  matchesFormats: readonly SeasonFormatType[];
  /** Ordered section manifest — drives WorldNav and section anchoring. */
  sections: readonly WorldSection[];
  /** Draft-experience key for interactive behavior selection. */
  draftExperience: DraftExperienceKey;
  /** Token namespace string — used as the `data-world` attribute value. */
  tokenNamespace: string;
  /**
   * Route-theme id (`RouteThemeDefinition.id`) for worlds driven by the 3D
   * route engine; omit for DOM-only worlds. The shell marks itself with
   * `data-world-route` and the client-side `WorldStateProvider` resolves the
   * theme through `src/components/world/themes/index.ts`.
   */
  routeThemeId?: string;
}

/**
 * The season slice the world registry needs to resolve a world: the format
 * plus the league's optional 3D-theme pick (`seasons.route_theme`). The
 * field is nullable so raw/pre-migration rows resolve through the format map
 * instead of crashing.
 */
export interface WorldResolvableSeason {
  format_type: SeasonFormatType;
  route_theme?: RouteThemeId | null;
}
