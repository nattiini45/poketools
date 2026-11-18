/**
 * A forced standings sync enrolls past the checks that guard a normal one, so it leaves an audit entry; a plain sync does not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: vi.fn() }));
vi.mock('@/lib/tournament/enrollment-sync', () => ({ syncStandingsEnrollment: vi.fn() }));
vi.mock('@/lib/league-phase/enrollment-services', () => ({ createNativePhaseEnrollment: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getKitPhases: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

import { POST } from '../route';
import { revalidateTag } from 'next/cache';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { readPhaseStorageMode } from '@/lib/supabase/queries/phase-storage';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { createNativePhaseEnrollment } from '@/lib/league-phase/enrollment-services';
import { logAuditEvent } from '@/lib/audit/log';

const SEASON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHASE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const args = { params: Promise.resolve({ id: SEASON, phaseId: PHASE }) };
const req = (body: unknown) => ({ json: vi.fn(async () => body), headers: new Headers() }) as unknown as NextRequest;
const nativeSync = vi.fn();
const result = { enrolled_count: 4, enrollment_source: {}, source_phase_name: 'Swiss' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', undefined);
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin', isAdmin: true } as never);
  vi.mocked(getTournamentById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'upcoming' } as never);
  vi.mocked(getPhaseById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'upcoming', format_stage_key: null } as never);
  vi.mocked(syncStandingsEnrollment).mockResolvedValue(result as never);
  vi.mocked(createNativePhaseEnrollment).mockReturnValue({ sync: nativeSync, enroll: vi.fn() });
  nativeSync.mockResolvedValue(result);
});

afterEach(() => vi.unstubAllEnvs());

function nativeMode() {
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  vi.mocked(readPhaseStorageMode).mockResolvedValue('phase');
}

describe('POST sync-standings audit', () => {
  it('audits a forced sync', async () => {
    const response = await POST(req({ force: true, source_phase_id: SOURCE }), args);

    expect(response.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'phase.enrollment.sync',
        actor_id: 'admin-1',
        resource_id: PHASE,
        metadata: expect.objectContaining({ season_id: SEASON, force: true, source_phase: SOURCE, enrolled_count: 4 }),
      }),
    );
  });

  it('does not audit a plain sync', async () => {
    const response = await POST(req({}), args);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: result });
    expect(syncStandingsEnrollment).toHaveBeenCalledExactlyOnceWith(SEASON, PHASE, {});
    expect(createNativePhaseEnrollment).not.toHaveBeenCalled();
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledWith(`tournament:${PHASE}`, { expire: 0 });
    expect(revalidateTag).not.toHaveBeenCalledWith(`phase:${PHASE}`, expect.anything());
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe('POST sync-standings on native storage', () => {
  it('dispatches only to the verified native phase and expires native tags after a successful sync', async () => {
    nativeMode();
    const options = { source_phase_id: SOURCE, top_n: 4, per_group: true };
    nativeSync.mockImplementationOnce(async () => {
      expect(revalidateTag).not.toHaveBeenCalled();
      return result;
    });

    const response = await POST(req(options), args);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: result });
    expect(requireResourceAdmin).toHaveBeenCalledExactlyOnceWith('season', SEASON);
    expect(getPhaseById).toHaveBeenCalledExactlyOnceWith(PHASE);
    expect(nativeSync).toHaveBeenCalledExactlyOnceWith(SEASON, PHASE, options);
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
    expect(revalidateTag).toHaveBeenCalledWith(`phase:${PHASE}`, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON}`, { expire: 0 });
    expect(revalidateTag).not.toHaveBeenCalledWith(`tournament:${PHASE}`, expect.anything());
  });

  it('denies an unauthorized caller before looking up mode or phase', async () => {
    nativeMode();
    vi.mocked(requireResourceAdmin).mockRejectedValue(Object.assign(new Error('Admin access required'), { statusCode: 403 }));
    const request = req({});

    expect((await POST(request, args)).status).toBe(403);
    expect(readPhaseStorageMode).not.toHaveBeenCalled();
    expect(getPhaseById).not.toHaveBeenCalled();
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(request.json).not.toHaveBeenCalled();
    expect(nativeSync).not.toHaveBeenCalled();
  });

  it.each(['frozen_legacy', 'frozen_phase'] as const)('refuses %s before reading or syncing the phase', async (mode) => {
    nativeMode();
    vi.mocked(readPhaseStorageMode).mockResolvedValue(mode);
    const request = req({ force: true });
    const response = await POST(request, args);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    expect(getPhaseById).not.toHaveBeenCalled();
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(request.json).not.toHaveBeenCalled();
    expect(nativeSync).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([null, { id: PHASE, season_id: 'other' }])('refuses an unowned native phase: %j', async (phase) => {
    nativeMode();
    vi.mocked(getPhaseById).mockResolvedValue(phase as never);

    const response = await POST(req({ force: true }), args);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'PHASE_NOT_FOUND' });
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(nativeSync).not.toHaveBeenCalled();
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('keeps the format lock and both audits for a forced native sync', async () => {
    nativeMode();
    vi.mocked(getPhaseById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'active', format_stage_key: 'groups' } as never);

    const refused = await POST(req({}), args);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'format_phase_owned' });
    expect(nativeSync).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();

    const response = await POST(req({ force: true, reason: 'Manual correction' }), args);
    expect(response.status).toBe(200);
    expect(nativeSync).toHaveBeenCalledExactlyOnceWith(SEASON, PHASE, { force: true });
    expect(getKitPhases).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'phase.roster.force' }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'phase.enrollment.sync' }));
  });

  it.each(['ENROLLMENT_FROZEN', 'ENROLLMENT_ROUNDS_EXIST'] as const)('surfaces %s without expiring or falling back', async (code) => {
    nativeMode();
    nativeSync.mockRejectedValueOnce(new UserFacingError('Enrollment cannot be changed', { code }));

    const response = await POST(req({}), args);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code });
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
