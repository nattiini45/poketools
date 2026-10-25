import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { requirePlayer: vi.fn(), AuthError };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((err: unknown, fallback: string) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return NextResponse.json({ success: false, error: fallback }, { status });
  }),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  updateOpenMatchSchedule: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-proposals', () => ({
  cancelPendingMatchProposalsForMatch: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { PATCH } from '@/app/api/admin/matches/[id]/schedule/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById, updateOpenMatchSchedule } from '@/lib/supabase/queries/matches';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';

const MATCH_ID = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const routeParams = { params: Promise.resolve({ id: MATCH_ID }) };

const siteAdmin = { playerId: 'admin-1', name: 'Admin', isAdmin: true };
const resourceAdmin = { playerId: 'ra-1', name: 'Resource Admin', isAdmin: false };

function scheduledMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_ID,
    tournament_id: 'tourn-1',
    status: 'scheduled',
    scheduled_at: '2026-10-24T10:00:00+00:00',
    player_1_name: 'Alice',
    player_2_name: 'Bob',
    ...overrides,
  };
}

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function proposals(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `prop-${i}` })) as never;
}

describe('PATCH /api/admin/matches/[id]/schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(siteAdmin as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
    vi.mocked(getMatchById).mockResolvedValue(scheduledMatch() as never);
    vi.mocked(updateOpenMatchSchedule).mockImplementation(
      async (_id: string, scheduledAt: string | null) =>
        scheduledMatch({ scheduled_at: scheduledAt }) as never
    );
    vi.mocked(cancelPendingMatchProposalsForMatch).mockResolvedValue([]);
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);
  });

  describe('access', () => {
    it('answers 401 when the guard rejects an anonymous caller', async () => {
      vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

      const res = await PATCH(request({ scheduled_at: null }), routeParams);

      expect(res.status).toBe(401);
      expect(updateOpenMatchSchedule).not.toHaveBeenCalled();
    });

    it('answers 403 for a player who is no admin', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p9', name: 'Pat', isAdmin: false } as never);

      const res = await PATCH(request({ scheduled_at: null }), routeParams);

      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('forbidden');
      expect(updateOpenMatchSchedule).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('answers 403 for a resource admin of another tournament', async () => {
      vi.mocked(requirePlayer).mockResolvedValue(resourceAdmin as never);
      vi.mocked(isResourceAdminFor).mockResolvedValue(false);

      const res = await PATCH(request({ scheduled_at: null }), routeParams);

      expect(res.status).toBe(403);
      expect(isResourceAdminFor).toHaveBeenCalledWith('ra-1', 'tournament', 'tourn-1');
      expect(updateOpenMatchSchedule).not.toHaveBeenCalled();
    });

    it('lets a resource admin of the match tournament change the schedule', async () => {
      vi.mocked(requirePlayer).mockResolvedValue(resourceAdmin as never);
      vi.mocked(isResourceAdminFor).mockResolvedValue(true);

      const res = await PATCH(request({ scheduled_at: '2026-10-25T12:00:00Z' }), routeParams);

      expect(res.status).toBe(200);
      expect(updateOpenMatchSchedule).toHaveBeenCalledTimes(1);
    });

    it('answers 404 for an unknown match', async () => {
      vi.mocked(getMatchById).mockResolvedValue(null);

      const res = await PATCH(request({ scheduled_at: null }), routeParams);

      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('match_not_found');
    });
  });

  describe('validation', () => {
    it.each([
      ['a missing field', {}],
      ['a local time without an offset', { scheduled_at: '2026-10-24T10:00' }],
      ['a year before 2000', { scheduled_at: '1999-12-31T23:59:59Z' }],
      ['a year from 2100', { scheduled_at: '2100-01-01T00:00:00Z' }],
      ['a non-string time', { scheduled_at: 12345 }],
    ])('answers 400 validation_failed for %s', async (_label, body) => {
      const res = await PATCH(request(body), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
      expect(updateOpenMatchSchedule).not.toHaveBeenCalled();
    });

    it('answers 400 for an unreadable body', async () => {
      const broken = {
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      } as unknown as NextRequest;

      const res = await PATCH(broken, routeParams);

      expect(res.status).toBe(400);
      expect(updateOpenMatchSchedule).not.toHaveBeenCalled();
    });
  });

  describe('writes', () => {
    it('sets a first time and audits before and after', async () => {
      vi.mocked(getMatchById).mockResolvedValue(scheduledMatch({ scheduled_at: null }) as never);

      const res = await PATCH(request({ scheduled_at: '2026-10-25T12:00:00Z' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual({
        scheduled_at: '2026-10-25T12:00:00Z',
        previous_scheduled_at: null,
        proposals_cancelled: 0,
        proposals_cancel_failed: false,
        unchanged: false,
      });
      expect(updateOpenMatchSchedule).toHaveBeenCalledTimes(1);
      expect(updateOpenMatchSchedule).toHaveBeenCalledWith(MATCH_ID, '2026-10-25T12:00:00Z');
      expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', MATCH_ID);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith({
        actor_id: 'admin-1',
        actor_name: 'Admin',
        action: 'match.schedule',
        resource_type: 'match',
        resource_id: MATCH_ID,
        resource_name: 'Alice vs Bob',
        changes: { scheduled_at: { before: null, after: '2026-10-25T12:00:00Z' } },
        metadata: { tournament_id: 'tourn-1', proposals_cancelled: 0, proposals_cancel_failed: false },
      });
    });

    it('changes an existing time and audits old and new value', async () => {
      const res = await PATCH(request({ scheduled_at: '2026-10-26T18:30:00Z' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.previous_scheduled_at).toBe('2026-10-24T10:00:00+00:00');
      expect(body.data.scheduled_at).toBe('2026-10-26T18:30:00Z');
      expect(vi.mocked(logAuditEvent).mock.calls[0][0].changes).toEqual({
        scheduled_at: { before: '2026-10-24T10:00:00+00:00', after: '2026-10-26T18:30:00Z' },
      });
    });

    it('clears the time with null', async () => {
      const res = await PATCH(request({ scheduled_at: null }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(updateOpenMatchSchedule).toHaveBeenCalledWith(MATCH_ID, null);
      expect(body.data).toMatchObject({ scheduled_at: null, unchanged: false });
      expect(vi.mocked(logAuditEvent).mock.calls[0][0].changes).toEqual({
        scheduled_at: { before: '2026-10-24T10:00:00+00:00', after: null },
      });
    });

    it('keeps the offset the admin sent', async () => {
      await PATCH(request({ scheduled_at: '2026-10-25T14:00:00+02:00' }), routeParams);

      expect(updateOpenMatchSchedule).toHaveBeenCalledWith(MATCH_ID, '2026-10-25T14:00:00+02:00');
    });

    it('also writes for an in-progress, pending or disputed match', async () => {
      for (const status of ['in_progress', 'pending_confirmation', 'disputed']) {
        vi.mocked(updateOpenMatchSchedule).mockClear();
        vi.mocked(getMatchById).mockResolvedValue(scheduledMatch({ status }) as never);

        const res = await PATCH(request({ scheduled_at: '2026-10-27T09:00:00Z' }), routeParams);

        expect(res.status).toBe(200);
        expect(updateOpenMatchSchedule).toHaveBeenCalledTimes(1);
      }
    });

    it('cancels pending proposals and reports the count in the response and the audit', async () => {
      vi.mocked(cancelPendingMatchProposalsForMatch).mockResolvedValue(proposals(2));

      const res = await PATCH(request({ scheduled_at: '2026-10-26T18:30:00Z' }), routeParams);
      const body = await res.json();

      expect(cancelPendingMatchProposalsForMatch).toHaveBeenCalledWith(MATCH_ID);
      expect(body.data.proposals_cancelled).toBe(2);
      expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({
        tournament_id: 'tourn-1',
        proposals_cancelled: 2,
        proposals_cancel_failed: false,
      });
    });

    it('keeps the committed write audited and revalidated when cancelling the proposals fails, and reports it', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(cancelPendingMatchProposalsForMatch).mockRejectedValue(new Error('proposals down'));

      const res = await PATCH(request({ scheduled_at: '2026-10-26T18:30:00Z' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual({
        scheduled_at: '2026-10-26T18:30:00Z',
        previous_scheduled_at: '2026-10-24T10:00:00+00:00',
        proposals_cancelled: 0,
        proposals_cancel_failed: true,
        unchanged: false,
      });
      expect(updateOpenMatchSchedule).toHaveBeenCalledTimes(1);
      expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', MATCH_ID);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({
        tournament_id: 'tourn-1',
        proposals_cancelled: 0,
        proposals_cancel_failed: true,
      });
    });

    it('still answers 200 and audits when the page revalidation fails after the write', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(revalidateMatchPages).mockRejectedValue(new Error('cache down'));

      const res = await PATCH(request({ scheduled_at: '2026-10-26T18:30:00Z' }), routeParams);

      expect(res.status).toBe(200);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
    });

    it('cancels pending proposals when the time is cleared too', async () => {
      vi.mocked(cancelPendingMatchProposalsForMatch).mockResolvedValue(proposals(1));

      const res = await PATCH(request({ scheduled_at: null }), routeParams);

      expect(cancelPendingMatchProposalsForMatch).toHaveBeenCalledTimes(1);
      expect((await res.json()).data.proposals_cancelled).toBe(1);
    });
  });

  describe('no-op and conflicts', () => {
    it('treats the same instant in another spelling as unchanged: no write, audit or proposal change', async () => {
      const res = await PATCH(request({ scheduled_at: '2026-10-24T12:00:00+02:00' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual({
        scheduled_at: '2026-10-24T10:00:00+00:00',
        previous_scheduled_at: '2026-10-24T10:00:00+00:00',
        proposals_cancelled: 0,
        proposals_cancel_failed: false,
        unchanged: true,
      });
      expect(updateOpenMatchSchedule).not.toHaveBeenCalled();
      expect(cancelPendingMatchProposalsForMatch).not.toHaveBeenCalled();
      expect(revalidateMatchPages).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('treats clearing an unset time as unchanged', async () => {
      vi.mocked(getMatchById).mockResolvedValue(scheduledMatch({ scheduled_at: null }) as never);

      const res = await PATCH(request({ scheduled_at: null }), routeParams);

      expect((await res.json()).data.unchanged).toBe(true);
      expect(updateOpenMatchSchedule).not.toHaveBeenCalled();
    });

    it('answers 409 match_schedule_completed for a completed match and writes nothing', async () => {
      vi.mocked(getMatchById).mockResolvedValue(scheduledMatch({ status: 'completed' }) as never);

      const res = await PATCH(request({ scheduled_at: '2026-10-30T10:00:00Z' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body).toEqual({
        success: false,
        error: 'A completed match cannot be rescheduled. Reopen it first.',
        code: 'match_schedule_completed',
      });
      expect(updateOpenMatchSchedule).not.toHaveBeenCalled();
      expect(cancelPendingMatchProposalsForMatch).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('answers 409 when the match completes between the read and the guarded write', async () => {
      vi.mocked(updateOpenMatchSchedule).mockResolvedValue(null);

      const res = await PATCH(request({ scheduled_at: '2026-10-30T10:00:00Z' }), routeParams);

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('match_schedule_completed');
      expect(cancelPendingMatchProposalsForMatch).not.toHaveBeenCalled();
      expect(revalidateMatchPages).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('goes through safeErrorResponse on an unexpected failure', async () => {
      vi.mocked(updateOpenMatchSchedule).mockRejectedValue(new Error('db down'));

      const res = await PATCH(request({ scheduled_at: '2026-10-30T10:00:00Z' }), routeParams);

      expect(res.status).toBe(500);
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });
});
