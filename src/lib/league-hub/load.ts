import 'server-only';

import { phasePublicReads } from '@/lib/cache/phase-public-reads';
import { publicReads } from '@/lib/cache/public-reads';
import type { PublicPhaseReport } from '@/lib/league-phase/public-report';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { aggregatesToUsageRows } from '@/lib/stats/usage-rows';
import { buildKillRanking } from '@/lib/stats/kill-ranking';
import type { SeasonStandingsContext } from '@/lib/tournament/season-standings';
import { formatScoresByes, scoringByeRecords } from '@/lib/tournament/byes';
import { isEvolutionPointBuy, isLeagueDoubles } from '@/lib/season/format-utils';
import type { LeagueGroupStandings, LeagueStage, LeagueStanding } from '@/lib/supabase/queries/league-standings';
import type { CombinedRanking } from '@/lib/tournament/group-standings';
import type { PublicSeasonParticipant, PublicTournamentParticipant } from '@/lib/players/public-player';
import { worldStandingsContext, type WorldRouteData } from '@/lib/worlds/route-data';
import type { KillRankingRow, PokemonUsageRow } from '@/types/game';
import type { PublicCompetitionMatch } from '@/lib/match/public-match';
import type { Ruleset } from '@/types/ruleset';
import type { SeasonWithDetails } from '@/types/season';
import type { TournamentReport } from '@/types/tournament-report';
import type { LeagueHubTab, PhaseStorage } from './tabs';
import { withoutHiddenIds, withoutHiddenPlayers } from '@/lib/players/hidden-players';
import {
  bracketStages,
  buildTableStage,
  groupStageMatches,
  resolveGroupMembers,
  roundRobinStages,
  showsAdvancement,
  stageMatches,
  tableStages,
  withDisplayStatus,
  type HubGroup,
  type HubRound,
  type HubStage,
  type HubStageMatches,
  type HubTableStage,
} from './views';

/**
 * Server loader for the league hub: reads exactly what the selected tab
 * renders, through the tagged public read cache, and shapes it into the
 * panel data the hub components render.
 *
 * Read cost per tab (cold cache; a warm render reads nothing but the ruleset):
 *   standings — none: the season table (and, in a league with groups, the
 *               group tables and the combined table) is in the world payload;
 *   matches   — the rounds of each phase (round names and order);
 *   groups    — per table phase its enrollment and groups, per round robin
 *               phase its battle stats (kill difference);
 *   playoffs  — per elimination phase its rounds and enrollment (seeds);
 *   phases    — per table phase its groups and enrollment (the members the
 *               group tables show, see `resolveGroupMembers`);
 *   insights  — the league's aggregate counters, game total and battle stats;
 *   rules     — the ruleset, read live (ruleset edits expire no cache tag);
 *   reports   — the reports of each phase (Kale flag only).
 * The rounds, participants, battle-stats and reports reads are the phase
 * page's own cache entries, so a phase page view warms them and the other way
 * round. Native groups use the phase page's cache too; legacy groups use
 * the league-only `publicReads.tournamentGroups` entry.
 *
 * Matches always come from the world payload's fixtures (one batched read for
 * every phase, already paid), never from a second matches read. They also
 * set the phase status chips (`withDisplayStatus`: a phase whose matches are
 * all played reads finished even while its stored status lags).
 *
 * The tab reads are optional to the page: if one fails, the error is logged
 * and the panel becomes `{ tab: 'unavailable' }` (a notice in the hub), so
 * the world, roster, schedule and rules still render. The world payload is
 * not optional: its failure still fails the page, as it always has.
 */

/** One elimination phase, ready for the bracket renderer. */
export interface HubBracketStage {
  stage: HubStage;
  rounds: HubRound[];
  matches: PublicCompetitionMatch[];
  participants: PublicTournamentParticipant[];
}

/** One phase with its groups, for the phase cards. */
export interface HubPhase {
  /** The phase, with its displayed status. */
  stage: HubStage;
  groups: HubGroup[];
  /** Whether the card shows the phase's advancement rule (`showsAdvancement`). */
  showAdvancement: boolean;
}

export interface HubStageReports {
  stage: HubStage;
  reports: (TournamentReport | PublicPhaseReport)[];
}

export type LeagueHubPanelData =
  | {
      tab: 'standings';
      /** The season table; in a league with groups the combined table, shown below the group tables. */
      standings: LeagueStanding[];
      finalPlacings?: (LeagueStanding & { rank: number })[];
      /** One table per league group (cross-group matches included); empty or absent without groups. */
      groupStandings?: LeagueGroupStandings[];
      /** How `standings` is ranked: `points` (also when absent) unless a grouped league's match counts differ. */
      standingsRanking?: CombinedRanking;
      isEvolutionPointBuy: boolean;
    }
  | { tab: 'matches'; stages: HubStageMatches[] }
  | { tab: 'groups'; stages: HubTableStage[]; isEvolutionPointBuy: boolean }
  | { tab: 'playoffs'; stages: HubBracketStage[] }
  | { tab: 'phases'; phases: HubPhase[] }
  | { tab: 'insights'; usageRows: PokemonUsageRow[]; killRanking: KillRankingRow[]; isDoubles: boolean }
  | { tab: 'rules'; ruleset: Ruleset | null }
  | { tab: 'reports'; reports: HubStageReports[] }
  /** The selected tab's reads failed (logged); the hub shows a notice in its place. */
  | { tab: 'unavailable'; requested: LeagueHubTab };

export interface LeagueHubLoadContext {
  seasonId: string;
  league: SeasonWithDetails;
  stages: readonly LeagueStage[];
  storage?: PhaseStorage;
  participants: readonly PublicSeasonParticipant[];
  /** Players the public directory hides; their rows drop out of the group tables the tab builds. */
  hiddenPlayerIds?: readonly string[];
  /** The world payload, still in flight: the tab reads run beside it, never after it. */
  routeData: Promise<WorldRouteData | null>;
}

/** Season-wide gym bands, for the group members the groups read leaves blank. */
function gymTypeMap(participants: readonly PublicSeasonParticipant[]): Record<string, string | null> {
  return Object.fromEntries(participants.map((participant) => [participant.id, participant.gym_type]));
}

/**
 * A phase's groups as the phase cards show them: the members the group tables
 * hold (`resolveGroupMembers`: enrolled players only, ungrouped substitutes
 * placed), with their name and gym band from the season participants. The
 * groups read embeds player names but carries no `players` tag, so a rename
 * would not expire it; the season participants read does.
 */
function withPublicMembers(
  groups: HubGroup[],
  matches: readonly PublicCompetitionMatch[],
  enrollment: readonly Pick<PublicTournamentParticipant, 'id'>[],
  participants: readonly PublicSeasonParticipant[],
): HubGroup[] {
  const byId = new Map(participants.map((participant) => [participant.id, participant]));
  const members = resolveGroupMembers(groups, matches, new Set(enrollment.map((participant) => participant.id)));
  return [...groups]
    .sort((a, b) => a.group_number - b.group_number)
    .map((group) => ({
      ...group,
      members: (members.get(group.id) ?? []).map((member) => ({
        player_id: member.id,
        player_name: byId.get(member.id)?.name ?? member.name,
        seed: member.seed,
        gym_type: byId.get(member.id)?.gym_type ?? null,
      })),
    }));
}

/** Marks an optional tab read that failed. */
const READ_FAILED = Symbol('league-hub-read-failed');

/**
 * An optional hub-tab read: a failure is logged under its tab (so the cause
 * stays distinguishable in the server logs) and comes back as READ_FAILED
 * instead of rejecting the page's read wave.
 */
async function tabRead<T>(tab: LeagueHubTab, read: Promise<T>): Promise<T | typeof READ_FAILED> {
  try {
    return await read;
  } catch (err) {
    console.error(`[league-hub] ${tab} tab read failed:`, err);
    return READ_FAILED;
  }
}

/** One cached read per phase, keyed by phase id. Cached values are never mutated. */
async function perStage<T>(
  stages: readonly HubStage[],
  read: (stageId: string) => Promise<T>,
): Promise<Record<string, T>> {
  const values = await Promise.all(stages.map((stage) => read(stage.id)));
  return Object.fromEntries(stages.map((stage, index) => [stage.id, values[index]]));
}

/**
 * The selected tab's panel data. Null only when the world payload is missing,
 * which the page answers with notFound() (the hub never renders without it).
 * A failed tab read gives `{ tab: 'unavailable' }`.
 */
export async function loadLeagueHubPanel(
  tab: LeagueHubTab,
  ctx: LeagueHubLoadContext,
): Promise<LeagueHubPanelData | null> {
  const { seasonId, league, stages } = ctx;
  const native = ctx.storage === 'phase';
  const readRounds = native ? phasePublicReads.rounds : publicReads.tournamentRounds;
  const readParticipants = native ? phasePublicReads.participants : publicReads.tournamentParticipants;
  const readGroups = native ? phasePublicReads.groups : publicReads.tournamentGroups;
  const readBattleStats = native ? phasePublicReads.battleStats : publicReads.tournamentBattleStats;
  const readReports = native ? phasePublicReads.reports : publicReads.tournamentReports;
  const epb = isEvolutionPointBuy(league.format_type);
  const unavailable: LeagueHubPanelData = { tab: 'unavailable', requested: tab };

  switch (tab) {
    case 'standings': {
      const data = await ctx.routeData;
      if (!data) return null;
      // A league without groups carries neither field (its payload is unchanged): no group tables, points.
      return {
        tab,
        standings: data.standings,
        finalPlacings: data.finalPlacings,
        groupStandings: data.groupStandings ?? [],
        standingsRanking: data.standingsRanking ?? 'points',
        isEvolutionPointBuy: epb,
      };
    }

    case 'matches': {
      const [data, rounds] = await Promise.all([
        ctx.routeData,
        tabRead(tab, perStage<HubRound[]>(stages, readRounds)),
      ]);
      if (!data) return null;
      if (rounds === READ_FAILED) return unavailable;
      return { tab, stages: groupStageMatches(stages, data.fixtures, rounds) };
    }

    case 'groups': {
      const tables = tableStages(stages);
      const roundRobin = roundRobinStages(tables);
      // Only the Swiss tables of a league that scores byes: an Evolution Point Buy league scores none, so its
      // rounds are not read for them.
      const swiss = formatScoresByes(league.format_type)
        ? tables.filter((stage) => stage.bracket_type === 'swiss')
        : [];
      const [data, reads] = await Promise.all([
        ctx.routeData,
        tabRead(
          tab,
          Promise.all([
            perStage(tables, readParticipants),
            perStage<HubGroup[]>(tables, readGroups),
            perStage(roundRobin, readBattleStats),
            // A Swiss table scores the byes stored on its rounds.
            perStage<HubRound[]>(swiss, readRounds),
          ]),
        ),
      ]);
      if (!data) return null;
      if (reads === READ_FAILED) return unavailable;
      const [participants, groups, battleStats, swissRounds] = reads;
      // One season context for every table on the page (AGENTS.md: never one
      // standings lookup per table).
      // The stored tiebreaker order comes from the world payload's format rules (already read, no extra query).
      const context: SeasonStandingsContext = worldStandingsContext(league.format_type, data);
      const gymTypes = gymTypeMap(ctx.participants);
      const hiddenIds = ctx.hiddenPlayerIds ?? [];
      return {
        tab,
        isEvolutionPointBuy: epb,
        stages: tables.map((stage) => {
          const built = buildTableStage({
            stage,
            matches: stageMatches(data.fixtures, stage.id),
            participants: participants[stage.id] ?? [],
            groups: groups[stage.id] ?? [],
            battleStats: battleStats[stage.id] ?? [],
            roundNumbers: {},
            byes: scoringByeRecords(stage.bracket_type, swissRounds[stage.id] ?? []),
            context,
            gymTypes,
            showAdvancement: showsAdvancement(stages, stage.id),
          });
          return {
            ...built,
            tables: built.tables.map((table) => ({
              ...table,
              standings: withoutHiddenPlayers(table.standings, hiddenIds),
              members: withoutHiddenIds(table.members, hiddenIds),
            })),
          };
        }),
      };
    }

    case 'playoffs': {
      const brackets = bracketStages(stages);
      const [data, reads] = await Promise.all([
        ctx.routeData,
        tabRead(
          tab,
          Promise.all([
            perStage<HubRound[]>(brackets, readRounds),
            perStage(brackets, readParticipants),
          ]),
        ),
      ]);
      if (!data) return null;
      if (reads === READ_FAILED) return unavailable;
      const [rounds, participants] = reads;
      return {
        tab,
        stages: brackets.map((stage) => {
          const stageRounds = rounds[stage.id] ?? [];
          const matches = stageMatches(data.fixtures, stage.id);
          const roundSides = Object.fromEntries(stageRounds.map((round) => [round.id, round.bracket_side]));
          return {
            stage: withDisplayStatus(stage, matches, roundSides),
            rounds: stageRounds,
            matches,
            participants: participants[stage.id] ?? [],
          };
        }),
      };
    }

    case 'phases': {
      // Groups pair players in table phases (round robin and Swiss); their
      // enrollment decides who the cards list, as on the group tables.
      const tables = tableStages(stages);
      const [data, reads] = await Promise.all([
        ctx.routeData,
        tabRead(
          tab,
          Promise.all([
            perStage<HubGroup[]>(tables, readGroups),
            perStage(tables, readParticipants),
          ]),
        ),
      ]);
      if (!data) return null;
      if (reads === READ_FAILED) return unavailable;
      const [groups, enrollment] = reads;
      return {
        tab,
        phases: stages.map((stage) => {
          const matches = stageMatches(data.fixtures, stage.id);
          return {
            stage: withDisplayStatus(stage, matches),
            groups: withPublicMembers(groups[stage.id] ?? [], matches, enrollment[stage.id] ?? [], ctx.participants).map(
              (group) => ({
                ...group,
                members: withoutHiddenPlayers(group.members, ctx.hiddenPlayerIds ?? []),
              }),
            ),
            showAdvancement: showsAdvancement(stages, stage.id),
          };
        }),
      };
    }

    case 'insights': {
      const reads = await tabRead(
        tab,
        Promise.all([
          publicReads.aggregatesSummary('league', seasonId),
          native ? phasePublicReads.seasonGameTotal(seasonId) : publicReads.totalGames('league', seasonId),
          native ? phasePublicReads.seasonBattleStats(seasonId) : publicReads.seasonBattleStats(seasonId),
        ]),
      );
      if (reads === READ_FAILED) return unavailable;
      const [aggregates, totalGames, battleStats] = reads;
      return {
        tab,
        usageRows: aggregatesToUsageRows(aggregates, totalGames),
        killRanking: buildKillRanking(battleStats),
        isDoubles: isLeagueDoubles(league.format_type, stages),
      };
    }

    case 'rules': {
      // The season's ruleset, else the first phase's (the world's rulesetName
      // follows the same fallback). Read live: ruleset edits expire no tag.
      const rulesetId = league.ruleset_id ?? stages[0]?.ruleset_id ?? null;
      const ruleset = rulesetId ? await tabRead(tab, getRulesetById(rulesetId)) : null;
      if (ruleset === READ_FAILED) return unavailable;
      return { tab, ruleset };
    }

    case 'reports': {
      const reports = await tabRead(
        tab,
        perStage<HubStageReports['reports']>(stages, readReports),
      );
      if (reports === READ_FAILED) return unavailable;
      return { tab, reports: stages.map((stage) => ({ stage, reports: reports[stage.id] ?? [] })) };
    }
  }
}
