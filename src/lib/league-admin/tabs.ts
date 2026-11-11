import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import { isDraftLike } from '@/lib/season/format-utils';
import type { SeasonFormatType } from '@/types/season';

/**
 * League workspace tabs (`/admin/leagues/[id]?tab=`): the admin page of one league,
 * split into views so an admin sees one topic at a time instead of one long
 * page of collapsible sections (live feedback, admin panel proposal A; seven tabs since redesign A5).
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
export const LEAGUE_ADMIN_TABS = ['overview', 'participants', 'phases', 'format', 'draft', 'live', 'settings'] as const;

export type LeagueAdminTab = (typeof LEAGUE_ADMIN_TABS)[number];

/** The tab a bare `/admin/leagues/[id]` opens on. It renders from the league row alone. */
export const DEFAULT_LEAGUE_ADMIN_TAB: LeagueAdminTab = 'overview';

/** The anchor of the rules editors inside the Format and rules tab (the former Rules tab). */
export const LEAGUE_ADMIN_RULES_SECTION = 'league-rules';

/** The anchor of the danger zone at the end of the Settings tab (the former Danger zone tab). */
export const LEAGUE_ADMIN_DANGER_SECTION = 'danger-zone';

/**
 * Earlier tab ids that still open their tab, because links to them are bookmarked and shared: the phases tab was
 * called "schedule" until round 3; the Rules tab is part of Format and rules and the Danger zone tab the last
 * section of Settings since redesign A5.
 */
export const LEAGUE_ADMIN_TAB_ALIASES: Readonly<Record<string, LeagueAdminTab>> = {
  schedule: 'phases',
  rules: 'format',
  danger: 'settings',
};

/** The section an earlier tab id opens its tab at. */
const ALIAS_SECTIONS: Readonly<Record<string, string>> = {
  rules: LEAGUE_ADMIN_RULES_SECTION,
  danger: LEAGUE_ADMIN_DANGER_SECTION,
};

/** Whether the format has rules editors (evolution tiers, tier limits, point-buy list) in its Format and rules tab. */
export function leagueHasRulesSection(format: SeasonFormatType): boolean {
  const caps = getFormatCapabilities(format);
  return caps.pointBuyList || caps.evolutionTiers || caps.tierLimits;
}

/**
 * The tabs a league's format shows, in display order:
 * - every format: overview, participants, phases, format (Format and rules), settings;
 * - classic draft and Evolution Point Buy: those plus draft (pool and Draft Room);
 * - custom: those plus live.
 *
 * The format tab has no capability gate; its rules editors show for the formats that have them
 * (`leagueHasRulesSection`). The live tab (checks inbox, adjustments, player actions, relations, challenges of a
 * running kit league) exists for custom leagues only; a custom league that has no running kit format sees a notice
 * there, so the tab never moves.
 */
export function availableLeagueAdminTabs(format: SeasonFormatType): LeagueAdminTab[] {
  const hasDraft = isDraftLike(format);
  return LEAGUE_ADMIN_TABS.filter((tab) => {
    if (tab === 'draft') return hasDraft;
    if (tab === 'live') return format === 'custom';
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
 * The section of its tab an earlier tab id asks for (`?tab=danger` opens Settings at the danger zone,
 * `?tab=rules` Format and rules at the rules editors), or null for every other request.
 */
export function leagueAdminAliasSection(raw: string | string[] | undefined): string | null {
  return typeof raw === 'string' && Object.hasOwn(ALIAS_SECTIONS, raw) ? ALIAS_SECTIONS[raw] : null;
}

/**
 * The link to one admin tab, optionally at one of its sections. The overview drops the param, so the canonical
 * admin URL stays bare. No other query parameter is carried: the admin page reads none.
 */
export function leagueAdminHref(leagueId: string, tab: LeagueAdminTab, section?: string): string {
  const base = `/admin/leagues/${leagueId}`;
  const path = tab === DEFAULT_LEAGUE_ADMIN_TAB ? base : `${base}?${LEAGUE_ADMIN_TAB_PARAM}=${tab}`;
  return section === undefined ? path : `${path}#${section}`;
}

/**
 * Where a new league's admin lands after it is created. A custom league goes straight to the Format tab, because
 * attaching a format is its first step (it cannot start without one); every other league type opens its overview.
 */
export function leagueCreatedHref(leagueId: string, formatType: SeasonFormatType): string {
  return formatType === 'custom' ? leagueAdminHref(leagueId, 'format') : `/admin/leagues/${leagueId}`;
}
