import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import type { SeasonWorld } from '@/lib/worlds/types';
import type { SeasonWithDetails } from '@/types/season';
import type { PublicParticipant } from '@/lib/players/public-player';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';
import type { FormatRules } from '@/types/format-rules';
import type { Standing } from '@/lib/tournament/types';
import type { LeagueFixture, LeagueStanding } from '@/lib/supabase/queries/league-standings';

/** The world payload's fields before the standings rows are sharpened. */
interface EvoligaWorldDataFields {
  world: SeasonWorld;
  league: SeasonWithDetails;
  stages: TournamentWithDetails[];
  participants: PublicParticipant[];
  /** Point-buy list entries; empty when the season has no list bound. */
  entries: PointBuyListEntry[];
  /** Evolution trackers for the whole season (all players). */
  trackers: EvolutionTracker[];
  standings: Standing[];
  fixtures: LeagueFixture[];
  /** Format rules row; null when not configured (defaults apply). */
  formatRules: FormatRules | null;
  /** Whether a draft pool row exists for the season (not just a bound list). */
  hasDraftPool: boolean;
}

/**
 * All page-loaded data the EvoLiga scrollworld renders from. `standings` is a
 * first-class `LeagueStanding[]`: every row carries `rank_change` because both
 * producers (the league schedule query and the preview fixtures) attach it
 * before the data crosses this boundary — consumers read the field directly,
 * no shim. Sharpened with `Omit & { … }`, never a bare intersection: an
 * intersection would not propagate the override to the element type through
 * `.map`/`.every` (PB-212).
 */
export type EvoligaWorldData = Omit<EvoligaWorldDataFields, 'standings'> & {
  standings: LeagueStanding[];
};

/**
 * The viewer's languages for the plaza's server-rendered sections and panels
 * (i18n D11: the world follows the viewer). `EvoligaWorld` reads them once on
 * the server and threads them down; `dataLocale` (Pokémon names) defaults to
 * `locale`.
 */
export interface EvoligaLocaleProps {
  locale: Locale;
  dataLocale?: Locale;
}

/** Serializable overlay bundle: server-rendered content keyed by trigger value. */
export interface OverlayContentMap {
  /** Search-param value (player id / line id) → rendered overlay body. */
  contents: Record<string, ReactNode>;
  /** Search-param value → accessible dialog title. */
  titles: Record<string, string>;
}
