import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiveAccess } from '../helpers';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>(),
  isResourceAdminFor: vi.fn<(playerId: string, type: string, id: string) => Promise<boolean>>(),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));

import { gateResourceAdmin } from '../resource-gate';

const ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';
const PLAYER = { playerId: 'p1' } as LiveAccess['player'];

function access(flags: Partial<LiveAccess>): LiveAccess {
  return { player: PLAYER, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, ...flags };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gateResourceAdmin', () => {
  it('404s a non-uuid id before any auth or admin read', async () => {
    await expect(gateResourceAdmin('season', 'not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('is guard when signed out', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    expect(await gateResourceAdmin('tournament', ID)).toEqual({ kind: 'guard' });
  });

  it('is guard for a non-admin and for an admin flag without a player', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({}));
    expect(await gateResourceAdmin('season', ID)).toEqual({ kind: 'guard' });
    mocks.getLiveAccess.mockResolvedValue(access({ player: null, isAnyAdmin: true }));
    expect(await gateResourceAdmin('season', ID)).toEqual({ kind: 'guard' });
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('passes a site admin without an assignment lookup', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    expect(await gateResourceAdmin('season', ID)).toEqual({ kind: 'ok', playerId: 'p1', isSiteAdmin: true });
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('passes a resource admin of the resource', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(true);
    expect(await gateResourceAdmin('tournament', ID)).toEqual({ kind: 'ok', playerId: 'p1', isSiteAdmin: false });
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('p1', 'tournament', ID);
  });

  it('is forbidden for a resource admin of another resource', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockResolvedValue(false);
    expect(await gateResourceAdmin('season', ID)).toEqual({ kind: 'forbidden' });
  });

  it('fails closed when the assignment read fails', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.isResourceAdminFor.mockRejectedValue(new Error('db down'));
    await expect(gateResourceAdmin('season', ID)).rejects.toThrow('db down');
  });
});
