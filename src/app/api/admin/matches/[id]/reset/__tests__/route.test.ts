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
  return {
    requirePlayer: vi.fn(),
    AuthError,
  };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  resetMatch: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/admin/matches/[id]/reset/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import { revalidateMatchPages } from '@/lib/revalidation';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEvent } from '@/lib/audit/log';

const mockPlayer = { playerId: 'player-1', isAdmin: true, isCreator: false };
const mockMatch = {
  id: 'daa274a2-59da-43fd-84a5-8cede96e15a4',
  tournament_id: 'tourn-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  status: 'completed',
  winner_id: 'p1',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
};
const routeParams = { params: Promise.resolve({ id: 'daa274a2-59da-43fd-84a5-8cede96e15a4' }) };

describe('POST /api/admin/matches/[id]/reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets a match when user is site admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(resetMatch).mockResolvedValue({
      games_deleted: 2,
      has_downstream_matches: false,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.games_deleted).toBe(2);
    expect(resetMatch).toHaveBeenCalledWith('daa274a2-59da-43fd-84a5-8cede96e15a4', 'player-1', false);
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', 'daa274a2-59da-43fd-84a5-8cede96e15a4');
  });

  it('threads cascade: true through to resetMatch', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(resetMatch).mockResolvedValue({
      games_deleted: 2,
      has_downstream_matches: true,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({ cascade: true }) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(resetMatch).toHaveBeenCalledWith('daa274a2-59da-43fd-84a5-8cede96e15a4', 'player-1', true);
  });

  it('records the recalculation summary in the audit metadata and returns it (spec §24)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(resetMatch).mockResolvedValue({
      games_deleted: 2,
      has_downstream_matches: true,
      evolution_events: [],
      childrenCleanup: {
        matchPrepTeamsDeleted: 1,
        matchProposalsDeleted: 2,
        broadcastMomentsDeleted: 3,
        animationViewsDeleted: 0,
        teamPointersCleared: 1,
        castSessionPointersCleared: 1,
        agentSuggestionPointersCleared: 0,
        socialImageCleared: true,
      },
      impossibleLineups: [
        { matchId: 'match-later', playerId: 'p1', basePokemon: 'eevee',
          snapshotStage: 2, rebuiltMaxStageByMatchday: 1, matchday: 3 },
      ],
      recalculation: {
        gamesDeleted: 2,
        childrenCleanup: {
          matchPrepTeamsDeleted: 1,
          matchProposalsDeleted: 2,
          broadcastMomentsDeleted: 3,
          animationViewsDeleted: 0,
          teamPointersCleared: 1,
          castSessionPointersCleared: 1,
          agentSuggestionPointersCleared: 0,
          socialImageCleared: true,
        },
        ratingsRebuilt: { players: ['p1', 'p2'] },
        evolutionRepaired: {
          trackersUpdated: 3,
          eventsRewritten: 7,
          evolutionPoints: 5,
          impossibleLineups: [
            { matchId: 'match-later', playerId: 'p1', basePokemon: 'eevee',
              snapshotStage: 2, rebuiltMaxStageByMatchday: 1, matchday: 3 },
          ],
        },
        impossibleLineups: [
          { matchId: 'match-later', playerId: 'p1', basePokemon: 'eevee',
            snapshotStage: 2, rebuiltMaxStageByMatchday: 1, matchday: 3 },
        ],
      },
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    // The recalculation summary flows through to the response unchanged.
    expect(body.success).toBe(true);
    expect(body.data.recalculation).toBeDefined();
    expect(body.data.recalculation.gamesDeleted).toBe(2);
    expect(body.data.recalculation.ratingsRebuilt.players).toEqual(['p1', 'p2']);

    // The audit metadata captures the recalculation fields (counts only — the
    // impossible-lineups array is reduced to a length for the log).
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.metadata).toMatchObject({
      games_deleted: 2,
      has_downstream_matches: true,
      recalculation: {
        gamesDeleted: 2,
        ratingsRebuiltPlayers: 2,
        evolutionRepaired: {
          trackersUpdated: 3,
          eventsRewritten: 7,
          evolutionPoints: 5,
          impossibleLineups: 1,
        },
        impossibleLineups: 1,
      },
    });
  });

  it('adds the reason to the match.reset audit metadata', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(resetMatch).mockResolvedValue({
      games_deleted: 1,
      has_downstream_matches: false,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({ cascade: true, reason: '  Wrong replay was submitted  ' }) } as NextRequest;
    const res = await POST(request, routeParams);

    expect(res.status).toBe(200);
    expect(resetMatch).toHaveBeenCalledWith('daa274a2-59da-43fd-84a5-8cede96e15a4', 'player-1', true);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.metadata).toMatchObject({ cascade: true, reason: 'Wrong replay was submitted' });
  });

  it('omits the reason key from the audit metadata when none is given', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(resetMatch).mockResolvedValue({
      games_deleted: 1,
      has_downstream_matches: false,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const res = await POST({ json: async () => ({}) } as NextRequest, routeParams);

    expect(res.status).toBe(200);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.metadata).not.toHaveProperty('reason');
  });

  it('rejects a blank reason with 400 before resetting anything', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);

    const res = await POST({ json: async () => ({ reason: '   ' }) } as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(resetMatch).not.toHaveBeenCalled();
  });

  it('resets a match when user is resource admin', async () => {
    const nonAdmin = { playerId: 'player-2', isAdmin: false, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(nonAdmin as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
    vi.mocked(resetMatch).mockResolvedValue({
      games_deleted: 2,
      has_downstream_matches: false,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(isResourceAdminFor).toHaveBeenCalledWith(
      'player-2',
      'tournament',
      'tourn-1'
    );
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Match not found', code: 'match_not_found' });
  });

  it('returns 403 when user has no admin access', async () => {
    const nonAdmin = { playerId: 'player-3', isAdmin: false, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(nonAdmin as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const request = { json: async () => ({}) } as NextRequest;
    const res = await POST(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
  });

  it('returns auth error when not logged in', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new AuthError('Not authenticated', 401)
    );

    const request = {} as NextRequest;
    await POST(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
