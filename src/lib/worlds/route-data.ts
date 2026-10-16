import type { Team } from '@/types/team';
import type { EvolutionTracker } from '@/types/evolution';
import type { FormatRules } from '@/types/format-rules';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { SeasonFormatType, SeasonWithDetails } from '@/types/season';
import type { TournamentWithDetails } from '@/types/tournament';
import {
  toPublicParticipants,
  type ParticipantSource,
  type PublicParticipant,
  type PublicSeasonParticipant,
} from '@/lib/players/public-player';
import { toPublicMatch } from '@/lib/match/public-match';
import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { sumEvolutionPoints } from '@/lib/tournament/season-standings';
import { getDraftPoolBySeason } from '@/lib/supabase/queries/drafts';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import {
  assembleLeagueSchedule,
  type LeagueFixture,
  type LeagueFixtureSource,
  type LeagueStanding,
} from '@/lib/supabase/queries/league-standings';
import { getMatchesByTournamentIds } from '@/lib/supabase/queries/matches';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { listTeamLeadsBySeason, type TeamLead } from '@/lib/supabase/queries/teams';
import { getPublicSeasonParticipants, getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getSeasonWorld } from './registry';
import type { SeasonWorld } from './types';

/**
 * The generic, format-flexed data contract every 3D route world renders from.
 *
 * One shape regardless of league format: a sakura/mountain/clouds theme
 * consumes exactly what the evoliga plaza consumes today, with the format
 * differences expressed as nullability (`rosterLines` is null on formats
 * without a point-buy list) instead of different fields. Pure data — no
 * functions, no class instances — because the theme id crosses the RSC
 * boundary as a string and the DATA crosses as JSON-serializable props.
 *
 * Server-built via `buildWorldRouteData` (or the pure `assembleWorldRouteData`
 * over already-fetched rows); consumed through per-world adapters such as
 * `toEvoligaRouteData`, which feed the painters their current inputs.
 *
 * SECURITY: this payload is serialized into the public league page (it is
 * handed to `'use client'` providers) and stored in the public read cache.
 * Participants cross as `PublicParticipant` (id, name, gym band) only —
 * `assembleWorldRouteData` maps every participant through
 * `toPublicParticipants`, so a full player row handed in (admin getters,
 * fixtures) never reaches the client. Fixture matches cross as `PublicMatch`
 * (`src/lib/match/public-match.ts`) only: `assembleWorldRouteData` maps every
 * fixture through `toPublicFixtures` (again, after `assembleLeagueSchedule`),
 * so a full match row handed in never carries the admin notes, the
 * submitter or the confirmation timestamps to the client.
 */

/**
 * One painter-facing roster tile, format-independent. On point-buy formats it
 * mirrors a list line; on every other format it is derived from the season's
 * participants (`deriveRosterTiles`): the ace species where their team data
 * has one, the participant name otherwise, and the gym band where the
 * participant carries a gym type. `price` is null whenever there is no
 * point-buy price — painters print the band instead.
 */
export interface WorldRosterTile {
  id: string;
  /** 1-based roster position, stable across formats. */
  line: number;
  /** Ace species, point-buy base species, or participant name. */
  name: string;
  /** Point-buy price group, or the participant's gym band (`'open'` if none). */
  band: string;
  /** Point-buy price; null on participant-derived tiles. */
  price: number | null;
}

/**
 * The world payload as the route engine's data contract. Every field is a
 * plain JSON round-trippable value.
 */
export interface WorldRouteData {
  /** Resolved world registry entry (theme id, token namespace, sections). */
  world: SeasonWorld;
  /** League format the world was resolved for. */
  format: SeasonFormatType;
  /**
   * The season row; null when the world renders from a standalone tournament
   * with no season context (rules then come from the stages).
   */
  league: SeasonWithDetails | null;
  stages: TournamentWithDetails[];
  /** Public participant shape only: no private player columns (see SECURITY above). */
  participants: PublicParticipant[];
  /**
   * Point-buy roster lines — null whenever the format has no point-buy list
   * (`getFormatCapabilities(format).pointBuyList === false`). Consumers derive
   * painter tiles with `deriveRosterTiles` instead of branching on format.
   */
  rosterLines: PointBuyListEntry[] | null;
  /**
   * Ace species per player id, derived server-side from team data where
   * present (`deriveTeamAces`). Empty when no teams exist — the EPB world's
   * ace source stays the evolution trackers.
   */
  teamAces: Record<string, string>;
  trackers: EvolutionTracker[];
  standings: LeagueStanding[];
  /** Public match shape only: no admin-only match columns (see SECURITY above). */
  fixtures: LeagueFixture[];
  /** Format rules row; null when not configured (defaults apply). */
  formatRules: FormatRules | null;
  /** The season's ruleset name, else the first stage's, else null. */
  rulesetName: string | null;
  /** Whether a draft pool row exists for the season (not just a bound list). */
  hasDraftPool: boolean;
}

/** Already-fetched rows `assembleWorldRouteData` shapes into the contract. */
export interface WorldRouteDataInput {
  /** Season row; null for a standalone tournament. */
  league: SeasonWithDetails | null;
  /** Explicit format override; defaults to the season's format, else `'singles'`. */
  format?: SeasonFormatType;
  stages: TournamentWithDetails[];
  /**
   * Participants in any shape carrying id, name and gym band — full rows are
   * accepted and narrowed to `PublicParticipant` on assembly.
   */
  participants: readonly ParticipantSource[];
  /** Point-buy list entries when the season has one bound; empty array otherwise. */
  rosterLines?: PointBuyListEntry[] | null;
  trackers: EvolutionTracker[];
  standings: LeagueStanding[];
  /**
   * Fixtures whose matches carry at least the public match fields — full rows
   * are accepted and narrowed to `PublicMatch` on assembly.
   */
  fixtures: readonly LeagueFixtureSource[];
  formatRules: FormatRules | null;
  hasDraftPool: boolean;
  /** Season teams, for the participant ace derivation. */
  teams?: Team[];
  /** Season team leads (`listTeamLeadsBySeason`), the narrow ace source. */
  teamLeads?: TeamLead[];
}

/**
 * Ace species per player id from team data: each player's most recently
 * updated team (id as the deterministic tiebreak) contributes its FIRST
 * Pokémon set's species — the team lead. Players without a team with at
 * least one set get no entry, so consumers fall back to the participant
 * name. Pure; no DB reads.
 */
export function deriveTeamAces(teams: Team[]): Record<string, string> {
  return deriveTeamAcesFromLeads(teams.map(teamToLead));
}

/**
 * A full team reduced to the slice the ace derivation reads — the same slice
 * `listTeamLeadsBySeason` selects: no first set → `lead_species: null`; a
 * first set → its species (`''` when blank, which still counts as the team).
 */
export function teamToLead(team: Team): TeamLead {
  return {
    id: team.id,
    player_id: team.player_id,
    updated_at: team.updated_at,
    lead_species: team.pokemon.length === 0 ? null : (team.pokemon[0]?.species ?? ''),
  };
}

/**
 * `deriveTeamAces` over team leads: each player's most recently updated team
 * with a first set (id as the tiebreak) contributes that set's species. Pure.
 */
export function deriveTeamAcesFromLeads(leads: readonly TeamLead[]): Record<string, string> {
  const newestPerPlayer = new Map<string, TeamLead>();
  for (const lead of leads) {
    if (lead.lead_species === null) continue;
    const current = newestPerPlayer.get(lead.player_id);
    const newer =
      current === undefined ||
      lead.updated_at > current.updated_at ||
      (lead.updated_at === current.updated_at && lead.id > current.id);
    if (newer) newestPerPlayer.set(lead.player_id, lead);
  }
  const aces: Record<string, string> = {};
  for (const [playerId, lead] of newestPerPlayer) {
    if (lead.lead_species) aces[playerId] = lead.lead_species;
  }
  return aces;
}

/**
 * Roster tiles for any format, derived once from the contract. Point-buy
 * formats mirror the list lines 1:1 (the exact rows the plaza paints today);
 * every other format — and every point-buy format whose list is absent OR
 * empty — derives one tile per participant: ace species from their team data
 * where present, participant name otherwise, gym band as the tile's band.
 * Pure.
 */
export function deriveRosterTiles(
  data: Pick<WorldRouteData, 'rosterLines' | 'participants' | 'teamAces'>,
): WorldRosterTile[] {
  const { rosterLines, participants, teamAces } = data;
  // `length` gate, not a nullish one: an EPB season whose list is bound but
  // still EMPTY (pre-draft) or not bound at all arrives as `[]` and must take
  // the participant fallback — an empty array would otherwise paint an empty
  // roster next to the RosterSection's "no point-buy list is bound" copy.
  if (rosterLines && rosterLines.length > 0) {
    return rosterLines.map((line) => ({
      id: line.id,
      line: line.line_number,
      name: line.base_pokemon,
      band: line.price_group,
      price: line.price,
    }));
  }
  return participants.map((participant, index) => ({
    id: participant.id,
    line: index + 1,
    name: teamAces[participant.id] ?? participant.name,
    band: participant.gym_type ?? 'open',
    price: null,
  }));
}

/** Fixtures narrowed to the public match shape (`PublicMatch`), field by field. */
function toPublicFixtures(fixtures: readonly LeagueFixtureSource[]): LeagueFixture[] {
  return fixtures.map((fixture) => ({
    stageId: fixture.stageId,
    stageName: fixture.stageName,
    match: toPublicMatch(fixture.match),
  }));
}

/**
 * Shape already-fetched rows into the contract. Pure — the async fetch fan-out
 * lives in `buildWorldRouteData`, so per-format behavior stays unit-testable
 * without a database.
 */
export function assembleWorldRouteData(input: WorldRouteDataInput): WorldRouteData {
  const format = input.format ?? input.league?.format_type ?? 'singles';
  // The capability gate decides point-buy-ness declaratively — no format
  // name string-matching outside `format-capabilities.ts`.
  const hasPointBuyList = getFormatCapabilities(format).pointBuyList;
  return {
    world: getSeasonWorld(format),
    format,
    league: input.league,
    stages: input.stages,
    // The client boundary: only the public participant fields cross.
    participants: toPublicParticipants(input.participants),
    rosterLines: hasPointBuyList ? (input.rosterLines ?? null) : null,
    teamAces: deriveTeamAcesFromLeads([
      ...(input.teamLeads ?? []),
      ...(input.teams ?? []).map(teamToLead),
    ]),
    trackers: input.trackers,
    standings: input.standings,
    // The same boundary for matches: only the public match fields cross.
    fixtures: toPublicFixtures(input.fixtures),
    formatRules: input.formatRules,
    rulesetName: input.league?.ruleset_name ?? input.stages[0]?.ruleset_name ?? null,
    hasDraftPool: input.hasDraftPool,
  };
}

/**
 * Rows the caller already loaded for the same season. The league page reads
 * the season, its stages and its public participants before it knows which
 * world renders; handing them in keeps the world build from reading them a
 * second time.
 */
export interface WorldRouteDataPreload {
  league: SeasonWithDetails;
  stages: TournamentWithDetails[];
  participants: readonly PublicSeasonParticipant[];
}

/**
 * Server-side builder: fetches every row a route world renders from through
 * the EXISTING query modules and returns the contract. Returns null when the
 * season does not exist (caller decides `notFound()`). Server-only — imports
 * service-role query modules.
 *
 * Query budget after the preload: ONE wave of at most six reads — the
 * point-buy list (only with a bound list), format rules, trackers, every
 * stage's matches in one `.in()` read, the draft pool and the team leads.
 * The standings are computed in memory from those rows: the season format
 * comes from the league row and, for EPB, the evolution points are summed
 * from the trackers already loaded (the reduction `getSeasonEvolutionPoints`
 * applies to the same table).
 */
export async function buildWorldRouteData(
  seasonId: string,
  preloaded?: WorldRouteDataPreload,
): Promise<WorldRouteData | null> {
  const league = preloaded?.league ?? (await getSeasonWithDetails(seasonId));
  if (!league) return null;

  const [stages, participants] = preloaded
    ? [preloaded.stages, preloaded.participants]
    : await Promise.all([getStagesBySeasonId(seasonId), getPublicSeasonParticipants(seasonId)]);

  const [pointBuyEntries, formatRules, evolutionTrackers, matchesByStage, draftPool, teamLeads] =
    await Promise.all([
      league.point_buy_list_id ? getListEntries(league.point_buy_list_id) : Promise.resolve([]),
      // Disclosed fallbacks, never silent ones: each degraded read logs the
      // ORIGINAL error first so the failure cause stays distinguishable in
      // the server logs (AGENTS.md Security Requirement 5 — the query modules
      // rethrow without logging, so this is the only log site).
      getFormatRules(seasonId).catch((err: unknown) => {
        console.error(
          '[worlds/route-data] getFormatRules failed — falling back to format defaults:',
          err
        );
        return null;
      }),
      getSeasonTrackers(seasonId),
      getMatchesByTournamentIds(stages.map((stage) => stage.id)),
      getDraftPoolBySeason(seasonId).catch((err: unknown) => {
        console.error(
          '[worlds/route-data] getDraftPoolBySeason failed — reporting hasDraftPool false:',
          err
        );
        return null;
      }),
      // Team leads only enrich the ace derivation — a failure degrades to
      // "no team aces" (disclosed fallback), never to a missing world.
      listTeamLeadsBySeason(seasonId).catch((err: unknown) => {
        console.error(
          '[worlds/route-data] listTeamLeadsBySeason failed — deriving no team aces:',
          err
        );
        return [];
      }),
    ]);

  const schedule = assembleLeagueSchedule({
    stages,
    participants,
    matchesByStage,
    context: isEvolutionPointBuy(league.format_type)
      ? { formatType: league.format_type, evolutionPoints: sumEvolutionPoints(evolutionTrackers) }
      : { formatType: league.format_type },
  });

  return assembleWorldRouteData({
    league,
    stages,
    participants,
    rosterLines: pointBuyEntries,
    trackers: evolutionTrackers,
    standings: schedule.standings,
    fixtures: schedule.fixtures,
    formatRules,
    hasDraftPool: draftPool !== null,
    teamLeads,
  });
}
