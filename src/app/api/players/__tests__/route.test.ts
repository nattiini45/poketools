import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Player } from '@/types/player';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  listPlayers: vi.fn(),
  createPlayer: vi.fn(),
}));

import { GET, POST } from '@/app/api/players/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { listPlayers, createPlayer } from '@/lib/supabase/queries/players';

const mockPlayer: Player = {
  id: 'player-1',
  name: 'Ash',
  discord_id: '111111111111111111',
  auth_user_id: null,
  ps_username: 'AshPS',
  champions_username: '',
  is_admin: false,
  is_creator: false,
  is_guest: false,
  is_test_account: false,
  joined_date: null,
  avatar_url: null,
  avatar_config: null,
  status: 'active',
  suspended_until: null,
  ban_reason: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/players', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401));

    const url = new URL('http://localhost:3000/api/players');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403));

    const url = new URL('http://localhost:3000/api/players');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Admin access required');
  });

  it('returns player list with defaults', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: false,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active' as const,
    });
    vi.mocked(listPlayers).mockResolvedValue({ data: [mockPlayer], total: 1 });

    const url = new URL('http://localhost:3000/api/players');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockPlayer]);
    expect(body.total).toBe(1);
    expect(vi.mocked(listPlayers)).toHaveBeenCalledWith({ limit: 50, offset: 0, search: undefined });
  });

  it('passes search params to listPlayers', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: false,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active' as const,
    });
    vi.mocked(listPlayers).mockResolvedValue({ data: [], total: 0 });

    const url = new URL('http://localhost:3000/api/players?limit=10&offset=5&search=ash');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(vi.mocked(listPlayers)).toHaveBeenCalledWith({ limit: 10, offset: 5, search: 'ash' });
  });

  it('rejects an over-long search term with validation_failed', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: false,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active' as const,
    });

    const url = new URL(`http://localhost:3000/api/players?search=${'a'.repeat(101)}`);
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(vi.mocked(listPlayers)).not.toHaveBeenCalled();
  });

  describe('sorting', () => {
    const admin = {
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: false,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active' as const,
    };

    function get(query: string) {
      const request = { url: `http://localhost:3000/api/players${query}` } as unknown as NextRequest;
      return GET(request);
    }

    beforeEach(() => {
      vi.mocked(requireAdmin).mockResolvedValue(admin);
      vi.mocked(listPlayers).mockResolvedValue({ data: [], total: 0 });
    });

    it('leaves the order to the query default (name ascending) without sort or dir', async () => {
      await get('');

      expect(vi.mocked(listPlayers).mock.calls[0][0]?.sort).toBeUndefined();
    });

    it.each(['name', 'discord_id', 'ps_username', 'status'])('passes sort=%s with its direction', async (column) => {
      const response = await get(`?sort=${column}&dir=desc&search=ash&limit=20&offset=40`);

      expect(response.status).toBe(200);
      expect(vi.mocked(listPlayers)).toHaveBeenCalledWith({
        limit: 20,
        offset: 40,
        search: 'ash',
        sort: { column, direction: 'desc' },
      });
    });

    it('defaults the direction to ascending and the column to name', async () => {
      await get('?sort=status');
      await get('?dir=desc');

      expect(vi.mocked(listPlayers).mock.calls[0][0]?.sort).toEqual({ column: 'status', direction: 'asc' });
      expect(vi.mocked(listPlayers).mock.calls[1][0]?.sort).toEqual({ column: 'name', direction: 'desc' });
    });

    it.each([
      ['a column outside the whitelist', '?sort=is_admin'],
      ['a column the table does not have', '?sort=password'],
      ['an injected order expression', '?sort=name.desc,id'],
      ['an unknown direction', '?sort=name&dir=sideways'],
      ['an empty sort', '?sort='],
    ])('rejects %s with validation_failed', async (_label, query) => {
      const response = await get(query);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.code).toBe('validation_failed');
      expect(vi.mocked(listPlayers)).not.toHaveBeenCalled();
    });
  });

  it('returns the exact total so the caller can page past the first window', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: false,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active' as const,
    });
    vi.mocked(listPlayers).mockResolvedValue({ data: [mockPlayer], total: 137 });

    const url = new URL('http://localhost:3000/api/players?limit=50&offset=100');
    const request = { url: url.toString() } as unknown as NextRequest;

    const body = await (await GET(request)).json();

    expect(body.total).toBe(137);
    expect(vi.mocked(listPlayers)).toHaveBeenCalledWith({ limit: 50, offset: 100, search: undefined });
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: false,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active' as const,
    });
    vi.mocked(listPlayers).mockRejectedValue(new Error('DB error'));

    const url = new URL('http://localhost:3000/api/players');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch players');
  });
});

describe('POST /api/players', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
      isAdmin: true,
      isResourceAdmin: false,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active' as const,
    });
  });

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Ash', discord_id: '123' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('returns 400 when name is missing', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ discord_id: '111111111111111111' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid input');
    expect(body.code).toBe('validation_failed');
  });

  it('returns 400 when discord_id is missing for registered player', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Ash' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Invalid input');
    expect(body.code).toBe('validation_failed');
  });

  it('creates guest player without discord_id', async () => {
    const guest = { ...mockPlayer, discord_id: null, is_guest: true };
    vi.mocked(createPlayer).mockResolvedValue(guest);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Guest Ash', is_guest: true }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(createPlayer).toHaveBeenCalledWith({ name: 'Guest Ash', is_guest: true });
  });

  it('strips an identity sent alongside is_guest (a guest is created without one)', async () => {
    const guest = { ...mockPlayer, discord_id: null, is_guest: true };
    vi.mocked(createPlayer).mockResolvedValue(guest);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Guest Ash', is_guest: true, discord_id: '111111111111111111' }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(createPlayer).toHaveBeenCalledWith({ name: 'Guest Ash', is_guest: true });
  });

  it('returns the coded identity error instead of the generic failure', async () => {
    const { UserFacingError } = await import('@/lib/api/user-facing-error');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createPlayer).mockRejectedValue(
      new UserFacingError('A registered player needs a Discord ID or a linked account. Only guests may have neither.', {
        code: 'player_identity_required',
        status: 400,
      }),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Guest Ash', is_guest: true }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('player_identity_required');
    expect(body.error).not.toBe('Failed to create player');
  });

  it('returns 409 player_identity_taken for a Discord ID that is already linked', async () => {
    const { UserFacingError } = await import('@/lib/api/user-facing-error');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createPlayer).mockRejectedValue(
      new UserFacingError('This Discord ID or account already belongs to another player.', {
        code: 'player_identity_taken',
        status: 409,
      }),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Ash', discord_id: '111111111111111111' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('player_identity_taken');
  });

  it('creates player and returns 201', async () => {
    vi.mocked(createPlayer).mockResolvedValue(mockPlayer);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Ash', discord_id: '111111111111111111' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(mockPlayer);
    expect(vi.mocked(createPlayer)).toHaveBeenCalledWith({ name: 'Ash', discord_id: '111111111111111111' });
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(createPlayer).mockRejectedValue(new Error('Duplicate discord_id'));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Ash', discord_id: '111111111111111111' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to create player');
  });
});
