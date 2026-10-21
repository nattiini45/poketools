'use client';

import { useRouteData } from '@/components/world/route/RouteDataProvider';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { SeasonWithDetails } from '@/types/season';
import type { WorldRouteData } from '@/lib/worlds/route-data';

/**
 * The EvoLiga adapter/view over the generic `WorldRouteData` contract
 * (`src/lib/worlds/route-data.ts`). The shape the plaza reads is preserved
 * exactly — every page-loaded row except the world registry entry (the scene
 * gets its palette from the CSS tokens, not from `world`), with `rosterLines`
 * flattened back to `entries` because the point-buy painters never see a null
 * roster: the evoliga world only ever renders for a bound season.
 *
 * The `Omit` keeps the sharpened `standings: LeagueStanding[]` intact — the
 * rows arrive with `rank_change` as a first-class field, so consumers (e.g.
 * the boards' `buildBoardContent`) read it straight off the row.
 */
export type EvoligaRouteData = Omit<
  WorldRouteData,
  'world' | 'format' | 'league' | 'rosterLines' | 'rulesetName' | 'teamAces'
> & {
  /** The evoliga world is season-scoped, so the league row is required here. */
  league: SeasonWithDetails;
  /** Point-buy list lines; empty when the season has no list bound. */
  entries: PointBuyListEntry[];
};

/**
 * Map the generic contract onto the evoliga view. Returns null when the
 * payload has no season row (standalone tournament) — the evoliga world has
 * no rendering for that case, and the caller decides what to do instead of
 * this adapter inventing a league.
 */
export function toEvoligaRouteData(data: WorldRouteData): EvoligaRouteData | null {
  if (!data.league) return null;
  return {
    league: data.league,
    stages: data.stages,
    participants: data.participants,
    entries: data.rosterLines ?? [],
    trackers: data.trackers,
    standings: data.standings,
    fixtures: data.fixtures,
    formatRules: data.formatRules,
    hasDraftPool: data.hasDraftPool,
  };
}

/** The evoliga view of the page-loaded route data, inside the provider tree. */
export function useEvoligaRouteData(): EvoligaRouteData {
  return useRouteData<EvoligaRouteData>();
}
