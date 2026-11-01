import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerUpdate } from '@/types/player';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'update', 'eq', 'select']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { updatePlayer } from '../players';

const row = {
  id: 'p-1',
  name: 'Ash',
  discord_id: '123456789012345678',
  auth_user_id: null,
  ps_username: '',
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

describe('updatePlayer identity columns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuilder.single.mockResolvedValue({ data: row, error: null });
  });

  // Identity moves only through the guarded flows (link, claim, import). The superadmin
  // binding (credentials session + Discord-linked player) trusts that `discord_id` is
  // never writable through a profile edit, so a future change that copies it fails here.
  it('never writes discord_id or auth_user_id, whatever the caller passes', async () => {
    const hostile = {
      name: 'Renamed',
      discord_id: '999999999999999999',
      auth_user_id: '00000000-0000-4000-8000-000000000000',
    } as unknown as PlayerUpdate;

    await updatePlayer('p-1', hostile);

    expect(mockBuilder.update).toHaveBeenCalledTimes(1);
    const written = mockBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(written).toEqual({ name: 'Renamed' });
    expect(written).not.toHaveProperty('discord_id');
    expect(written).not.toHaveProperty('auth_user_id');
  });
});
