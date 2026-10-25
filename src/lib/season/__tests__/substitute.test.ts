import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { GroupMembership } from '@/lib/supabase/queries/tournament-groups';

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getSeasonParticipantRow: vi.fn(),
  swapSeasonParticipant: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
  getParticipants: vi.fn(),
  swapTournamentParticipant: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupMembershipsInTournament: vi.fn(),
  swapGroupMemberInTournament: vi.fn(),
  // As the real marker: here a test flags an error with `wroteBefore`.
  groupSwapWroteBeforeFailure: vi.fn(
    (err: unknown) => (err as { wroteBefore?: boolean } | null)?.wroteBefore === true,
  ),
}));

vi.mock('@/lib/supabase/queries/season-groups', () => ({
  getSeasonGroupOfPlayer: vi.fn(),
  seasonGroupHasDraftingPool: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getScheduledMatchesForPlayerInTournament: vi.fn(),
  repairScheduledMatchPairing: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-proposals', () => ({
  cancelPendingMatchProposalsForMatch: vi.fn(),
}));

import {
  emptySubstituteApplyLog,
  substituteApplyWrote,
  substitutePartialApply,
  substituteParticipant,
  type SubstituteInput,
} from '../substitute';
import { getPlayerById } from '@/lib/supabase/queries/players';
import {
  getSeasonById,
  getSeasonParticipantRow,
  swapSeasonParticipant,
} from '@/lib/supabase/queries/seasons';
import {
  getStagesBySeasonId,
  getParticipants,
  swapTournamentParticipant,
} from '@/lib/supabase/queries/tournaments';
import {
  getGroupMembershipsInTournament,
  swapGroupMemberInTournament,
} from '@/lib/supabase/queries/tournament-groups';
import {
  getScheduledMatchesForPlayerInTournament as getMatchesByTournament,
  repairScheduledMatchPairing as repairMatchPairing,
} from '@/lib/supabase/queries/matches';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import { getSeasonGroupOfPlayer, seasonGroupHasDraftingPool } from '@/lib/supabase/queries/season-groups';
import { DraftRuleError } from '@/lib/draft/errors';

const SEASON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const OUT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const IN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
const OTHER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';
const PHASE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a21';
const GROUP_PHASE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const PLAYOFF_PHASE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23';
const SECOND_GROUP_PHASE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a24';
const GROUP_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31';
const SECOND_GROUP_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a32';

interface RecordedMock {
  mock: { calls: ReadonlyArray<ReadonlyArray<unknown>>; invocationCallOrder: number[] };
}

/**
 * Every apply write in invocation order (`mock.invocationCallOrder`), each
 * labelled `<step>:<first argument>` (a match id for the match steps, a
 * phase id for the phase steps, the season id for the roster swap).
 */
function writeSequence(): string[] {
  const steps: Array<[label: string, mock: RecordedMock]> = [
    ['repair', vi.mocked(repairMatchPairing)],
    ['proposals', vi.mocked(cancelPendingMatchProposalsForMatch)],
    ['group', vi.mocked(swapGroupMemberInTournament)],
    ['enrollment', vi.mocked(swapTournamentParticipant)],
    ['roster', vi.mocked(swapSeasonParticipant)],
  ];
  const entries: Array<{ order: number; label: string }> = [];
  for (const [label, mock] of steps) {
    mock.mock.calls.forEach((args, index) => {
      entries.push({ order: mock.mock.invocationCallOrder[index], label: `${label}:${String(args[0])}` });
    });
  }
  return entries.sort((a, b) => a.order - b.order).map((entry) => entry.label);
}

describe('substituteParticipant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations: reset every write a test may stub.
    vi.mocked(getSeasonById).mockResolvedValue({ status: 'active', archived: false } as never);
    vi.mocked(swapTournamentParticipant).mockResolvedValue({ swapped: true, seed: 4 });
    vi.mocked(swapSeasonParticipant).mockResolvedValue(undefined);
    vi.mocked(repairMatchPairing).mockResolvedValue('repaired');
    vi.mocked(cancelPendingMatchProposalsForMatch).mockResolvedValue([]);
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(null);
    vi.mocked(seasonGroupHasDraftingPool).mockResolvedValue(false);
    vi.mocked(getPlayerById).mockImplementation(async (id) => {
      if (id === OUT_ID) return { id: OUT_ID, name: 'Out' } as never;
      if (id === IN_ID) return { id: IN_ID, name: 'In' } as never;
      return null;
    });
    vi.mocked(getSeasonParticipantRow).mockImplementation(async (_seasonId, playerId) => {
      if (playerId === OUT_ID) {
        return { gym_type: null, core_types: null, core_assigned_at: null };
      }
      return null;
    });
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { id: PHASE_ID, name: 'Playoffs', status: 'active' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: OUT_ID, name: 'Out', seed: 3 },
    ] as never);
    vi.mocked(getGroupMembershipsInTournament).mockResolvedValue([]);
    vi.mocked(swapGroupMemberInTournament).mockResolvedValue({ written: false, held: null });
    vi.mocked(getMatchesByTournament).mockResolvedValue([
      {
        id: 'match-1',
        tournament_id: PHASE_ID,
        round_id: 'round-1',
        status: 'scheduled',
        games: [],
        player_1_id: OUT_ID,
        player_2_id: 'other',
        player_1_name: 'Out',
        player_2_name: 'Other',
      },
    ] as never);
  });

  it('returns preview with affected matches', async () => {
    const summary = await substituteParticipant({
      seasonId: SEASON_ID,
      outPlayerId: OUT_ID,
      inPlayerId: IN_ID,
      scope: 'league',
      dryRun: true,
    });

    expect(summary.phases).toHaveLength(1);
    expect(summary.affected_matches).toHaveLength(1);
    expect(summary.matches_repaired).toBe(0);
  });

  it('rejects when incoming player is already on roster (league scope)', async () => {
    vi.mocked(getSeasonParticipantRow).mockImplementation(async (_seasonId, playerId) => {
      if (playerId === OUT_ID || playerId === IN_ID) {
        return { gym_type: null, core_types: null, core_assigned_at: null };
      }
      return null;
    });

    await expect(
      substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: 'league',
        dryRun: true,
      }),
    ).rejects.toBeInstanceOf(UserFacingError);
  });

  it('allows in-roster incoming player for phase scope (reserve promotion)', async () => {
    vi.mocked(getSeasonParticipantRow).mockImplementation(async (_seasonId, playerId) => {
      if (playerId === OUT_ID || playerId === IN_ID) {
        return { gym_type: null, core_types: null, core_assigned_at: null };
      }
      return null;
    });

    const summary = await substituteParticipant({
      seasonId: SEASON_ID,
      outPlayerId: OUT_ID,
      inPlayerId: IN_ID,
      scope: PHASE_ID,
      dryRun: true,
    });

    expect(summary.roster_swapped).toBe(false);
    expect(summary.phases).toHaveLength(1);
  });

  it('rejects when incoming player is already enrolled in the phase', async () => {
    vi.mocked(getParticipants).mockResolvedValue([
      { id: OUT_ID, name: 'Out', seed: 3 },
      { id: IN_ID, name: 'In', seed: 5 },
    ] as never);

    await expect(
      substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: PHASE_ID,
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      code: 'IN_ALREADY_IN_PHASE',
      message: 'Incoming player is already enrolled in this phase',
      // The phase is named in params, so the translated message can say which.
      params: { phase: 'Playoffs' },
    });
  });

  it('rejects the same player on both sides with substitute_same_player, before any read', async () => {
    await expect(
      substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: OUT_ID,
        scope: 'league',
        dryRun: true,
      }),
    ).rejects.toMatchObject({
      code: 'substitute_same_player',
      message: 'Outgoing and incoming players must be different',
      statusCode: 400,
    });
    expect(getSeasonById).not.toHaveBeenCalled();
  });

  describe('group membership', () => {
    interface PhaseFixture {
      id: string;
      name: string;
      /** Whether the outgoing player holds a tournament_participants row. */
      outEnrolled: boolean;
      /** The group row the outgoing player holds in this phase, if any. */
      group: { id: string; name: string; group_number: number } | null;
    }

    const GROUP_STAGE: PhaseFixture = {
      id: GROUP_PHASE_ID,
      name: 'Group Stage',
      outEnrolled: true,
      group: { id: GROUP_ID, name: 'Group B', group_number: 2 },
    };
    const PLAYOFFS: PhaseFixture = {
      id: PLAYOFF_PHASE_ID,
      name: 'Playoffs',
      outEnrolled: true,
      group: null,
    };
    const SECOND_GROUP_STAGE: PhaseFixture = {
      id: SECOND_GROUP_PHASE_ID,
      name: 'Second Group Stage',
      outEnrolled: true,
      group: { id: SECOND_GROUP_ID, name: 'Group A', group_number: 1 },
    };

    /**
     * Stage the season's phases. The group read answers from the fixture
     * whether or not the outgoing player is enrolled, so a phase that should
     * be skipped would surface a group if it were read.
     */
    function setupPhases(phases: PhaseFixture[]) {
      vi.mocked(getStagesBySeasonId).mockResolvedValue(
        phases.map((phase) => ({ id: phase.id, name: phase.name, status: 'active' })) as never,
      );
      vi.mocked(getParticipants).mockImplementation(async (tournamentId) => {
        const phase = phases.find((p) => p.id === tournamentId);
        const others = [{ id: OTHER_ID, name: 'Other', seed: 1 }];
        return (phase?.outEnrolled ? [{ id: OUT_ID, name: 'Out', seed: 4 }, ...others] : others) as never;
      });
      vi.mocked(getGroupMembershipsInTournament).mockImplementation(
        async (tournamentId, playerIds): Promise<GroupMembership[]> => {
          const phase = phases.find((p) => p.id === tournamentId);
          if (!phase?.group || !playerIds.includes(OUT_ID)) return [];
          return [
            {
              group_id: phase.group.id,
              group_name: phase.group.name,
              group_number: phase.group.group_number,
              season_group_id: null,
              player_id: OUT_ID,
              seed: 2,
            },
          ];
        },
      );
      vi.mocked(getMatchesByTournament).mockImplementation(
        async (tournamentId) =>
          [
            {
              id: `match-${tournamentId}`,
              tournament_id: tournamentId,
              round_id: 'round-1',
              status: 'scheduled',
              games: [],
              player_1_id: OUT_ID,
              player_2_id: OTHER_ID,
              player_1_name: 'Out',
              player_2_name: 'Other',
            },
          ] as never,
      );
    }

    /** The global invocation order of the first call to `mock` for `phaseId`. */
    function callOrderFor(
      mock: { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>>; invocationCallOrder: number[] } },
      phaseId: string,
    ): number {
      const index = mock.mock.calls.findIndex((args) => args[0] === phaseId);
      expect(index, `no call for phase ${phaseId}`).toBeGreaterThanOrEqual(0);
      return mock.mock.invocationCallOrder[index];
    }

    it('dry run reports the group slot per phase and writes nothing', async () => {
      setupPhases([GROUP_STAGE, PLAYOFFS]);

      const summary = await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: 'league',
        dryRun: true,
      });

      expect(summary.phases).toEqual([
        {
          phase_id: GROUP_PHASE_ID,
          phase_name: 'Group Stage',
          seed: 4,
          group: { id: GROUP_ID, name: 'Group B' },
        },
        { phase_id: PLAYOFF_PHASE_ID, phase_name: 'Playoffs', seed: 4, group: null },
      ]);
      // Only the outgoing player's slot is read, once per enrolled phase.
      expect(getGroupMembershipsInTournament).toHaveBeenCalledTimes(2);
      expect(getGroupMembershipsInTournament).toHaveBeenCalledWith(GROUP_PHASE_ID, [OUT_ID, IN_ID]);
      expect(getGroupMembershipsInTournament).toHaveBeenCalledWith(PLAYOFF_PHASE_ID, [OUT_ID, IN_ID]);

      expect(swapGroupMemberInTournament).not.toHaveBeenCalled();
      expect(swapTournamentParticipant).not.toHaveBeenCalled();
      expect(swapSeasonParticipant).not.toHaveBeenCalled();
      expect(repairMatchPairing).not.toHaveBeenCalled();
      expect(cancelPendingMatchProposalsForMatch).not.toHaveBeenCalled();
      expect(writeSequence()).toEqual([]);
      expect(summary.matches_repaired).toBe(0);
    });

    it('apply (league scope) hands over the group row and the enrollment in every phase, then the roster', async () => {
      setupPhases([GROUP_STAGE, PLAYOFFS]);

      const summary = await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: 'league',
        dryRun: false,
      });

      expect(swapSeasonParticipant).toHaveBeenCalledTimes(1);
      expect(swapSeasonParticipant).toHaveBeenCalledWith(SEASON_ID, OUT_ID, IN_ID);

      expect(swapTournamentParticipant).toHaveBeenCalledTimes(2);
      expect(swapTournamentParticipant).toHaveBeenCalledWith(GROUP_PHASE_ID, OUT_ID, IN_ID);
      expect(swapTournamentParticipant).toHaveBeenCalledWith(PLAYOFF_PHASE_ID, OUT_ID, IN_ID);

      // The group step runs in every phase; it is a no-op where there is no slot.
      expect(swapGroupMemberInTournament).toHaveBeenCalledTimes(2);
      expect(swapGroupMemberInTournament).toHaveBeenCalledWith(GROUP_PHASE_ID, OUT_ID, IN_ID);
      expect(swapGroupMemberInTournament).toHaveBeenCalledWith(PLAYOFF_PHASE_ID, OUT_ID, IN_ID);

      expect(summary.roster_swapped).toBe(true);
      expect(summary.phases.map((phase) => phase.group)).toEqual([
        { id: GROUP_ID, name: 'Group B' },
        null,
      ]);
      // Each repair names the pairing it expects, so a match changed since the plan is left alone.
      for (const phaseId of [GROUP_PHASE_ID, PLAYOFF_PHASE_ID]) {
        expect(repairMatchPairing).toHaveBeenCalledWith(
          `match-${phaseId}`,
          { player_1_id: OUT_ID, player_2_id: OTHER_ID },
          { player_1_id: IN_ID, player_2_id: OTHER_ID },
        );
      }
      expect(cancelPendingMatchProposalsForMatch).toHaveBeenCalledWith(`match-${GROUP_PHASE_ID}`);
      expect(cancelPendingMatchProposalsForMatch).toHaveBeenCalledWith(`match-${PLAYOFF_PHASE_ID}`);
      expect(summary.matches_repaired).toBe(2);
    });

    it('apply runs each phase in turn (repair, group, enrollment) and swaps the roster after every phase step', async () => {
      setupPhases([GROUP_STAGE, PLAYOFFS]);

      await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: 'league',
        dryRun: false,
      });

      // Per phase: its fixtures are repaired first, then the group slot moves,
      // and the enrollment swap comes last (while the outgoing player is still
      // enrolled, a re-run plans the phase again). The roster goes last of all.
      expect(writeSequence()).toEqual([
        `proposals:match-${GROUP_PHASE_ID}`,
        `repair:match-${GROUP_PHASE_ID}`,
        `group:${GROUP_PHASE_ID}`,
        `enrollment:${GROUP_PHASE_ID}`,
        `proposals:match-${PLAYOFF_PHASE_ID}`,
        `repair:match-${PLAYOFF_PHASE_ID}`,
        `group:${PLAYOFF_PHASE_ID}`,
        `enrollment:${PLAYOFF_PHASE_ID}`,
        `roster:${SEASON_ID}`,
      ]);

      for (const phaseId of [GROUP_PHASE_ID, PLAYOFF_PHASE_ID]) {
        const repair = vi.mocked(repairMatchPairing).mock.invocationCallOrder[
          vi.mocked(repairMatchPairing).mock.calls.findIndex(([matchId]) => matchId === `match-${phaseId}`)
        ];
        const group = callOrderFor(vi.mocked(swapGroupMemberInTournament), phaseId);
        const enrollment = callOrderFor(vi.mocked(swapTournamentParticipant), phaseId);
        expect(group).toBeGreaterThan(repair);
        expect(enrollment).toBeGreaterThan(group);
      }
      const roster = vi.mocked(swapSeasonParticipant).mock.invocationCallOrder[0];
      const phaseSteps = [
        ...vi.mocked(repairMatchPairing).mock.invocationCallOrder,
        ...vi.mocked(cancelPendingMatchProposalsForMatch).mock.invocationCallOrder,
        ...vi.mocked(swapGroupMemberInTournament).mock.invocationCallOrder,
        ...vi.mocked(swapTournamentParticipant).mock.invocationCallOrder,
      ];
      expect(phaseSteps).toHaveLength(8);
      expect(roster).toBeGreaterThan(Math.max(...phaseSteps));
    });

    it('apply calls the group step for an ungrouped phase too (it holds no slot)', async () => {
      setupPhases([PLAYOFFS]);

      const summary = await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: PLAYOFF_PHASE_ID,
        dryRun: false,
      });

      expect(summary.phases).toEqual([
        { phase_id: PLAYOFF_PHASE_ID, phase_name: 'Playoffs', seed: 4, group: null },
      ]);
      expect(swapGroupMemberInTournament).toHaveBeenCalledTimes(1);
      expect(swapGroupMemberInTournament).toHaveBeenCalledWith(PLAYOFF_PHASE_ID, OUT_ID, IN_ID);
      expect(writeSequence()).toEqual([
        `proposals:match-${PLAYOFF_PHASE_ID}`,
        `repair:match-${PLAYOFF_PHASE_ID}`,
        `group:${PLAYOFF_PHASE_ID}`,
        `enrollment:${PLAYOFF_PHASE_ID}`,
      ]);
      expect(swapSeasonParticipant).not.toHaveBeenCalled();
    });

    it('logs the group step as a write when the step reports one (stale rows deleted), not when it kept the row the incoming player holds', async () => {
      setupPhases([PLAYOFFS]);
      const inRow = (groupId: string, groupNumber: number): GroupMembership => ({
        group_id: groupId,
        group_name: `Group ${groupNumber}`,
        group_number: groupNumber,
        season_group_id: null,
        player_id: IN_ID,
        seed: 1,
      });

      // The step deleted a stale second row and kept the first.
      vi.mocked(swapGroupMemberInTournament).mockResolvedValue({
        written: true,
        held: inRow(GROUP_ID, 1),
      });
      const twoRows = emptySubstituteApplyLog();
      await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: PLAYOFF_PHASE_ID,
        dryRun: false,
        log: twoRows,
      });
      expect(twoRows.groups_handed_over).toEqual([{ phase_id: PLAYOFF_PHASE_ID, group_id: GROUP_ID }]);

      // One row, the slot an earlier run moved: kept, nothing written.
      vi.mocked(swapGroupMemberInTournament).mockResolvedValue({
        written: false,
        held: inRow(GROUP_ID, 1),
      });
      const oneRow = emptySubstituteApplyLog();
      await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: PLAYOFF_PHASE_ID,
        dryRun: false,
        log: oneRow,
      });
      expect(oneRow.groups_handed_over).toEqual([]);
      // Whether it wrote comes from the step itself: no extra read before it.
      expect(getGroupMembershipsInTournament).toHaveBeenCalledTimes(2);
    });

    it('records a group step that failed after deleting a stale row, holding no group, and not one that failed before writing', async () => {
      setupPhases([PLAYOFFS]);

      const wrote = Object.assign(new Error('slot update failed'), { wroteBefore: true });
      vi.mocked(swapGroupMemberInTournament).mockRejectedValueOnce(wrote);
      const afterWrite = emptySubstituteApplyLog();
      await expect(
        substituteParticipant({
          seasonId: SEASON_ID,
          outPlayerId: OUT_ID,
          inPlayerId: IN_ID,
          scope: PLAYOFF_PHASE_ID,
          dryRun: false,
          log: afterWrite,
        }),
      ).rejects.toBe(wrote);
      expect(afterWrite.groups_handed_over).toEqual([{ phase_id: PLAYOFF_PHASE_ID, group_id: null }]);
      expect(afterWrite.phases_touched).toEqual([PLAYOFF_PHASE_ID]);
      expect(afterWrite.stopped_at).toEqual({ step: 'group', phase_id: PLAYOFF_PHASE_ID, match_id: null });
      expect(swapTournamentParticipant).not.toHaveBeenCalled();

      vi.mocked(repairMatchPairing).mockResolvedValue('changed');
      vi.mocked(swapGroupMemberInTournament).mockRejectedValueOnce(new Error('delete failed'));
      const beforeWrite = emptySubstituteApplyLog();
      await expect(
        substituteParticipant({
          seasonId: SEASON_ID,
          outPlayerId: OUT_ID,
          inPlayerId: IN_ID,
          scope: PLAYOFF_PHASE_ID,
          dryRun: false,
          log: beforeWrite,
        }),
      ).rejects.toThrow('delete failed');
      expect(beforeWrite.groups_handed_over).toEqual([]);
      expect(beforeWrite.phases_touched).toEqual([]);
      expect(substituteApplyWrote(beforeWrite)).toBe(false);
    });

    it('apply (phase scope) moves only that phase\'s group row', async () => {
      setupPhases([GROUP_STAGE, SECOND_GROUP_STAGE]);

      const summary = await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: SECOND_GROUP_PHASE_ID,
        dryRun: false,
      });

      expect(summary.roster_swapped).toBe(false);
      expect(summary.phases).toEqual([
        {
          phase_id: SECOND_GROUP_PHASE_ID,
          phase_name: 'Second Group Stage',
          seed: 4,
          group: { id: SECOND_GROUP_ID, name: 'Group A' },
        },
      ]);
      expect(swapSeasonParticipant).not.toHaveBeenCalled();

      // Once, to plan: the group step reports its own writes.
      expect(getGroupMembershipsInTournament).toHaveBeenCalledTimes(1);
      expect(getGroupMembershipsInTournament).not.toHaveBeenCalledWith(GROUP_PHASE_ID, expect.anything());
      expect(getGroupMembershipsInTournament).toHaveBeenCalledWith(SECOND_GROUP_PHASE_ID, [OUT_ID, IN_ID]);
      expect(swapTournamentParticipant).toHaveBeenCalledTimes(1);
      expect(swapTournamentParticipant).toHaveBeenCalledWith(SECOND_GROUP_PHASE_ID, OUT_ID, IN_ID);
      expect(swapGroupMemberInTournament).toHaveBeenCalledTimes(1);
      expect(swapGroupMemberInTournament).toHaveBeenCalledWith(SECOND_GROUP_PHASE_ID, OUT_ID, IN_ID);

      // The group slot moves before the enrollment swap.
      expect(
        callOrderFor(vi.mocked(swapTournamentParticipant), SECOND_GROUP_PHASE_ID),
      ).toBeGreaterThan(callOrderFor(vi.mocked(swapGroupMemberInTournament), SECOND_GROUP_PHASE_ID));
    });

    it('skips a phase the outgoing player is not enrolled in: no group read, no swaps', async () => {
      // A stale group row for the outgoing player in a phase they are not
      // enrolled in must not be read or moved.
      const notEnrolled: PhaseFixture = { ...SECOND_GROUP_STAGE, outEnrolled: false };
      setupPhases([GROUP_STAGE, notEnrolled]);

      const summary = await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: 'league',
        dryRun: false,
      });

      expect(summary.phases.map((phase) => phase.phase_id)).toEqual([GROUP_PHASE_ID]);

      expect(getGroupMembershipsInTournament).not.toHaveBeenCalledWith(
        SECOND_GROUP_PHASE_ID,
        expect.anything(),
      );
      expect(swapTournamentParticipant).not.toHaveBeenCalledWith(
        SECOND_GROUP_PHASE_ID,
        expect.anything(),
        expect.anything(),
      );
      expect(swapGroupMemberInTournament).not.toHaveBeenCalledWith(
        SECOND_GROUP_PHASE_ID,
        expect.anything(),
        expect.anything(),
      );
      expect(getMatchesByTournament).not.toHaveBeenCalledWith(SECOND_GROUP_PHASE_ID, expect.anything());

      // The enrolled grouped phase is still handled in full.
      expect(swapTournamentParticipant).toHaveBeenCalledTimes(1);
      expect(swapTournamentParticipant).toHaveBeenCalledWith(GROUP_PHASE_ID, OUT_ID, IN_ID);
      expect(swapGroupMemberInTournament).toHaveBeenCalledTimes(1);
      expect(swapGroupMemberInTournament).toHaveBeenCalledWith(GROUP_PHASE_ID, OUT_ID, IN_ID);
    });
  });

  /**
   * The apply writes are not one transaction. These tests back the query
   * mocks with one small in-memory league, so a failed run leaves real
   * partial state behind and the re-run plans from that state.
   */
  describe('resumable apply', () => {
    interface FakePhase {
      id: string;
      name: string;
      /** tournament_participants: player id to seed (null: unseeded). */
      enrolled: Map<string, number | null>;
      /** The phase's group slot in play; null in an ungrouped phase. */
      group: { id: string; name: string; group_number: number; playerId: string } | null;
    }

    interface FakeMatch {
      id: string;
      tournament_id: string;
      player_1_id: string;
      player_2_id: string;
      status: 'scheduled' | 'pending_confirmation';
      /** Game rows reported for it. */
      games: number;
    }

    interface FakeLeague {
      roster: Set<string>;
      phases: FakePhase[];
      matches: FakeMatch[];
      /** Phases whose enrollment swap throws. */
      failEnrollmentSwapIn: Set<string>;
      /** Matches whose proposal cancel throws. */
      failProposalCancelFor: Set<string>;
      failRosterSwap: boolean;
    }

    const NAMES: Record<string, string> = { [OUT_ID]: 'Out', [IN_ID]: 'In', [OTHER_ID]: 'Other' };

    const APPLY: SubstituteInput = {
      seasonId: SEASON_ID,
      outPlayerId: OUT_ID,
      inPlayerId: IN_ID,
      scope: 'league',
      dryRun: false,
    };

    /**
     * The outgoing player is on the roster and enrolled (seed 4) in a grouped
     * phase and an ungrouped one, with one open fixture against OTHER in each.
     */
    function freshLeague(): FakeLeague {
      return {
        roster: new Set([OUT_ID, OTHER_ID]),
        phases: [
          {
            id: GROUP_PHASE_ID,
            name: 'Group Stage',
            enrolled: new Map([[OUT_ID, 4], [OTHER_ID, 1]]),
            group: { id: GROUP_ID, name: 'Group B', group_number: 2, playerId: OUT_ID },
          },
          {
            id: PLAYOFF_PHASE_ID,
            name: 'Playoffs',
            enrolled: new Map([[OUT_ID, 4], [OTHER_ID, 1]]),
            group: null,
          },
        ],
        matches: [GROUP_PHASE_ID, PLAYOFF_PHASE_ID].map((phaseId) => ({
          id: `match-${phaseId}`,
          tournament_id: phaseId,
          player_1_id: OUT_ID,
          player_2_id: OTHER_ID,
          status: 'scheduled' as const,
          games: 0,
        })),
        failEnrollmentSwapIn: new Set(),
        failProposalCancelFor: new Set(),
        failRosterSwap: false,
      };
    }

    /** Point every read and write mock at `db`; the writes mutate it. */
    function backMocksWith(db: FakeLeague) {
      const phaseOf = (id: string) => db.phases.find((phase) => phase.id === id);

      vi.mocked(getSeasonParticipantRow).mockImplementation(async (_seasonId, playerId) =>
        db.roster.has(playerId)
          ? { gym_type: null, core_types: null, core_assigned_at: null }
          : null,
      );
      vi.mocked(getStagesBySeasonId).mockImplementation(
        async () =>
          db.phases.map((phase) => ({ id: phase.id, name: phase.name, status: 'active' })) as never,
      );
      vi.mocked(getParticipants).mockImplementation(
        async (tournamentId) =>
          [...(phaseOf(tournamentId)?.enrolled ?? [])].map(([id, seed]) => ({
            id,
            name: NAMES[id],
            seed,
          })) as never,
      );
      vi.mocked(getGroupMembershipsInTournament).mockImplementation(
        async (tournamentId, playerIds): Promise<GroupMembership[]> => {
          const group = phaseOf(tournamentId)?.group;
          if (!group || !playerIds.includes(group.playerId)) return [];
          return [
            {
              group_id: group.id,
              group_name: group.name,
              group_number: group.group_number,
              season_group_id: null,
              player_id: group.playerId,
              seed: 2,
            },
          ];
        },
      );
      vi.mocked(getMatchesByTournament).mockImplementation(
        async (tournamentId, playerId) =>
          db.matches
            .filter(
              (match) =>
                match.tournament_id === tournamentId &&
                match.status === 'scheduled' &&
                (match.player_1_id === playerId || match.player_2_id === playerId),
            )
            .map((match) => ({
              ...match,
              round_id: 'round-1',
              games: Array.from({ length: match.games }, (_, index) => ({ id: `game-${index}` })),
              player_1_name: NAMES[match.player_1_id],
              player_2_name: NAMES[match.player_2_id],
            })) as never,
      );
      // As repairScheduledMatchPairing: writes only while the match is as planned.
      vi.mocked(repairMatchPairing).mockImplementation(async (matchId, expected, next) => {
        const match = db.matches.find((m) => m.id === matchId);
        if (!match) throw new Error(`no match ${matchId}`);
        if (match.games > 0) return 'has_games';
        if (
          match.status !== 'scheduled' ||
          match.player_1_id !== expected.player_1_id ||
          match.player_2_id !== expected.player_2_id
        ) {
          return 'changed';
        }
        match.player_1_id = next.player_1_id;
        match.player_2_id = next.player_2_id;
        return 'repaired';
      });
      vi.mocked(cancelPendingMatchProposalsForMatch).mockImplementation(async (matchId) => {
        if (db.failProposalCancelFor.has(matchId)) throw new Error(`proposal cancel failed for ${matchId}`);
        return [];
      });
      // As swapGroupMemberInTournament: the outgoing player's slot moves; with
      // no slot left, a row the incoming player already holds is kept.
      vi.mocked(swapGroupMemberInTournament).mockImplementation(
        async (tournamentId, outPlayerId, inPlayerId) => {
          const group = phaseOf(tournamentId)?.group;
          if (!group || (group.playerId !== outPlayerId && group.playerId !== inPlayerId)) {
            return { written: false, held: null };
          }
          const written = group.playerId === outPlayerId;
          group.playerId = inPlayerId;
          return {
            written,
            held: {
              group_id: group.id,
              group_name: group.name,
              group_number: group.group_number,
              season_group_id: null,
              player_id: inPlayerId,
              seed: 2,
            },
          };
        },
      );
      vi.mocked(swapTournamentParticipant).mockImplementation(
        async (tournamentId, outPlayerId, inPlayerId) => {
          if (db.failEnrollmentSwapIn.has(tournamentId)) {
            throw new Error(`enrollment swap failed in ${tournamentId}`);
          }
          const enrolled = phaseOf(tournamentId)?.enrolled;
          const seed = enrolled?.get(outPlayerId);
          if (!enrolled || seed === undefined) return { swapped: false, seed: null };
          // One UPDATE: the primary key rejects an incoming player already enrolled.
          if (enrolled.has(inPlayerId)) throw new Error('duplicate key value violates unique constraint');
          enrolled.delete(outPlayerId);
          enrolled.set(inPlayerId, seed);
          return { swapped: true, seed };
        },
      );
      vi.mocked(swapSeasonParticipant).mockImplementation(async (_seasonId, outPlayerId, inPlayerId) => {
        if (db.failRosterSwap) throw new Error('roster swap failed');
        if (!db.roster.has(outPlayerId)) {
          throw new UserFacingError('roster changed', { code: 'ROSTER_CHANGED', status: 409 });
        }
        db.roster.delete(outPlayerId);
        db.roster.add(inPlayerId);
      });
    }

    /** One phase's state as plain data: enrollment, group holder, fixture pairings. */
    function phaseState(db: FakeLeague, phaseId: string) {
      const phase = db.phases.find((p) => p.id === phaseId);
      if (!phase) throw new Error(`no phase ${phaseId}`);
      return {
        enrolled: Object.fromEntries(phase.enrolled),
        groupHolder: phase.group?.playerId ?? null,
        fixtures: db.matches
          .filter((match) => match.tournament_id === phaseId)
          .map((match) => [match.player_1_id, match.player_2_id]),
      };
    }

    const SUBSTITUTED_GROUP_STAGE = {
      enrolled: { [IN_ID]: 4, [OTHER_ID]: 1 },
      groupHolder: IN_ID,
      fixtures: [[IN_ID, OTHER_ID]],
    };
    const SUBSTITUTED_PLAYOFFS = {
      enrolled: { [IN_ID]: 4, [OTHER_ID]: 1 },
      groupHolder: null,
      fixtures: [[IN_ID, OTHER_ID]],
    };

    it('(a) a phase whose enrollment already moved is skipped on re-run, and the roster swap still happens', async () => {
      const db = freshLeague();
      db.failRosterSwap = true;
      backMocksWith(db);

      await expect(substituteParticipant(APPLY)).rejects.toThrow('roster swap failed');

      // Every phase moved to the substitute; the roster did not.
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual(SUBSTITUTED_GROUP_STAGE);
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual(SUBSTITUTED_PLAYOFFS);
      expect(db.roster).toEqual(new Set([OUT_ID, OTHER_ID]));

      db.failRosterSwap = false;
      vi.clearAllMocks();
      backMocksWith(db);
      const summary = await substituteParticipant(APPLY);

      // The outgoing player is enrolled in neither phase, so neither is planned
      // or written again.
      expect(summary.phases).toEqual([]);
      expect(summary.affected_matches).toEqual([]);
      expect(summary.matches_repaired).toBe(0);
      expect(getGroupMembershipsInTournament).not.toHaveBeenCalled();
      expect(getMatchesByTournament).not.toHaveBeenCalled();

      // The roster swap still runs, and is the only write.
      expect(summary.roster_swapped).toBe(true);
      expect(writeSequence()).toEqual([`roster:${SEASON_ID}`]);
      expect(swapSeasonParticipant).toHaveBeenCalledWith(SEASON_ID, OUT_ID, IN_ID);
      expect(db.roster).toEqual(new Set([IN_ID, OTHER_ID]));
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual(SUBSTITUTED_GROUP_STAGE);
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual(SUBSTITUTED_PLAYOFFS);
    });

    it('(b) an enrollment swap failing in phase 2 leaves phase 1 complete and the roster unswapped; a re-run completes phase 2 and the roster', async () => {
      const db = freshLeague();
      db.failEnrollmentSwapIn.add(PLAYOFF_PHASE_ID);
      backMocksWith(db);

      await expect(substituteParticipant(APPLY)).rejects.toThrow(
        `enrollment swap failed in ${PLAYOFF_PHASE_ID}`,
      );

      // Phase 1 is complete.
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual(SUBSTITUTED_GROUP_STAGE);
      // Phase 2 got as far as its enrollment swap: its fixture is repaired,
      // but the outgoing player is still enrolled there.
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual({
        enrolled: { [OUT_ID]: 4, [OTHER_ID]: 1 },
        groupHolder: null,
        fixtures: [[IN_ID, OTHER_ID]],
      });
      // The roster swap never ran.
      expect(swapSeasonParticipant).not.toHaveBeenCalled();
      expect(db.roster).toEqual(new Set([OUT_ID, OTHER_ID]));
      expect(writeSequence()).toEqual([
        `proposals:match-${GROUP_PHASE_ID}`,
        `repair:match-${GROUP_PHASE_ID}`,
        `group:${GROUP_PHASE_ID}`,
        `enrollment:${GROUP_PHASE_ID}`,
        `proposals:match-${PLAYOFF_PHASE_ID}`,
        `repair:match-${PLAYOFF_PHASE_ID}`,
        `group:${PLAYOFF_PHASE_ID}`,
        `enrollment:${PLAYOFF_PHASE_ID}`, // threw
      ]);

      db.failEnrollmentSwapIn.clear();
      vi.clearAllMocks();
      backMocksWith(db);
      const summary = await substituteParticipant(APPLY);

      // Phase 1 is skipped now: the outgoing player is no longer enrolled there.
      expect(summary.phases).toEqual([
        { phase_id: PLAYOFF_PHASE_ID, phase_name: 'Playoffs', seed: 4, group: null },
      ]);
      expect(getGroupMembershipsInTournament).not.toHaveBeenCalledWith(
        GROUP_PHASE_ID,
        expect.anything(),
      );
      expect(getMatchesByTournament).not.toHaveBeenCalledWith(GROUP_PHASE_ID, expect.anything());
      // Phase 2's fixture was repaired by the first run; nothing is left to repair.
      expect(summary.affected_matches).toEqual([]);
      expect(summary.matches_repaired).toBe(0);
      expect(writeSequence()).toEqual([
        `group:${PLAYOFF_PHASE_ID}`,
        `enrollment:${PLAYOFF_PHASE_ID}`,
        `roster:${SEASON_ID}`,
      ]);

      // Every phase and the roster now name the substitute.
      expect(summary.roster_swapped).toBe(true);
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual(SUBSTITUTED_GROUP_STAGE);
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual(SUBSTITUTED_PLAYOFFS);
      expect(db.roster).toEqual(new Set([IN_ID, OTHER_ID]));
    });

    it('(c) an enrollment swap failing in a grouped phase: the re-run keeps the group slot already handed over', async () => {
      const db = freshLeague();
      db.failEnrollmentSwapIn.add(GROUP_PHASE_ID);
      backMocksWith(db);

      await expect(substituteParticipant(APPLY)).rejects.toThrow(
        `enrollment swap failed in ${GROUP_PHASE_ID}`,
      );
      // The slot moved; the outgoing player is still enrolled.
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual({
        enrolled: { [OUT_ID]: 4, [OTHER_ID]: 1 },
        groupHolder: IN_ID,
        fixtures: [[IN_ID, OTHER_ID]],
      });

      db.failEnrollmentSwapIn.clear();
      vi.clearAllMocks();
      backMocksWith(db);
      const log = emptySubstituteApplyLog();
      const summary = await substituteParticipant({ ...APPLY, log });

      // The re-run's log holds what it wrote: the enrollments and the roster,
      // not the slot the first run already moved.
      expect(log.groups_handed_over).toEqual([]);
      expect(log.enrollments_swapped).toEqual([GROUP_PHASE_ID, PLAYOFF_PHASE_ID]);
      expect(log.phases_touched).toEqual([GROUP_PHASE_ID, PLAYOFF_PHASE_ID]);
      expect(log.roster_swapped).toBe(true);

      // The preview names the group the substitute keeps, and the re-run ends
      // with them in it.
      expect(summary.phases[0]).toEqual({
        phase_id: GROUP_PHASE_ID,
        phase_name: 'Group Stage',
        seed: 4,
        group: { id: GROUP_ID, name: 'Group B' },
      });
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual(SUBSTITUTED_GROUP_STAGE);
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual(SUBSTITUTED_PLAYOFFS);
      expect(db.roster).toEqual(new Set([IN_ID, OTHER_ID]));
    });

    it('(d) a proposal cancel failing leaves the match unrepaired, so the re-run retries the cancel and the repair', async () => {
      const db = freshLeague();
      db.failProposalCancelFor.add(`match-${GROUP_PHASE_ID}`);
      backMocksWith(db);

      await expect(substituteParticipant(APPLY)).rejects.toThrow('proposal cancel failed');
      expect(repairMatchPairing).not.toHaveBeenCalled();
      expect(phaseState(db, GROUP_PHASE_ID).fixtures).toEqual([[OUT_ID, OTHER_ID]]);

      db.failProposalCancelFor.clear();
      vi.clearAllMocks();
      backMocksWith(db);
      const summary = await substituteParticipant(APPLY);

      expect(writeSequence().slice(0, 2)).toEqual([
        `proposals:match-${GROUP_PHASE_ID}`,
        `repair:match-${GROUP_PHASE_ID}`,
      ]);
      expect(summary.matches_repaired).toBe(2);
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual(SUBSTITUTED_GROUP_STAGE);
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual(SUBSTITUTED_PLAYOFFS);
    });

    it('(e) league scope rejects an incoming reserve already enrolled in a target phase, before any write', async () => {
      const db = freshLeague();
      // Promoted into the playoffs earlier by a phase-scope substitution:
      // enrolled there, not on the roster.
      db.phases[1].enrolled.set(IN_ID, 2);
      backMocksWith(db);

      const run = substituteParticipant(APPLY);

      await expect(run).rejects.toBeInstanceOf(UserFacingError);
      await expect(run).rejects.toMatchObject({ code: 'IN_ALREADY_IN_PHASE', params: { phase: 'Playoffs' } });
      await expect(run).rejects.toThrow('Incoming player is already enrolled in Playoffs');
      expect(writeSequence()).toEqual([]);
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual({
        enrolled: { [OUT_ID]: 4, [OTHER_ID]: 1 },
        groupHolder: OUT_ID,
        fixtures: [[OUT_ID, OTHER_ID]],
      });
    });

    it('(e) the same check runs in the dry run, so the preview already reports it', async () => {
      const db = freshLeague();
      db.phases[0].enrolled.set(IN_ID, 2);
      backMocksWith(db);

      await expect(substituteParticipant({ ...APPLY, dryRun: true })).rejects.toMatchObject({
        code: 'IN_ALREADY_IN_PHASE',
      });
    });

    it('(f) a match reported between the plan and its repair is left as it is and reported as skipped', async () => {
      const db = freshLeague();
      backMocksWith(db);
      // The opponent reports the group-stage match while the apply runs: its
      // proposals are being cancelled when the result lands.
      vi.mocked(cancelPendingMatchProposalsForMatch).mockImplementation(async (matchId) => {
        const match = db.matches.find((m) => m.id === matchId);
        if (match && matchId === `match-${GROUP_PHASE_ID}`) {
          match.status = 'pending_confirmation';
          match.games = 1;
        }
        return [];
      });

      const summary = await substituteParticipant(APPLY);

      expect(summary.matches_repaired).toBe(1);
      expect(summary.matches_skipped).toEqual([
        expect.objectContaining({ match_id: `match-${GROUP_PHASE_ID}`, reason: 'has_games' }),
      ]);
      // The reported match keeps the player who played it; the rest moves.
      expect(phaseState(db, GROUP_PHASE_ID)).toEqual({
        ...SUBSTITUTED_GROUP_STAGE,
        fixtures: [[OUT_ID, OTHER_ID]],
      });
      expect(db.matches[0].status).toBe('pending_confirmation');
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual(SUBSTITUTED_PLAYOFFS);
      expect(db.roster).toEqual(new Set([IN_ID, OTHER_ID]));
    });

    it('(g) a match re-paired meanwhile is skipped as changed', async () => {
      const db = freshLeague();
      backMocksWith(db);
      vi.mocked(cancelPendingMatchProposalsForMatch).mockImplementation(async (matchId) => {
        const match = db.matches.find((m) => m.id === matchId);
        if (match && matchId === `match-${PLAYOFF_PHASE_ID}`) match.player_2_id = 'someone-else';
        return [];
      });

      const summary = await substituteParticipant(APPLY);

      expect(summary.matches_skipped).toEqual([
        expect.objectContaining({ match_id: `match-${PLAYOFF_PHASE_ID}`, reason: 'changed' }),
      ]);
      expect(db.matches[1]).toMatchObject({ player_1_id: OUT_ID, player_2_id: 'someone-else' });
    });

    it('(h) two concurrent applies: one completes, the other stops with a 409 and re-pairs nothing twice', async () => {
      const db = freshLeague();
      backMocksWith(db);

      const results = await Promise.allSettled([substituteParticipant(APPLY), substituteParticipant(APPLY)]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(UserFacingError);
      expect(rejected[0].reason).toMatchObject({ code: 'ENROLLMENT_CHANGED', statusCode: 409 });

      expect(phaseState(db, GROUP_PHASE_ID)).toEqual(SUBSTITUTED_GROUP_STAGE);
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual(SUBSTITUTED_PLAYOFFS);
      expect(db.roster).toEqual(new Set([IN_ID, OTHER_ID]));
      expect(swapSeasonParticipant).toHaveBeenCalledTimes(1);
    });

    it('(i) maps a primary-key clash on the enrollment swap to 409 IN_ALREADY_IN_PHASE', async () => {
      const db = freshLeague();
      backMocksWith(db);
      vi.mocked(swapTournamentParticipant).mockRejectedValue(
        Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }),
      );
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(substituteParticipant(APPLY)).rejects.toMatchObject({
        code: 'IN_ALREADY_IN_PHASE',
        params: { phase: 'Group Stage' },
        statusCode: 409,
      });
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });

    it('(j) fills the apply log as it writes, and names the step it stopped at', async () => {
      const db = freshLeague();
      db.failEnrollmentSwapIn.add(PLAYOFF_PHASE_ID);
      backMocksWith(db);
      // Only the group-stage match has a pending proposal to cancel.
      vi.mocked(cancelPendingMatchProposalsForMatch).mockImplementation(async (matchId) =>
        matchId === `match-${GROUP_PHASE_ID}` ? ([{ id: 'proposal-1' }] as never) : [],
      );
      const log = emptySubstituteApplyLog();

      await expect(substituteParticipant({ ...APPLY, log })).rejects.toThrow('enrollment swap failed');

      // Only real writes: the playoffs had no proposal to cancel, and its group
      // step (an ungrouped phase) wrote nothing.
      expect(log).toEqual({
        proposals_cancelled: [`match-${GROUP_PHASE_ID}`],
        matches_repaired: [`match-${GROUP_PHASE_ID}`, `match-${PLAYOFF_PHASE_ID}`],
        matches_skipped: [],
        groups_handed_over: [{ phase_id: GROUP_PHASE_ID, group_id: GROUP_ID }],
        enrollments_swapped: [GROUP_PHASE_ID],
        roster_swapped: false,
        phases_touched: [GROUP_PHASE_ID, PLAYOFF_PHASE_ID],
        stopped_at: { step: 'enrollment', phase_id: PLAYOFF_PHASE_ID, match_id: null },
      });
      expect(substituteApplyWrote(log)).toBe(true);
    });

    it('(j) a completed apply clears stopped_at; a dry run writes nothing to the log', async () => {
      const db = freshLeague();
      backMocksWith(db);
      const dryLog = emptySubstituteApplyLog();
      await substituteParticipant({ ...APPLY, dryRun: true, log: dryLog });
      expect(substituteApplyWrote(dryLog)).toBe(false);

      const log = emptySubstituteApplyLog();
      await substituteParticipant({ ...APPLY, log });
      expect(log.stopped_at).toBeNull();
      expect(log.roster_swapped).toBe(true);
    });

    /** Enrolled without a seed, as `addParticipant` enrolls, in every phase. */
    function unseededLeague(): FakeLeague {
      const db = freshLeague();
      for (const phase of db.phases) phase.enrolled.set(OUT_ID, null);
      return db;
    }

    it('(k) an unseeded outgoing player is swapped in every phase and on the roster (league scope)', async () => {
      const db = unseededLeague();
      backMocksWith(db);
      const log = emptySubstituteApplyLog();

      const summary = await substituteParticipant({ ...APPLY, log });

      expect(summary.roster_swapped).toBe(true);
      for (const phaseId of [GROUP_PHASE_ID, PLAYOFF_PHASE_ID]) {
        expect(phaseState(db, phaseId).enrolled).toEqual({ [IN_ID]: null, [OTHER_ID]: 1 });
      }
      expect(phaseState(db, GROUP_PHASE_ID).groupHolder).toBe(IN_ID);
      expect(db.roster).toEqual(new Set([IN_ID, OTHER_ID]));
      expect(log.enrollments_swapped).toEqual([GROUP_PHASE_ID, PLAYOFF_PHASE_ID]);
      expect(log.stopped_at).toBeNull();
      // The swap's own `swapped` decides: the enrollment is read only to plan.
      expect(getParticipants).toHaveBeenCalledTimes(2);
    });

    it('(k) an unseeded outgoing player is swapped in phase scope without a 409', async () => {
      const db = unseededLeague();
      backMocksWith(db);

      const summary = await substituteParticipant({ ...APPLY, scope: PLAYOFF_PHASE_ID });

      expect(summary.phases).toEqual([
        { phase_id: PLAYOFF_PHASE_ID, phase_name: 'Playoffs', seed: null, group: null },
      ]);
      expect(phaseState(db, PLAYOFF_PHASE_ID)).toEqual({
        enrolled: { [IN_ID]: null, [OTHER_ID]: 1 },
        groupHolder: null,
        fixtures: [[IN_ID, OTHER_ID]],
      });
    });

    it('(k) an unseeded row gone by the UPDATE stops with 409 ENROLLMENT_CHANGED', async () => {
      const db = unseededLeague();
      backMocksWith(db);
      // The row is gone when the UPDATE runs: it matches nothing.
      vi.mocked(swapTournamentParticipant).mockImplementation(async (tournamentId, outPlayerId) => {
        db.phases.find((phase) => phase.id === tournamentId)?.enrolled.delete(outPlayerId);
        return { swapped: false, seed: null };
      });
      const log = emptySubstituteApplyLog();

      await expect(substituteParticipant({ ...APPLY, log })).rejects.toMatchObject({
        code: 'ENROLLMENT_CHANGED',
        params: { phase: 'Group Stage' },
        statusCode: 409,
      });
      expect(log.enrollments_swapped).toEqual([]);
      expect(log.stopped_at).toEqual({ step: 'enrollment', phase_id: GROUP_PHASE_ID, match_id: null });
      expect(swapSeasonParticipant).not.toHaveBeenCalled();
    });

    it('(k) an outgoing player unenrolled before the swap stops with 409; the swap moves nothing', async () => {
      const db = freshLeague();
      backMocksWith(db);
      // Removed from the playoffs while the apply runs.
      vi.mocked(cancelPendingMatchProposalsForMatch).mockImplementation(async (matchId) => {
        if (matchId === `match-${PLAYOFF_PHASE_ID}`) db.phases[1].enrolled.delete(OUT_ID);
        return [];
      });
      const log = emptySubstituteApplyLog();

      await expect(substituteParticipant({ ...APPLY, log })).rejects.toMatchObject({
        code: 'ENROLLMENT_CHANGED',
        statusCode: 409,
      });
      expect(swapTournamentParticipant).toHaveBeenCalledWith(PLAYOFF_PHASE_ID, OUT_ID, IN_ID);
      expect(phaseState(db, PLAYOFF_PHASE_ID).enrolled).toEqual({ [OTHER_ID]: 1 });
      expect(log.enrollments_swapped).toEqual([GROUP_PHASE_ID]);
      expect(log.stopped_at).toEqual({ step: 'enrollment', phase_id: PLAYOFF_PHASE_ID, match_id: null });
      expect(swapSeasonParticipant).not.toHaveBeenCalled();
    });

    it('(m) the partial signal of a failed apply is exactly its log; null when it wrote nothing', async () => {
      const db = freshLeague();
      db.failEnrollmentSwapIn.add(PLAYOFF_PHASE_ID);
      backMocksWith(db);
      const log = emptySubstituteApplyLog();

      await expect(substituteParticipant({ ...APPLY, log })).rejects.toThrow('enrollment swap failed');

      expect(substitutePartialApply(log)).toEqual({
        written: {
          proposals_cancelled: [],
          matches_repaired: [`match-${GROUP_PHASE_ID}`, `match-${PLAYOFF_PHASE_ID}`],
          matches_skipped: [],
          groups_handed_over: [{ phase_id: GROUP_PHASE_ID, group_id: GROUP_ID }],
          enrollments_swapped: [GROUP_PHASE_ID],
          roster_swapped: false,
        },
        phase_ids: [GROUP_PHASE_ID, PLAYOFF_PHASE_ID],
        stopped_at: { step: 'enrollment', phase_id: PLAYOFF_PHASE_ID, match_id: null },
      });

      expect(substitutePartialApply(emptySubstituteApplyLog())).toBeNull();
      // Skipped matches alone are no write.
      expect(
        substitutePartialApply({ ...emptySubstituteApplyLog(), matches_skipped: ['match-1'] }),
      ).toBeNull();
    });

    it('(l) an apply that lost the race to an identical one wrote nothing, so its log records nothing', async () => {
      const db = freshLeague();
      backMocksWith(db);
      // Apply B planned while the outgoing player was enrolled; apply A then
      // completed the same substitution (it already cancelled the proposals)
      // before B's first write.
      const cancel = vi.mocked(cancelPendingMatchProposalsForMatch);
      let raced = false;
      cancel.mockImplementation(async () => {
        if (!raced) {
          raced = true;
          for (const phase of db.phases) {
            const seed = phase.enrolled.get(OUT_ID) ?? null;
            phase.enrolled.delete(OUT_ID);
            phase.enrolled.set(IN_ID, seed);
            if (phase.group) phase.group.playerId = IN_ID;
          }
          for (const match of db.matches) match.player_1_id = IN_ID;
          db.roster.delete(OUT_ID);
          db.roster.add(IN_ID);
        }
        return [];
      });
      const log = emptySubstituteApplyLog();

      await expect(substituteParticipant({ ...APPLY, log })).rejects.toMatchObject({
        code: 'ENROLLMENT_CHANGED',
        statusCode: 409,
      });

      expect(log.proposals_cancelled).toEqual([]);
      expect(log.matches_repaired).toEqual([]);
      expect(log.groups_handed_over).toEqual([]);
      expect(log.enrollments_swapped).toEqual([]);
      expect(log.phases_touched).toEqual([]);
      expect(substituteApplyWrote(log)).toBe(false);
    });
  });

  describe('league group drafting (SEASON_GROUP_SUBSTITUTION_LOCKED, lead ruling round 5)', () => {
    const LEAGUE_GROUP_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a41';
    const leagueGroup = { id: LEAGUE_GROUP_ID, season_id: SEASON_ID, name: 'Group A', sort_order: 1 };

    it("refuses a league-scope substitution while the outgoing trainer's group is drafting, preview included, before any write", async () => {
      vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(leagueGroup);
      vi.mocked(seasonGroupHasDraftingPool).mockResolvedValue(true);

      for (const dryRun of [true, false]) {
        const log = emptySubstituteApplyLog();
        const err = await substituteParticipant({
          seasonId: SEASON_ID,
          outPlayerId: OUT_ID,
          inPlayerId: IN_ID,
          scope: 'league',
          dryRun,
          log,
        }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(DraftRuleError);
        expect(err).toMatchObject({
          code: 'SEASON_GROUP_SUBSTITUTION_LOCKED',
          statusCode: 409,
          detail: { season_group_id: LEAGUE_GROUP_ID },
        });
        expect(substituteApplyWrote(log)).toBe(false);
      }
      expect(getSeasonGroupOfPlayer).toHaveBeenCalledWith(SEASON_ID, OUT_ID);
      expect(seasonGroupHasDraftingPool).toHaveBeenCalledWith(LEAGUE_GROUP_ID);
      expect(writeSequence()).toEqual([]);
    });

    it('lets the substitution through when the group is not drafting (setup or complete) and for a trainer in no group', async () => {
      vi.mocked(getSeasonGroupOfPlayer).mockResolvedValueOnce(leagueGroup).mockResolvedValueOnce(null);

      for (let i = 0; i < 2; i++) {
        await substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: 'league', dryRun: false });
      }
      expect(seasonGroupHasDraftingPool).toHaveBeenCalledTimes(1);
      expect(swapSeasonParticipant).toHaveBeenCalledTimes(2);
    });

    it('phase scope leaves the roster and the league group as they are, so it does not read the group', async () => {
      await substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: PHASE_ID, dryRun: true });
      expect(getSeasonGroupOfPlayer).not.toHaveBeenCalled();
    });

    it('a draft that started after the pre-check is still refused by the roster swap (trigger backstop), reported as partial', async () => {
      vi.mocked(swapSeasonParticipant).mockRejectedValueOnce(
        new DraftRuleError('SEASON_GROUP_SUBSTITUTION_LOCKED', undefined, { season_group_id: LEAGUE_GROUP_ID }),
      );
      const log = emptySubstituteApplyLog();
      await expect(
        substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: 'league', dryRun: false, log }),
      ).rejects.toMatchObject({ code: 'SEASON_GROUP_SUBSTITUTION_LOCKED', statusCode: 409 });
      expect(log.stopped_at).toEqual({ step: 'roster', phase_id: null, match_id: null });
      expect(log.roster_swapped).toBe(false);
    });
  });

  describe('phase scope in a phase that mirrors the league groups (SUBSTITUTE_LEAGUE_GROUP_MISMATCH)', () => {
    const LEAGUE_GROUP_A = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a51';
    const LEAGUE_GROUP_B = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a52';
    const leagueGroup = (id: string, name: string) => ({ id, season_id: SEASON_ID, name, sort_order: 1 });

    beforeEach(() => {
      // The outgoing trainer holds the phase slot of Group A, which mirrors league group A.
      vi.mocked(getGroupMembershipsInTournament).mockResolvedValue([
        {
          group_id: GROUP_ID,
          group_name: 'Group A',
          group_number: 1,
          season_group_id: LEAGUE_GROUP_A,
          player_id: OUT_ID,
          seed: 1,
        },
      ]);
    });

    it.each([
      ['a trainer of another league group', leagueGroup(LEAGUE_GROUP_B, 'Group B')],
      ['a trainer in no league group (a reserve)', null],
    ])('refuses %s with 409, preview included, before any write', async (_label, inGroup) => {
      vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(inGroup);

      for (const dryRun of [true, false]) {
        const log = emptySubstituteApplyLog();
        const err = await substituteParticipant({
          seasonId: SEASON_ID,
          outPlayerId: OUT_ID,
          inPlayerId: IN_ID,
          scope: PHASE_ID,
          dryRun,
          log,
        }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(UserFacingError);
        expect(err).toMatchObject({
          code: 'SUBSTITUTE_LEAGUE_GROUP_MISMATCH',
          statusCode: 409,
          params: { phase: 'Playoffs', group: 'Group A' },
        });
        expect(substituteApplyWrote(log)).toBe(false);
      }
      expect(getSeasonGroupOfPlayer).toHaveBeenCalledWith(SEASON_ID, IN_ID);
      expect(writeSequence()).toEqual([]);
    });

    it('lets a trainer of the same league group take the slot, so the phase group stays equal to the league group', async () => {
      vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(leagueGroup(LEAGUE_GROUP_A, 'Group A'));

      const summary = await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: PHASE_ID,
        dryRun: false,
      });

      expect(summary.phases[0].group).toEqual({ id: GROUP_ID, name: 'Group A' });
      expect(swapGroupMemberInTournament).toHaveBeenCalledWith(PHASE_ID, OUT_ID, IN_ID);
      expect(swapSeasonParticipant).not.toHaveBeenCalled();
    });

    it('checks a re-run whose slot already moved against the row the incoming trainer holds', async () => {
      vi.mocked(getGroupMembershipsInTournament).mockResolvedValue([
        {
          group_id: GROUP_ID,
          group_name: 'Group A',
          group_number: 1,
          season_group_id: LEAGUE_GROUP_A,
          player_id: IN_ID,
          seed: 1,
        },
      ]);
      vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(leagueGroup(LEAGUE_GROUP_B, 'Group B'));

      await expect(
        substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: PHASE_ID, dryRun: true }),
      ).rejects.toMatchObject({ code: 'SUBSTITUTE_LEAGUE_GROUP_MISMATCH' });
    });

    it('league scope moves the league group slot with the roster row, so it is not checked', async () => {
      vi.mocked(getSeasonGroupOfPlayer).mockResolvedValue(null);

      await substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: 'league', dryRun: false });

      expect(getSeasonGroupOfPlayer).not.toHaveBeenCalledWith(SEASON_ID, IN_ID);
      expect(swapSeasonParticipant).toHaveBeenCalledTimes(1);
    });

    it('an unmirrored phase group (a league without groups) is not checked', async () => {
      vi.mocked(getGroupMembershipsInTournament).mockResolvedValue([
        { group_id: GROUP_ID, group_name: 'Group A', group_number: 1, season_group_id: null, player_id: OUT_ID, seed: 1 },
      ]);

      await substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: PHASE_ID, dryRun: false });

      expect(getSeasonGroupOfPlayer).not.toHaveBeenCalled();
      expect(swapGroupMemberInTournament).toHaveBeenCalledWith(PHASE_ID, OUT_ID, IN_ID);
    });
  });

  describe('eligibility', () => {
    it.each([
      ['completed', { status: 'completed', archived: false }],
      ['archived', { status: 'active', archived: true }],
    ])('rejects a %s league with 409 SEASON_CLOSED, in the preview too, before any write', async (_label, season) => {
      vi.mocked(getSeasonById).mockResolvedValue(season as never);

      for (const dryRun of [true, false]) {
        await expect(
          substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: 'league', dryRun }),
        ).rejects.toMatchObject({ code: 'SEASON_CLOSED', statusCode: 409 });
      }
      expect(writeSequence()).toEqual([]);
    });

    it('rejects an unknown league with 404 SEASON_NOT_FOUND', async () => {
      vi.mocked(getSeasonById).mockResolvedValue(null);

      await expect(
        substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: 'league', dryRun: true }),
      ).rejects.toMatchObject({ code: 'SEASON_NOT_FOUND', statusCode: 404 });
    });

    it('rejects a phase-scope substitution of a player not enrolled in that phase (OUT_NOT_IN_PHASE), before any write', async () => {
      vi.mocked(getParticipants).mockResolvedValue([{ id: OTHER_ID, name: 'Other', seed: 1 }] as never);

      for (const dryRun of [true, false]) {
        await expect(
          substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: PHASE_ID, dryRun }),
        ).rejects.toMatchObject({ code: 'OUT_NOT_IN_PHASE' });
      }
      expect(writeSequence()).toEqual([]);
    });

    it('replaces a promoted reserve (enrolled in the phase, not on the roster) in phase scope', async () => {
      // OUT is a reserve: enrolled in the phase, not on the roster.
      vi.mocked(getSeasonParticipantRow).mockResolvedValue(null);

      const summary = await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: PHASE_ID,
        dryRun: false,
      });

      expect(summary.roster_swapped).toBe(false);
      expect(summary.phases).toEqual([{ phase_id: PHASE_ID, phase_name: 'Playoffs', seed: 3, group: null }]);
      expect(swapTournamentParticipant).toHaveBeenCalledWith(PHASE_ID, OUT_ID, IN_ID);
      expect(swapSeasonParticipant).not.toHaveBeenCalled();
    });

    it('still requires the roster for a league-scope substitution', async () => {
      vi.mocked(getSeasonParticipantRow).mockResolvedValue(null);

      await expect(
        substituteParticipant({ seasonId: SEASON_ID, outPlayerId: OUT_ID, inPlayerId: IN_ID, scope: 'league', dryRun: true }),
      ).rejects.toMatchObject({ code: 'OUT_NOT_ON_ROSTER' });
    });

    it("reads only the outgoing player's scheduled matches, per phase", async () => {
      await substituteParticipant({
        seasonId: SEASON_ID,
        outPlayerId: OUT_ID,
        inPlayerId: IN_ID,
        scope: 'league',
        dryRun: true,
      });

      expect(getMatchesByTournament).toHaveBeenCalledWith(PHASE_ID, OUT_ID);
    });
  });
});
