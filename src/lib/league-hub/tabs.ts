import type { BracketType } from '@/types/tournament';

/**
 * League hub tabs: the multi-view overview at the top of a league page
 * (standings, matches, group tables, playoff bracket, phases, insights,
 * rules, and the flag-gated Kale reports).
 *
 * The active tab lives in the URL (`?tab=`), so every view is one link away,
 * shareable, and rendered on the server. The page reads ONLY the selected
 * tab's data: the default tab renders from the world payload the page already
 * holds, so a plain league view costs no query beyond its existing budget.
 *
 * Pure and client-safe: no reads, no server imports.
 */

/** The query parameter that selects the hub tab. Not a world or focus param. */
export const LEAGUE_HUB_TAB_PARAM = 'tab';

/** Every hub tab, in display order. */
export const LEAGUE_HUB_TABS = [
  'standings',
  'matches',
  'groups',
  'playoffs',
  'phases',
  'insights',
  'rules',
  'reports',
] as const;

export type LeagueHubTab = (typeof LEAGUE_HUB_TABS)[number];

/** The tab a bare league URL opens on. It renders from the world payload alone. */
export const DEFAULT_LEAGUE_HUB_TAB: LeagueHubTab = 'standings';

/** A phase is read either as a table (round robin, Swiss) or as a bracket (elimination). */
export type StageKind = 'table' | 'bracket';

export function stageKind(bracketType: BracketType): StageKind {
  return bracketType === 'single_elim' || bracketType === 'double_elim' ? 'bracket' : 'table';
}

export interface HubTabOptions {
  /** Kale Cabbage reports are soft-deprecated: the tab exists only behind `ENABLE_KALE_CABBAGE`. */
  reports: boolean;
}

/**
 * The tabs a league shows, in display order. Standings, matches, phases,
 * insights and rules are always there (each has an empty state). The group
 * tab needs a table phase, the playoff tab an elimination phase, and the
 * reports tab the Kale flag.
 */
export function availableLeagueHubTabs(
  stages: readonly { bracket_type: BracketType }[],
  options: HubTabOptions,
): LeagueHubTab[] {
  const hasTable = stages.some((stage) => stageKind(stage.bracket_type) === 'table');
  const hasBracket = stages.some((stage) => stageKind(stage.bracket_type) === 'bracket');
  return LEAGUE_HUB_TABS.filter((tab) => {
    if (tab === 'groups') return hasTable;
    if (tab === 'playoffs') return hasBracket;
    if (tab === 'reports') return options.reports;
    return true;
  });
}

/**
 * The tab a request asks for, whitelisted against the league's available
 * tabs. Anything else (missing, repeated, unknown, or a tab this league does
 * not have) falls back to the default tab.
 */
export function parseLeagueHubTab(
  raw: string | string[] | undefined,
  available: readonly LeagueHubTab[],
): LeagueHubTab {
  if (typeof raw !== 'string') return DEFAULT_LEAGUE_HUB_TAB;
  const match = available.find((tab) => tab === raw);
  return match ?? DEFAULT_LEAGUE_HUB_TAB;
}

/**
 * The link to one hub tab. Every other query parameter is kept (`?world=`,
 * focus params, route debug flags), so switching tabs never changes the world
 * or closes what the viewer has open. The default tab drops the param, which
 * keeps the canonical league URL bare.
 */
export function leagueHubHref(
  leagueId: string,
  query: Readonly<Record<string, string | string[] | undefined>>,
  tab: LeagueHubTab,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === LEAGUE_HUB_TAB_PARAM || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  if (tab !== DEFAULT_LEAGUE_HUB_TAB) params.set(LEAGUE_HUB_TAB_PARAM, tab);
  const search = params.toString();
  return `/leagues/${leagueId}${search ? `?${search}` : ''}`;
}
