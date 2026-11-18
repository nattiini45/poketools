import 'server-only';

import { UserFacingError } from '@/lib/api/user-facing-error';
import { filteredRoundRobinRound, formKitGroups, kitStageRounds, legRoundRange, pairNextRound, roundRobinLegRound, roundRobinOf } from '@/lib/format-engine/pairing';
import type { KitPhase } from '@/lib/format-engine/load';
import type { PairingAids } from '@/lib/format-engine/pairing-server';
import { assertBatchMayRunAhead, assertMirroredGroupsPlayLegs, batchRoundCap } from '@/lib/format-engine/route-guards';
import { generateRound } from '@/lib/tournament';
import { byeRecordsFromRounds } from '@/lib/tournament/byes';
import type { StartingBrackets } from '@/lib/tournament/double-elim';
import { pendingWeeks, planPhaseWeeks, resolveWeekPairings, type PhaseWeekContext } from '@/lib/tournament/group-rounds';
import { mirrorsLeagueGroups, toScheduleGroups } from '@/lib/tournament/phase-week-plan';
import { generateRoundRobinRound, getRoundRobinTotalRounds } from '@/lib/tournament/round-robin';
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

interface NativePairingInput {
  phase: Pick<Phase, 'season_id' | 'current_round' | 'bracket_type'>;
  context: PhaseWeekContext<PhaseRound>;
  participantIds: string[];
  participantNames: Record<string, string>;
  kit: KitPhase | null;
  startingBrackets?: StartingBrackets;
  aidsFor: (round: number) => Promise<PairingAids>;
  loadStandingsContext: () => Promise<SeasonStandingsContext>;
}

export async function pairNativeRound(input: NativePairingInput): Promise<GeneratedRound> {
  const { phase, context, participantIds, participantNames, kit, aidsFor } = input;
  const { groups: storedGroups, rounds } = context;
  const robin = phase.bracket_type === 'round_robin';
  const elimination = phase.bracket_type === 'single_elim' || phase.bracket_type === 'double_elim';
  const groups = elimination && storedGroups.length > 0 && hasCrossGroupEliminationHistory(context, phase.current_round)
    ? [] : storedGroups;
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
  const history = nativePairingHistory(context, elimination);
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
      round = generateRound(phase.bracket_type, ids, participantNames, scored, number, {
        byeHistory: byes, pairedMatches: paired, startingBrackets: input.startingBrackets,
      });
    }
    if (robin) {
      const leg = kitRobin ? legRoundRange(ids.length, number) : null;
      const previous = leg ? paired.filter(match => match.round_number >= leg.first && match.round_number <= leg.last) : paired;
      assertNoScheduleDrift(round.round_name, round.pairings, previous, { ignoreRoundNumber: number });
    }
    generated = true;
    if (!elimination || groups.length === 0) merged.round_name = round.round_name;
    merged.pairings.push(...round.pairings);
    if (!elimination) merged.bye_player_ids.push(...round.bye_player_ids);
    merged.rematches = (merged.rematches ?? 0) + (round.rematches ?? 0);
    merged.forbidden = (merged.forbidden ?? 0) + (round.forbidden ?? 0);
  }
  if (!generated || (elimination && merged.pairings.length === 0)
    || (kit && groups.length > 0 && merged.pairings.length === 0 && merged.bye_player_ids.length === 0)) {
    throw allGenerated();
  }
  return merged;
}

export async function pairNativeRoundBatch(input: Omit<NativePairingInput, 'participantNames'>): Promise<GeneratedRound[]> {
  const { phase, context, participantIds, kit, aidsFor } = input;
  const { groups, rounds, matches } = context;
  const kitRobin = kit ? roundRobinOf(kit.stage.pairing) : null;
  if (phase.bracket_type !== 'round_robin' || (kit && !kitRobin)) {
    throw new UserFacingError('Generate-all-rounds is only supported for round_robin tournaments', { code: 'rounds_round_robin_only' });
  }
  const mirrored = mirrorsLeagueGroups(groups);
  assertMirroredGroupsPlayLegs(kitRobin, mirrored);
  const cap = batchRoundCap(kit) ?? Infinity;
  const filtered = kit?.stage.pairing.kind === 'filter';
  const byNumber = new Map(rounds.map(round => [round.round_number, round]));
  const withFixtures = new Set(matches.map(match => match.round_id));
  const batch: GeneratedRound[] = [];
  const alreadyWritten = (number: number) => {
    const existing = byNumber.get(number);
    return existing && (withFixtures.has(existing.id) ||
      (existing.pairings_generated && (filtered || existing.bye_player_ids.length > 0)));
  };

  const append = (round: GeneratedRound) => {
    const existing = byNumber.get(round.round_number);
    if (existing?.status === 'completed') {
      throw new UserFacingError(`${existing.name} is already completed and holds no matches. Delete it to generate it again.`, {
        code: 'rounds_round_completed', params: { round: existing.name }, status: 409,
      });
    }
    batch.push(round);
  };

  if (groups.length > 0 && (!kit || mirrored)) {
    const plan = planPhaseWeeks(context);
    const weeks: number[] = [];
    for (const week of pendingWeeks(context, plan)) {
      if (week.week > cap) break;
      if (alreadyWritten(week.week)) continue;
      if (week.awaitingTables && weeks.length > 0) break;
      weeks.push(week.week);
    }
    const { resolved } = await resolveWeekPairings(phase.season_id, context, weeks, {
      loadStandingsContext: input.loadStandingsContext,
    });
    for (const { week, pairings } of resolved) {
      const { allowPair } = await aidsFor(week.week);
      if (filtered && !allowPair) throw new Error('Native round robin filter needs a pairing predicate');
      const kept = allowPair ? pairings.filter(pair => allowPair(pair.player_1_id, pair.player_2_id)) : pairings;
      append({
        round_number: week.week, round_name: `Round ${week.week}`, pairings: kept,
        bye_player_ids: [], forbidden: pairings.length - kept.length,
      });
    }
  } else {
    const history = nativePairingHistory(context);
    const circles = (groups.length ? toScheduleGroups(groups).map(group => [...group.memberIds]) : [participantIds]).map(ids => {
      const members = new Set(ids);
      return {
        ids,
        total: kitRobin ? kitStageRounds(kitRobin, ids.length) ?? 0 : getRoundRobinTotalRounds(ids.length),
        paired: history.filter(match => members.has(match.player_1_id) && members.has(match.player_2_id)),
      };
    });
    const total = Math.min(cap, Math.max(0, ...circles.map(circle => circle.total)));
    for (let number = 1; number <= total; number++) {
      if (alreadyWritten(number)) continue;
      const { allowPair } = await aidsFor(number);
      if (filtered && !allowPair) throw new Error('Native round robin filter needs a pairing predicate');
      const merged: GeneratedRound = { round_number: number, round_name: `Round ${number}`, pairings: [], bye_player_ids: [] };
      for (const { ids, total: roundsInCircle, paired } of circles) {
        if (number > roundsInCircle) continue;
        const round = !kitRobin
          ? generateRoundRobinRound(ids, number)
          : allowPair
            ? filteredRoundRobinRound(ids, kitRobin, number, allowPair)
            : roundRobinLegRound(ids, kitRobin, number);
        const leg = kitRobin ? legRoundRange(ids.length, number) : null;
        const previous = leg ? paired.filter(match => match.round_number >= leg.first && match.round_number <= leg.last) : paired;
        assertNoScheduleDrift(round.round_name, round.pairings, previous, { ignoreRoundNumber: number });
        merged.pairings.push(...round.pairings);
        merged.bye_player_ids.push(...round.bye_player_ids);
        merged.forbidden = (merged.forbidden ?? 0) + (round.forbidden ?? 0);
      }
      append(merged);
    }
  }
  if (batch.length === 0) throw allGenerated();
  assertBatchMayRunAhead(kit, batch.length);
  return batch;
}

function nativePairingHistory(context: PhaseWeekContext<PhaseRound>, includeLegacyByes = false) {
  const byNumber = new Map(context.rounds.map(round => [round.id, round.round_number]));
  return context.matches.flatMap(match => {
    const roundNumber = byNumber.get(match.round_id);
    if (roundNumber === undefined) throw new Error('Native pairing history has a match without a phase round');
    if (!includeLegacyByes && (match.player_1_id === BYE_PLAYER_ID || match.player_2_id === BYE_PLAYER_ID)) return [];
    return [{
      match_id: match.id, player_1_id: match.player_1_id, player_2_id: match.player_2_id,
      winner_id: match.winner_id, round_number: roundNumber, status: match.status,
    }];
  });
}

function hasCrossGroupEliminationHistory(context: PhaseWeekContext<PhaseRound>, currentRound: number) {
  const playedRounds = new Set(context.rounds.filter(round => round.round_number <= currentRound).map(round => round.id));
  const groupOf = new Map(context.groups.flatMap(group => group.members.map(member => [member.player_id, group.id] as const)));
  return context.matches.some(match => {
    if (match.status !== 'completed' || !playedRounds.has(match.round_id)
      || match.player_1_id === BYE_PLAYER_ID || match.player_2_id === BYE_PLAYER_ID) return false;
    const group = groupOf.get(match.player_1_id);
    return group === undefined || group !== groupOf.get(match.player_2_id);
  });
}

function allGenerated() {
  return new UserFacingError('All rounds have already been generated', { code: 'rounds_all_generated' });
}
