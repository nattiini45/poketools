import 'server-only';

import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { planGroupSchedule, type ScheduleGroup } from './group-schedule';
import type { TournamentGroupWithMembers } from '@/types/season';

/**
 * The planned weeks of a phase whose groups mirror league groups (league groups design, point 5).
 *
 * Kept light on purpose (one read and the pure planner): the EPB Hinrunde gate (`src/lib/season/epb-phase.ts`)
 * takes its boundary from here. A grouped phase's weeks come from its plan, not from the rounds written so far:
 * generation stops in front of each placement week, so `rounds.length` undercounts the phase until its last
 * week exists. The plan's week count and Hinrunde boundary depend only on the group sizes.
 */

/** Whether a phase's groups mirror league groups (every group carries a `season_group_id`). */
export function mirrorsLeagueGroups(groups: readonly TournamentGroupWithMembers[]): boolean {
  return groups.length > 0 && groups.every((group) => Boolean(group.season_group_id));
}

/** The plan's view of a phase's groups: group order, members in seed order. */
export function toScheduleGroups(groups: readonly TournamentGroupWithMembers[]): ScheduleGroup[] {
  return [...groups]
    .sort((a, b) => a.group_number - b.group_number)
    .map((group) => ({
      id: group.id,
      memberIds: [...group.members].sort((a, b) => a.seed - b.seed).map((member) => member.player_id),
    }));
}

/** A grouped phase's planned week count and Hinrunde boundary. */
export interface PhaseWeekPlan {
  totalWeeks: number;
  /** Last Hinrunde week (`floor(totalWeeks / 2)`, the placement week that closes the first half). */
  firstHalfLastWeek: number;
}

/**
 * The planned weeks of a phase whose groups mirror league groups; null for any other phase (no groups, or
 * phase-only groups: their weeks are their rounds, as before). One read: the phase groups. A layout the planner
 * refuses propagates its `GroupScheduleError` (generation refuses the same layout, so no round exists then).
 */
export async function getGroupedPhaseWeekPlan(tournamentId: string): Promise<PhaseWeekPlan | null> {
  const groups = await getGroupsByTournament(tournamentId);
  if (!mirrorsLeagueGroups(groups)) return null;
  const plan = planGroupSchedule(toScheduleGroups(groups), { crossGroup: true });
  return { totalWeeks: plan.totalWeeks, firstHalfLastWeek: plan.firstHalfLastWeek };
}
