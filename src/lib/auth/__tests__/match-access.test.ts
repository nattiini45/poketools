import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

import { canAdministerMatchAccess, submitsAsMatchAdmin } from '../match-access';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isResourceAdminFor).mockResolvedValue(false);
});

describe('canAdministerMatchAccess', () => {
  it('admits a site admin without a resource lookup', async () => {
    await expect(canAdministerMatchAccess({ playerId: 'p', isAdmin: true }, 't-1')).resolves.toBe(true);
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('admits a resource admin of the tournament or its league', async () => {
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
    await expect(canAdministerMatchAccess({ playerId: 'p', isAdmin: false }, 't-1')).resolves.toBe(true);
    expect(isResourceAdminFor).toHaveBeenCalledWith('p', 'tournament', 't-1');
  });

  it('refuses a player who administers nothing here', async () => {
    await expect(canAdministerMatchAccess({ playerId: 'p', isAdmin: false }, 't-1')).resolves.toBe(false);
  });

  it('fails closed when the role read fails', async () => {
    vi.mocked(isResourceAdminFor).mockRejectedValue(new Error('db down'));
    await expect(canAdministerMatchAccess({ playerId: 'p', isAdmin: false }, 't-1')).rejects.toThrow('db down');
  });
});

describe('submitsAsMatchAdmin', () => {
  const match = { tournament_id: 't-1', player_1_id: 'a', player_2_id: 'b' };

  it('treats a site admin as admin without a lookup', async () => {
    await expect(submitsAsMatchAdmin({ playerId: 'x', isAdmin: true }, match)).resolves.toBe(true);
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('treats a participant as a participant without a lookup', async () => {
    await expect(submitsAsMatchAdmin({ playerId: 'a', isAdmin: false }, match)).resolves.toBe(false);
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('admits a non-participant resource admin of the match', async () => {
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
    await expect(submitsAsMatchAdmin({ playerId: 'x', isAdmin: false }, match)).resolves.toBe(true);
    expect(isResourceAdminFor).toHaveBeenCalledWith('x', 'tournament', 't-1');
  });

  it('refuses a non-participant who administers nothing here', async () => {
    await expect(submitsAsMatchAdmin({ playerId: 'x', isAdmin: false }, match)).resolves.toBe(false);
  });
});
