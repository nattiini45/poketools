import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  updateMatchStatus: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByMatch: vi.fn(),
}));

vi.mock('@/lib/tournament/match-state', () => ({
  validateTransition: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

vi.mock('@/lib/discord/helpers', () => ({
  buildGamePokemonStats: vi.fn().mockReturnValue([]),
  computePokemonScoreFromGameStats: vi.fn().mockReturnValue({ p1: 3, p2: 1 }),
}));

vi.mock('@/lib/gamification/achievements', () => ({
  checkAchievements: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/gamification/signatures', () => ({
  updateSignatures: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/gamification/streaks', () => ({
  updateStreaks: vi.fn().mockResolvedValue({
    win_streak: { before: 0, after: 1 },
    loss_streak: { before: 0, after: 0 },
    draw_streak: { before: 0, after: 0 },
  }),
}));

vi.mock('@/lib/rating/updateRatings', () => ({
  updateRatings: vi.fn().mockResolvedValue({
    winnerRating: 1520,
    loserRating: 1480,
    winnerChange: 20,
    loserChange: -20,
  }),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

// --------------- imports (after mocks) ---------------

import { POST } from '@/app/api/confirm-match/[mid]/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { validateTransition } from '@/lib/tournament/match-state';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';

// --------------- helpers ---------------

const routeParams = (mid: string) => ({ params: Promise.resolve({ mid }) });

function makeRequest(body: Record<string, unknown>): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

const pendingMatch = {
  id: 'm-1',
  tournament_id: 't-1',
  round_id: 'r-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  player_1_avatar_url: null,
  player_2_avatar_url: null,
  winner_id: 'p1',
  winner_name: 'Alice',
  status: 'pending_confirmation' as const,
  submitter_id: 'p1',
  social_image_url: null,
  games: [],
};

const overridePlayerOneId = '00000000-0000-4000-8000-000000000001';
const overridePlayerTwoId = '00000000-0000-4000-8000-000000000002';

// --------------- tests ---------------

describe('POST /api/confirm-match/[mid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated player p2 (the opponent)
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: 'p2',
      name: 'Bob',
      isAdmin: false,
    } as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);
  });

  // ---- auth ----

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Unauthorized', 401));

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
  });

  // ---- validation ----

  it('returns 400 for an invalid action value', async () => {
    const response = await POST(
      makeRequest({ action: 'invalid' }),
      routeParams('m-1')
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('confirm');
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
  });

  it('returns 404 when match does not exist', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain('not found');
    expect(payload.code).toBe('match_not_found');
  });

  it('returns 400 when transition is invalid', async () => {
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);
    vi.mocked(validateTransition).mockReturnValue({
      valid: false,
      error: 'Invalid transition: completed -> completed',
    });

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
  });

  it.each([
    [
      'Invalid transition: completed → completed',
      { code: 'match_transition_invalid', params: { from: 'completed', to: 'completed' } },
    ],
    ['Only admins can reset match state', { code: 'match_reset_admin_only' }],
    ['Only admins can resolve disputed matches', { code: 'match_dispute_resolve_admin_only' }],
    ['Cannot complete a match without a winner', { code: 'match_complete_no_winner' }],
    ['Winner must be one of the match participants', { code: 'match_winner_not_participant' }],
    ['Only match participants or admins can confirm results', { code: 'match_confirm_participants_only' }],
    ['Only match participants or admins can dispute results', { code: 'match_dispute_participants_only' }],
  ] as const)('forwards the transition code with the English error %j', async (message, extra) => {
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: false, error: message, ...extra });

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: message, ...extra });
  });

  it('sends no code when validateTransition gives none', async () => {
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: false, error: 'A reason this route does not know' });

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'A reason this route does not know' });
  });

  it('returns 400 when submitter tries to confirm their own submission', async () => {
    // Player is the submitter
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: 'p1',
      name: 'Alice',
      isAdmin: false,
    } as never);
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: true });

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('own submission');
    expect(payload.code).toBe('match_confirm_own_submission');
  });

  it('allows admin to confirm even if they are the submitter', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: 'p1',
      name: 'Alice',
      isAdmin: true,
    } as never);
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: true });
    vi.mocked(updateMatchStatus).mockResolvedValue({ ...pendingMatch, status: 'completed' } as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't-1', name: 'League', season_id: 's-1' } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
  });

  it('rejects winner overrides from non-admin players', async () => {
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);

    const response = await POST(
      makeRequest({ action: 'confirm', winner_id: overridePlayerTwoId }),
      routeParams('m-1')
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('Only admins');
    expect(payload.code).toBe('match_override_admin_only');
    expect(updateMatchStatus).not.toHaveBeenCalled();
  });

  it('allows admins to override winner and notes while logging the change', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
    } as never);
    vi.mocked(getMatchById).mockResolvedValue({
      ...pendingMatch,
      player_1_id: overridePlayerOneId,
      player_2_id: overridePlayerTwoId,
      winner_id: overridePlayerOneId,
      status: 'disputed',
      notes: 'Needs review',
    } as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: true });
    vi.mocked(updateMatchStatus).mockResolvedValue({
      ...pendingMatch,
      status: 'completed',
      winner_id: overridePlayerTwoId,
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't-1', name: 'League', season_id: 's-1' } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);

    const response = await POST(
      makeRequest({ action: 'confirm', winner_id: overridePlayerTwoId, notes: 'Resolved by admin' }),
      routeParams('m-1')
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(updateMatchStatus).toHaveBeenCalledWith('m-1', 'completed', overridePlayerTwoId, 'admin-1', 'Resolved by admin', 'disputed');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'match.override',
      changes: expect.objectContaining({
        winner_id: { before: overridePlayerOneId, after: overridePlayerTwoId },
        notes: { before: 'Needs review', after: 'Resolved by admin' },
      }),
    }));
  });

  // ---- happy path: confirm ----

  it('confirms a match and returns the updated record', async () => {
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: true });
    vi.mocked(updateMatchStatus).mockResolvedValue({
      ...pendingMatch,
      status: 'completed',
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't-1',
      name: 'League',
      season_id: 's-1',
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(updateMatchStatus).toHaveBeenCalledWith('m-1', 'completed', 'p1', 'p2', undefined, 'pending_confirmation');
    expect(revalidateMatchPages).toHaveBeenCalledWith('t-1', 'm-1');
  });

  it('defaults to confirm action when action is not provided', async () => {
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: true });
    vi.mocked(updateMatchStatus).mockResolvedValue({
      ...pendingMatch,
      status: 'completed',
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't-1',
      name: 'League',
      season_id: 's-1',
    } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);

    const response = await POST(makeRequest({}), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(updateMatchStatus).toHaveBeenCalledWith('m-1', 'completed', 'p1', 'p2', undefined, 'pending_confirmation');
  });

  // ---- happy path: dispute ----

  it('disputes a match when action=dispute', async () => {
    vi.mocked(getMatchById).mockResolvedValue(pendingMatch as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: true });
    vi.mocked(updateMatchStatus).mockResolvedValue({
      ...pendingMatch,
      status: 'disputed',
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: 't-1',
      name: 'League',
      season_id: 's-1',
    } as never);

    const response = await POST(makeRequest({ action: 'dispute' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    // dispute -> no winner_id passed
    expect(updateMatchStatus).toHaveBeenCalledWith('m-1', 'disputed', undefined, 'p2', undefined, 'pending_confirmation');
  });

  it('returns early without finalizing when compare-and-set misses', async () => {
    const alreadyCompleted = { ...pendingMatch, status: 'completed' as const };
    vi.mocked(getMatchById)
      .mockResolvedValueOnce(pendingMatch as never)
      .mockResolvedValueOnce(alreadyCompleted as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: true });
    vi.mocked(updateMatchStatus).mockResolvedValue(null as never);

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.status).toBe('completed');
    expect(revalidateMatchPages).not.toHaveBeenCalled();
  });

  it('passes an updated winner onto finalize for in_progress force-complete', async () => {
    const inProgress = {
      ...pendingMatch,
      player_1_id: overridePlayerOneId,
      player_2_id: overridePlayerTwoId,
      status: 'in_progress' as const,
      winner_id: null,
      submitter_id: null,
    };
    vi.mocked(requirePlayer).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
    } as never);
    vi.mocked(getMatchById).mockResolvedValue(inProgress as never);
    vi.mocked(validateTransition).mockReturnValue({ valid: true });
    vi.mocked(updateMatchStatus).mockResolvedValue({
      ...inProgress,
      status: 'completed',
      winner_id: overridePlayerOneId,
    } as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: 't-1', name: 'League', season_id: 's-1' } as never);
    vi.mocked(getBattleStatsByMatch).mockResolvedValue({} as never);

    const response = await POST(
      makeRequest({ action: 'confirm', winner_id: overridePlayerOneId }),
      routeParams('m-1')
    );

    expect(response.status).toBe(200);
    expect(revalidateMatchPages).toHaveBeenCalledWith('t-1', 'm-1');
  });

  // ---- error handling ----

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getMatchById).mockRejectedValue(new Error('db'));

    const response = await POST(makeRequest({ action: 'confirm' }), routeParams('m-1'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});
