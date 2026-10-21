import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { expireTournamentReads } from '@/lib/revalidation';
import { getSeasonGroups, seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getMatchesByTournament } from '@/lib/supabase/queries/matches';
import {
  addGroupMembersBatch,
  createGroupBatch,
  deleteGroupsByTournament,
  getGroupsByTournament,
} from '@/lib/supabase/queries/tournament-groups';
import { computeStandingsFromContext, loadSeasonStandingsContext } from './season-standings';
import { groupTablesUpToWeek } from './group-standings';
import {
  GroupScheduleError,
  pairKey,
  pairPlacementWeek,
  planGroupSchedule,
  type GroupSchedulePlan,
  type PlannedWeek,
} from './group-schedule';
import { mirrorsLeagueGroups, toScheduleGroups } from './phase-week-plan';
import type { MatchRecord, Pairing } from './types';
import type { Round } from '@/types/round';
import type { TournamentGroupWithMembers } from '@/types/season';
import type { BracketType } from '@/types/tournament';
import type { MatchWithPlayers } from '@/types/match';

/**
 * League groups in a phase's schedule (server side of `group-schedule.ts`):
 *   - a phase of a league WITH groups mirrors the league groups (`ensurePhaseGroupsFromLeague`): one phase group
 *     per league group that has enrolled trainers, `season_group_id` set, members = the enrolled trainers of the
 *     league group in enrollment (seed) order. A league without groups never reaches the writes: its phases keep
 *     the phase-only groups the phase editor builds;
 *   - a grouped round robin phase is generated week by week from the plan (`planPhaseWeeks`), with cross-group
 *     matches when its groups mirror league groups, and a placement week paired from the group tables after the
 *     previous week only when that week is generated (`resolveWeekPairings`).
 */

/** Phases whose players sit in groups (round robin and Swiss); an elimination phase has none. */
function isTablePhase(bracketType: BracketType): boolean {
  return bracketType === 'round_robin' || bracketType === 'swiss';
}

export { mirrorsLeagueGroups, toScheduleGroups } from './phase-week-plan';

interface DesiredGroup {
  season_group_id: string;
  name: string;
  memberIds: string[];
}

function sameGroups(existing: readonly TournamentGroupWithMembers[], desired: readonly DesiredGroup[]): boolean {
  const current = [...existing].sort((a, b) => a.group_number - b.group_number);
  if (current.length !== desired.length) return false;
  return current.every((group, index) => {
    const want = desired[index];
    const members = [...group.members].sort((a, b) => a.seed - b.seed).map((member) => member.player_id);
    return (
      group.season_group_id === want.season_group_id &&
      group.name === want.name &&
      group.group_number === index + 1 &&
      members.length === want.memberIds.length &&
      members.every((id, i) => id === want.memberIds[i])
    );
  });
}

/**
 * Make a table phase of a league with groups mirror the league groups, and return the phase's groups.
 *
 * - League without groups, or an elimination phase: nothing is written; the phase's own groups come back.
 * - Phase with rounds: the groups its schedule was generated from stay (nothing is rewritten under played
 *   weeks); they come back unchanged.
 * - Otherwise the phase groups are rebuilt when they differ from the league groups: one per league group with
 *   enrolled trainers (league group order, its name, `season_group_id` set), members in enrollment order (seed
 *   1..n). An enrolled trainer in no league group is refused (`PHASE_PLAYER_WITHOUT_LEAGUE_GROUP`, 409): the
 *   admin places them in the league groups editor first.
 * The rebuild is a delete and two inserts (the same writes as the phase editor's regenerate); a failure between
 * them leaves the phase without groups, and the next call rebuilds them.
 */
export async function ensurePhaseGroupsFromLeague(
  seasonId: string,
  phase: { id: string; bracket_type: BracketType },
): Promise<TournamentGroupWithMembers[]> {
  const [leagueGroups, existing] = await Promise.all([getSeasonGroups(seasonId), getGroupsByTournament(phase.id)]);
  if (leagueGroups.length === 0 || !isTablePhase(phase.bracket_type)) return existing;

  const rounds = await getRoundsByTournament(phase.id);
  if (rounds.length > 0) return existing;

  const enrollment = await getParticipants(phase.id);
  const groupOf = new Map<string, string>();
  for (const group of leagueGroups) for (const playerId of group.player_ids) groupOf.set(playerId, group.id);
  const ungrouped = enrollment.filter((participant) => !groupOf.has(participant.id));
  if (ungrouped.length > 0) {
    throw new UserFacingError('Every trainer of this phase must be in a league group first', {
      code: 'PHASE_PLAYER_WITHOUT_LEAGUE_GROUP',
      status: 409,
      params: { count: ungrouped.length },
    });
  }

  const desired: DesiredGroup[] = leagueGroups
    .map((group) => ({
      season_group_id: group.id,
      name: group.name,
      memberIds: enrollment.filter((participant) => groupOf.get(participant.id) === group.id).map((p) => p.id),
    }))
    .filter((group) => group.memberIds.length > 0);
  if (sameGroups(existing, desired)) return existing;

  // Validate the layout before anything is rewritten: a refused layout leaves the phase's groups as they were
  // (no mirror rows of a layout that can never be generated, which would hold the league groups in use).
  try {
    planGroupSchedule(
      desired.map((group) => ({ id: group.season_group_id, memberIds: group.memberIds })),
      { crossGroup: true },
    );
  } catch (err) {
    if (err instanceof GroupScheduleError) throw scheduleRefusal(err);
    throw err;
  }

  await deleteGroupsByTournament(phase.id);
  const created = await createGroupBatch(
    desired.map((group, index) => ({
      tournament_id: phase.id,
      name: group.name,
      group_number: index + 1,
      season_group_id: group.season_group_id,
    })),
  );
  const idBySeasonGroup = new Map(created.map((group) => [group.season_group_id, group.id]));
  await addGroupMembersBatch(
    desired.flatMap((group) =>
      group.memberIds.map((playerId, index) => ({
        group_id: idBySeasonGroup.get(group.season_group_id)!,
        player_id: playerId,
        seed: index + 1,
      })),
    ),
  );
  expireTournamentReads(phase.id, seasonId);
  return getGroupsByTournament(phase.id);
}

/**
 * A league with groups owns its phases' groups: they mirror the league groups (rebuilt from them before the
 * phase's first round, `ensurePhaseGroupsFromLeague`). The phase editor's regenerate, delete and member moves
 * are refused there (`PHASE_GROUPS_LEAGUE_MANAGED`, 409), pointing at the league groups editor.
 */
export async function assertPhaseGroupsEditable(seasonId: string): Promise<void> {
  if (await seasonHasGroups(seasonId)) {
    throw new UserFacingError(
      "This league has groups, so its phases follow them. Change the groups in the league's Participants tab.",
      { code: 'PHASE_GROUPS_LEAGUE_MANAGED', status: 409 },
    );
  }
}

/** Map a planner refusal to the user-facing one (the admin fixes the groups); each cause keeps its own code. */
function scheduleRefusal(err: GroupScheduleError): UserFacingError {
  console.error('[tournament/group-rounds] group layout refused by the planner:', err);
  if (err.code === 'no_balance') {
    return new UserFacingError('The phase groups cannot be split into two balanced halves of the season', {
      code: 'rounds_group_schedule_unbalanced',
      status: 400,
    });
  }
  return new UserFacingError(
    'The phase groups cannot be scheduled: every group needs a trainer, and every trainer exactly one group',
    { code: 'rounds_group_layout_invalid', status: 400 },
  );
}

/** What a grouped round robin phase's weeks are built from: its groups, rounds and matches. */
export interface PhaseWeekContext {
  groups: TournamentGroupWithMembers[];
  rounds: Round[];
  /** Every match of the phase (any status). */
  matches: MatchWithPlayers[];
}

/** Load the rounds and matches a grouped phase's plan needs (its groups are passed in). */
export async function loadPhaseWeekContext(
  tournamentId: string,
  groups: TournamentGroupWithMembers[],
): Promise<PhaseWeekContext> {
  const [rounds, matches] = await Promise.all([getRoundsByTournament(tournamentId), getMatchesByTournament(tournamentId)]);
  return { groups, rounds, matches };
}

function matchesOfWeek(context: PhaseWeekContext, week: number): MatchWithPlayers[] {
  const roundIds = new Set(context.rounds.filter((round) => round.round_number === week).map((round) => round.id));
  return context.matches.filter((match) => roundIds.has(match.round_id));
}

/**
 * The phase's plan with the placement weeks already generated filled in (their stored pairings), so the weeks
 * after them prefer opponents not met there. `extraPlacements` adds placement pairings resolved in this request.
 * Throws a user-facing refusal for a group layout the planner rejects.
 */
export function planPhaseWeeks(
  context: PhaseWeekContext,
  extraPlacements: ReadonlyMap<number, readonly Pairing[]> = new Map(),
): GroupSchedulePlan {
  const groups = toScheduleGroups(context.groups);
  const crossGroup = mirrorsLeagueGroups(context.groups);
  try {
    const skeleton = planGroupSchedule(groups, { crossGroup });
    const placements = new Map<number, readonly Pairing[]>(extraPlacements);
    for (const week of skeleton.weeks) {
      if (week.kind !== 'placement' || placements.has(week.week)) continue;
      const stored = matchesOfWeek(context, week.week);
      if (stored.length > 0) {
        placements.set(
          week.week,
          stored.map((match) => ({ player_1_id: match.player_1_id, player_2_id: match.player_2_id })),
        );
      }
    }
    return placements.size === 0 ? skeleton : planGroupSchedule(groups, { crossGroup, placementPairings: placements });
  } catch (err) {
    if (err instanceof GroupScheduleError) throw scheduleRefusal(err);
    throw err;
  }
}

/**
 * A placement week's pairings: refused until every match of the weeks before it is completed
 * (`rounds_group_placement_not_ready`, 409), then the group tables after the previous week (format standings,
 * cross-group matches included; ties in table order) pair the same-placed trainers (`pairPlacementWeek`).
 */
async function placementPairings(
  seasonId: string | null,
  context: PhaseWeekContext,
  week: number,
): Promise<Pairing[]> {
  const roundNumber = new Map(context.rounds.map((round) => [round.id, round.round_number]));
  const earlier = context.matches.filter((match) => (roundNumber.get(match.round_id) ?? 0) < week);
  if (earlier.some((match) => match.status !== 'completed')) {
    throw new UserFacingError('Finish every match before the placement week first', {
      code: 'rounds_group_placement_not_ready',
      status: 409,
      params: { week },
    });
  }
  const standingsContext = await loadSeasonStandingsContext(seasonId);
  const names: Record<string, string> = {};
  for (const group of context.groups) for (const member of group.members) names[member.player_id] = member.player_name;
  const records: MatchRecord[] = earlier.map((match) => ({
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
    winner_id: match.winner_id,
    round_number: roundNumber.get(match.round_id) ?? 0,
  }));
  const ordered = toScheduleGroups(context.groups);
  const tables = groupTablesUpToWeek({
    groups: ordered.map((group) => ({ id: group.id, name: group.id, playerIds: group.memberIds })),
    matches: records,
    lastWeek: week - 1,
    computeTable: (ids, matches) => computeStandingsFromContext(standingsContext, ids, names, matches),
  });
  // Earlier pairings of the phase: with three or more groups a trainer prefers a same-placed trainer not met yet.
  const met = new Set(earlier.map((match) => pairKey(match.player_1_id, match.player_2_id)));
  return pairPlacementWeek(
    ordered.map((group) => (tables.get(group.id) ?? []).map((row) => row.player_id)),
    met,
  );
}

/**
 * Written rounds of a grouped phase that hold no match although their planned week has pairings (a placement
 * week always has): what an interrupted write leaves (the round and its matches are two writes). Keyed by week.
 * Generation fills these rounds instead of skipping them, so no week of the plan stays empty.
 */
export function roundsAwaitingMatches(context: PhaseWeekContext, plan: GroupSchedulePlan): Map<number, Round> {
  const withMatches = new Set(context.matches.map((match) => match.round_id));
  const awaiting = new Map<number, Round>();
  for (const round of context.rounds) {
    if (withMatches.has(round.id)) continue;
    const week = plan.weeks.find((w) => w.week === round.round_number);
    if (!week) continue;
    if (week.kind === 'placement' || week.groupPairings.length + week.crossPairings.length > 0) {
      awaiting.set(round.round_number, round);
    }
  }
  return awaiting;
}

/**
 * The planned weeks still to write, in week order: weeks with no round, and written rounds still waiting for their
 * matches (`roundsAwaitingMatches`). Both generate routes take their weeks from here, never from
 * `tournaments.current_round`: an interrupted generate-all-rounds updates `current_round` only after all its writes,
 * so counting from it could write a second round for a week that already has one.
 */
export function pendingWeeks(context: PhaseWeekContext, plan: GroupSchedulePlan): PlannedWeek[] {
  const written = new Set(context.rounds.map((round) => round.round_number));
  const awaiting = roundsAwaitingMatches(context, plan);
  return plan.weeks.filter((week) => !written.has(week.week) || awaiting.has(week.week));
}

/** One week ready to write: its plan entry and every pairing. */
export interface ResolvedWeek {
  week: PlannedWeek;
  pairings: Pairing[];
}

/**
 * The weeks to write, validated in full before anything is written. `weeks` are the week numbers asked for, in
 * order; a placement week among them is resolved from the tables (and refused until they are final). Returns the
 * plan the weeks came from and the weeks with their pairings.
 */
export async function resolveWeekPairings(
  seasonId: string | null,
  context: PhaseWeekContext,
  weeks: readonly number[],
): Promise<{ plan: GroupSchedulePlan; resolved: ResolvedWeek[] }> {
  const extra = new Map<number, Pairing[]>();
  let plan = planPhaseWeeks(context);
  for (const number of weeks) {
    const week = plan.weeks.find((w) => w.week === number);
    if (week?.awaitingTables) {
      extra.set(number, await placementPairings(seasonId, context, number));
      plan = planPhaseWeeks(context, extra);
    }
  }
  const resolved = weeks.map((number) => {
    const week = plan.weeks.find((w) => w.week === number);
    if (!week) throw new Error(`group schedule: week ${number} is outside the plan (${plan.totalWeeks} weeks)`);
    return { week, pairings: [...week.groupPairings, ...week.crossPairings] };
  });
  return { plan, resolved };
}
