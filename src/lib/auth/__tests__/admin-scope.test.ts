import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPlayer } from '@/types/auth';

const q = vi.hoisted(() => ({
  getAdminSeasonIds: vi.fn<(playerId: string) => Promise<string[]>>(),
  getAdminTournamentIds: vi.fn<(playerId: string) => Promise<string[]>>(),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => q);

import { getAdminScope, scopeAllowsSeason, scopeAllowsTournament, type AdminScope } from '../admin-scope';

function player(overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    playerId: 'p1',
    name: 'Admin',
    isAdmin: false,
    isResourceAdmin: true,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAdminScope', () => {
  it('is unrestricted for a site admin and reads nothing', async () => {
    const scope = await getAdminScope(player({ isAdmin: true }));
    expect(scope).toEqual({ playerId: 'p1', isSiteAdmin: true, seasonIds: null, tournamentIds: null });
    expect(q.getAdminSeasonIds).not.toHaveBeenCalled();
    expect(q.getAdminTournamentIds).not.toHaveBeenCalled();
  });

  it('lists the assigned seasons and the cascaded tournaments for a resource admin', async () => {
    q.getAdminSeasonIds.mockResolvedValue(['s1']);
    // getAdminTournamentIds cascades: direct tournament t9 plus the stages t1, t2 of season s1.
    q.getAdminTournamentIds.mockResolvedValue(['t9', 't1', 't2']);
    const scope = await getAdminScope(player());
    expect(scope).toEqual({ playerId: 'p1', isSiteAdmin: false, seasonIds: ['s1'], tournamentIds: ['t9', 't1', 't2'] });
    expect(q.getAdminSeasonIds).toHaveBeenCalledWith('p1');
    expect(q.getAdminTournamentIds).toHaveBeenCalledWith('p1');
  });

  it('is empty (not unrestricted) for a resource admin without assignments', async () => {
    q.getAdminSeasonIds.mockResolvedValue([]);
    q.getAdminTournamentIds.mockResolvedValue([]);
    const scope = await getAdminScope(player());
    expect(scope.seasonIds).toEqual([]);
    expect(scope.tournamentIds).toEqual([]);
  });

  it('fails closed when a read fails', async () => {
    q.getAdminSeasonIds.mockResolvedValue(['s1']);
    q.getAdminTournamentIds.mockRejectedValue(new Error('db down'));
    await expect(getAdminScope(player())).rejects.toThrow('db down');
  });
});

describe('scope helpers', () => {
  const open: AdminScope = { playerId: 'p', isSiteAdmin: true, seasonIds: null, tournamentIds: null };
  const limited: AdminScope = { playerId: 'p', isSiteAdmin: false, seasonIds: ['s1'], tournamentIds: ['t1'] };
  const none: AdminScope = { playerId: 'p', isSiteAdmin: false, seasonIds: [], tournamentIds: [] };

  it('an unrestricted scope allows every id', () => {
    expect(scopeAllowsTournament(open, 'anything')).toBe(true);
    expect(scopeAllowsSeason(open, 'anything')).toBe(true);
  });

  it('a limited scope allows only its ids', () => {
    expect(scopeAllowsTournament(limited, 't1')).toBe(true);
    expect(scopeAllowsTournament(limited, 't2')).toBe(false);
    expect(scopeAllowsSeason(limited, 's1')).toBe(true);
    expect(scopeAllowsSeason(limited, 's2')).toBe(false);
  });

  it('an empty scope allows nothing', () => {
    expect(scopeAllowsTournament(none, 't1')).toBe(false);
    expect(scopeAllowsSeason(none, 's1')).toBe(false);
  });
});
