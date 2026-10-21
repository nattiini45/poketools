import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/test-accounts', () => ({
  ensureStandardTestPlayers: vi.fn(),
  listTestAccounts: vi.fn(),
  resetTestAccountData: vi.fn(),
  removeTestPlayerFromSeason: vi.fn(),
  mintLoginCredentials: vi.fn(),
  clearLoginCredentials: vi.fn(),
  deleteTestOnlyMatches: vi.fn(),
}));

import { POST } from '@/app/api/admin/test-players/route';
import { requireAdmin } from '@/lib/auth/helpers';
import {
  deleteTestOnlyMatches,
  resetTestAccountData,
} from '@/lib/supabase/queries/test-accounts';

const PLAYER_ID = '11111111-1111-4111-8111-111111111111';

function post(body: unknown) {
  return POST(
    new Request('http://localhost/api/admin/test-players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

describe('POST /api/admin/test-players: error codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  });

  it('rejects an unknown action with test_player_action_invalid and the allowed list', async () => {
    const res = await post({ action: 'explode' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      'action must be one of: ensure, reset, remove_from_league, mint_login, clear_login, delete_test_matches'
    );
    expect(body.code).toBe('test_player_action_invalid');
    expect(body.params).toEqual({
      actions: 'ensure, reset, remove_from_league, mint_login, clear_login, delete_test_matches',
    });
  });

  it('rejects a missing player_id with admin_param_required', async () => {
    const res = await post({ action: 'reset' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'player_id required',
      code: 'admin_param_required',
      params: { name: 'player_id' },
    });
    expect(resetTestAccountData).not.toHaveBeenCalled();
  });

  it('rejects a malformed season_id with INVALID_PARAM', async () => {
    const res = await post({ action: 'delete_test_matches', season_id: 'not-a-uuid' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'season_id must be a valid UUID',
      code: 'INVALID_PARAM',
      params: { name: 'season_id' },
    });
    expect(deleteTestOnlyMatches).not.toHaveBeenCalled();
  });

  it('runs a valid player action', async () => {
    const res = await post({ action: 'reset', player_id: PLAYER_ID });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { reset: PLAYER_ID } });
    expect(resetTestAccountData).toHaveBeenCalledWith(PLAYER_ID);
  });
});
