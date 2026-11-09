/**
 * A forced standings sync enrolls past the checks that guard a normal one, so it leaves an audit entry; a plain sync does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/tournament/enrollment-sync', () => ({ syncStandingsEnrollment: vi.fn() }));
vi.mock('@/lib/format-studio/phase-guards', () => ({ assertFormatPhaseRosterOpen: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

import { POST } from '../route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { logAuditEvent } from '@/lib/audit/log';

const SEASON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHASE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const args = { params: Promise.resolve({ id: SEASON, phaseId: PHASE }) };
const req = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin', isAdmin: true } as never);
  vi.mocked(getTournamentById).mockResolvedValue({ id: PHASE, season_id: SEASON, status: 'upcoming' } as never);
  vi.mocked(syncStandingsEnrollment).mockResolvedValue({ enrolled_count: 4, enrollment_source: {}, source_phase_name: 'Swiss' } as never);
});

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
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
