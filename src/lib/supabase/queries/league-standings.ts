import { getStagesBySeasonId } from './tournaments';
import { getPublicSeasonParticipants } from './seasons';
import { getMatchesByTournamentIds } from './matches';
import {
  computeStandingsFromContext,
  loadSeasonStandingsContext,
  type SeasonStandingsContext,
} from '@/lib/tournament/season-standings';
import type { Standing, MatchRecord } from '@/lib/tournament/types';
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

export interface LeagueSchedule {
  /** Season-wide standings across all stages, sorted by the format tiebreakers. */
  standings: LeagueStanding[];
  /** All matches of the season, grouped flat with their stage metadata. */
  fixtures: LeagueFixture[];
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

/** The stage fields the schedule reads. */
export type LeagueScheduleStage = Pick<TournamentWithDetails, 'id' | 'name'>;

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
}

export async function getLeagueSchedule(
  seasonId: string,
  preloaded: LeagueSchedulePreload = {},
): Promise<LeagueSchedule> {
  const [stages, participants, context] = await Promise.all([
    preloaded.stages ?? getStagesBySeasonId(seasonId),
    preloaded.participants ?? getPublicSeasonParticipants(seasonId),
    preloaded.context ?? loadSeasonStandingsContext(seasonId),
  ]);

  const matchesByStage = await getMatchesByTournamentIds(stages.map((stage) => stage.id));

  return assembleLeagueSchedule({ stages, participants, matchesByStage, context });
}

/**
 * The schedule from already-fetched rows. Pure: fixtures flattened in stage
 * order, season-wide standings with the format tiebreakers, and each row's
 * rank movement against the previous matchday's table.
 */
export function assembleLeagueSchedule(input: LeagueScheduleInput): LeagueSchedule {
  const { stages, participants, matchesByStage, context } = input;

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

  const standings = computeStandingsFromContext(
    context,
    participantIds,
    participantNames,
    matchRecords,
    participantAvatars,
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
  const matchdays = completedMatchdays(fixtures);
  const previousStandings =
    matchdays.length > 1
      ? computeStandingsFromContext(
          context,
          participantIds,
          participantNames,
          matchdays.slice(0, -1).flatMap((day) => day.records),
          participantAvatars,
        )
      : null;
  const rankChanges = deriveRankChanges(standings, previousStandings);

  const table: LeagueStanding[] = standings.map((row) => ({
    ...row,
    rank_change: rankChanges.get(row.player_id) ?? null,
  }));

  return { standings: table, fixtures };
}
