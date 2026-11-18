import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { formKitGroups, legRoundRange, pairNextRound, roundRobinOf } from '@/lib/format-engine/pairing';
import type { KitPhase } from '@/lib/format-engine/load';
import type { PairingAids } from '@/lib/format-engine/pairing-server';
import { assertMirroredGroupsPlayLegs } from '@/lib/format-engine/route-guards';
import { generateRound } from '@/lib/tournament';
import { byeRecordsFromRounds } from '@/lib/tournament/byes';
import { pendingWeeks, planPhaseWeeks, resolveWeekPairings, type PhaseWeekContext } from '@/lib/tournament/group-rounds';
import { mirrorsLeagueGroups, toScheduleGroups } from '@/lib/tournament/phase-week-plan';
import { getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
import { assertNoScheduleDrift } from '@/lib/tournament/schedule-drift';
import { groupLabel } from '@/lib/tournament/serpentine';
import type { PhaseRoundGroupLayout } from '@/lib/supabase/queries/phase-rounds';
import type { SeasonStandingsContext } from '@/lib/tournament/season-standings';
import { BYE_PLAYER_ID, type GeneratedRound, type MatchRecord } from '@/lib/tournament/types';
import type { Phase, PhaseRound } from '@/types/league-phase';
import type { SeasonGroupWithMembers } from '@/types/season-group';

export function planNativeRoundGroups(
  existing: (PhaseRoundGroupLayout & { id: string })[],
  leagueGroups: SeasonGroupWithMembers[],
  participantIds: string[],
  first: boolean,
  kit: KitPhase | null,
) {
  const grouped = existing.flatMap(group => group.members.map(member => member.player_id));
  const groupedSet = new Set(grouped);
  const holdsRoster = grouped.length === participantIds.length && groupedSet.size === grouped.length
    && participantIds.every(id => groupedSet.has(id)) && existing.every(group => group.members.length > 0);
  let replacement: PhaseRoundGroupLayout[] | undefined;
  if (first && leagueGroups.length > 0) {
    const groupedIds = new Set(leagueGroups.flatMap(group => group.player_ids));
    const count = participantIds.filter(id => !groupedIds.has(id)).length;
    if (count > 0) {
      throw new UserFacingError('Every trainer of this phase must be in a league group first', {
        code: 'PHASE_PLAYER_WITHOUT_LEAGUE_GROUP', params: { count }, status: 409,
      });
    }
    const desiredGroups = leagueGroups.map(group => ({
      name: group.name, season_group_id: group.id,
      members: participantIds.filter(id => group.player_ids.includes(id)).map((player_id, index) => ({ player_id, seed: index + 1 })),
    })).filter(group => group.members.length > 0).map((group, index) => ({ ...group, group_number: index + 1 }));
    if (existing.length !== desiredGroups.length || !existing.every((group, index) => {
      const desired = desiredGroups[index];
      return group.name === desired.name && group.season_group_id === desired.season_group_id
        && group.group_number === desired.group_number && group.members.length === desired.members.length
        && group.members.every((member, slot) => member.player_id === desired.members[slot].player_id && member.seed === desired.members[slot].seed);
    })) replacement = desiredGroups;
  } else if (first && kit?.stage.groups && kit.stage.groups.method !== 'manual' && !holdsRoster) {
    replacement = formKitGroups(participantIds, kit.stage.groups, { seed: kit.seed, stageKey: kit.stage.key })
      .map(group => ({ ...group, season_group_id: null, name: `Group ${groupLabel(group.group_number - 1)}` }));
  } else if (!holdsRoster && (existing.length > 0 || kit?.stage.groups !== undefined || leagueGroups.length > 0)) {
    throw new UserFacingError('The phase groups cannot be scheduled: every group needs a trainer, and every trainer exactly one group', {
      code: 'rounds_group_layout_invalid', status: 409,
    });
  }
  if (!first && leagueGroups.length > 0) {
    const leagueGroupOf = new Map(leagueGroups.flatMap(group => group.player_ids.map(id => [id, group.id] as const)));
    if (existing.some(group => group.members.some(member => leagueGroupOf.get(member.player_id) !== group.season_group_id))) {
      throw new UserFacingError('The phase groups no longer mirror the league groups; no round was written.', {
        code: 'PHASE_GROUPS_STALE', status: 409,
      });
    }
  }
  return {
    replacement,
    groups: replacement?.map(group => ({ ...group, id: group.season_group_id ?? String(group.group_number) })) ?? existing,
  };
}

export async function pairNativeRound(input: {
  phase: Pick<Phase, 'season_id' | 'current_round'> & { bracket_type: 'swiss' | 'round_robin' };
  context: PhaseWeekContext<PhaseRound>;
  participantIds: string[];
  participantNames: Record<string, string>;
  kit: KitPhase | null;
  aidsFor: (round: number) => Promise<PairingAids>;
  loadStandingsContext: () => Promise<SeasonStandingsContext>;
}): Promise<GeneratedRound> {
  const { phase, context, participantIds, participantNames, kit, aidsFor } = input;
  const { groups, rounds, matches } = context;
  const robin = phase.bracket_type === 'round_robin';
  const mirrored = mirrorsLeagueGroups(groups);
  const kitRobin = kit ? roundRobinOf(kit.stage.pairing) : null;
  assertMirroredGroupsPlayLegs(kitRobin, mirrored);
  if (groups.length > 0 && robin && (!kit || mirrored)) {
    const plan = planPhaseWeeks(context);
    const written = new Map(rounds.map(round => [round.round_number, round]));
    for (const next of pendingWeeks(context, plan)) {
      const { resolved: [{ pairings }] } = await resolveWeekPairings(phase.season_id, context, [next.week], {
        loadStandingsContext: input.loadStandingsContext,
      });
      const { allowPair } = await aidsFor(next.week);
      const kept = allowPair ? pairings.filter(pair => allowPair(pair.player_1_id, pair.player_2_id)) : pairings;
      const existing = written.get(next.week);
      if (allowPair && existing?.pairings_generated) {
        if (kept.length === 0) continue;
        throw new UserFacingError(`${existing.name} has no fixtures, but its pairings are marked as generated. Delete it to generate it again.`, {
          code: 'rounds_round_already_written', params: { round: existing.name }, status: 409,
        });
      }
      return {
        round_number: next.week, round_name: `Round ${next.week}`, pairings: kept, bye_player_ids: [],
        forbidden: pairings.length - kept.length,
      };
    }
    throw allGenerated();
  }
  if (mirrored && rounds.length === 0) planPhaseWeeks(context);

  const number = phase.current_round + 1;
  const byNumber = new Map(rounds.map(round => [round.id, round.round_number]));
  const history = matches.flatMap(match => {
    const roundNumber = byNumber.get(match.round_id);
    if (roundNumber === undefined) throw new Error('Native pairing history has a match without a phase round');
    if (match.player_1_id === BYE_PLAYER_ID || match.player_2_id === BYE_PLAYER_ID) return [];
    return [{
      match_id: match.id, player_1_id: match.player_1_id, player_2_id: match.player_2_id,
      winner_id: match.winner_id, round_number: roundNumber, status: match.status,
    }];
  });
  const byeHistory = byeRecordsFromRounds(rounds.filter(round => round.round_number < number));
  const aids = await aidsFor(number);
  const merged: GeneratedRound = { round_number: number, round_name: `Round ${number}`, pairings: [], bye_player_ids: [] };
  let generated = false;
  for (const ids of groups.length ? toScheduleGroups(groups).map(group => [...group.memberIds]) : [participantIds]) {
    const players = new Set(ids);
    const within = (match: MatchRecord) => players.has(match.player_1_id) && players.has(match.player_2_id);
    const paired = history.filter(within);
    const scored = paired.filter(match => match.status === 'completed' && match.round_number < number);
    const byes = byeHistory.filter(bye => players.has(bye.player_id));
    let round: GeneratedRound;
    if (kit) {
      const result = pairNextRound({
        stage: kit.stage, participantIds: ids, participantNames, matches: scored, pairedMatches: paired,
        byeHistory: byes, roundNumber: number, outcomes: kit.outcomes, tableExtras: kit.tableExtras, seed: kit.seed, ...aids,
      });
      if (result.kind !== 'round') continue;
      round = result.round;
    } else {
      if (robin && number > getRoundRobinTotalRounds(ids.length)) continue;
      round = generateRound(phase.bracket_type, ids, participantNames, scored, number, { byeHistory: byes, pairedMatches: paired });
    }
    if (robin) {
      const leg = kitRobin ? legRoundRange(ids.length, number) : null;
      const previous = leg ? paired.filter(match => match.round_number >= leg.first && match.round_number <= leg.last) : paired;
      assertNoScheduleDrift(round.round_name, round.pairings, previous, { ignoreRoundNumber: number });
    }
    generated = true;
    merged.round_name = round.round_name;
    merged.pairings.push(...round.pairings);
    merged.bye_player_ids.push(...round.bye_player_ids);
    merged.rematches = (merged.rematches ?? 0) + (round.rematches ?? 0);
    merged.forbidden = (merged.forbidden ?? 0) + (round.forbidden ?? 0);
  }
  if (!generated || (kit && groups.length > 0 && merged.pairings.length === 0 && merged.bye_player_ids.length === 0)) {
    throw allGenerated();
  }
  return merged;
}

function allGenerated() {
  return new UserFacingError('All rounds have already been generated', { code: 'rounds_all_generated' });
}
