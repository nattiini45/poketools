import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: vi.fn(), updatePhaseMatchStatus: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitedResponse: vi.fn(() => NextResponse.json({ success: false }, { status: 429 })),
}));
const finalize = vi.hoisted(() => vi.fn());

import { createNativeMatchDecisionHandler, type NativeMatchDecisionEffects } from '../match-decisions';
import { requirePlayer } from '@/lib/auth/helpers';
import { getPhaseMatchById, updatePhaseMatchStatus } from '@/lib/supabase/queries/phase-matches';
import { logAuditEvent } from '@/lib/audit/log';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';

const mid = '00000000-0000-4000-8000-000000000010';
const p1 = '00000000-0000-4000-8000-000000000001';
const p2 = '00000000-0000-4000-8000-000000000002';
const match = {
  id: mid, phase_id: 'phase', round_id: 'round', status: 'pending_confirmation',
  player_1_id: p1, player_2_id: p2, submitter_id: p1, winner_id: p1,
  player_1_name: 'Trainer One', player_2_name: 'Trainer Two', notes: '', games: [],
} as unknown as PhaseMatchWithPlayers;
const player = { playerId: p2, name: 'Trainer Two', isAdmin: false };
const context = { params: Promise.resolve({ mid }) };
const request = (body: object) => new NextRequest('http://localhost/api/confirm-match/' + mid, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});

function effects(): NativeMatchDecisionEffects {
  return {
    finalizer: { finalizeMatchCompletion: finalize },
    canAdminister: vi.fn(async () => false),
    revalidate: vi.fn(async () => {}),
    announceDispute: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(player as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, retryAfterSeconds: 0 });
  vi.mocked(getPhaseMatchById).mockResolvedValue(match);
  vi.mocked(updatePhaseMatchStatus).mockResolvedValue({ ...match, status: 'completed' });
  finalize.mockResolvedValue({ finalized: true, complete: true, failed_steps: [] });
});

describe('native match decisions', () => {
  it('confirms as the non-submitting participant with native reads, actor and configured finalizer', async () => {
    const port = effects();
    const response = await createNativeMatchDecisionHandler(port)(request({ action: 'confirm' }), context);
    expect(response.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledWith('confirm-match', p2, { limit: 30, windowSeconds: 3600 });
    expect(port.canAdminister).toHaveBeenCalledWith(player, 'phase');
    expect(port.finalizer.finalizeMatchCompletion).toBe(finalize);
    expect(updatePhaseMatchStatus).toHaveBeenCalledWith(mid, 'completed', p1, p1, undefined, 'pending_confirmation', 'player');
    expect(finalize).toHaveBeenCalledWith({ match: { ...match, status: 'completed' }, winnerId: p1, previousStatus: 'pending_confirmation' });
    expect(finalize.mock.calls[0][0].match).not.toHaveProperty('tournament_id');
    expect(port.announceDispute).not.toHaveBeenCalled();
  });

  it('authenticates live before reading an id, rate limiting or parsing a body', async () => {
    vi.mocked(requirePlayer).mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { statusCode: 401, code: 'unauthenticated' }));
    const response = await createNativeMatchDecisionHandler(effects())(request({}), { params: Promise.resolve({ mid: 'invalid' }) });
    expect(response.status).toBe(401);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getPhaseMatchById).not.toHaveBeenCalled();
  });

  it('rejects invalid ids and bodies before reading the match', async () => {
    const handler = createNativeMatchDecisionHandler(effects());
    expect((await handler(request({}), { params: Promise.resolve({ mid: 'invalid' }) })).status).toBe(404);
    expect((await handler(request({ action: 'invalid' }), context)).status).toBe(400);
    expect((await handler(request({ action: 'confirm', reason: 'invalid here' }), context)).status).toBe(400);
    expect(getPhaseMatchById).not.toHaveBeenCalled();
  });

  it('stops at the rate limit before reading the match', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const response = await createNativeMatchDecisionHandler(effects())(request({}), context);
    expect(response.status).toBe(429);
    expect(getPhaseMatchById).not.toHaveBeenCalled();
  });

  it.each([
    { actor: p1, input: { action: 'confirm' }, code: 'match_confirm_own_submission', status: 400 },
    { actor: 'unrelated', input: { action: 'confirm' }, code: 'match_confirm_participants_only', status: 400 },
    { actor: 'unrelated', input: { action: 'dispute' }, code: 'match_dispute_participants_only', status: 400 },
    { actor: p2, input: { action: 'confirm', winner_id: p2 }, code: 'match_override_admin_only', status: 403 },
  ])('refuses $code without writing', async ({ actor, input, code, status }) => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...player, playerId: actor } as never);
    const response = await createNativeMatchDecisionHandler(effects())(request(input), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(updatePhaseMatchStatus).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it('refuses settling a scheduled match even for an admin', async () => {
    vi.mocked(getPhaseMatchById).mockResolvedValueOnce({ ...match, status: 'scheduled' });
    const port = effects();
    vi.mocked(port.canAdminister).mockResolvedValue(true);
    const response = await createNativeMatchDecisionHandler(port)(request({ action: 'confirm' }), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'match_settle_use_result_route' });
    expect(updatePhaseMatchStatus).not.toHaveBeenCalled();
  });

  it('allows the live admin to override and resolve a dispute with the admin actor', async () => {
    vi.mocked(getPhaseMatchById).mockResolvedValueOnce({ ...match, status: 'disputed' });
    const port = effects();
    vi.mocked(port.canAdminister).mockResolvedValue(true);
    const response = await createNativeMatchDecisionHandler(port)(request({ action: 'confirm', winner_id: p2, notes: 'Correction' }), context);
    expect(response.status).toBe(200);
    expect(updatePhaseMatchStatus).toHaveBeenCalledWith(mid, 'completed', p2, p1, 'Correction', 'disputed', 'admin');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'match.override', resource_type: 'phase_match' }));
  });

  it('audits a dispute reason without writing it as notes, then invalidates and announces natively', async () => {
    const port = effects();
    await createNativeMatchDecisionHandler(port)(request({ action: 'dispute', reason: 'Replay mismatch' }), context);
    expect(updatePhaseMatchStatus).toHaveBeenCalledWith(mid, 'disputed', undefined, p1, undefined, 'pending_confirmation', 'player');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'match.dispute', resource_type: 'phase_match', metadata: { phase_id: 'phase', reason: 'Replay mismatch', by_admin: false },
    }));
    expect(port.revalidate).toHaveBeenCalledWith('phase', mid);
    expect(port.announceDispute).toHaveBeenCalledWith({ match, player });
    expect(finalize).not.toHaveBeenCalled();
  });

  it('recognizes an identical CAS winner without repeating finalization or announcements', async () => {
    vi.mocked(updatePhaseMatchStatus).mockResolvedValueOnce(null);
    vi.mocked(getPhaseMatchById).mockResolvedValueOnce(match).mockResolvedValueOnce({ ...match, status: 'completed' });
    const port = effects();
    const response = await createNativeMatchDecisionHandler(port)(request({ action: 'confirm' }), context);
    expect(response.status).toBe(200);
    expect(finalize).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(port.announceDispute).not.toHaveBeenCalled();
  });

  it('refuses a different CAS winner or a lost admin note', async () => {
    const port = effects();
    vi.mocked(port.canAdminister).mockResolvedValue(true);
    vi.mocked(updatePhaseMatchStatus).mockResolvedValue(null);
    vi.mocked(getPhaseMatchById).mockResolvedValueOnce(match).mockResolvedValueOnce({ ...match, status: 'completed', winner_id: p2 });
    const handler = createNativeMatchDecisionHandler(port);
    expect((await handler(request({ action: 'confirm' }), context)).status).toBe(409);
    vi.mocked(getPhaseMatchById).mockResolvedValueOnce(match).mockResolvedValueOnce({ ...match, status: 'completed' });
    expect((await handler(request({ action: 'confirm', notes: 'Correction' }), context)).status).toBe(409);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('returns the finalize race and incomplete-step catalog responses', async () => {
    const handler = createNativeMatchDecisionHandler(effects());
    finalize.mockResolvedValueOnce({ finalized: false, reason: 'match_changed', current_status: 'in_progress' });
    const changed = await handler(request({ action: 'confirm' }), context);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'match_state_changed', params: { status: 'in_progress' } });
    finalize.mockResolvedValueOnce({ finalized: true, failed_steps: ['ratings'] });
    const incomplete = await handler(request({ action: 'confirm' }), context);
    expect(incomplete.status).toBe(500);
    expect(await incomplete.json()).toMatchObject({ code: 'match_finalize_incomplete', params: { count: 1 } });
  });
});
