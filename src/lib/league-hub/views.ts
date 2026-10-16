import { computeStandingsForFormat } from '@/lib/tournament/standings';
import type { MatchRecord, Standing } from '@/lib/tournament/types';
import type { SeasonStandingsContext } from '@/lib/tournament/season-standings';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import type { LeagueFixture } from '@/lib/supabase/queries/league-standings';
import type { PublicTournamentParticipant } from '@/lib/players/public-player';
import type { AdvancementRule, TournamentGroupWithMembers } from '@/types/season';
import type { BracketSide } from '@/types/match';
import type { PublicMatch } from '@/lib/match/public-match';
import type { Round, RoundStatus } from '@/types/round';
import type { TournamentStatus, TournamentWithDetails } from '@/types/tournament';
import { stageKind } from './tabs';

/**
 * Pure view builders for the league hub tabs. Every input is a row the page
 * already holds or read for the selected tab; nothing here reads.
 *
 * Client-safe: the season-standings import is type-only, and standings go
 * through the same format dispatch `computeStandingsFromContext` performs, so
 * every table on the page is computed from ONE season context (AGENTS.md).
 */

/** The phase fields the hub renders. */
export type HubStage = Pick<
  TournamentWithDetails,
  | 'id'
  | 'name'
  | 'bracket_type'
  | 'status'
  | 'best_of_default'
  | 'participant_count'
  | 'advancement_rule'
  | 'current_round'
  | 'stage_order'
  | 'bracket_reset_enabled'
>;

// ─── Scores ───────────────────────────────────────────────────────────────

/**
 * Games won by each player of a match, from its game rows. Null while no game
 * has a winner (an unplayed or freshly started match shows no score).
 */
export function gameScore(match: Pick<PublicMatch, 'player_1_id' | 'player_2_id' | 'games'>): {
  player1: number;
  player2: number;
} | null {
  let player1 = 0;
  let player2 = 0;
  for (const game of match.games) {
    if (game.winner_id === match.player_1_id) player1 += 1;
    else if (game.winner_id === match.player_2_id) player2 += 1;
  }
  return player1 + player2 === 0 ? null : { player1, player2 };
}

// ─── Displayed statuses ───────────────────────────────────────────────────

/*
 * The stored round and phase statuses can lag the results: nothing moves
 * `rounds.status` or `tournaments.status` when the last match of a round or
 * phase is confirmed, so a finished playoff could still read "Pending" next
 * to "2/2". The hub shows the more advanced of the stored status and the one
 * the matches prove, never a less advanced one.
 */

const ROUND_STATUS_RANK: Record<RoundStatus, number> = { pending: 0, active: 1, completed: 2 };
const STAGE_STATUS_RANK: Record<TournamentStatus, number> = { upcoming: 0, active: 1, completed: 2 };

type StatusMatch = Pick<PublicMatch, 'status' | 'round_id' | 'bracket_side' | 'player_1_id' | 'player_2_id'>;

function hasStarted(match: Pick<PublicMatch, 'status'>): boolean {
  return match.status !== 'scheduled';
}

/**
 * Whether a round robin's matches cover its whole schedule. Rounds may be
 * generated one at a time ("Generate next round"), so the matches that exist
 * are not the schedule. Groups are paired among themselves, so the players
 * fall apart into one connected set per group (the whole phase when it has no
 * groups); the schedule is complete when each set has played every pairing in
 * it, the same number of times (a second leg half generated is not complete),
 * and the sets hold every enrolled player.
 *
 * One generated round alone splits the players into pairs that look like
 * complete groups of two, so several sets must hold at least three players
 * each; a phase whose groups have two players is never proved finished here
 * and keeps its stored status. Anything the matches cannot show complete
 * (a substitution leaves the departed player's pairings unplayed) also keeps
 * the stored status.
 */
function roundRobinComplete(participantCount: number, matches: readonly StatusMatch[]): boolean {
  const opponents = new Map<string, Map<string, number>>();
  const meet = (a: string, b: string) => {
    const met = opponents.get(a) ?? new Map<string, number>();
    met.set(b, (met.get(b) ?? 0) + 1);
    opponents.set(a, met);
  };
  for (const match of matches) {
    if (match.player_1_id === match.player_2_id) return false;
    meet(match.player_1_id, match.player_2_id);
    meet(match.player_2_id, match.player_1_id);
  }
  if (participantCount < 2 || opponents.size < participantCount) return false;

  const legs = new Set<number>();
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const start of opponents.keys()) {
    if (seen.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const player = stack.pop()!;
      component.push(player);
      for (const opponent of opponents.get(player)!.keys()) {
        if (!seen.has(opponent)) {
          seen.add(opponent);
          stack.push(opponent);
        }
      }
    }
    for (const player of component) {
      const met = opponents.get(player)!;
      if (met.size !== component.length - 1) return false;
      for (const count of met.values()) legs.add(count);
    }
    sizes.push(component.length);
  }
  if (legs.size !== 1) return false;
  return sizes.length === 1 || sizes.every((size) => size >= 3);
}

/**
 * Whether a phase's matches prove it finished. Every match must be completed,
 * and the matches must cover the whole phase, which only some formats can
 * show: a round robin once every pairing of every group has been played
 * (`roundRobinComplete`: its rounds may be generated one at a time); a single
 * elimination plays one match per eliminated player (byes create no match),
 * so N players need N − 1; a double elimination is over once a grand-final
 * match is completed (a needed bracket reset is created as soon as the grand
 * final is decided, and is then still open). Swiss is paired one round at a
 * time, so its matches never prove the last round has been played.
 */
export function stageFinishedByMatches(
  stage: Pick<HubStage, 'bracket_type' | 'participant_count'>,
  matches: readonly StatusMatch[],
  roundSides: Readonly<Record<string, BracketSide | null>> = {},
): boolean {
  if (matches.length === 0 || matches.some((match) => match.status !== 'completed')) return false;
  switch (stage.bracket_type) {
    case 'round_robin':
      return roundRobinComplete(stage.participant_count, matches);
    case 'single_elim':
      return stage.participant_count >= 2 && matches.length >= stage.participant_count - 1;
    case 'double_elim':
      return matches.some((match) => (match.bracket_side ?? roundSides[match.round_id] ?? null) === 'grand_finals');
    case 'swiss':
      return false;
  }
}

/** A phase's displayed status: the stored one, unless its matches show it further along. */
export function displayStageStatus(
  stage: Pick<HubStage, 'status' | 'bracket_type' | 'participant_count'>,
  matches: readonly StatusMatch[],
  roundSides: Readonly<Record<string, BracketSide | null>> = {},
): TournamentStatus {
  const derived: TournamentStatus = stageFinishedByMatches(stage, matches, roundSides)
    ? 'completed'
    : matches.some(hasStarted)
      ? 'active'
      : 'upcoming';
  return STAGE_STATUS_RANK[derived] > STAGE_STATUS_RANK[stage.status] ? derived : stage.status;
}

/** The phase with its displayed status, for the hub's phase chips. A copy: cached rows are never mutated. */
export function withDisplayStatus<T extends HubStage>(
  stage: T,
  matches: readonly StatusMatch[],
  roundSides: Readonly<Record<string, BracketSide | null>> = {},
): T {
  const status = displayStageStatus(stage, matches, roundSides);
  return status === stage.status ? stage : { ...stage, status };
}

/**
 * A round's displayed status: the stored one, unless its matches show it
 * further along. A table round is paired in full, so all its matches
 * completed means the round is over. An elimination round's later matches
 * appear one by one as their feeders finish, so its own matches prove it
 * over only once the whole phase is; until then a played round reads active.
 * No stored status (round row unknown) stays without a chip.
 */
export function displayRoundStatus(
  stored: RoundStatus | null,
  matches: readonly Pick<PublicMatch, 'status'>[],
  options: { elimination: boolean; stageFinished: boolean },
): RoundStatus | null {
  if (stored === null) return null;
  const allCompleted = matches.length > 0 && matches.every((match) => match.status === 'completed');
  const derived: RoundStatus =
    allCompleted && (!options.elimination || options.stageFinished)
      ? 'completed'
      : matches.some(hasStarted)
        ? 'active'
        : 'pending';
  return ROUND_STATUS_RANK[derived] > ROUND_STATUS_RANK[stored] ? derived : stored;
}

// ─── Matches tab ──────────────────────────────────────────────────────────

/** One round of one phase, with its matches in bracket/kickoff order. */
export interface HubRoundMatches {
  roundId: string;
  /** The round's own name; null when the round row is unknown (the panel prints "Round n"). */
  name: string | null;
  /** 1-based position among the phase's rounds, the fallback label. */
  position: number;
  status: RoundStatus | null;
  bracketSide: BracketSide | null;
  matches: PublicMatch[];
}

export interface HubStageMatches {
  stage: HubStage;
  rounds: HubRoundMatches[];
}

const SIDE_ORDER: Record<BracketSide, number> = { winners: 0, losers: 1, grand_finals: 2 };

function kickoff(match: PublicMatch): string {
  return match.scheduled_at ?? match.date_played ?? match.created_at;
}

function earliestKickoff(matches: readonly PublicMatch[]): string {
  return matches.reduce((earliest, match) => {
    const time = kickoff(match);
    return time.localeCompare(earliest) < 0 ? time : earliest;
  }, kickoff(matches[0]));
}

function compareMatches(a: PublicMatch, b: PublicMatch): number {
  const pos = (a.bracket_pos ?? Number.MAX_SAFE_INTEGER) - (b.bracket_pos ?? Number.MAX_SAFE_INTEGER);
  if (pos !== 0) return pos;
  const time = kickoff(a).localeCompare(kickoff(b));
  if (time !== 0) return time;
  return a.id.localeCompare(b.id);
}

/**
 * Every phase's matches, grouped into rounds. Rounds with a known row sort by
 * round number, then bracket side (winners, losers, grand final); matches
 * whose round row is missing form trailing rounds in kickoff order. Phases
 * keep their stage order, and a phase without matches is kept with no rounds
 * so the panel can say so. Round and phase statuses are the displayed ones
 * (`displayRoundStatus`, `displayStageStatus`).
 */
export function groupStageMatches(
  stages: readonly HubStage[],
  fixtures: readonly LeagueFixture[],
  roundsByStage: Readonly<Record<string, readonly Round[]>>,
): HubStageMatches[] {
  return stages.map((stage) => {
    const rounds = roundsByStage[stage.id] ?? [];
    const roundById = new Map(rounds.map((round) => [round.id, round]));
    const byRound = new Map<string, PublicMatch[]>();
    for (const fixture of fixtures) {
      if (fixture.stageId !== stage.id) continue;
      const list = byRound.get(fixture.match.round_id);
      if (list) list.push(fixture.match);
      else byRound.set(fixture.match.round_id, [fixture.match]);
    }

    const groups = [...byRound.entries()].map(([roundId, matches]) => ({
      roundId,
      round: roundById.get(roundId) ?? null,
      matches: [...matches].sort(compareMatches),
    }));
    groups.sort((a, b) => {
      if (a.round && b.round) {
        if (a.round.round_number !== b.round.round_number) return a.round.round_number - b.round.round_number;
        const side =
          SIDE_ORDER[a.round.bracket_side ?? 'winners'] - SIDE_ORDER[b.round.bracket_side ?? 'winners'];
        if (side !== 0) return side;
        return a.roundId.localeCompare(b.roundId);
      }
      if (a.round) return -1;
      if (b.round) return 1;
      const time = earliestKickoff(a.matches).localeCompare(earliestKickoff(b.matches));
      return time !== 0 ? time : a.roundId.localeCompare(b.roundId);
    });

    const stageMatchList = groups.flatMap((group) => group.matches);
    const roundSides = Object.fromEntries(rounds.map((round) => [round.id, round.bracket_side]));
    const stageFinished = stageFinishedByMatches(stage, stageMatchList, roundSides);
    const elimination = stageKind(stage.bracket_type) === 'bracket';
    return {
      stage: withDisplayStatus(stage, stageMatchList, roundSides),
      rounds: groups.map((group, index) => ({
        roundId: group.roundId,
        name: group.round?.name ?? null,
        position: index + 1,
        status: displayRoundStatus(group.round?.status ?? null, group.matches, { elimination, stageFinished }),
        bracketSide: group.round?.bracket_side ?? null,
        matches: group.matches,
      })),
    };
  });
}

/**
 * Which round of a phase opens expanded: the active round with a match still
 * to play, else the first round still to play, else (a finished phase) the
 * last one. A played elimination round reads active until its phase is over
 * (`displayRoundStatus`), so "active" alone would open a finished round.
 */
export function openRoundId(rounds: readonly HubRoundMatches[]): string | null {
  const active = rounds.find(
    (round) => round.status === 'active' && round.matches.some((match) => match.status !== 'completed'),
  );
  if (active) return active.roundId;
  const open = rounds.find((round) => round.matches.some((match) => match.status !== 'completed'));
  if (open) return open.roundId;
  return rounds[rounds.length - 1]?.roundId ?? null;
}

// ─── Group stage tab ──────────────────────────────────────────────────────

/** One table of a table phase: a group, or the whole phase when it has no groups. */
export interface HubGroupTable {
  key: string;
  /** The group's name; null for an ungrouped phase. */
  name: string | null;
  standings: Standing[];
  /** Table members in standings order, for the results grid. */
  members: { id: string; name: string }[];
  /** The phase's matches between two members of this table. */
  matches: PublicMatch[];
  /**
   * Rows that sit in the advancement zone: the rule's count per group, or the
   * overall count on an ungrouped phase. Null when the rule cannot be shown
   * on this table (no rule, or an overall cut across several groups).
   */
  advanceCount: number | null;
}

export interface HubTableStage {
  /** The phase, with its displayed status (`displayStageStatus`). */
  stage: HubStage;
  /** Round robin scores 3/0 with kill difference; Swiss 1/½ with Buchholz. */
  scoring: 'round_robin' | 'swiss';
  /** The advancement rule the hub shows for this phase; null when it shows none (`showsAdvancement`). */
  advancementRule: AdvancementRule | null;
  tables: HubGroupTable[];
}

export interface TableStageInput {
  stage: HubStage;
  /** The phase's matches (any status); only completed ones count. */
  matches: readonly PublicMatch[];
  /** Phase enrollment (seed order); used when the phase has no groups. */
  participants: readonly Pick<PublicTournamentParticipant, 'id' | 'name' | 'avatar_url'>[];
  groups: readonly TournamentGroupWithMembers[];
  /** The phase's battle stats (round robin kill difference); empty for Swiss. */
  battleStats: readonly TournamentBattleStat[];
  /** Round numbers of the phase's rounds, for the match records. */
  roundNumbers: Readonly<Record<string, number>>;
  context: SeasonStandingsContext;
  gymTypes: Readonly<Record<string, string | null>>;
  /** Whether the phase's advancement rule is shown (`showsAdvancement`); default true. */
  showAdvancement?: boolean;
}

function toRecord(match: PublicMatch, roundNumbers: Readonly<Record<string, number>>): MatchRecord {
  return {
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
    winner_id: match.winner_id,
    round_number: roundNumbers[match.round_id] ?? 0,
  };
}

/**
 * Whether the hub shows a phase's advancement rule ("Top 4 overall
 * advance"). Only a table phase sends players on, and only when a phase
 * follows it. A league's only phase keeps its rule: its playoffs are usually
 * created once the table is final, and the rule says who will make them.
 */
export function showsAdvancement(
  stages: readonly Pick<HubStage, 'id' | 'bracket_type' | 'advancement_rule'>[],
  stageId: string,
): boolean {
  const index = stages.findIndex((stage) => stage.id === stageId);
  if (index === -1) return false;
  const stage = stages[index];
  if (!stage.advancement_rule || stageKind(stage.bracket_type) !== 'table') return false;
  return index < stages.length - 1 || stages.length === 1;
}

function advanceCountFor(
  rule: AdvancementRule | null,
  grouped: boolean,
  groupCount: number,
): number | null {
  if (!rule) return null;
  if (rule.per_group) return rule.count;
  return grouped && groupCount > 1 ? null : rule.count;
}

/**
 * Enrolled players of a grouped phase who hold no group row, placed in the
 * group most of their opponents belong to (ties: the earlier group). Since
 * substitution hands over the group row (`swapGroupMemberInTournament`) this
 * is a fallback for substitutions from before that fix and for hand-edited
 * groups: without it such a player and every match they played would drop
 * out of every table. Players who are not enrolled (departed) are never
 * placed, nor is anyone when the phase has no enrollment rows; players whose
 * opponents have no group either are left out.
 */
function placeUngroupedPlayers(
  groups: readonly TournamentGroupWithMembers[],
  matches: readonly PublicMatch[],
  enrolled: ReadonlySet<string>,
): Map<string, { id: string; name: string }[]> {
  const groupOf = new Map<string, string>();
  for (const group of groups) for (const member of group.members) groupOf.set(member.player_id, group.id);

  const votes = new Map<string, { name: string; byGroup: Map<string, number> }>();
  for (const match of matches) {
    const sides = [
      [match.player_1_id, match.player_1_name, match.player_2_id],
      [match.player_2_id, match.player_2_name, match.player_1_id],
    ] as const;
    for (const [id, name, opponent] of sides) {
      if (groupOf.has(id) || !enrolled.has(id)) continue;
      const entry = votes.get(id) ?? { name, byGroup: new Map<string, number>() };
      const opponentGroup = groupOf.get(opponent);
      if (opponentGroup) entry.byGroup.set(opponentGroup, (entry.byGroup.get(opponentGroup) ?? 0) + 1);
      votes.set(id, entry);
    }
  }

  const placed = new Map<string, { id: string; name: string }[]>();
  for (const [id, { name, byGroup }] of votes) {
    let best: string | null = null;
    let bestCount = 0;
    for (const group of groups) {
      const count = byGroup.get(group.id) ?? 0;
      if (count > bestCount) {
        best = group.id;
        bestCount = count;
      }
    }
    if (best) placed.set(best, [...(placed.get(best) ?? []), { id, name }]);
  }
  return placed;
}

/** A group member as the hub shows it: the group tables and the phase cards. */
export interface HubGroupMember {
  id: string;
  name: string;
  /** The group row's seed; 0 for a player placed by `placeUngroupedPlayers`. */
  seed: number;
}

/**
 * Each group's members as the hub shows them, keyed by group id: the group
 * rows of players enrolled in the phase, then the enrolled players without a
 * group row that `placeUngroupedPlayers` puts in the group most of their
 * opponents belong to. A departed player (substituted out, enrollment row
 * gone) shows in no group. With no enrollment rows at all every group row is
 * kept (legacy data). The group tables and the phase cards both read this, so
 * the two tabs list the same players.
 */
export function resolveGroupMembers(
  groups: readonly TournamentGroupWithMembers[],
  matches: readonly PublicMatch[],
  enrolled: ReadonlySet<string>,
): Map<string, HubGroupMember[]> {
  const ordered = [...groups].sort((a, b) => a.group_number - b.group_number);
  const isEnrolled = (id: string) => enrolled.size === 0 || enrolled.has(id);
  const extras = placeUngroupedPlayers(ordered, matches, enrolled);
  return new Map(
    ordered.map((group) => [
      group.id,
      [
        ...group.members
          .filter((member) => isEnrolled(member.player_id))
          .map((member) => ({ id: member.player_id, name: member.player_name, seed: member.seed })),
        ...(extras.get(group.id) ?? []).map((extra) => ({ id: extra.id, name: extra.name, seed: 0 })),
      ],
    ]),
  );
}

/**
 * The standings tables of one table phase, scored exactly as the phase page
 * scores them: round robin 3 points a win, 0 a draw, kill difference and
 * games played from the phase's own games; Swiss the default 1 / ½ with
 * Buchholz. A grouped phase (round robin or Swiss: groups pair players for
 * both) gets one table per group, counting only matches between two members
 * of that group (the advancement filter).
 */
export function buildTableStage(input: TableStageInput): HubTableStage {
  const { matches, participants, groups, battleStats, roundNumbers, context, gymTypes } = input;
  const stage = withDisplayStatus(input.stage, matches);
  const scoring = stage.bracket_type === 'swiss' ? 'swiss' : 'round_robin';
  const completed = matches.filter((match) => match.status === 'completed');
  const advancementRule = input.showAdvancement === false ? null : stage.advancement_rule;

  const avatars: Record<string, string | null> = {};
  const names: Record<string, string> = {};
  for (const participant of participants) {
    avatars[participant.id] = participant.avatar_url;
    names[participant.id] = participant.name;
  }

  const tableFor = (
    key: string,
    name: string | null,
    memberIds: string[],
    memberNames: Record<string, string>,
    advanceCount: number | null,
  ): HubGroupTable => {
    const members = new Set(memberIds);
    const tableMatches = matches.filter(
      (match) => members.has(match.player_1_id) && members.has(match.player_2_id),
    );
    const tableCompleted = completed.filter(
      (match) => members.has(match.player_1_id) && members.has(match.player_2_id),
    );
    const records = tableCompleted.map((match) => toRecord(match, roundNumbers));
    // Kill difference counts the games of the matches the table counts, as
    // W/L does: never a game against a departed player, a player outside the
    // group, or of a match not yet completed.
    const tableGames = new Set(tableCompleted.flatMap((match) => match.games.map((game) => game.id)));
    const options =
      scoring === 'round_robin'
        ? {
            pointsPerWin: 3,
            pointsPerDraw: 0,
            battleStats: battleStats.filter((stat) => tableGames.has(stat.game_id)),
            gamesByMatch: Object.fromEntries(
              tableCompleted.map((match) => [
                `${match.player_1_id}::${match.player_2_id}`,
                match.games.map((game) => game.winner_id ?? ''),
              ]),
            ),
          }
        : {};
    // Gym bands from the season participants where the format's standings
    // leave them blank (Evolution Point Buy computes no gym band).
    const standings = computeStandingsForFormat(
      context.formatType,
      memberIds,
      memberNames,
      records,
      avatars,
      options,
      { ...gymTypes },
      { evolutionPoints: context.evolutionPoints },
    ).map((row) => (row.gym_type ? row : { ...row, gym_type: gymTypes[row.player_id] ?? null }));
    return {
      key,
      name,
      standings,
      members: standings.map((row) => ({ id: row.player_id, name: row.player_name })),
      matches: tableMatches,
      advanceCount,
    };
  };

  // The tables hold the players enrolled in the phase, as the phase page's
  // table does: a departed player (substituted out, enrollment row gone) and
  // the matches against them count nowhere. Per-group advancement reads the
  // raw group rows instead, so the two agree only where a substitution handed
  // the group row over (every one since the handover; older ones left it with
  // the departed player, whom the hub drops while advancement keeps). A phase
  // with no enrollment rows at all falls back to whoever its groups or
  // matches name, so legacy data still shows a table. Group membership comes
  // from `resolveGroupMembers`, as on the phase cards.
  const enrolled = new Set(participants.map((participant) => participant.id));

  if (groups.length > 0) {
    const ordered = [...groups].sort((a, b) => a.group_number - b.group_number);
    const membersByGroup = resolveGroupMembers(ordered, matches, enrolled);
    return {
      stage,
      scoring,
      advancementRule,
      tables: ordered.map((group) => {
        const members = membersByGroup.get(group.id) ?? [];
        const memberNames: Record<string, string> = {};
        for (const member of members) memberNames[member.id] = names[member.id] ?? member.name;
        return tableFor(
          group.id,
          group.name,
          members.map((member) => member.id),
          memberNames,
          advanceCountFor(advancementRule, true, ordered.length),
        );
      }),
    };
  }

  // Ungrouped: the phase enrollment; without enrollment rows, the players its
  // matches name.
  const memberIds = participants.map((participant) => participant.id);
  const memberNames = { ...names };
  for (const match of enrolled.size === 0 ? matches : []) {
    for (const [id, name] of [
      [match.player_1_id, match.player_1_name],
      [match.player_2_id, match.player_2_name],
    ] as const) {
      if (!(id in memberNames)) {
        memberNames[id] = name;
        memberIds.push(id);
      }
    }
  }
  return {
    stage,
    scoring,
    advancementRule,
    tables:
      memberIds.length === 0
        ? []
        : [tableFor(stage.id, null, memberIds, memberNames, advanceCountFor(advancementRule, false, 0))],
  };
}

/** The table phases of a league, in stage order. */
export function tableStages<T extends Pick<HubStage, 'bracket_type'>>(stages: readonly T[]): T[] {
  return stages.filter((stage) => stageKind(stage.bracket_type) === 'table');
}

/** The elimination phases of a league, in stage order. */
export function bracketStages<T extends Pick<HubStage, 'bracket_type'>>(stages: readonly T[]): T[] {
  return stages.filter((stage) => stageKind(stage.bracket_type) === 'bracket');
}

/** Round robin phases: the only ones scored with kill difference (their battle stats). */
export function roundRobinStages<T extends Pick<HubStage, 'bracket_type'>>(stages: readonly T[]): T[] {
  return stages.filter((stage) => stage.bracket_type === 'round_robin');
}

/** A phase's matches from the season fixtures, in fixture order. */
export function stageMatches(fixtures: readonly LeagueFixture[], stageId: string): PublicMatch[] {
  return fixtures.filter((fixture) => fixture.stageId === stageId).map((fixture) => fixture.match);
}
