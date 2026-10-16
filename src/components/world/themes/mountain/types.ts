import { deriveRosterTiles, type WorldRouteData, type WorldRosterTile } from '@/lib/worlds/route-data';

import type { SeasonWithDetails } from '@/types/season';
import type { PublicParticipant } from '@/lib/players/public-player';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';
import type { FormatRules } from '@/types/format-rules';

/**
 * Standings/fixture row shapes, derived from the `WorldRouteData` contract
 * (whose `standings`/`fixtures` are exactly the evoliga league query's row
 * arrays) so the theme package never imports a query-module path directly.
 */
type LeagueStanding = WorldRouteData['standings'][number];
type LeagueFixture = WorldRouteData['fixtures'][number];

/**
 * The Mountain Pass view over the generic `WorldRouteData` contract.
 *
 * The scene content derives ONLY from this shape — built once on the server
 * by `toMountainRouteData` and handed to `RouteDataProvider`, so no theme
 * module ever touches Supabase. It keeps the flattened roster (`entries`)
 * because the W2 board builders (`buildBoardContent`) consume exactly that
 * shape, and it adds the mountain-specific precomputation:
 *
 *  - `rosterTiles` — `deriveRosterTiles` over the contract, so the non-EPB
 *    fallback (participant tiles: ace species + gym band, `rosterLines`
 *    null) is derived on the SERVER; importing the pure helper into the
 *    client would drag the query modules into the browser bundle.
 *  - `rulesetName` — the contract's stage-fallback-aware name, first-class
 *    here so the gate plaque painters read it without re-deriving.
 */
export interface MountainRouteData {
  /** The season row; the valley is season-scoped, so it is required here. */
  league: SeasonWithDetails;
  stages: TournamentWithDetails[];
  participants: PublicParticipant[];
  /** Point-buy list lines; empty when the season has no list bound. */
  entries: PointBuyListEntry[];
  /** Format-independent roster tiles (EPB lines or participant fallback). */
  rosterTiles: WorldRosterTile[];
  trackers: EvolutionTracker[];
  /** Ace species per player id from team data — the non-EPB ace source. */
  teamAces: Record<string, string>;
  standings: LeagueStanding[];
  fixtures: LeagueFixture[];
  formatRules: FormatRules | null;
  /** Season ruleset name, else the first stage's, else null. */
  rulesetName: string | null;
  hasDraftPool: boolean;
}

/**
 * Map the generic contract onto the mountain view. Returns null when the
 * payload has no season row (standalone tournament) — the valley has no
 * rendering for that case, and the caller decides what to do instead of
 * this adapter inventing a league. Pure; safe on both sides of the RSC
 * boundary (unlike the evoliga adapter, which lives in a client module).
 */
export function toMountainRouteData(data: WorldRouteData): MountainRouteData | null {
  if (!data.league) return null;
  return {
    league: data.league,
    stages: data.stages,
    participants: data.participants,
    entries: data.rosterLines ?? [],
    rosterTiles: deriveRosterTiles(data),
    trackers: data.trackers,
    teamAces: data.teamAces,
    standings: data.standings,
    fixtures: data.fixtures,
    formatRules: data.formatRules,
    rulesetName: data.rulesetName,
    hasDraftPool: data.hasDraftPool,
  };
}
