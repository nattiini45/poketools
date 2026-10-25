import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/match/reopen', () => ({
  reopenMatch: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitedResponse: vi.fn(
    (seconds: number) =>
      new Response(JSON.stringify({ success: false, code: 'rate_limited', params: { seconds } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      })
  ),
}));

import { POST } from '@/app/api/admin/matches/[id]/reopen/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { reopenMatch } from '@/lib/match/reopen';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { UserFacingError } from '@/lib/api/user-facing-error';

const MATCH_ID = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const routeParams = { params: Promise.resolve({ id: MATCH_ID }) };
const siteAdmin = { playerId: 'admin-1', name: 'Admin', isAdmin: true };

const completedMatch = {
  id: MATCH_ID,
  tournament_id: 'tourn-1',
  status: 'completed',
  winner_id: 'p1',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
};

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe('POST /api/admin/matches/[id]/reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requirePlayer).mockResolvedValue(siteAdmin as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
    vi.mocked(getMatchById).mockResolvedValue(completedMatch as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 } as never);
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);
    vi.mocked(reopenMatch).mockResolvedValue({
      from_status: 'completed',
      ratings_rebuilt_players: 2,
      bracket_matches_removed: 1,
      failed_steps: [],
    });
  });

  describe('access', () => {
    it('answers 401 when the guard rejects an anonymous caller', async () => {
      vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

      const res = await POST(request({ reason: 'typo' }), routeParams);

      expect(res.status).toBe(401);
      expect(reopenMatch).not.toHaveBeenCalled();
    });

    it('answers 403 for a player who is no admin', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p9', name: 'Pat', isAdmin: false } as never);

      const res = await POST(request({ reason: 'typo' }), routeParams);

      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('forbidden');
      expect(reopenMatch).not.toHaveBeenCalled();
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it('answers 403 for a resource admin of another tournament', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'ra-1', name: 'RA', isAdmin: false } as never);

      const res = await POST(request({ reason: 'typo' }), routeParams);

      expect(res.status).toBe(403);
      expect(isResourceAdminFor).toHaveBeenCalledWith('ra-1', 'tournament', 'tourn-1');
      expect(reopenMatch).not.toHaveBeenCalled();
    });

    it('lets a resource admin of the match tournament reopen', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'ra-1', name: 'RA', isAdmin: false } as never);
      vi.mocked(isResourceAdminFor).mockResolvedValue(true);

      const res = await POST(request({ reason: 'typo' }), routeParams);

      expect(res.status).toBe(200);
      expect(reopenMatch).toHaveBeenCalledWith(MATCH_ID, 'ra-1');
    });
  });

  describe('validation and rate limit', () => {
    it.each([
      ['a missing reason', {}],
      ['a blank reason', { reason: '   ' }],
      ['a reason over 500 characters', { reason: 'a'.repeat(501) }],
    ])('answers 400 validation_failed for %s', async (_label, body) => {
      const res = await POST(request(body), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
      expect(reopenMatch).not.toHaveBeenCalled();
    });

    it('answers 400 for an unreadable body', async () => {
      const broken = {
        json: async () => {
          throw new SyntaxError('Unexpected end of JSON input');
        },
      } as unknown as NextRequest;

      expect((await POST(broken, routeParams)).status).toBe(400);
      expect(reopenMatch).not.toHaveBeenCalled();
    });

    it('rate limits per admin before doing anything', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 90 } as never);

      const res = await POST(request({ reason: 'typo' }), routeParams);

      expect(res.status).toBe(429);
      expect(checkRateLimit).toHaveBeenCalledWith('admin-match-reopen', 'admin-1', {
        limit: 20,
        windowSeconds: 3600,
      });
      expect(reopenMatch).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('reopens, revalidates and audits the reason and the source status', async () => {
      const res = await POST(request({ reason: '  Winner was entered wrongly  ' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        success: true,
        data: {
          from_status: 'completed',
          ratings_rebuilt_players: 2,
          bracket_matches_removed: 1,
          failed_steps: [],
        },
      });
      expect(reopenMatch).toHaveBeenCalledWith(MATCH_ID, 'admin-1');
      expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', MATCH_ID);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith({
        actor_id: 'admin-1',
        actor_name: 'Admin',
        action: 'match.reopen',
        resource_type: 'match',
        resource_id: MATCH_ID,
        resource_name: 'Alice vs Bob',
        changes: {
          status: { before: 'completed', after: 'in_progress' },
          winner_id: { before: 'p1', after: null },
        },
        metadata: {
          tournament_id: 'tourn-1',
          reason: 'Winner was entered wrongly',
          from_status: 'completed',
          ratings_rebuilt_players: 2,
          bracket_matches_removed: 1,
        },
      });
    });

    it('audits the status the match really had when reopening a disputed match', async () => {
      vi.mocked(getMatchById).mockResolvedValue({ ...completedMatch, status: 'disputed', winner_id: null } as never);
      vi.mocked(reopenMatch).mockResolvedValue({
        from_status: 'disputed',
        ratings_rebuilt_players: 0,
        bracket_matches_removed: 0,
        failed_steps: [],
      });

      await POST(request({ reason: 'Reviewed with both players' }), routeParams);

      const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
      expect(entry.changes).toMatchObject({ status: { before: 'disputed', after: 'in_progress' } });
      expect(entry.metadata).toMatchObject({ from_status: 'disputed' });
    });
  });

  describe('failures', () => {
    it('audits an incomplete reopen with the failed steps, then answers 500 match_reopen_incomplete', async () => {
      vi.mocked(reopenMatch).mockResolvedValue({
        from_status: 'completed',
        ratings_rebuilt_players: 0,
        bracket_matches_removed: 0,
        failed_steps: ['ratings', 'evolution'],
      });

      const res = await POST(request({ reason: 'typo' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toMatchObject({
        success: false,
        code: 'match_reopen_incomplete',
        params: { count: 2 },
      });
      expect(body.error).toContain('2 follow-up steps failed');
      expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', MATCH_ID);
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({
        reason: 'typo',
        incomplete: true,
        failed_steps: ['ratings', 'evolution'],
      });
    });

    it('uses the singular for one failed step', async () => {
      vi.mocked(reopenMatch).mockResolvedValue({
        from_status: 'completed',
        ratings_rebuilt_players: 2,
        bracket_matches_removed: 0,
        failed_steps: ['round'],
      });

      const body = await (await POST(request({ reason: 'typo' }), routeParams)).json();

      expect(body.error).toContain('1 follow-up step failed');
      expect(body.params).toEqual({ count: 1 });
    });

    it.each([
      ['match_state_changed', 409, undefined],
      ['match_reopen_downstream_played', 409, { count: 2 }],
      ['rating_history_incomplete', 409, undefined],
      ['match_transition_invalid', 400, { from: 'scheduled', to: 'in_progress' }],
    ] as const)('passes %s through with status %i and writes no audit event', async (code, status, params) => {
      vi.mocked(reopenMatch).mockRejectedValue(new UserFacingError('refused', { code, params, status }));

      const res = await POST(request({ reason: 'typo' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(status);
      expect(body.code).toBe(code);
      if (params) expect(body.params).toEqual(params);
      expect(logAuditEvent).not.toHaveBeenCalled();
      expect(revalidateMatchPages).not.toHaveBeenCalled();
    });

    it('answers 500 with the static fallback for an unexpected error', async () => {
      vi.mocked(reopenMatch).mockRejectedValue(new Error('db password in message'));

      const res = await POST(request({ reason: 'typo' }), routeParams);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe('Failed to reopen the match');
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });
});
