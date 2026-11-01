import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'update', 'eq', 'lt']) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import { revokePlayerSessions, revokeSessionsOfAuthUser } from '../players';

const NOW = new Date('2026-11-02T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const m of ['from', 'update', 'eq']) mockBuilder[m].mockReturnValue(mockBuilder);
  mockBuilder.lt.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('revokePlayerSessions', () => {
  it('moves the epoch to the application clock and writes nothing else', async () => {
    await revokePlayerSessions('player-1');

    expect(mockBuilder.from).toHaveBeenCalledWith('players');
    expect(mockBuilder.update).toHaveBeenCalledWith({ sessions_valid_after: NOW.toISOString() });
    expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'player-1');
  });

  it('only ever moves the epoch forward', async () => {
    await revokePlayerSessions('player-1');
    expect(mockBuilder.lt).toHaveBeenCalledWith('sessions_valid_after', NOW.toISOString());
  });

  it('rethrows a failed write so the caller does not report a revocation that did not happen', async () => {
    const error = { message: 'boom', code: '500' };
    mockBuilder.lt.mockResolvedValue({ error });
    await expect(revokePlayerSessions('player-1')).rejects.toBe(error);
  });
});

describe('revokeSessionsOfAuthUser', () => {
  it('targets the player behind the auth user, which also ends its Discord sessions', async () => {
    await revokeSessionsOfAuthUser('auth-uuid-1');

    expect(mockBuilder.update).toHaveBeenCalledWith({ sessions_valid_after: NOW.toISOString() });
    expect(mockBuilder.eq).toHaveBeenCalledWith('auth_user_id', 'auth-uuid-1');
    expect(mockBuilder.lt).toHaveBeenCalledWith('sessions_valid_after', NOW.toISOString());
  });

  it('is a no-op success when the auth user has no player row yet', async () => {
    mockBuilder.lt.mockResolvedValue({ error: null, count: 0 });
    await expect(revokeSessionsOfAuthUser('auth-uuid-new')).resolves.toBeUndefined();
  });

  it('rethrows a failed write', async () => {
    const error = { message: 'boom', code: '500' };
    mockBuilder.lt.mockResolvedValue({ error });
    await expect(revokeSessionsOfAuthUser('auth-uuid-1')).rejects.toBe(error);
  });
});
