import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Supabase mock ──────────────────────────────────────────────────
const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'select', 'eq']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import {
  SESSION_PLAYER_COLUMNS,
  getSessionPlayerRowByIdentity,
  toSessionPlayer,
} from '../players';
import type { SessionPlayer } from '@/types/auth';

const dbRow = {
  id: 'p-1',
  name: 'Ash',
  is_admin: false,
  is_creator: true,
  ps_username: 'ash_ps',
  champions_username: 'ash_ch',
  avatar_url: 'https://example.test/ash.png',
  status: 'active',
  resource_admins: [{ count: 3 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of ['from', 'select', 'eq']) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
});

describe('SESSION_PLAYER_COLUMNS', () => {
  it('lists explicit columns only, with the resource_admins count embedded', () => {
    expect(SESSION_PLAYER_COLUMNS).not.toContain('*');
    expect(SESSION_PLAYER_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'id',
      'name',
      'is_admin',
      'is_creator',
      'ps_username',
      'champions_username',
      'avatar_url',
      'status',
      'resource_admins(count)',
    ]);
  });

  it('never selects identity or moderation columns', () => {
    for (const column of ['discord_id', 'auth_user_id', 'ban_reason', 'suspended_until', 'is_test_account', 'avatar_config']) {
      expect(SESSION_PLAYER_COLUMNS).not.toContain(column);
    }
  });
});

describe('getSessionPlayerRowByIdentity', () => {
  it('reads a Discord identity by discord_id in one query with the explicit columns', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: dbRow, error: null });

    const row = await getSessionPlayerRowByIdentity('discord', 'snowflake-1');

    expect(mockBuilder.from).toHaveBeenCalledTimes(1);
    expect(mockBuilder.from).toHaveBeenCalledWith('players');
    expect(mockBuilder.select).toHaveBeenCalledWith(SESSION_PLAYER_COLUMNS);
    expect(mockBuilder.eq).toHaveBeenCalledWith('discord_id', 'snowflake-1');
    expect(row).toEqual({
      id: 'p-1',
      name: 'Ash',
      is_admin: false,
      is_creator: true,
      ps_username: 'ash_ps',
      champions_username: 'ash_ch',
      avatar_url: 'https://example.test/ash.png',
      status: 'active',
      resource_admin_count: 3,
    });
  });

  it('reads a credentials identity by auth_user_id', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: dbRow, error: null });
    await getSessionPlayerRowByIdentity('credentials', 'auth-uuid-1');
    expect(mockBuilder.eq).toHaveBeenCalledWith('auth_user_id', 'auth-uuid-1');
  });

  it('counts zero when the player holds no resource_admins rows', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({
      data: { ...dbRow, resource_admins: [{ count: 0 }] },
      error: null,
    });
    const row = await getSessionPlayerRowByIdentity('discord', 'snowflake-1');
    expect(row?.resource_admin_count).toBe(0);
  });

  it('counts zero when the embed comes back empty', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: { ...dbRow, resource_admins: [] }, error: null });
    const row = await getSessionPlayerRowByIdentity('discord', 'snowflake-1');
    expect(row?.resource_admin_count).toBe(0);
  });

  it('returns null when no player is linked to the identity', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getSessionPlayerRowByIdentity('discord', 'nobody')).toBeNull();
  });

  it('rethrows query errors', async () => {
    const error = { message: 'boom', code: '500' };
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error });
    await expect(getSessionPlayerRowByIdentity('discord', 'snowflake-1')).rejects.toBe(error);
  });

  it('throws on a status outside the players_status_check set instead of guessing', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: { ...dbRow, status: 'deleted' }, error: null });
    await expect(getSessionPlayerRowByIdentity('discord', 'snowflake-1')).rejects.toThrow(
      'Unexpected player status'
    );
  });

  it.each(['active', 'suspended', 'banned'])('keeps status %s', async (status) => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: { ...dbRow, status }, error: null });
    const row = await getSessionPlayerRowByIdentity('discord', 'snowflake-1');
    expect(row?.status).toBe(status);
  });
});

describe('toSessionPlayer', () => {
  it('builds the unchanged SessionPlayer shape', () => {
    const player = toSessionPlayer({
      id: 'p-1',
      name: 'Ash',
      is_admin: true,
      is_creator: false,
      ps_username: 'ash_ps',
      champions_username: 'ash_ch',
      avatar_url: null,
      status: 'suspended',
      resource_admin_count: 1,
    });

    const expected: SessionPlayer = {
      playerId: 'p-1',
      name: 'Ash',
      isAdmin: true,
      isResourceAdmin: true,
      isCreator: false,
      psUsername: 'ash_ps',
      championsUsername: 'ash_ch',
      avatarUrl: null,
      status: 'suspended',
    };
    expect(player).toEqual(expected);
  });

  it('drops extra fields, so a full player row never reaches the token', () => {
    const fullRow = {
      id: 'p-1',
      name: 'Ash',
      is_admin: false,
      is_creator: false,
      ps_username: '',
      champions_username: '',
      avatar_url: null,
      status: 'active' as const,
      resource_admin_count: 0,
      discord_id: 'snowflake-1',
      auth_user_id: 'auth-uuid-1',
      ban_reason: 'secret',
    };
    const player = toSessionPlayer(fullRow);
    expect(player).not.toHaveProperty('discord_id');
    expect(player).not.toHaveProperty('auth_user_id');
    expect(player).not.toHaveProperty('ban_reason');
    expect(player.isResourceAdmin).toBe(false);
  });
});
