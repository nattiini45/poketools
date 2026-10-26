import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Player } from '@/types/player';

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  isSuperadmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerById: vi.fn(),
  updatePlayer: vi.fn(),
  deletePlayer: vi.fn(),
  getPlayerCompetitiveRefs: vi.fn(),
}));

const { authAdminDeleteUser } = vi.hoisted(() => ({ authAdminDeleteUser: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { admin: { deleteUser: authAdminDeleteUser } } },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { GET, PATCH, DELETE } from '@/app/api/players/[id]/route';
import { revalidateTag } from 'next/cache';
import { requireAuth, requireAdmin, isSuperadmin, AuthError } from '@/lib/auth/helpers';
import {
  getPlayerById,
  updatePlayer,
  deletePlayer,
  getPlayerCompetitiveRefs,
} from '@/lib/supabase/queries/players';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';

/** The tags a player write expires (D37): every read embedding a player, and this player's own. */
function expectPlayerReadsExpired(playerId: string) {
  expect(revalidateTag).toHaveBeenCalledWith('players', { expire: 0 });
  expect(revalidateTag).toHaveBeenCalledWith(`player:${playerId}`, { expire: 0 });
}

const mockPlayer: Player = {
  id: '51541de2-cef5-42ee-8563-d412cf4563a2',
  name: 'Ash',
  discord_id: '123456789',
  auth_user_id: null,
  ps_username: 'AshPS',
  champions_username: '',
  is_admin: false,
  is_creator: false,
  is_test_account: false,
  is_guest: false,
  status: 'active',
  suspended_until: null,
  ban_reason: null,
  joined_date: null,
  avatar_url: null,
  avatar_config: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const makeRouteArgs = (id: string) => ({ params: Promise.resolve({ id }) });

const selfSession = {
  user: { id: 'discord-user-1' },
  player: {
    playerId: '51541de2-cef5-42ee-8563-d412cf4563a2',
    name: 'Ash',
    isAdmin: false,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: 'AshPS',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  } as const,
  expires: '2027-01-01T00:00:00.000Z',
};

const adminSession = {
  user: { id: 'discord-admin-1' },
  player: {
    playerId: 'admin-1',
    name: 'Admin',
    isAdmin: true,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  } as const,
  expires: '2027-01-01T00:00:00.000Z',
};

const otherSession = {
  user: { id: 'discord-other-1' },
  player: {
    playerId: 'other-1',
    name: 'Other',
    isAdmin: false,
    isResourceAdmin: false,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  } as const,
  expires: '2027-01-01T00:00:00.000Z',
};

describe('GET /api/players/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 404 when player not found', async () => {
    vi.mocked(requireAuth).mockResolvedValue(selfSession);
    vi.mocked(getPlayerById).mockResolvedValue(null);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('504f761c-34b4-4d69-82e3-2a199b24ba7b'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Player not found');
    expect(body.code).toBe('player_not_found');
  });

  it('returns full player data for self', async () => {
    vi.mocked(requireAuth).mockResolvedValue(selfSession);
    vi.mocked(getPlayerById).mockResolvedValue(mockPlayer);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockPlayer);
    expect(body.data.discord_id).toBe('123456789');
  });

  it('returns full player data for admin', async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(getPlayerById).mockResolvedValue(mockPlayer);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.discord_id).toBe('123456789');
  });

  it('redacts discord_id for other players', async () => {
    vi.mocked(requireAuth).mockResolvedValue(otherSession);
    vi.mocked(getPlayerById).mockResolvedValue(mockPlayer);

    const request = {} as unknown as NextRequest;
    const response = await GET(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.discord_id).toBeUndefined();
    expect(body.data.name).toBe('Ash');
  });

  it('another player gets exactly the PublicPlayer card', async () => {
    vi.mocked(requireAuth).mockResolvedValue(otherSession);
    vi.mocked(getPlayerById).mockResolvedValue(fullPlayerRow({ id: '51541de2-cef5-42ee-8563-d412cf4563a2', name: 'Ash' }));

    const response = await GET({} as unknown as NextRequest, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(Object.keys(body.data).sort()).toEqual(
      ['avatar_url', 'champions_username', 'id', 'is_creator', 'is_guest', 'joined_date', 'name', 'ps_username'],
    );
  });

  it('the non-self response carries no private player column (JSON.stringify check)', async () => {
    vi.mocked(requireAuth).mockResolvedValue(otherSession);
    vi.mocked(getPlayerById).mockResolvedValue(fullPlayerRow({ id: '51541de2-cef5-42ee-8563-d412cf4563a2', name: 'Ash' }));

    const response = await GET({} as unknown as NextRequest, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));

    expectNoPrivatePlayerData(await response.json());
  });
});

describe('PATCH /api/players/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAuth).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ ps_username: 'NewName' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('returns 403 when non-admin edits another player', async () => {
    vi.mocked(requireAuth).mockResolvedValue(otherSession);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Hacked' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Not authorized to update this player');
    expect(body.code).toBe('player_update_forbidden');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('non-admin can only update ps_username and champions_username', async () => {
    const updated = { ...mockPlayer, ps_username: 'NewPS' };
    vi.mocked(requireAuth).mockResolvedValue(selfSession);
    vi.mocked(updatePlayer).mockResolvedValue(updated);

    const request = {
      json: vi.fn().mockResolvedValue({ ps_username: 'NewPS', name: 'HackedName', is_admin: true }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    // Only ps_username should be passed (name and is_admin stripped)
    expect(vi.mocked(updatePlayer)).toHaveBeenCalledWith('51541de2-cef5-42ee-8563-d412cf4563a2', { ps_username: 'NewPS' });
    // The profile card shows the usernames from the public read cache.
    expectPlayerReadsExpired('51541de2-cef5-42ee-8563-d412cf4563a2');
  });

  it('admin can update any field', async () => {
    const updated = { ...mockPlayer, name: 'Renamed' };
    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(updatePlayer).mockResolvedValue(updated);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Renamed' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(updatePlayer)).toHaveBeenCalledWith('51541de2-cef5-42ee-8563-d412cf4563a2', { name: 'Renamed' });
    // A rename shows on the next view of every cached read that embeds the name.
    expectPlayerReadsExpired('51541de2-cef5-42ee-8563-d412cf4563a2');
  });

  it('expires nothing when the update fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(updatePlayer).mockRejectedValue(new Error('db down'));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Renamed' }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));

    expect(response.status).toBe(500);
    expect(revalidateTag).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('returns 403 when non-superadmin tries to set is_creator', async () => {
    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(isSuperadmin).mockReturnValue(false);

    const request = {
      json: vi.fn().mockResolvedValue({ is_creator: true }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Only the superadmin can manage creator status');
    expect(body.code).toBe('creator_status_superadmin_only');
  });

  it('superadmin can set is_creator', async () => {
    const updated = { ...mockPlayer, is_creator: true };
    vi.mocked(requireAuth).mockResolvedValue(adminSession);
    vi.mocked(isSuperadmin).mockReturnValue(true);
    vi.mocked(updatePlayer).mockResolvedValue(updated);

    const request = {
      json: vi.fn().mockResolvedValue({ is_creator: true }),
    } as unknown as NextRequest;

    const response = await PATCH(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(updatePlayer)).toHaveBeenCalledWith('51541de2-cef5-42ee-8563-d412cf4563a2', { is_creator: true });
  });
});

describe('DELETE /api/players/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy path: player exists and has no competitive references.
    vi.mocked(getPlayerById).mockResolvedValue(mockPlayer);
    vi.mocked(getPlayerCompetitiveRefs).mockResolvedValue({ matches: 0, proposals: 0, leagueHistory: 0, activeDrafts: 0, trashedLeagues: 0 });
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it('deletes player and returns null data', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(deletePlayer).mockResolvedValue(undefined);

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(vi.mocked(deletePlayer)).toHaveBeenCalledWith('51541de2-cef5-42ee-8563-d412cf4563a2');
    // The directory, leaderboards and rosters drop the player on the next view.
    expectPlayerReadsExpired('51541de2-cef5-42ee-8563-d412cf4563a2');
  });

  it('returns 404 when the player does not exist', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(getPlayerById).mockResolvedValue(null);

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('3487bc94-5a0f-4486-8589-93a155a05a3f'));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(vi.mocked(deletePlayer)).not.toHaveBeenCalled();
  });

  it('returns 409 when the player has match history', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(getPlayerCompetitiveRefs).mockResolvedValue({ matches: 3, proposals: 0, leagueHistory: 0, activeDrafts: 0, trashedLeagues: 0 });

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('match history');
    expect(body.code).toBe('player_has_match_history');
    expect(body.params).toEqual({ count: 3 });
    expect(vi.mocked(deletePlayer)).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns 409 when the player has match proposals but no matches', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(getPlayerCompetitiveRefs).mockResolvedValue({ matches: 0, proposals: 1, leagueHistory: 0, activeDrafts: 0, trashedLeagues: 0 });

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));

    expect(response.status).toBe(409);
    expect(vi.mocked(deletePlayer)).not.toHaveBeenCalled();
  });

  it('returns a coded 409 when the player has EvoLiga/EPB history and no matches', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(getPlayerCompetitiveRefs).mockResolvedValue({ matches: 0, proposals: 0, leagueHistory: 2, activeDrafts: 0, trashedLeagues: 0 });

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe('player_still_referenced');
    expect(vi.mocked(deletePlayer)).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns the same coded 409 when the player appears in a league in the trash', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(getPlayerCompetitiveRefs).mockResolvedValue({
      matches: 0,
      proposals: 0,
      leagueHistory: 0,
      activeDrafts: 0,
      trashedLeagues: 1,
    });

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('player_still_referenced');
    expect(vi.mocked(deletePlayer)).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns a coded 409 when the player is seated in an unfinished queue draft', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(getPlayerCompetitiveRefs).mockResolvedValue({ matches: 0, proposals: 0, leagueHistory: 0, activeDrafts: 1, trashedLeagues: 0 });

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe('player_in_active_draft');
    expect(body.error).toContain('unfinished draft');
    expect(vi.mocked(deletePlayer)).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('maps a residual foreign-key violation (23503) to 409, not 500', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(deletePlayer).mockRejectedValue(
      Object.assign(new Error('update or delete violates foreign key constraint'), { code: '23503' }),
    );

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain('still reference');
    expect(body.code).toBe('player_still_referenced');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('maps the foreign key of a league that reached the trash after the pre-check to the same coded 409', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(deletePlayer).mockRejectedValue({
      code: '23503',
      message:
        'update or delete on table "players" violates foreign key constraint "league_trash_players_player_id_fkey" on table "league_trash_players"',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await DELETE({} as unknown as NextRequest, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.code).toBe('player_still_referenced');
      expect(body.error).toContain('still reference');
      expect(revalidateTag).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(deletePlayer).mockRejectedValue(new Error('FK constraint'));

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to delete player');
  });

  it('cascades deletion to the linked Supabase Auth user', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(getPlayerById).mockResolvedValue({ ...mockPlayer, auth_user_id: 'auth-9' });
    vi.mocked(deletePlayer).mockResolvedValue(undefined);
    authAdminDeleteUser.mockResolvedValue({ data: {}, error: null });

    const request = {} as unknown as NextRequest;
    const response = await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));

    expect(response.status).toBe(200);
    expect(authAdminDeleteUser).toHaveBeenCalledWith('auth-9');
  });

  it('does not call the auth admin API when no auth user is linked', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(adminSession.player);
    vi.mocked(getPlayerById).mockResolvedValue({ ...mockPlayer, auth_user_id: null });
    vi.mocked(deletePlayer).mockResolvedValue(undefined);

    const request = {} as unknown as NextRequest;
    await DELETE(request, makeRouteArgs('51541de2-cef5-42ee-8563-d412cf4563a2'));

    expect(authAdminDeleteUser).not.toHaveBeenCalled();
  });
});
