import { getStagesBySeasonId } from './tournaments';
import { getPublicSeasonParticipants } from './seasons';
import { getMatchesByTournamentIds } from './matches';
import { getSeasonGroups } from './season-groups';
import type { ByeRound } from './rounds';
import {
  computeStandingsFromContext,
  loadSeasonStandingsContext,
  type SeasonStandingsContext,
} from '@/lib/tournament/season-standings';
import { loadSeasonSwissByeRounds } from '@/lib/tournament/scoring-byes';
import { scoringByeRecordsForStages } from '@/lib/tournament/byes';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import type { Standing, MatchRecord, ByeRecord } from '@/lib/tournament/types';
import { rankCombinedTable, splitGroupTables, type CombinedRanking } from '@/lib/tournament/group-standings';
import type { MatchWithPlayers } from '@/types/match';
import { toPublicMatch, type PublicMatch, type PublicMatchSource } from '@/lib/match/public-match';
import type { TournamentWithDetails } from '@/types/tournament';
import type { PublicSeasonParticipant } from '@/lib/players/public-player';

/**
 * Server-side league schedule + standings for the EvoLiga world.
 *
 * The broadcast standings overlay fetches its data through the public API
 * route `/api/broadcast/standings/[sid]` (client-side fetch) — not cleanly
 * reusable from a server component, and it only covers the FIRST stage of a
 * season. This module computes season-wide standings across ALL stages with
 * the format-aware standings dispatch (EPB tiebreaker chain included) and
 * returns the fixtures per stage, reading every stage's matches in one query. Each standings row also
 * carries its rank movement against the previous matchday's table
 * (`rank_change`), derived here server-side — the boards never guess it.
 *
 * Server-only: imports service-role query modules.
 */

/**
 * One scheduled/played match, annotated with its stage. The match is the
 * public shape (`PublicMatch`, no admin notes or confirmation columns):
 * fixtures are cached in the public read cache and serialized into the
 * league page's client providers.
 */
export interface LeagueFixture {
  stageId: string;
  stageName: string;
  match: PublicMatch;
}

/**
 * A fixture in any shape carrying a match's public fields (full rows
 * included); `assembleWorldRouteData` narrows it to `LeagueFixture`.
 */
export interface LeagueFixtureSource {
  stageId: string;
  stageName: string;
  match: PublicMatchSource;
}

/**
 * A standings row as the league world consumes it: the season-wide row plus the
 * rank movement the plaza boards paint beside the rank. This is the
 * world-contract row — `EvoligaWorldData.standings` (and therefore
 * `EvoligaRouteData.standings`) is typed as `LeagueStanding[]`, so `rank_change`
 * crosses the provider boundary as a required field, not a consumer-side
 * extension.
 */
export interface LeagueStanding extends Standing {
  /**
   * Places gained (+) or lost (−) against the table as it stood before the most
   * recent matchday with results. `null` until a second matchday has results —
   * the first matchday has nothing to move against (disclosed fallback: the
   * board keeps the glyph column closed rather than guessing a direction).
   */
  rank_change: number | null;
}

/**
 * A league group as the public schedule carries it (allowlist: id, name, display order, member player ids).
 * Group membership is public league structure (the hub shows the group tables).
 */
export interface LeagueScheduleGroup {
  id: string;
  name: string;
  sort_order: number;
  player_ids: string[];
}

/** One league group's table: its members' rows of the season table, in table order (cross matches included). */
export interface LeagueGroupStandings {
  groupId: string;
  name: string;
  standings: LeagueStanding[];
}

export interface LeagueSchedule {
  /**
   * Season-wide standings across all stages, sorted by the format tiebreakers. In a league with groups this is
   * the combined table: ranked by points per match while the trainers have played different numbers of matches
   * (`standingsRanking`), else by points.
   */
  standings: LeagueStanding[];
  /** All matches of the season, grouped flat with their stage metadata. */
  fixtures: LeagueFixture[];
  /**
   * League groups only (absent in a league without groups, whose schedule is unchanged): one table per group in
   * group order, each counting all of its members' matches, cross-group matches included.
   */
  groupStandings?: LeagueGroupStandings[];
  /** League groups only: how `standings` (the combined table) is ranked. */
  standingsRanking?: CombinedRanking;
}

/** One matchday's (round's) completed matches, with the order the season played them in. */
export interface CompletedMatchday {
  roundId: string;
  /** Earliest kickoff among the round's completed matches — orders the matchdays. */
  firstKickoff: string;
  records: MatchRecord[];
}

/** When a fixture counts as played for matchday ordering: kickoff, else played, else updated. */
function playedAt(fixture: LeagueFixture): string {
  const { match } = fixture;
  return match.scheduled_at ?? match.date_played ?? match.updated_at;
}

function toMatchRecord(fixture: LeagueFixture): MatchRecord {
  const { match } = fixture;
  return {
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
    winner_id: match.winner_id,
    round_number: 0,
  };
}

/**
 * Completed fixtures grouped into their matchdays (rounds), ordered by each
 * round's earliest kickoff and using the same kickoff precedence as the
 * boards' Spieltag grouping (`buildBoardContent`), so the movement column and
 * the board's matchday labels always agree. Pure: no DB reads.
 */
export function completedMatchdays(fixtures: LeagueFixture[]): CompletedMatchday[] {
  const byRound = new Map<string, LeagueFixture[]>();
  for (const fixture of fixtures) {
    if (fixture.match.status !== 'completed') continue;
    const group = byRound.get(fixture.match.round_id);
    if (group) group.push(fixture);
    else byRound.set(fixture.match.round_id, [fixture]);
  }

  return [...byRound.values()]
    .map((group) => {
      const firstKickoff = group.reduce(
        (earliest, fixture) => (playedAt(fixture).localeCompare(earliest) < 0 ? playedAt(fixture) : earliest),
        playedAt(group[0]),
      );
      return { roundId: group[0].match.round_id, firstKickoff, records: group.map(toMatchRecord) };
    })
    .sort((a, b) => a.firstKickoff.localeCompare(b.firstKickoff));
}

/**
 * Rank deltas between two ordered standings tables: positive = climbed,
 * negative = dropped, `0` = unmoved. `null` for every row without a previous
 * rank — no previous table (first matchday) or a player absent from it. Pure.
 */
export function deriveRankChanges(
  current: Standing[],
  previous: Standing[] | null,
): Map<string, number | null> {
  const changes = new Map<string, number | null>();
  const previousRank = previous
    ? new Map(previous.map((row, index) => [row.player_id, index + 1] as const))
    : null;
  current.forEach((row, index) => {
    const before = previousRank?.get(row.player_id);
    changes.set(row.player_id, before === undefined ? null : before - (index + 1));
  });
  return changes;
}

/**
 * The stage fields the schedule reads. `bracket_type` decides whether the stage's stored byes score: a Swiss stage
 * scores them as wins; a stage without it (or any other type) scores none.
 */
export type LeagueScheduleStage = Pick<TournamentWithDetails, 'id' | 'name'> &
  Partial<Pick<TournamentWithDetails, 'bracket_type'>>;

/** The participant fields the schedule reads (public columns only). */
export type LeagueScheduleParticipant = Pick<PublicSeasonParticipant, 'id' | 'name' | 'avatar_url'>;

/** Already-fetched rows `assembleLeagueSchedule` turns into the schedule. */
export interface LeagueScheduleInput {
  /** The season's stages in stage order. */
  stages: readonly LeagueScheduleStage[];
  participants: readonly LeagueScheduleParticipant[];
  /** Matches per stage id (`getMatchesByTournamentIds`); a missing id means none. */
  matchesByStage: ReadonlyMap<string, MatchWithPlayers[]>;
  /** The season's format and, for EPB, its evolution points. */
  context: SeasonStandingsContext;
  /** The league's groups in display order (`getSeasonGroups`); empty or absent for a league without groups. */
  groups?: readonly LeagueScheduleGroup[];
  /**
   * The stored bye rounds per Swiss stage id (`loadSeasonSwissByeRounds`); a missing id means none. Each Swiss bye
   * counts in the season table as a win, like in the stage's own table. Absent for a league that scores none, and
   * never read by Evolution Point Buy standings.
   */
  byeRoundsByStage?: ReadonlyMap<string, readonly ByeRound[]>;
}

/**
 * Loads what a league schedule needs that the caller has not already loaded.
 * The league page and the world route builder pass the season's stages,
 * participants and standings context they hold, so the schedule then costs a
 * single matches query.
 */
export interface LeagueSchedulePreload {
  stages?: readonly LeagueScheduleStage[];
  participants?: readonly LeagueScheduleParticipant[];
  context?: SeasonStandingsContext;
  groups?: readonly LeagueScheduleGroup[];
}

/** A league's groups narrowed to the public schedule shape (allowlist). */
export function toLeagueScheduleGroups(
  groups: readonly { id: string; name: string; sort_order: number; player_ids: readonly string[] }[],
): LeagueScheduleGroup[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    sort_order: group.sort_order,
    player_ids: [...group.player_ids],
  }));
}

export async function getLeagueSchedule(
  seasonId: string,
  preloaded: LeagueSchedulePreload = {},
): Promise<LeagueSchedule> {
  const [stages, participants, context, groups] = await Promise.all([
    preloaded.stages ?? getStagesBySeasonId(seasonId),
    preloaded.participants ?? getPublicSeasonParticipants(seasonId),
    preloaded.context ?? loadSeasonStandingsContext(seasonId),
    preloaded.groups ?? getSeasonGroups(seasonId).then(toLeagueScheduleGroups),
  ]);

  // One rounds read for every Swiss stage. A league without a Swiss stage has no bye to score, and Evolution Point
  // Buy standings never read byes, so neither reads the rounds.
  const readsByes =
    stages.some((stage) => stage.bracket_type === 'swiss') &&
    (context.formatType === null || !isEvolutionPointBuy(context.formatType));
  const [matchesByStage, byeRoundsByStage] = await Promise.all([
    getMatchesByTournamentIds(stages.map((stage) => stage.id)),
    readsByes ? loadSeasonSwissByeRounds(seasonId) : undefined,
  ]);

  return assembleLeagueSchedule({ stages, participants, matchesByStage, context, groups, byeRoundsByStage });
}

/**
 * The Swiss byes the season table scores, as `[current, previous]`: all of them, and the ones that stood before the
 * latest matchday. A bye is part of the table the moment its round is generated. A round with results stands where
 * its matchday does (matchdays are ordered by kickoff, so a delayed lower-numbered round can be the latest one);
 * a round nobody has played yet was generated after the latest matchday when it follows that matchday's round in
 * its stage. Pure.
 */
function seasonByes(
  stages: readonly LeagueScheduleStage[],
  byeRoundsByStage: ReadonlyMap<string, readonly ByeRound[]>,
  matchdays: readonly CompletedMatchday[],
): { current: ByeRecord[]; previous: ByeRecord[] } {
  // No previous table before a second matchday: every bye stands.
  const latestMatchdayRoundId = matchdays.length > 1 ? matchdays[matchdays.length - 1].roundId : null;
  const playedBefore = new Set(matchdays.slice(0, -1).map((day) => day.roundId));
  const played = new Set(matchdays.map((day) => day.roundId));
  let latestRound: ByeRound | undefined;
  if (latestMatchdayRoundId) {
    for (const rounds of byeRoundsByStage.values()) {
      latestRound = rounds.find((round) => round.id === latestMatchdayRoundId) ?? latestRound;
    }
  }

  const standsBeforeLatest = (round: ByeRound) => {
    if (latestMatchdayRoundId === null) return true;
    if (played.has(round.id)) return playedBefore.has(round.id);
    return !(
      latestRound &&
      round.tournament_id === latestRound.tournament_id &&
      round.round_number > latestRound.round_number
    );
  };
  const earlier = new Map(
    [...byeRoundsByStage].map(([stageId, rounds]) => [stageId, rounds.filter(standsBeforeLatest)] as const),
  );
  return {
    current: scoringByeRecordsForStages(stages, byeRoundsByStage),
    previous: scoringByeRecordsForStages(stages, earlier),
  };
}

/**
 * The schedule from already-fetched rows. Pure: fixtures flattened in stage
 * order, season-wide standings with the format tiebreakers, and each row's
 * rank movement against the previous matchday's table.
 *
 * A league with groups adds one table per group (`groupStandings`, the season
 * table split per group: cross-group matches count, tiebreaks unchanged) and
 * ranks the combined table by points per match while match counts differ
 * (`rankCombinedTable`). Each table's movement compares it with the same table
 * one matchday earlier. Without groups nothing of this applies: the schedule is
 * exactly the season table it always was.
 */
export function assembleLeagueSchedule(input: LeagueScheduleInput): LeagueSchedule {
  const { stages, participants, matchesByStage, context } = input;
  const groups = input.groups ?? [];

  // The public boundary: full match rows in, `PublicMatch` out, so neither
  // the cached schedule nor the world payload holds admin-only columns.
  const fixtures: LeagueFixture[] = stages.flatMap((stage) =>
    (matchesByStage.get(stage.id) ?? []).map((match) => ({
      stageId: stage.id,
      stageName: stage.name,
      match: toPublicMatch(match),
    })),
  );

  const participantIds = participants.map((p) => p.id);
  const participantNames: Record<string, string> = {};
  const participantAvatars: Record<string, string | null> = {};
  for (const p of participants) {
    participantNames[p.id] = p.name;
    participantAvatars[p.id] = p.avatar_url ?? null;
  }

  const matchRecords: MatchRecord[] = fixtures
    .filter((f) => f.match.status === 'completed')
    .map(toMatchRecord);

  // Every match counts for one point per win here, whatever its stage, so a Swiss stage's bye is worth that win
  // too (the stage's own table uses the same single point). Evolution Point Buy standings ignore byes. A legacy
  // round holds no bye, so a league without Swiss byes is exactly the table it always was.
  const matchdays = completedMatchdays(fixtures);
  const byes = seasonByes(stages, input.byeRoundsByStage ?? new Map(), matchdays);

  const standings = computeStandingsFromContext(
    context,
    participantIds,
    participantNames,
    matchRecords,
    participantAvatars,
    { byes: byes.current },
  );

  // Rank movement vs the previous matchday: recompute the table over the
  // completed matchdays BEFORE the latest one with results — same context and
  // inputs as above, so the format tiebreaker chain applies to both
  // snapshots. The context is resolved once, so the second table costs no
  // read; it is skipped entirely until a second matchday has results.
  //
  // KNOWN LIMITATION (escalated, Kilo PR #63 finding): `getSeasonEvolutionPoints`
  // sums `evolution_tracker.evolution_points_awarded` as of NOW — there is no
  // as-of-matchday award ledger — so the previous-matchday EPB snapshot uses
  // CURRENT evolution points. Match points are historical, but when the EPB
  // tiebreaker chain falls through to evolution points, `rank_change` can be
  // skewed for tied rows. A correct fix needs a stored per-matchday snapshot
  // or an award-level ledger (schema change) — deliberately NOT implemented
  // here; see AGENTS.md "Escalate When".
  const previousStandings =
    matchdays.length > 1
      ? computeStandingsFromContext(
          context,
          participantIds,
          participantNames,
          matchdays.slice(0, -1).flatMap((day) => day.records),
          participantAvatars,
          { byes: byes.previous },
        )
      : null;
  if (groups.length === 0) {
    const rankChanges = deriveRankChanges(standings, previousStandings);

    const table: LeagueStanding[] = standings.map((row) => ({
      ...row,
      rank_change: rankChanges.get(row.player_id) ?? null,
    }));

    return { standings: table, fixtures };
  }

  const withMovement = (current: Standing[], previous: Standing[] | null): LeagueStanding[] => {
    const changes = deriveRankChanges(current, previous);
    return current.map((row) => ({ ...row, rank_change: changes.get(row.player_id) ?? null }));
  };
  const tableGroups = groups.map((group) => ({ id: group.id, name: group.name, playerIds: group.player_ids }));
  const combined = rankCombinedTable(standings);
  const previousCombined = previousStandings ? rankCombinedTable(previousStandings).standings : null;
  const previousByGroup = previousStandings
    ? new Map(splitGroupTables(previousStandings, tableGroups).map((t) => [t.group.id, t.standings]))
    : null;

  return {
    standings: withMovement(combined.standings, previousCombined),
    fixtures,
    groupStandings: splitGroupTables(standings, tableGroups).map(({ group, standings: rows }) => ({
      groupId: group.id,
      name: group.name,
      standings: withMovement(rows, previousByGroup?.get(group.id) ?? null),
    })),
    standingsRanking: combined.ranking,
  };
}
