import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/players', () => ({
  getPlayerIdByDiscordId: vi.fn(),
  isAuthUserLinkedToDiscordId: vi.fn(),
}));

import { resolveSuperadminPlayerId } from '../superadmin';
import { getPlayerIdByDiscordId } from '@/lib/supabase/queries/players';

describe('resolveSuperadminPlayerId', () => {
  const original = process.env.SUPERADMIN_DISCORD_ID;

  beforeEach(() => {
    vi.mocked(getPlayerIdByDiscordId).mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SUPERADMIN_DISCORD_ID;
    else process.env.SUPERADMIN_DISCORD_ID = original;
  });

  it('reads the player linked to SUPERADMIN_DISCORD_ID', async () => {
    process.env.SUPERADMIN_DISCORD_ID = '111222333444555666';
    vi.mocked(getPlayerIdByDiscordId).mockResolvedValue('player-1');

    await expect(resolveSuperadminPlayerId()).resolves.toBe('player-1');
    expect(getPlayerIdByDiscordId).toHaveBeenCalledWith('111222333444555666');
  });

  it('is null, without a query, when SUPERADMIN_DISCORD_ID is unset', async () => {
    delete process.env.SUPERADMIN_DISCORD_ID;

    await expect(resolveSuperadminPlayerId()).resolves.toBeNull();
    expect(getPlayerIdByDiscordId).not.toHaveBeenCalled();
  });

  it('rethrows a failed read so callers fail closed', async () => {
    process.env.SUPERADMIN_DISCORD_ID = '111222333444555666';
    vi.mocked(getPlayerIdByDiscordId).mockRejectedValue(new Error('db down'));

    await expect(resolveSuperadminPlayerId()).rejects.toThrow('db down');
  });
});
