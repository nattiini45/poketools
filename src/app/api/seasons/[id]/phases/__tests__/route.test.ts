import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
  createTournament: vi.fn(),
  shiftStageOrders: vi.fn(),
  getTournamentWithDetails: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/tournament/enrollment-sync', () => ({
  syncStandingsEnrollment: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  addResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/seasons/[id]/phases/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import {
  getStagesBySeasonId,
  createTournament,
  shiftStageOrders,
  getTournamentWithDetails,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';
import { revalidateTag } from 'next/cache';

describe('POST /api/seasons/[id]/phases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: true,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active',
    });
    vi.mocked(getSeasonById).mockResolvedValue({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'League' } as never);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([]);
    vi.mocked(createTournament).mockResolvedValue({
      id: 'phase-1',
      name: 'Playoffs',
      season_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      stage_order: 1,
      status: 'upcoming',
    } as never);
    vi.mocked(syncStandingsEnrollment).mockResolvedValue({
      enrolled_count: 12,
      enrollment_source: {
        type: 'roster',
        source_phase_id: null,
        synced_at: new Date().toISOString(),
        frozen: false,
      },
      source_phase_name: 'League',
    });
    vi.mocked(getTournamentWithDetails).mockResolvedValue({
      id: 'phase-1',
      name: 'Playoffs',
      season_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      stage_order: 1,
      status: 'upcoming',
      participant_count: 12,
      ruleset_name: 'OU',
      bracket_type: 'single_elim',
      best_of_default: 3,
      bo_overrides: {},
      is_doubles: false,
      team_visibility: 'hidden_until_match',
      advancement_rule: null,
      enrollment_source: null,
      archived: false,
      created_at: '',
      updated_at: '',
      description: '',
      ruleset_id: 'r1',
      current_round: 0,
      legacy: false,
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  });

  it('creates phase and auto-enrolls participants', async () => {
    const request = makeRequest({
      name: 'Playoffs',
      bracket_type: 'single_elim',
      ruleset_id: '00000000-0000-4000-8000-000000000002',
    }) as NextRequest;

    const response = await POST(request, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(createTournament).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Playoffs',
        season_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      })
    );
    expect(syncStandingsEnrollment).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'phase-1');
    // D37: the new phase shows on the league page's next view.
    expect(revalidateTag).toHaveBeenCalledWith('season:cccccccc-cccc-4ccc-8ccc-cccccccccccc', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('tournament:phase-1', { expire: 0 });
  });

  it('rejects insert_at when it would shift a non-upcoming phase', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { id: 'phase-active', name: 'Hinrunde', status: 'active', stage_order: 1 },
      { id: 'phase-upcoming', name: 'Playoffs', status: 'upcoming', stage_order: 2 },
    ] as never);

    const request = makeRequest({
      name: 'Mid-season',
      bracket_type: 'single_elim',
      ruleset_id: '00000000-0000-4000-8000-000000000002',
      insert_at: 1,
    }) as NextRequest;

    const response = await POST(request, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('PHASE_INSERT_LOCKED');
    expect(shiftStageOrders).not.toHaveBeenCalled();
    expect(createTournament).not.toHaveBeenCalled();
  });

  it('refuses a name another phase already has (any case or spacing) with 409 PHASE_NAME_TAKEN, before any shift', async () => {
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { id: 'phase-1', name: 'Hinrunde', status: 'upcoming', stage_order: 1 },
      { id: 'phase-2', name: 'Playoffs', status: 'upcoming', stage_order: 2 },
    ] as never);

    const request = makeRequest({
      name: '  hinRUNDE ',
      bracket_type: 'single_elim',
      ruleset_id: '00000000-0000-4000-8000-000000000002',
      insert_at: 1,
    }) as NextRequest;

    const response = await POST(request, { params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('PHASE_NAME_TAKEN');
    expect(shiftStageOrders).not.toHaveBeenCalled();
    expect(createTournament).not.toHaveBeenCalled();
  });

  describe('positions after a deleted middle phase (stage orders 1 and 3)', () => {
    const body = {
      name: 'Finale',
      bracket_type: 'single_elim',
      ruleset_id: '00000000-0000-4000-8000-000000000002',
    };
    const post = (extra: Record<string, unknown> = {}) =>
      POST(makeRequest({ ...body, ...extra }) as NextRequest, {
        params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
      });

    beforeEach(() => {
      vi.mocked(getStagesBySeasonId).mockResolvedValue([
        { id: 'phase-1', name: 'Hinrunde', status: 'completed', stage_order: 1 },
        { id: 'phase-3', name: 'Playoffs', status: 'upcoming', stage_order: 3 },
      ] as never);
    });

    it('appends after the highest stage order (4), not into the gap or onto the phase count', async () => {
      const response = await post();

      expect(response.status).toBe(201);
      expect(shiftStageOrders).not.toHaveBeenCalled();
      expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({ stage_order: 4 }));
    });

    it('accepts insert_at 2 in the gap and shifts from there', async () => {
      const response = await post({ insert_at: 2 });

      expect(response.status).toBe(201);
      expect(shiftStageOrders).toHaveBeenCalledWith('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 2, 1);
      expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({ stage_order: 2 }));
    });

    it('accepts insert_at 4 (max + 1) without shifting', async () => {
      const response = await post({ insert_at: 4 });

      expect(response.status).toBe(201);
      expect(shiftStageOrders).not.toHaveBeenCalled();
      expect(createTournament).toHaveBeenCalledWith(expect.objectContaining({ stage_order: 4 }));
    });

    it('refuses insert_at beyond max + 1 with PHASE_INSERT_INVALID', async () => {
      const response = await post({ insert_at: 5 });
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.code).toBe('PHASE_INSERT_INVALID');
      expect(shiftStageOrders).not.toHaveBeenCalled();
      expect(createTournament).not.toHaveBeenCalled();
    });

    it('still refuses an insert in front of a started phase (PHASE_INSERT_LOCKED)', async () => {
      const response = await post({ insert_at: 1 });

      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('PHASE_INSERT_LOCKED');
      expect(shiftStageOrders).not.toHaveBeenCalled();
    });
  });

  it('answers an unknown league with 404 SEASON_NOT_FOUND', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);

    const response = await POST(makeRequest({ name: 'Playoffs' }) as NextRequest, {
      params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toMatchObject({ error: 'League not found', code: 'SEASON_NOT_FOUND' });
    expect(createTournament).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with validation_failed and the issues as a param', async () => {
    const response = await POST(makeRequest({ bracket_type: 'single_elim' }) as NextRequest, {
      params: makeParams({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
    expect(createTournament).not.toHaveBeenCalled();
  });
});
