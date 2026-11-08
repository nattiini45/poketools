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
  updateMatchStatus: vi.fn(),
}));

vi.mock('@/lib/match/finalize', () => ({
  finalizeMatchCompletion: vi.fn(),
  stageAdminOutcome: vi.fn(),
  discardStagedAdminOutcome: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

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

import { POST } from '@/app/api/admin/matches/[id]/result/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { discardStagedAdminOutcome, finalizeMatchCompletion, stageAdminOutcome } from '@/lib/match/finalize';
import { StagedOutcomeBlockedError } from '@/lib/match/staged-outcome';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/utils/rate-limit';

const MATCH_ID = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '99999999-9999-4999-8999-999999999999';
const routeParams = { params: Promise.resolve({ id: MATCH_ID }) };
const siteAdmin = { playerId: 'admin-1', name: 'Admin', isAdmin: true };

function matchWith(overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_ID,
    tournament_id: 'tourn-1',
    round_id: 'round-1',
    status: 'scheduled',
    winner_id: null,
    submitter_id: null,
    notes: null,
    player_1_id: P1,
    player_2_id: P2,
    player_1_name: 'Alice',
    player_2_name: 'Bob',
    games: [],
    ...overrides,
  };
}

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const STAGED = { setAt: '2026-11-06T10:00:00.123456+00:00' };
const validBody = { winner_id: P1, reason: 'Bob did not show up' };

describe('POST /api/admin/matches/[id]/result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requirePlayer).mockResolvedValue(siteAdmin as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
    vi.mocked(getMatchById).mockResolvedValue(matchWith() as never);
    vi.mocked(updateMatchStatus).mockResolvedValue(matchWith({ status: 'completed', winner_id: P1 }) as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 } as never);
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);
    vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: true, complete: true, failed_steps: [] });
    vi.mocked(stageAdminOutcome).mockResolvedValue(STAGED);
    vi.mocked(discardStagedAdminOutcome).mockResolvedValue(undefined);
  });

  describe('access', () => {
    it('answers 401 for an anonymous caller', async () => {
      vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(401);
      expect(updateMatchStatus).not.toHaveBeenCalled();
    });

    it('answers 403 for a player who administers nothing', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: OUTSIDER, name: 'Pat', isAdmin: false } as never);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(403);
      expect(updateMatchStatus).not.toHaveBeenCalled();
      expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    });

    it('answers 403 for a participant (a player cannot settle their own match)', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: P1, name: 'Alice', isAdmin: false } as never);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(403);
      expect(updateMatchStatus).not.toHaveBeenCalled();
    });

    it('answers 403 for a resource admin of another league', async () => {
      vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'ra-2', name: 'Other', isAdmin: false } as never);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(403);
      expect(isResourceAdminFor).toHaveBeenCalledWith('ra-2', 'tournament', 'tourn-1');
      expect(updateMatchStatus).not.toHaveBeenCalled();
    });

    it('answers 404 match_not_found for an unknown match', async () => {
      vi.mocked(getMatchById).mockResolvedValue(null);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('match_not_found');
    });
  });

  describe('validation', () => {
    it.each([
      ['a missing reason', { winner_id: P1 }],
      ['a blank reason', { winner_id: P1, reason: '   ' }],
      ['a missing winner', { reason: 'no show' }],
      ['a winner that is not a uuid', { winner_id: 'alice', reason: 'no show' }],
      ['no body', null],
      ['an unresolved outcome (never set by an admin)', { winner_id: P1, reason: 'no show', outcome: 'unresolved' }],
      ['an unknown outcome', { winner_id: P1, reason: 'no show', outcome: 'draw' }],
    ])('answers 400 validation_failed for %s', async (_label, body) => {
      const res = await POST(request(body), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
      expect(updateMatchStatus).not.toHaveBeenCalled();
    });

    it('answers 400 match_winner_not_participant for a winner outside the match', async () => {
      const res = await POST(request({ winner_id: OUTSIDER, reason: 'no show' }), routeParams);

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('match_winner_not_participant');
      expect(updateMatchStatus).not.toHaveBeenCalled();
    });

    it.each(['pending_confirmation', 'completed', 'disputed'])(
      'answers 409 match_result_wrong_status for a %s match and writes nothing',
      async (status) => {
        vi.mocked(getMatchById).mockResolvedValue(matchWith({ status }) as never);

        const res = await POST(request(validBody), routeParams);
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.code).toBe('match_result_wrong_status');
        expect(body.params).toEqual({ status });
        expect(updateMatchStatus).not.toHaveBeenCalled();
        expect(finalizeMatchCompletion).not.toHaveBeenCalled();
      }
    );

    it('answers 429 once the rate limit is used up', async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 } as never);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(429);
      expect(updateMatchStatus).not.toHaveBeenCalled();
    });
  });

  describe.each([['scheduled'], ['in_progress']])('settling a %s match', (status) => {
    beforeEach(() => {
      vi.mocked(getMatchById).mockResolvedValue(matchWith({ status }) as never);
    });

    it('completes it directly with the winner, as one compare-and-set on the status read', async () => {
      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(200);
      expect(updateMatchStatus).toHaveBeenCalledTimes(1);
      expect(updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, 'completed', P1, siteAdmin.playerId, undefined, status);
      expect((await res.json()).data).toMatchObject({ status: 'completed', winner_id: P1 });
    });

    it('finalizes exactly once with the winner and the previous status', async () => {
      await POST(request(validBody), routeParams);

      expect(finalizeMatchCompletion).toHaveBeenCalledTimes(1);
      expect(finalizeMatchCompletion).toHaveBeenCalledWith({
        match: expect.objectContaining({ id: MATCH_ID, status: 'completed', winner_id: P1 }),
        winnerId: P1,
        previousStatus: status,
        adminOutcome: { kind: 'played', reason: 'Bob did not show up', setBy: siteAdmin.playerId },
      });
    });

    it.each(['forfeit', 'no_show'])('hands a %s outcome with the reason to finalize and audits it', async (outcome) => {
      await POST(request({ ...validBody, outcome }), routeParams);

      expect(finalizeMatchCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          adminOutcome: { kind: outcome, reason: 'Bob did not show up', setBy: siteAdmin.playerId },
        })
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ outcome }) })
      );
    });

    it('audits match.admin_result with the reason and the status and winner change', async () => {
      await POST(request(validBody), routeParams);

      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_id: siteAdmin.playerId,
          action: 'match.admin_result',
          resource_type: 'match',
          resource_id: MATCH_ID,
          changes: {
            status: { before: status, after: 'completed' },
            winner_id: { before: null, after: P1 },
          },
          metadata: expect.objectContaining({
            tournament_id: 'tourn-1',
            reason: 'Bob did not show up',
            from_status: status,
            games_recorded: 0,
          }),
        })
      );
    });

    it('expires the public match pages right after the write', async () => {
      await POST(request(validBody), routeParams);

      expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', MATCH_ID);
      const write = vi.mocked(updateMatchStatus).mock.invocationCallOrder[0];
      expect(vi.mocked(revalidateMatchPages).mock.invocationCallOrder[0]).toBeGreaterThan(write);
    });
  });

  it('keeps the original reporter as submitter of an in-progress match', async () => {
    vi.mocked(getMatchById).mockResolvedValue(
      matchWith({ status: 'in_progress', submitter_id: P2, games: [{ id: 'g1' }] }) as never
    );

    await POST(request(validBody), routeParams);

    expect(updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, 'completed', P1, P2, undefined, 'in_progress');
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ games_recorded: 1 }) })
    );
  });

  it('lets a resource admin of the match tournament or league settle', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'ra-1', name: 'Organizer', isAdmin: false } as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);

    const res = await POST(request({ winner_id: P2, reason: 'Agreed in Discord' }), routeParams);

    expect(res.status).toBe(200);
    expect(updateMatchStatus).toHaveBeenCalledWith(MATCH_ID, 'completed', P2, 'ra-1', undefined, 'scheduled');
  });

  describe('the admin outcome', () => {
    it('is written before the status flip and handed to finalize as the same intent', async () => {
      const order: string[] = [];
      vi.mocked(stageAdminOutcome).mockImplementation(async () => {
        order.push('stage');
        return STAGED;
      });
      vi.mocked(updateMatchStatus).mockImplementation(async () => {
        order.push('flip');
        return matchWith({ status: 'completed', winner_id: P1 }) as never;
      });

      const res = await POST(request({ ...validBody, outcome: 'forfeit' }), routeParams);

      expect(res.status).toBe(200);
      expect(order).toEqual(['stage', 'flip']);
      const staged = { kind: 'forfeit', reason: 'Bob did not show up', setBy: 'admin-1' };
      expect(stageAdminOutcome).toHaveBeenCalledWith(MATCH_ID, staged);
      expect(finalizeMatchCompletion).toHaveBeenCalledWith(expect.objectContaining({ adminOutcome: staged }));
    });

    it('fails the request with the match untouched when the outcome cannot be written', async () => {
      vi.mocked(stageAdminOutcome).mockRejectedValue(new Error('db down'));

      const res = await POST(request({ ...validBody, outcome: 'no_show' }), routeParams);

      expect(res.status).toBe(500);
      expect(updateMatchStatus).not.toHaveBeenCalled();
      expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    });

    it('answers 409 and writes nothing when a replay-tie disputed the match since it was read', async () => {
      vi.mocked(stageAdminOutcome).mockRejectedValue(new StagedOutcomeBlockedError('disputed'));

      const res = await POST(request({ ...validBody, outcome: 'forfeit' }), routeParams);

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({ success: false, code: 'match_state_changed', params: { status: 'disputed' } });
      expect(updateMatchStatus).not.toHaveBeenCalled();
      expect(finalizeMatchCompletion).not.toHaveBeenCalled();
      expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'admin-match-result',
        expect.stringContaining('staged outcome blocked'),
        expect.objectContaining({ matchId: MATCH_ID, status: 'disputed' })
      );
    });

    it('takes its staged row back (finalize-side restore of the dispute row) when the dispute lands between staging and the flip', async () => {
      vi.mocked(updateMatchStatus).mockResolvedValue(null);
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockResolvedValueOnce(matchWith({ status: 'disputed' }) as never);

      const res = await POST(request({ ...validBody, outcome: 'forfeit' }), routeParams);

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'match_state_changed', params: { status: 'disputed' } });
      // the handle is passed on, so the discard knows which row is ours and restores the dispute's
      expect(discardStagedAdminOutcome).toHaveBeenCalledWith(MATCH_ID, STAGED);
    });

    it('is removed again when the compare-and-set loses to a status that is not completed', async () => {
      vi.mocked(updateMatchStatus).mockResolvedValue(null);
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockResolvedValueOnce(matchWith({ status: 'pending_confirmation' }) as never);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(409);
      expect(discardStagedAdminOutcome).toHaveBeenCalledWith(MATCH_ID, STAGED);
    });

    it('takes back its own row when a request without an admin outcome (a player confirmation) completed the match meanwhile', async () => {
      vi.mocked(updateMatchStatus).mockResolvedValue(null);
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockResolvedValueOnce(matchWith({ status: 'completed', winner_id: P1 }) as never);

      const res = await POST(request({ ...validBody, outcome: 'forfeit' }), routeParams);

      expect(res.status).toBe(409);
      // The stale admin row would make the played match score as a forfeit; only the row this request wrote goes.
      expect(discardStagedAdminOutcome).toHaveBeenCalledWith(MATCH_ID, STAGED);
    });

    it('leaves the row of a completed match alone when nothing was staged by this request (the match was completed before)', async () => {
      vi.mocked(stageAdminOutcome).mockResolvedValue(null);
      vi.mocked(updateMatchStatus).mockResolvedValue(null);
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockResolvedValueOnce(matchWith({ status: 'completed', winner_id: P1 }) as never);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(409);
      expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
    });

    it('is removed when the status write throws and the match is confirmed not completed', async () => {
      vi.mocked(updateMatchStatus).mockRejectedValue(new Error('timeout'));
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockResolvedValueOnce(matchWith({ status: 'scheduled' }) as never);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(500);
      expect(discardStagedAdminOutcome).toHaveBeenCalledWith(MATCH_ID, STAGED);
    });

    it('stays when the status write threw and the match is completed (the write may have been our own)', async () => {
      vi.mocked(updateMatchStatus).mockRejectedValue(new Error('timeout'));
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockResolvedValueOnce(matchWith({ status: 'completed', winner_id: P1 }) as never);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(500);
      expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
    });

    it('stays when the status write threw and the match status cannot be read (the write may have committed)', async () => {
      vi.mocked(updateMatchStatus).mockRejectedValue(new Error('timeout'));
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockRejectedValueOnce(new Error('db down'));

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(500);
      expect(discardStagedAdminOutcome).not.toHaveBeenCalled();
    });
  });

  describe('a lost race', () => {
    it('answers 409 match_state_changed when the compare-and-set misses, and finalizes nothing', async () => {
      vi.mocked(updateMatchStatus).mockResolvedValue(null);
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockResolvedValueOnce(matchWith({ status: 'completed', winner_id: P1 }) as never);

      const res = await POST(request(validBody), routeParams);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe('match_state_changed');
      expect(body.params).toEqual({ status: 'completed' });
      expect(finalizeMatchCompletion).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('answers 404 when the match was deleted between the read and the write', async () => {
      vi.mocked(updateMatchStatus).mockResolvedValue(null);
      vi.mocked(getMatchById)
        .mockResolvedValueOnce(matchWith() as never)
        .mockResolvedValueOnce(null);

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(404);
      expect(finalizeMatchCompletion).not.toHaveBeenCalled();
    });
  });

  describe('finalize outcome', () => {
    it('answers 500 match_finalize_incomplete when follow-up steps fail, after the completion is saved and audited', async () => {
      vi.mocked(finalizeMatchCompletion).mockResolvedValue({
        finalized: true,
        complete: false,
        failed_steps: ['ratings', 'streaks'],
      });

      const res = await POST(request(validBody), routeParams);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.code).toBe('match_finalize_incomplete');
      expect(body.params).toEqual({ count: 2 });
      expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'match.admin_result' }));
    });

    it('answers 409 match_state_changed when the match was reset after the status flip', async () => {
      vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: false, reason: 'match_changed', current_status: 'scheduled' });

      const res = await POST(request(validBody), routeParams);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe('match_state_changed');
      expect(body.params).toEqual({ status: 'scheduled' });
    });

    it('fails loudly when finalize did not run at all', async () => {
      vi.mocked(finalizeMatchCompletion).mockResolvedValue({ finalized: false, reason: 'winner_not_participant' });

      const res = await POST(request(validBody), routeParams);

      expect(res.status).toBe(500);
    });
  });
});
