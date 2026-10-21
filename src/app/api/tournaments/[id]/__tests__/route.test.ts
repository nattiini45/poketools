import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  updateTournament: vi.fn(),
  deleteTournament: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterTournamentDelete: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: vi.fn(),
}));

// --------------- imports (after mocks) ---------------

import { GET, PATCH, DELETE } from '@/app/api/tournaments/[id]/route';
import { requireAdmin, requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getTournamentById,
  getTournamentWithDetails,
  updateTournament,
  deleteTournament,
  getParticipants,
} from '@/lib/supabase/queries/tournaments';
import { rebuildAfterTournamentDelete } from '@/lib/reconcile/entity-delete-rebuild';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { logAuditEvent as _logAuditEvent } from '@/lib/audit/log';
import { revalidateTag } from 'next/cache';

// --------------- helpers ---------------

const routeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const baseTournament = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Open League',
  status: 'active' as const,
  season_id: 's-1',
  bracket_type: 'swiss',
  current_round: 2,
};

const mockAdmin = {
  playerId: 'p-1',
  name: 'Admin User',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: 'admin',
  championsUsername: null,
  avatarUrl: null,
};

// --------------- GET ---------------

describe('GET /api/tournaments/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tournament details for a valid id', async () => {
    const details = { ...baseTournament, participants: [], rounds: [] };
    vi.mocked(getTournamentWithDetails).mockResolvedValue(details as never);

    const request = {} as NextRequest;
    const response = await GET(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('returns 404 when tournament does not exist', async () => {
    vi.mocked(getTournamentWithDetails).mockResolvedValue(null as never);

    const request = {} as NextRequest;
    const response = await GET(request, routeParams('99999999-9999-4999-8999-999999999999'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('not found');
    expect(payload.code).toBe('tournament_not_found');
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getTournamentWithDetails).mockRejectedValue(new Error('boom'));

    const request = {} as NextRequest;
    const response = await GET(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});

// --------------- PATCH ---------------

describe('PATCH /api/tournaments/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: auth passes with a mock admin player
    vi.mocked(requireResourceAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getTournamentById).mockResolvedValue(baseTournament as never);
  });

  it('returns auth error when not a resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Renamed' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
  });

  it('updates a tournament and returns the result', async () => {
    const updated = { ...baseTournament, name: 'Renamed' };
    vi.mocked(updateTournament).mockResolvedValue(updated as never);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Renamed' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(requireResourceAdmin).toHaveBeenCalledWith('tournament', '22222222-2222-4222-8222-222222222222');
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.name).toBe('Renamed');
    // D37: the tournament and its league show the change on the next view.
    expect(revalidateTag).toHaveBeenCalledWith('tournament:22222222-2222-4222-8222-222222222222', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('season:s-1', { expire: 0 });
    expect(vi.mocked(updateTournament).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(revalidateTag).mock.invocationCallOrder[0],
    );
  });

  it('emits Discord and social events on status transition to completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'active',
    } as never);
    vi.mocked(updateTournament).mockResolvedValue({
      ...baseTournament,
      status: 'completed',
    } as never);

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'completed' }),
    } as unknown as NextRequest;

    await PATCH(request, routeParams('22222222-2222-4222-8222-222222222222'));

    expect(emitDiscordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'tournament_completed' })
    );
    expect(emitSocialEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'tournament_completed' })
    );
  });

  it('does NOT emit events when status is unchanged', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'active',
    } as never);
    vi.mocked(updateTournament).mockResolvedValue(baseTournament as never);

    const request = {
      json: vi.fn().mockResolvedValue({ status: 'active' }),
    } as unknown as NextRequest;

    await PATCH(request, routeParams('22222222-2222-4222-8222-222222222222'));

    expect(emitDiscordEvent).not.toHaveBeenCalled();
    expect(emitSocialEvent).not.toHaveBeenCalled();
  });

  it('does NOT emit events when status is not in the body', async () => {
    vi.mocked(updateTournament).mockResolvedValue(baseTournament as never);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'New Name' }),
    } as unknown as NextRequest;

    await PATCH(request, routeParams('22222222-2222-4222-8222-222222222222'));

    expect(getTournamentById).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    expect(emitDiscordEvent).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(updateTournament).mockRejectedValue(new Error('db'));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'x' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});

// --------------- DELETE ---------------

describe('DELETE /api/tournaments/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: auth passes with a mock admin player
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(getParticipants).mockResolvedValue([] as never);
    vi.mocked(rebuildAfterTournamentDelete).mockResolvedValue({
      scope: 'tournament',
      playerIds: [],
      ratingsRebuilt: 0,
      streaksRebuilt: 0,
      tournamentScopeCleared: { aggregatesDeleted: 0, playerAggregatesDeleted: 0 },
      leagueScope: null,
      allTime: { gamesProcessed: 0, aggregatesDeleted: 0, playerAggregatesDeleted: 0 },
      evolutionRepair: null,
    } as never);
  });

  it('returns auth error when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const request = {} as NextRequest;
    const response = await DELETE(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
  });

  it('deletes a tournament and returns success', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(baseTournament as never);
    vi.mocked(deleteTournament).mockResolvedValue(undefined as never);

    const request = {} as NextRequest;
    const response = await DELETE(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(requireAdmin).toHaveBeenCalled();
    expect(deleteTournament).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({ rebuild_warning: null });
    expect(revalidateTag).toHaveBeenCalledWith('tournament:22222222-2222-4222-8222-222222222222', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('season:s-1', { expire: 0 });
  });

  it('captures participants before the delete and rebuilds derived data afterwards', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(baseTournament as never);
    vi.mocked(deleteTournament).mockResolvedValue(undefined as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1', name: 'One' },
      { id: 'p2', name: 'Two' },
    ] as never);

    const request = {} as NextRequest;
    const response = await DELETE(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);

    // Participants are captured BEFORE the cascade removes the rows.
    expect(getParticipants).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    expect(vi.mocked(getParticipants).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deleteTournament).mock.invocationCallOrder[0]
    );

    // Rebuild runs after the delete committed, with the captured players.
    expect(rebuildAfterTournamentDelete).toHaveBeenCalledWith({
      tournamentId: '22222222-2222-4222-8222-222222222222',
      seasonId: 's-1',
      playerIds: ['p1', 'p2'],
    });
    expect(vi.mocked(rebuildAfterTournamentDelete).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(deleteTournament).mock.invocationCallOrder[0]
    );

    // The audit entry records the rebuild summary.
    expect(_logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tournament.delete',
        metadata: expect.objectContaining({
          season_id: 's-1',
          rebuild: expect.objectContaining({ scope: 'tournament' }),
          rebuild_error: null,
        }),
      })
    );
  });

  it('still returns success when the derived-data rebuild fails (the delete already committed)', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(baseTournament as never);
    vi.mocked(deleteTournament).mockResolvedValue(undefined as never);
    vi.mocked(rebuildAfterTournamentDelete).mockRejectedValue(new Error('rebuild blew up'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const request = {} as NextRequest;
      const response = await DELETE(request, routeParams('22222222-2222-4222-8222-222222222222'));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      // The admin sees the failure (catalogued code), the internals stay in the log.
      expect(payload.data.rebuild_warning).toEqual({
        code: 'derived_data_rebuild_failed',
        error: expect.stringContaining('rebuilding the derived data'),
      });
      expect(JSON.stringify(payload)).not.toContain('rebuild blew up');
      // The original error is logged server-side, never masked.
      expect(errorSpy).toHaveBeenCalled();
      // The audit entry flags the failed rebuild for the §28 audit to pick up.
      expect(_logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tournament.delete',
          metadata: expect.objectContaining({ rebuild_error: 'derived_data_rebuild_failed' }),
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('records the distinct cause when the rebuild refuses with a catalog code', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(baseTournament as never);
    vi.mocked(deleteTournament).mockResolvedValue(undefined as never);
    vi.mocked(rebuildAfterTournamentDelete).mockRejectedValue(
      new UserFacingError('Rating history has gaps that no rebuild order can fill', {
        code: 'rating_history_incomplete',
        params: { count: 1, players: 'Alice, Bob' },
        status: 409,
      })
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await DELETE({} as NextRequest, routeParams('22222222-2222-4222-8222-222222222222'));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.data.rebuild_warning).toEqual({
        code: 'rating_history_incomplete',
        error: 'Rating history has gaps that no rebuild order can fill',
        params: { count: 1, players: 'Alice, Bob' },
      });
      expect(errorSpy).toHaveBeenCalled();
      expect(_logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tournament.delete',
          metadata: expect.objectContaining({ rebuild_error: 'rating_history_incomplete' }),
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(deleteTournament).mockRejectedValue(new Error('fk constraint'));

    const request = {} as NextRequest;
    const response = await DELETE(request, routeParams('22222222-2222-4222-8222-222222222222'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});