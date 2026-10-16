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

const P1_UUID = '00000000-0000-4000-8000-000000000001';
const P2_UUID = '00000000-0000-4000-8000-000000000002';

const mockPlayer = { playerId: 'player-1', isAdmin: true, isCreator: false };
const mockGame = { id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'p1' };
const mockMatch = {
  id: 'match-1',
  tournament_id: 'tourn-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  status: 'in_progress',
};
const routeParams = { params: Promise.resolve({ id: 'game-1' }) };

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
    expect(deleteGame).toHaveBeenCalledWith('game-1', 'player-1');
    expect(revalidateMatchPages).toHaveBeenCalledWith('tourn-1', 'match-1');
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
      game_id: 'game-1',
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
      game_id: 'game-1',
      winner_id: undefined,
      battle_stats: battleStats,
      admin_id: 'player-1',
    });
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
