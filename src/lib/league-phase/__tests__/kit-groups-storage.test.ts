import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn(), expireTournamentReads: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({}));
vi.mock('@/lib/supabase/queries/rounds', () => ({}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ seasonHasGroups: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({
  getGroupsByPhase: vi.fn(), createPhaseGroupBatch: vi.fn(), addPhaseGroupMembersBatch: vi.fn(),
  deleteGroupsByPhase: vi.fn(), deletePhaseGroup: vi.fn(),
}));

import { getGroupsByPhase, createPhaseGroupBatch, addPhaseGroupMembersBatch } from '@/lib/supabase/queries/phase-groups';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import { getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { expireSeasonReads, expireTournamentReads } from '@/lib/revalidation';
import { ensureKitPhaseGroups } from '@/lib/format-engine/groups';
import { nativeKitGroups } from '../kit-groups-storage';
import type { PhaseGroup } from '@/types/league-phase';

const groups: PhaseGroup[] = [1, 2].map((number) => ({
  id: `g${number}`, phase_id: 'phase', season_id: 'league', name: `Group ${number}`, group_number: number,
  season_group_id: null, created_at: '2026-11-17T00:00:00Z', updated_at: '2026-11-17T00:00:00Z',
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getGroupsByPhase).mockResolvedValue([]);
  vi.mocked(createPhaseGroupBatch).mockResolvedValue(groups);
  vi.mocked(getRoundsByPhase).mockResolvedValue([]);
  vi.mocked(seasonHasGroups).mockResolvedValue(false);
  vi.mocked(getPhaseParticipants).mockResolvedValue([{ id: 'p1', seed: 1 }, { id: 'p2', seed: 2 }] as never);
});

describe('native kit group persistence', () => {
  it('forms groups only in phase storage and supplies the ownership keys to both writes', async () => {
    const input = { seasonId: 'league', phaseId: 'phase', seed: 'seed', stage: { key: 'groups', groups: { count: 2, method: 'serpentine' as const } } };
    await ensureKitPhaseGroups(input, nativeKitGroups);
    expect(createPhaseGroupBatch).toHaveBeenCalledWith([
      { season_id: 'league', phase_id: 'phase', name: 'Group A', group_number: 1 },
      { season_id: 'league', phase_id: 'phase', name: 'Group B', group_number: 2 },
    ]);
    expect(addPhaseGroupMembersBatch).toHaveBeenCalledWith([
      { phase_id: 'phase', group_id: 'g1', player_id: 'p1', seed: 1 },
      { phase_id: 'phase', group_id: 'g2', player_id: 'p2', seed: 1 },
    ]);
    expect(expireSeasonReads).toHaveBeenCalledWith('league');
    expect(expireTournamentReads).not.toHaveBeenCalled();
  });

  it('does not reform after a first round or over mirrored league groups', async () => {
    vi.mocked(seasonHasGroups).mockResolvedValue(true);
    await ensureKitPhaseGroups({ seasonId: 'league', phaseId: 'phase', seed: 'seed', stage: { key: 'groups', groups: { count: 2, method: 'serpentine' } } }, nativeKitGroups);
    expect(createPhaseGroupBatch).not.toHaveBeenCalled();
  });
});
