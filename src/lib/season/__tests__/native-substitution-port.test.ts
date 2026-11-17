import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Season } from '@/types/season';
import type { Player } from '@/types/player';
import type { PhaseWithDetails, PhaseParticipant } from '@/types/league-phase';

vi.mock('@/lib/supabase/queries/players', () => ({ getPlayerById: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getSeasonParticipantRow: vi.fn(), swapSeasonParticipant: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getStagesBySeasonId: vi.fn(), getParticipants: vi.fn(), swapTournamentParticipant: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupMembershipsInTournament: vi.fn(), swapGroupMemberInTournament: vi.fn(), groupSwapWroteBeforeFailure: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn(), seasonGroupHasDraftingPool: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ seasonHasLiveLegacyDraft: vi.fn() }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getScheduledMatchesForPlayerInTournament: vi.fn(), repairScheduledMatchPairing: vi.fn() }));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({ cancelPendingMatchProposalsForMatch: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-substitute', () => ({ moveFormatSeat: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhasesBySeasonId: vi.fn(), getPhaseParticipants: vi.fn(), swapPhaseParticipant: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupMembershipsInPhase: vi.fn(), swapGroupMemberInPhase: vi.fn() }));

import { createNativeSubstitutionStorage } from '@/lib/league-phase/substitution-storage';
import { emptySubstituteApplyLog, substituteParticipant, substitutePartialApply } from '../substitute';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getPhasesBySeasonId, getPhaseParticipants, swapPhaseParticipant } from '@/lib/supabase/queries/league-phases';
import { getGroupMembershipsInPhase, swapGroupMemberInPhase } from '@/lib/supabase/queries/phase-groups';
import { getParticipants, getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { moveFormatSeat } from '@/lib/supabase/queries/format-substitute';

const input = { seasonId: 'league', outPlayerId: 'out', inPlayerId: 'in', scope: 'phase', dryRun: false };
const match = { phase_id: 'phase', phase_name: 'Group stage', match_id: 'match', round_id: 'round', player_1_id: 'out', player_2_id: 'other', player_1_name: 'Trainer A', player_2_name: 'Trainer B' };
const callbacks = () => ({
  matches: vi.fn().mockResolvedValue([match]),
  cancelProposals: vi.fn().mockResolvedValue(['proposal']),
  repairMatch: vi.fn().mockResolvedValue('repaired' as const),
  moveSeat: vi.fn().mockResolvedValue({ attached: false, moved: false, total: 0, rows: { relation_links: 0, resource_items: 0, action_submissions: 0, player_attrs: 0, track_progress: 0, challenges: 0 }, kept_phase_ids: [] }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSeasonById).mockResolvedValue({ id: 'league', status: 'active', archived: false } as Season);
  vi.mocked(getPlayerById).mockImplementation(async id => ({ id } as Player));
  vi.mocked(getPhasesBySeasonId).mockResolvedValue([{ id: 'phase', name: 'Group stage', status: 'active', ruleset_name: 'Fixture rules', season_name: 'Fixture league', participant_count: 1 } as PhaseWithDetails]);
  vi.mocked(getPhaseParticipants).mockResolvedValue([{ id: 'out', seed: 4, starting_bracket: 'losers' } as PhaseParticipant]);
  vi.mocked(getGroupMembershipsInPhase).mockResolvedValue([{ group_id: 'group', group_name: 'Group A', group_number: 1, season_group_id: null, player_id: 'out', seed: 4 }]);
  vi.mocked(swapPhaseParticipant).mockResolvedValue({ swapped: true, seed: 4 });
});

describe('native substitution persistence', () => {
  it('uses phase identity and the atomic enrollment/group cascade without legacy reads', async () => {
    const operations = callbacks();
    const log = emptySubstituteApplyLog();
    const result = await substituteParticipant({ ...input, log }, createNativeSubstitutionStorage(operations));
    expect(result.affected_matches).toEqual([match]);
    expect(result.affected_matches[0]).not.toHaveProperty('tournament_id');
    expect(result.phases[0].seed).toBe(4);
    expect(swapPhaseParticipant).toHaveBeenCalledWith('phase', 'out', 'in');
    expect(swapGroupMemberInPhase).not.toHaveBeenCalled();
    expect(log.enrollments_swapped).toEqual(['phase']);
    expect(log.groups_handed_over).toEqual([{ phase_id: 'phase', group_id: 'group' }]);
    expect(getParticipants).not.toHaveBeenCalled();
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
    expect(moveFormatSeat).not.toHaveBeenCalled();
    expect(operations.repairMatch).toHaveBeenCalledWith('match', { player_1_id: 'out', player_2_id: 'other' }, { player_1_id: 'in', player_2_id: 'other' });
  });

  it('previews through explicit callbacks without handing over the slot', async () => {
    const operations = callbacks();
    await substituteParticipant({ ...input, dryRun: true }, createNativeSubstitutionStorage(operations));
    expect(operations.moveSeat).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(swapPhaseParticipant).not.toHaveBeenCalled();
    expect(operations.cancelProposals).not.toHaveBeenCalled();
  });

  it('retains exact partial writes when the atomic enrollment loses a race', async () => {
    vi.mocked(swapPhaseParticipant).mockResolvedValue({ swapped: false, seed: null });
    const log = emptySubstituteApplyLog();
    await expect(substituteParticipant({ ...input, log }, createNativeSubstitutionStorage(callbacks()))).rejects.toMatchObject({ code: 'ENROLLMENT_CHANGED' });
    expect(substitutePartialApply(log)).toMatchObject({ written: { proposals_cancelled: ['match'], matches_repaired: ['match'], enrollments_swapped: [], groups_handed_over: [] }, stopped_at: { step: 'enrollment', phase_id: 'phase' } });
  });
});
