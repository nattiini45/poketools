import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import { isDraftLike } from '@/lib/season/format-utils';
import type { SeasonFormatType } from '@/types/season';

/**
 * League admin tabs (`/admin/leagues/[id]?tab=`): the admin page of one league,
 * split into views so an admin sees one topic at a time instead of one long
 * page of collapsible sections (live feedback, admin panel proposal A).
 *
 * Mirrors the league hub (`src/lib/league-hub/tabs.ts`): the active tab lives
 * in the URL, every tab is a link, and the server renders and reads ONLY the
 * selected tab. The default tab (overview) needs nothing beyond the league row.
 *
 * Pure and client-safe: no reads, no server imports.
 */

/** The query parameter that selects the admin tab. */
export const LEAGUE_ADMIN_TAB_PARAM = 'tab';

/** Every admin tab, in display order. */
export const LEAGUE_ADMIN_TABS = [
  'overview',
  'participants',
  'draft',
  'phases',
  'rules',
  'format',
  'settings',
  'danger',
] as const;

export type LeagueAdminTab = (typeof LEAGUE_ADMIN_TABS)[number];

/** The tab a bare `/admin/leagues/[id]` opens on. It renders from the league row alone. */
export const DEFAULT_LEAGUE_ADMIN_TAB: LeagueAdminTab = 'overview';

/**
 * Earlier tab ids that still open their tab: the phases tab was called "schedule" (`?tab=schedule`) until
 * round 3, and links to it may be bookmarked or shared.
 */
export const LEAGUE_ADMIN_TAB_ALIASES: Readonly<Record<string, LeagueAdminTab>> = {
  schedule: 'phases',
};

/**
 * The tabs a league's format shows, in display order (from `getFormatCapabilities`):
 * - singles / doubles: overview, participants, phases, format, settings, danger;
 * - classic draft: those plus draft (pool and Draft Room) and rules (evolution tiers, tier limits);
 * - Evolution Point Buy: all eight (rules = point-buy list, format rules, data import).
 *
 * The format tab (read-only generated outline and rules text) has no capability gate: every format shows it.
 */
export function availableLeagueAdminTabs(format: SeasonFormatType): LeagueAdminTab[] {
  const caps = getFormatCapabilities(format);
  const hasDraft = isDraftLike(format);
  const hasRules = caps.pointBuyList || caps.evolutionTiers || caps.tierLimits;
  return LEAGUE_ADMIN_TABS.filter((tab) => {
    if (tab === 'draft') return hasDraft;
    if (tab === 'rules') return hasRules;
    return true;
  });
}

/**
 * The tab a request asks for, whitelisted against the league's available tabs.
 * An earlier id (`LEAGUE_ADMIN_TAB_ALIASES`, e.g. `schedule`) opens its tab.
 * Anything else (missing, repeated, unknown, or a tab this format does not
 * have) falls back to the overview.
 */
export function parseLeagueAdminTab(
  raw: string | string[] | undefined,
  available: readonly LeagueAdminTab[],
): LeagueAdminTab {
  if (typeof raw !== 'string') return DEFAULT_LEAGUE_ADMIN_TAB;
  const wanted = Object.hasOwn(LEAGUE_ADMIN_TAB_ALIASES, raw) ? LEAGUE_ADMIN_TAB_ALIASES[raw] : raw;
  return available.find((tab) => tab === wanted) ?? DEFAULT_LEAGUE_ADMIN_TAB;
}

/**
 * The link to one admin tab. The overview drops the param, so the canonical
 * admin URL stays bare. No other query parameter is carried: the admin page
 * reads none.
 */
export function leagueAdminHref(leagueId: string, tab: LeagueAdminTab): string {
  const base = `/admin/leagues/${leagueId}`;
  return tab === DEFAULT_LEAGUE_ADMIN_TAB ? base : `${base}?${LEAGUE_ADMIN_TAB_PARAM}=${tab}`;
}

/**
 * Where a new league's admin lands after it is created. A custom league goes straight to the Format tab, because
 * attaching a format is its first step (it cannot start without one); every other league type opens its overview.
 */
export function leagueCreatedHref(leagueId: string, formatType: SeasonFormatType): string {
  return formatType === 'custom' ? leagueAdminHref(leagueId, 'format') : `/admin/leagues/${leagueId}`;
}
