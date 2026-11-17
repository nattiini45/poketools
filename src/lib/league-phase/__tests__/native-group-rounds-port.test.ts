import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhaseGroupWithMembers, PhaseRound } from '@/types/league-phase';
import type { SeasonStandingsContext } from '@/lib/tournament/season-standings';
import type { SchedulePhaseMatch } from '@/lib/tournament/group-rounds';

const h = vi.hoisted(() => {
  const forbidden = () => vi.fn(() => { throw new Error('Unexpected legacy persistence'); });
  return {
    getSeasonGroups: vi.fn(),
    native: {
      groups: vi.fn(), rounds: vi.fn(), participants: vi.fn(),
      deleteGroups: vi.fn(), createGroups: vi.fn(), addMembers: vi.fn(),
    },
    legacy: {
      groups: forbidden(), rounds: forbidden(), participants: forbidden(), matches: forbidden(),
      deleteGroups: forbidden(), createGroups: forbidden(), addMembers: forbidden(),
      standings: forbidden(), expire: forbidden(),
    },
    computeStandings: vi.fn(),
  };
});

vi.mock('@/lib/revalidation', () => ({ expireTournamentReads: h.legacy.expire }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: h.getSeasonGroups, seasonHasGroups: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getParticipants: h.legacy.participants }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: h.legacy.rounds }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchesByTournament: h.legacy.matches }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: h.legacy.groups, deleteGroupsByTournament: h.legacy.deleteGroups,
  createGroupBatch: h.legacy.createGroups, addGroupMembersBatch: h.legacy.addMembers,
}));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseParticipants: h.native.participants }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: h.native.rounds }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({
  getGroupsByPhase: h.native.groups, deleteGroupsByPhase: h.native.deleteGroups,
  createPhaseGroupBatch: h.native.createGroups, addPhaseGroupMembersBatch: h.native.addMembers,
}));
vi.mock('@/lib/tournament/season-standings', () => ({
  loadSeasonStandingsContext: h.legacy.standings, computeStandingsFromContext: h.computeStandings,
}));
vi.mock('@/lib/format-engine/groups', () => ({ mapGroupWriteConflict: (error: unknown) => error }));

import {
  createNativeGroupRoundPersistence, ensurePhaseGroupsFromLeague, loadPhaseWeekContext,
  planPhaseWeeks, resolveWeekPairings, roundsAwaitingMatches,
} from '@/lib/tournament/group-rounds';
import { mirrorsLeagueGroups, toScheduleGroups } from '@/lib/tournament/phase-week-plan';
import { computeStandings } from '@/lib/tournament/standings';

const seasonId = 'league-a';
const phase = { id: 'phase-a', bracket_type: 'round_robin' as const };
const ids = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'];
const groups: PhaseGroupWithMembers[] = ['a', 'b'].map((prefix, index) => ({
  id: 'group-' + prefix, phase_id: phase.id, season_id: seasonId,
  name: 'Group ' + prefix.toUpperCase(), group_number: index + 1,
  season_group_id: 'league-group-' + prefix, created_at: '', updated_at: '',
  members: ids.filter(id => id.startsWith(prefix)).map((player_id, seed) => ({
    player_id, player_name: 'Trainer ' + player_id, seed: seed + 1, gym_type: null,
  })),
}));
const round = (week: number): PhaseRound => ({
  id: 'round-' + week, phase_id: phase.id, name: 'Round ' + week, round_number: week,
  best_of: 3, status: 'pending', pairings_generated: true, deadline: null,
  bracket_side: null, bye_player_ids: [], created_at: '', updated_at: '',
});
const callbacks = {
  getMatches: vi.fn<(phaseId: string) => Promise<SchedulePhaseMatch[]>>(),
  loadStandingsContext: vi.fn<(seasonId: string | null) => Promise<SeasonStandingsContext>>(),
  expireReads: vi.fn<(phaseId: string, seasonId: string) => void>(),
};
const native = createNativeGroupRoundPersistence(callbacks);

beforeEach(() => {
  vi.clearAllMocks();
  h.getSeasonGroups.mockResolvedValue(groups.map(group => ({
    id: group.season_group_id, season_id: seasonId, name: group.name,
    sort_order: group.group_number, player_ids: group.members.map(member => member.player_id),
  })));
  h.native.groups.mockResolvedValue(groups);
  h.native.rounds.mockResolvedValue([]);
  h.native.participants.mockResolvedValue(ids.map(id => ({ id })));
  h.native.deleteGroups.mockResolvedValue(undefined);
  h.native.createGroups.mockResolvedValue(groups);
  h.native.addMembers.mockResolvedValue(undefined);
  callbacks.getMatches.mockResolvedValue([]);
  callbacks.loadStandingsContext.mockResolvedValue({ formatType: 'singles' });
  h.computeStandings.mockImplementation((_context, playerIds, names, records) => computeStandings(playerIds, names, records));
});

describe('native grouped scheduling persistence', () => {
  it('mirrors league groups with explicit native owners and never calls legacy queries', async () => {
    h.native.groups.mockResolvedValueOnce([]).mockResolvedValueOnce(groups);
    expect(await ensurePhaseGroupsFromLeague(seasonId, phase, native)).toBe(groups);
    expect(h.native.rounds).toHaveBeenCalledWith(phase.id);
    expect(h.native.participants).toHaveBeenCalledWith(phase.id);
    expect(h.native.deleteGroups).toHaveBeenCalledWith(phase.id);
    expect(h.native.createGroups).toHaveBeenCalledWith(groups.map(group => ({
      phase_id: phase.id, season_id: seasonId, name: group.name,
      group_number: group.group_number, season_group_id: group.season_group_id,
    })));
    expect(h.native.addMembers).toHaveBeenCalledWith(groups.flatMap(group => group.members.map(member => ({
      phase_id: phase.id, group_id: group.id, player_id: member.player_id, seed: member.seed,
    }))));
    expect(callbacks.expireReads).toHaveBeenCalledExactlyOnceWith(phase.id, seasonId);
    for (const legacy of Object.values(h.legacy)) expect(legacy).not.toHaveBeenCalled();
  });

  it('keeps the stored native groups after a round exists', async () => {
    h.native.rounds.mockResolvedValue([round(1)]);
    expect(await ensurePhaseGroupsFromLeague(seasonId, phase, native)).toBe(groups);
    expect(h.native.participants).not.toHaveBeenCalled();
    expect(h.native.deleteGroups).not.toHaveBeenCalled();
    expect(callbacks.expireReads).not.toHaveBeenCalled();
  });

  it('refuses a trainer outside the league groups before a native mirror write', async () => {
    h.native.participants.mockResolvedValue([{ id: 'ungrouped' }]);
    await expect(ensurePhaseGroupsFromLeague(seasonId, phase, native)).rejects.toMatchObject({
      code: 'PHASE_PLAYER_WITHOUT_LEAGUE_GROUP', statusCode: 409,
    });
    expect(h.native.deleteGroups).not.toHaveBeenCalled();
  });

  it('reads native rounds and explicitly supplied match data without inventing tournament fields', async () => {
    const nativeRound = round(1);
    h.native.rounds.mockResolvedValue([nativeRound]);
    const context = await loadPhaseWeekContext(phase.id, groups, native);
    expect(context.rounds[0]).toBe(nativeRound);
    expect(context.rounds[0]).not.toHaveProperty('tournament_id');
    expect(context.groups[0]).not.toHaveProperty('tournament_id');
    expect(callbacks.getMatches).toHaveBeenCalledExactlyOnceWith(phase.id);
    const awaiting = roundsAwaitingMatches(context, planPhaseWeeks(context));
    expect(awaiting.get(1)).toBe(nativeRound);
    for (const legacy of Object.values(h.legacy)) expect(legacy).not.toHaveBeenCalled();
  });

  it('uses the supplied standings context once for a native placement week', async () => {
    const skeleton = planPhaseWeeks({ groups, rounds: [], matches: [] });
    const placement = skeleton.weeks.find(week => week.kind === 'placement')!;
    const rounds: PhaseRound[] = [];
    const matches: SchedulePhaseMatch[] = [];
    for (const week of skeleton.weeks.filter(week => week.week < placement.week)) {
      rounds.push(round(week.week));
      for (const [index, pair] of [...week.groupPairings, ...week.crossPairings].entries()) {
        matches.push({
          id: 'match-' + week.week + '-' + index, round_id: 'round-' + week.week, ...pair,
          winner_id: pair.player_1_id, status: 'completed',
        });
      }
    }
    h.native.rounds.mockResolvedValue(rounds);
    callbacks.getMatches.mockResolvedValue(matches);
    const context = await loadPhaseWeekContext(phase.id, groups, native);
    const { resolved } = await resolveWeekPairings(seasonId, context, [placement.week], native);
    expect(resolved[0].week.kind).toBe('placement');
    expect(resolved[0].pairings).toHaveLength(4);
    expect(callbacks.loadStandingsContext).toHaveBeenCalledExactlyOnceWith(seasonId);
    expect(h.computeStandings).toHaveBeenCalledOnce();
    expect(h.computeStandings.mock.calls[0][3]).toEqual(matches.map(match => ({
      match_id: match.id, player_1_id: match.player_1_id, player_2_id: match.player_2_id,
      winner_id: match.winner_id, round_number: Number(match.round_id.slice(6)),
    })));
    for (const legacy of Object.values(h.legacy)) expect(legacy).not.toHaveBeenCalled();
  });

  it('keeps match and standings read failures distinguishable without a legacy fallback', async () => {
    const matchFailure = new Error('Native matches unavailable');
    callbacks.getMatches.mockRejectedValueOnce(matchFailure);
    await expect(loadPhaseWeekContext(phase.id, groups, native)).rejects.toBe(matchFailure);
    const placement = planPhaseWeeks({ groups, rounds: [], matches: [] }).weeks.find(week => week.kind === 'placement')!;
    const standingsFailure = new Error('Native standings unavailable');
    callbacks.loadStandingsContext.mockRejectedValueOnce(standingsFailure);
    await expect(resolveWeekPairings(seasonId, { groups, rounds: [], matches: [] }, [placement.week], native)).rejects.toBe(standingsFailure);
    for (const legacy of Object.values(h.legacy)) expect(legacy).not.toHaveBeenCalled();
  });

  it('lets pure scheduling consume neutral projections with no owner-specific row fields', () => {
    const neutralGroups = groups.map(group => ({
      id: group.id, name: group.name, group_number: group.group_number,
      season_group_id: group.season_group_id, members: group.members,
    }));
    expect(mirrorsLeagueGroups(neutralGroups)).toBe(true);
    expect(toScheduleGroups(neutralGroups).map(group => group.memberIds)).toEqual([ids.slice(0, 4), ids.slice(4)]);
    const neutralRound = { id: 'round-a', round_number: 1 };
    const context = { groups: neutralGroups, rounds: [neutralRound], matches: [] };
    const plan = planPhaseWeeks(context);
    expect(roundsAwaitingMatches(context, plan).get(1)).toBe(neutralRound);
  });
});
