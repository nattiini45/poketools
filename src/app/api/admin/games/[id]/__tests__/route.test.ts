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

vi.mock('@/lib/supabase/queries/games', () => ({
  getGameById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  deleteGame: vi.fn(),
  editGame: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { DELETE, PATCH } from '@/app/api/admin/games/[id]/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getGameById } from '@/lib/supabase/queries/games';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { deleteGame, editGame } from '@/lib/pkmn/game-pipeline';
import { revalidateMatchPages } from '@/lib/revalidation';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEvent } from '@/lib/audit/log';

const P1_UUID = '00000000-0000-4000-8000-000000000001';
const P2_UUID = '00000000-0000-4000-8000-000000000002';

const mockPlayer = { playerId: 'player-1', isAdmin: true, isCreator: false };
const mockGame = { id: '0fd91c32-fc35-40ed-8384-7e345468560c', match_id: 'match-1', game_number: 1, winner_id: 'p1' };
const mockMatch = {
  id: 'match-1',
  tournament_id: 'tourn-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  status: 'in_progress',
};
const routeParams = { params: Promise.resolve({ id: '0fd91c32-fc35-40ed-8384-7e345468560c' }) };

describe('DELETE /api/admin/games/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a game when user is site admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(deleteGame).mockResolvedValue({
      match_status: 'in_progress',
      games_remaining: 0,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.match_status).toBe('in_progress');
    expect(deleteGame).toHaveBeenCalledWith('0fd91c32-fc35-40ed-8384-7e345468560c', 'player-1');
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', 'match-1');
  });

  it('adds the reason to the game.delete audit metadata', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(deleteGame).mockResolvedValue({
      match_status: 'in_progress',
      games_remaining: 1,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = { json: async () => ({ reason: ' Duplicate replay ' }) } as NextRequest;
    const res = await DELETE(request, routeParams);

    expect(res.status).toBe(200);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('game.delete');
    expect(entry.metadata).toMatchObject({ match_id: 'match-1', games_remaining: 1, reason: 'Duplicate replay' });
  });

  it('still deletes with an empty or unreadable body and logs no reason', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(deleteGame).mockResolvedValue({
      match_status: 'in_progress',
      games_remaining: 0,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const unreadable = {
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    } as unknown as NextRequest;
    const res = await DELETE(unreadable, routeParams);

    expect(res.status).toBe(200);
    expect(deleteGame).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).not.toHaveProperty('reason');
  });

  it('rejects a blank reason with 400 and deletes nothing', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);

    const res = await DELETE({ json: async () => ({ reason: '  ' }) } as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(deleteGame).not.toHaveBeenCalled();
  });

  it('deletes a game when user is resource admin', async () => {
    const nonAdmin = { playerId: 'player-2', isAdmin: false, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(nonAdmin as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
    vi.mocked(deleteGame).mockResolvedValue({
      match_status: 'in_progress',
      games_remaining: 0,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(isResourceAdminFor).toHaveBeenCalledWith(
      'player-2',
      'tournament',
      'tourn-1'
    );
  });

  it('returns 404 when game not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(null as never);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Game not found', code: 'game_not_found' });
  });

  it('returns 404 when match not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Match not found', code: 'match_not_found' });
  });

  it('returns 403 when user has no admin access', async () => {
    const nonAdmin = { playerId: 'player-3', isAdmin: false, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(nonAdmin as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const request = {} as NextRequest;
    const res = await DELETE(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
  });

  it('delegates to safeErrorResponse on unexpected error', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new AuthError('Not authenticated', 401)
    );

    const request = {} as NextRequest;
    await DELETE(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/games/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('edits a game winner', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(editGame).mockResolvedValue({
      match_status: 'in_progress',
      match_winner_id: null,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = {
      json: vi.fn().mockResolvedValue({ winner_id: P2_UUID }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(editGame).toHaveBeenCalledWith({
      game_id: '0fd91c32-fc35-40ed-8384-7e345468560c',
      winner_id: P2_UUID,
      battle_stats: undefined,
      admin_id: 'player-1',
    });
  });

  it('edits game battle stats', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(editGame).mockResolvedValue({
      match_status: 'in_progress',
      match_winner_id: null,
      evolution_events: [],
    });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const battleStats = [
      { player_id: P1_UUID, pokemon_name: 'Pikachu', kos_dealt: 2 },
    ];
    const request = {
      json: vi.fn().mockResolvedValue({ battle_stats: battleStats }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(editGame).toHaveBeenCalledWith({
      game_id: '0fd91c32-fc35-40ed-8384-7e345468560c',
      winner_id: undefined,
      battle_stats: battleStats,
      admin_id: 'player-1',
    });
  });

  it('passes the version the editor loaded to editGame (optimistic concurrency)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(editGame).mockResolvedValue({ match_status: 'in_progress', match_winner_id: null, evolution_events: [] });
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);

    const request = {
      json: vi.fn().mockResolvedValue({ winner_id: P2_UUID, expected_updated_at: '2026-10-19T10:00:00.123456+00:00' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);

    expect(res.status).toBe(200);
    expect(editGame).toHaveBeenCalledWith(
      expect.objectContaining({ expected_updated_at: '2026-10-19T10:00:00.123456+00:00' }),
    );
  });

  it('rejects a malformed expected_updated_at with 400 before editing', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);

    const request = {
      json: vi.fn().mockResolvedValue({ winner_id: P2_UUID, expected_updated_at: 'yesterday' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(editGame).not.toHaveBeenCalled();
  });

  it('hands a stale-version refusal to safeErrorResponse with nothing audited or revalidated', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    const stale = Object.assign(new Error('stale'), { code: 'admin_game_edit_stale', statusCode: 409 });
    vi.mocked(editGame).mockRejectedValue(stale);

    const request = {
      json: vi.fn().mockResolvedValue({ winner_id: P2_UUID, expected_updated_at: '2026-10-19T10:00:00Z' }),
    } as unknown as NextRequest;

    await PATCH(request, routeParams);

    expect(safeErrorResponse).toHaveBeenCalledWith(stale, 'Failed to edit game');
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(revalidateMatchPages).not.toHaveBeenCalled();
  });

  it('returns 400 when neither winner_id nor battle_stats provided', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);

    const request = {
      json: vi.fn().mockResolvedValue({}),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'Provide winner_id and/or battle_stats to update',
      code: 'game_edit_empty',
    });
  });

  it('returns 404 when game not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(null as never);

    const request = {
      json: vi.fn().mockResolvedValue({ winner_id: 'p1' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Game not found', code: 'game_not_found' });
  });

  it('returns 403 when user has no admin access', async () => {
    const nonAdmin = { playerId: 'player-3', isAdmin: false, isCreator: false };
    vi.mocked(requirePlayer).mockResolvedValue(nonAdmin as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const request = {
      json: vi.fn().mockResolvedValue({ winner_id: 'p1' }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
  });
});

describe('admin game change with a concurrent match status change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
    vi.mocked(getGameById).mockResolvedValue(mockGame as never);
    vi.mocked(getMatchById).mockResolvedValue(mockMatch as never);
    vi.mocked(revalidateMatchPages).mockResolvedValue(undefined);
  });

  const conflictBody = {
    success: false,
    error: 'The game change was saved, but the match changed at the same moment, so its status was not re-evaluated. Reload the match and check its status.',
    code: 'admin_game_match_status_conflict',
  };

  it('DELETE audits the saved delete, revalidates, then answers 409', async () => {
    vi.mocked(deleteGame).mockResolvedValue({
      match_status: 'completed',
      match_status_conflict: true,
      games_remaining: 1,
      evolution_events: [],
    });

    const res = await DELETE({} as NextRequest, routeParams);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(conflictBody);
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', 'match-1');
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'game.delete',
      metadata: expect.objectContaining({ match_status_conflict: true }),
    }));
  });

  it('PATCH audits the saved edit, revalidates, then answers 409', async () => {
    vi.mocked(editGame).mockResolvedValue({
      match_status: 'completed',
      match_winner_id: 'p1',
      match_status_conflict: true,
      evolution_events: [],
    });
    const request = {
      json: vi.fn().mockResolvedValue({ winner_id: P2_UUID }),
    } as unknown as NextRequest;

    const res = await PATCH(request, routeParams);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(conflictBody);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'game.edit',
      metadata: expect.objectContaining({ match_status: 'completed', match_status_conflict: true }),
    }));
  });

  it('omits the conflict flag from the audit when the status write landed', async () => {
    vi.mocked(deleteGame).mockResolvedValue({
      match_status: 'in_progress',
      games_remaining: 1,
      evolution_events: [],
    });

    const res = await DELETE({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    const [event] = vi.mocked(logAuditEvent).mock.calls[0];
    expect(event.metadata).not.toHaveProperty('match_status_conflict');
  });
});
