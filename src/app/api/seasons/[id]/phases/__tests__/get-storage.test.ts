import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as list } from '../route';
import { GET as detail } from '../[phaseId]/route';
import { getPhaseWithDetails, getPhasesBySeasonId } from '@/lib/supabase/queries/league-phases';
import { listRoundStatusesByPhaseIds } from '@/lib/supabase/queries/phase-rounds';
import { getTournamentWithDetails } from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { readPhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import type { PhaseWithDetails } from '@/types/league-phase';

vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseWithDetails: vi.fn(), getPhasesBySeasonId: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ listRoundStatusesByPhaseIds: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentWithDetails: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn() }));

const id = '00000000-0000-4000-8000-000000000031';
const phaseId = '00000000-0000-4000-8000-000000000032';
const siblingId = '00000000-0000-4000-8000-000000000033';
const phase: PhaseWithDetails = {
  id: phaseId, season_id: id, name: 'First stage', status: 'active', participant_count: 4,
  description: '', bracket_type: 'swiss', ruleset_id: 'ruleset', best_of_default: 3, bo_overrides: {},
  is_doubles: false, team_visibility: 'always_public', current_round: 1, stage_order: 1,
  advancement_rule: null, enrollment_source: null, archived: false, legacy: false,
  bracket_reset_enabled: false, third_place_enabled: false, format_stage_key: null, format_group: 0,
  ruleset_name: 'Example ruleset', season_name: 'Example league', created_at: '', updated_at: '',
  stage_spec: { internal: 'not part of the public API' },
};
const request = new NextRequest(`http://localhost/api/seasons/${id}/phases`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  vi.mocked(readPhaseStorageMode).mockResolvedValue('phase');
  vi.mocked(getPhaseWithDetails).mockResolvedValue(phase);
  vi.mocked(getPhasesBySeasonId).mockResolvedValue([phase, { ...phase, id: siblingId }]);
  vi.mocked(getSeasonById).mockResolvedValue({ id } as NonNullable<Awaited<ReturnType<typeof getSeasonById>>>);
  vi.mocked(listRoundStatusesByPhaseIds).mockImplementation(async (ids) => [
    { id: 'round-1', phase_id: phaseId, round_number: 1, status: 'completed' as const },
    { id: 'round-2', phase_id: siblingId, round_number: 1, status: 'active' as const },
  ].filter((round) => ids.includes(round.phase_id)));
});

afterEach(() => vi.unstubAllEnvs());

describe('phase API GET storage ownership', () => {
  it('lists native stages with one bounded round-status batch', async () => {
    const res = await list(request, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject([
      { id: phaseId, rounds_total: 1, rounds_completed: 1 },
      { id: siblingId, rounds_total: 1, rounds_completed: 0 },
    ]);
    expect(listRoundStatusesByPhaseIds).toHaveBeenCalledExactlyOnceWith([phaseId, siblingId]);
    expect(getRoundsByTournament).not.toHaveBeenCalled();
  });

  it('projects a native phase through the existing public allowlist', async () => {
    const res = await detail(request, { params: Promise.resolve({ id, phaseId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: phaseId, season_id: id, participant_count: 4 });
    expect(body.data).not.toHaveProperty('stage_spec');
    expect(body.data).not.toHaveProperty('tournament_id');
    expect(listRoundStatusesByPhaseIds).toHaveBeenCalledExactlyOnceWith([phaseId]);
    expect(getTournamentWithDetails).not.toHaveBeenCalled();
  });

  it('refuses a mismatched league before reading rounds and never falls back', async () => {
    vi.mocked(getPhaseWithDetails).mockResolvedValueOnce({ ...phase, season_id: siblingId });
    const res = await detail(request, { params: Promise.resolve({ id, phaseId }) });
    expect(res.status).toBe(404);
    expect(listRoundStatusesByPhaseIds).not.toHaveBeenCalled();
    expect(getTournamentWithDetails).not.toHaveBeenCalled();
  });

  it.each(['frozen_legacy', 'frozen_phase'] as const)('refuses reads during %s', async (mode) => {
    vi.mocked(readPhaseStorageMode).mockResolvedValue(mode);
    const res = await detail(request, { params: Promise.resolve({ id, phaseId }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    expect(getPhaseWithDetails).not.toHaveBeenCalled();
    expect(getTournamentWithDetails).not.toHaveBeenCalled();
  });
});
