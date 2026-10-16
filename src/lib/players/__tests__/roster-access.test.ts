import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    AuthError,
    getSession: vi.fn(),
    // Same rule as the real helper: any admin tier on the token copy.
    isAnyAdmin: (session: { player?: { isAdmin?: boolean; isResourceAdmin?: boolean } } | null) =>
      session?.player?.isAdmin === true || session?.player?.isResourceAdmin === true,
    requireResourceAdmin: vi.fn(),
  };
});

import { canViewAdminRoster } from '../roster-access';
import { AuthError, getSession, requireResourceAdmin } from '@/lib/auth/helpers';

function session(roles: { isAdmin?: boolean; isResourceAdmin?: boolean }) {
  return { user: { id: 'discord-1' }, player: { playerId: 'p-1', ...roles } } as never;
}

describe('canViewAdminRoster', () => {
  beforeEach(() => vi.clearAllMocks());

  it('anonymous callers get the public list without any live read', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(canViewAdminRoster('season', 's-1')).resolves.toBe(false);
    expect(requireResourceAdmin).not.toHaveBeenCalled();
  });

  it('a player whose token carries no admin role gets the public list without a live read', async () => {
    vi.mocked(getSession).mockResolvedValue(session({ isAdmin: false, isResourceAdmin: false }));

    await expect(canViewAdminRoster('tournament', 't-1')).resolves.toBe(false);
    expect(requireResourceAdmin).not.toHaveBeenCalled();
  });

  it('the grant is decided live by requireResourceAdmin for this resource', async () => {
    vi.mocked(getSession).mockResolvedValue(session({ isResourceAdmin: true }));
    vi.mocked(requireResourceAdmin).mockResolvedValue({} as never);

    await expect(canViewAdminRoster('season', 's-1')).resolves.toBe(true);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', 's-1');
  });

  it('an admin of another resource (or a revoked or banned one) gets the public list', async () => {
    vi.mocked(getSession).mockResolvedValue(session({ isResourceAdmin: true }));
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new AuthError('Admin access required for this resource', 403),
    );

    await expect(canViewAdminRoster('tournament', 't-9')).resolves.toBe(false);
  });

  it('a failed live read is rethrown, never turned into either answer', async () => {
    vi.mocked(getSession).mockResolvedValue(session({ isAdmin: true }));
    vi.mocked(requireResourceAdmin).mockRejectedValue(new Error('connection reset'));

    await expect(canViewAdminRoster('season', 's-1')).rejects.toThrow('connection reset');
  });
});
