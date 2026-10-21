import 'server-only';

import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { computeStandingsFromContext, loadSeasonStandingsContext } from './season-standings';
import { groupTablesUpToWeek } from './group-standings';
import { planGroupSchedule } from './group-schedule';
import { mirrorsLeagueGroups, toScheduleGroups, type PhaseWeekPlan } from './phase-week-plan';
import type { Standing } from './types';

/**
 * The Hinrunde of a league with groups, for the per-group redraft (league groups design, point 5).
 *
 * The Hinrunde stays "the first half of the phase's weeks" of the league's primary phase (lowest stage order,
 * as `getEpbPhaseStatus`). A grouped phase's weeks come from its plan (`planGroupSchedule`), not from the rounds
 * written so far: generation stops in front of each placement week, so `rounds.length` undercounts the phase
 * until its last week exists. The plan's week count and Hinrunde boundary depend only on the group sizes.
 */

export { getGroupedPhaseWeekPlan, type PhaseWeekPlan } from './phase-week-plan';

/** Every league group's first-half (Hinrunde) table of the primary phase. */
export interface GroupFirstHalfTables extends PhaseWeekPlan {
  /** The primary phase (lowest stage order). */
  tournamentId: string;
  /**
   * League group id (`season_groups.id`) -> its table over weeks 1..firstHalfLastWeek, best first, counting
   * every match of its members (cross-group matches included) with the format's standings and tiebreaks.
   * Pass it to `computeRedraftSeats` (src/lib/draft/redraft-order.ts) unchanged: that takes the table best
   * first and returns the worst-first seats itself (do not reverse it before the call).
   */
  tables: Map<string, Standing[]>;
}

/**
 * The first-half tables of every league group, from the primary phase's completed matches. Null when the
 * league has no stage or its primary phase's groups do not mirror league groups (a league without groups keeps
 * the season-wide first-half table). Reads: stages, the phase groups, its completed matches, the season context.
 */
export async function getGroupFirstHalfTables(seasonId: string): Promise<GroupFirstHalfTables | null> {
  const stages = await getStagesBySeasonId(seasonId);
  const primary = stages[0];
  if (!primary) return null;
  const groups = await getGroupsByTournament(primary.id);
  if (!mirrorsLeagueGroups(groups)) return null;

  const ordered = toScheduleGroups(groups);
  const plan = planGroupSchedule(ordered, { crossGroup: true });
  const [records, context] = await Promise.all([
    getCompletedMatchRecords(primary.id),
    loadSeasonStandingsContext(seasonId),
  ]);
  const names: Record<string, string> = {};
  for (const group of groups) for (const member of group.members) names[member.player_id] = member.player_name;

  const byPhaseGroup = groupTablesUpToWeek({
    groups: ordered.map((group) => ({ id: group.id, name: group.id, playerIds: group.memberIds })),
    matches: records,
    lastWeek: plan.firstHalfLastWeek,
    computeTable: (ids, matches) => computeStandingsFromContext(context, ids, names, matches),
  });
  const tables = new Map<string, Standing[]>();
  for (const group of groups) {
    if (group.season_group_id) tables.set(group.season_group_id, byPhaseGroup.get(group.id) ?? []);
  }
  return {
    tournamentId: primary.id,
    totalWeeks: plan.totalWeeks,
    firstHalfLastWeek: plan.firstHalfLastWeek,
    tables,
  };
}
