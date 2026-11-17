import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '@/types/auth';
import type { LiveAccess } from '../helpers';

const mocks = vi.hoisted(() => ({
  requirePlayer: vi.fn<() => Promise<SessionPlayer>>(),
  getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>(),
  isPhaseAdminFor: vi.fn<(playerId: string, phaseId: string) => Promise<boolean>>(),
  getPhaseAdminScopeIds: vi.fn<(playerId: string) => Promise<{ seasonIds: string[]; phaseIds: string[] }>>(),
  hasPhaseAdminRole: vi.fn<(playerId: string) => Promise<boolean>>(),
}));
vi.mock('@/lib/auth/helpers', () => ({
  ...mocks,
  AuthError: class extends Error {},
}));
vi.mock('@/lib/supabase/queries/phase-admins', () => mocks);
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

import { assertMayRecordPhaseResult, canAdministerPhaseAccess, gatePhaseAdmin, getPhaseAdminScope, getPhaseAwareLiveAccess, requirePhaseAdmin, requirePhaseAwareAdmin } from '../phase-access';

const ID = '00000000-0000-4000-8000-000000000001';
const player: SessionPlayer = {
  playerId: 'organizer', name: 'Organizer', isAdmin: false, isResourceAdmin: false,
  isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active',
};
const access: LiveAccess = {
  player, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, isSuperadmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePlayer.mockResolvedValue(player);
  mocks.getLiveAccess.mockResolvedValue(access);
  mocks.isPhaseAdminFor.mockResolvedValue(false);
  mocks.hasPhaseAdminRole.mockResolvedValue(false);
});

describe('native phase access', () => {
  it('admits phase-only organizers through an explicit phase-aware gate without mutating session roles', async () => {
    mocks.hasPhaseAdminRole.mockResolvedValue(true);
    await expect(requirePhaseAwareAdmin()).resolves.toEqual(player);
    await expect(getPhaseAwareLiveAccess()).resolves.toMatchObject({ isAnyAdmin: true });
    expect(player.isResourceAdmin).toBe(false);
    expect(access.isAnyAdmin).toBe(false);
    mocks.hasPhaseAdminRole.mockResolvedValue(false);
    await expect(requirePhaseAwareAdmin()).rejects.toThrow('Admin access required');
  });

  it('never reads native assignments for site/legacy admins or signed-out/blocked views', async () => {
    mocks.requirePlayer.mockResolvedValue({ ...player, isAdmin: true });
    await requirePhaseAwareAdmin();
    mocks.requirePlayer.mockResolvedValue({ ...player, isResourceAdmin: true });
    await requirePhaseAwareAdmin();
    mocks.getLiveAccess.mockResolvedValue(null);
    await expect(getPhaseAwareLiveAccess()).resolves.toBeNull();
    mocks.getLiveAccess.mockResolvedValue({ ...access, player: { ...player, status: 'banned' } });
    await expect(getPhaseAwareLiveAccess()).resolves.toMatchObject({ isAnyAdmin: false });
    expect(mocks.hasPhaseAdminRole).not.toHaveBeenCalled();
  });

  it('admits site admins without querying phase assignments', async () => {
    await expect(canAdministerPhaseAccess({ ...player, isAdmin: true }, ID)).resolves.toBe(true);
    expect(mocks.isPhaseAdminFor).not.toHaveBeenCalled();
  });

  it('does not depend on the legacy resource-admin flag', async () => {
    mocks.isPhaseAdminFor.mockResolvedValue(true);
    await expect(requirePhaseAdmin(ID)).resolves.toEqual(player);
    await expect(gatePhaseAdmin(ID)).resolves.toEqual({ kind: 'ok', playerId: player.playerId, isSiteAdmin: false });
    expect(mocks.isPhaseAdminFor).toHaveBeenCalledWith(player.playerId, ID);
  });

  it('rejects a malformed phase id after the live route guard without a query', async () => {
    await expect(requirePhaseAdmin('bad')).rejects.toMatchObject({ code: 'INVALID_PHASE_ID', statusCode: 404 });
    expect(mocks.requirePlayer).toHaveBeenCalledOnce();
    expect(mocks.isPhaseAdminFor).not.toHaveBeenCalled();
  });

  it('rejects malformed view ids before reading the identity', async () => {
    await expect(gatePhaseAdmin('bad')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
  });

  it('refuses unrelated organizers and propagates failed assignment reads', async () => {
    await expect(requirePhaseAdmin(ID)).rejects.toThrow('Admin access required for this resource');
    mocks.isPhaseAdminFor.mockRejectedValue(new Error('roles unavailable'));
    await expect(gatePhaseAdmin(ID)).rejects.toThrow('roles unavailable');
  });

  it('refuses signed-out, banned and suspended views without reading assignments', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    await expect(gatePhaseAdmin(ID)).resolves.toEqual({ kind: 'guard' });
    for (const status of ['banned', 'suspended'] as const) {
      mocks.getLiveAccess.mockResolvedValue({ ...access, player: { ...player, status } });
      await expect(gatePhaseAdmin(ID)).resolves.toEqual({ kind: 'guard' });
    }
    expect(mocks.isPhaseAdminFor).not.toHaveBeenCalled();
  });

  it('keeps a participant submission distinct from an organizer correction', async () => {
    const match = { phase_id: ID, player_1_id: player.playerId, player_2_id: 'opponent' };
    await expect(assertMayRecordPhaseResult(player, match)).resolves.toEqual({ asAdmin: false });
    expect(mocks.isPhaseAdminFor).not.toHaveBeenCalled();
    await expect(assertMayRecordPhaseResult({ ...player, playerId: 'visitor' }, match))
      .rejects.toMatchObject({ code: 'match_submit_forbidden', statusCode: 403 });
    mocks.isPhaseAdminFor.mockResolvedValue(true);
    await expect(assertMayRecordPhaseResult({ ...player, playerId: 'organizer-2' }, match)).resolves.toEqual({ asAdmin: true });
    await expect(assertMayRecordPhaseResult({ ...player, isAdmin: true }, match)).resolves.toEqual({ asAdmin: true });
  });

  it('loads only native phase scopes, with unrestricted site admins reading nothing', async () => {
    await expect(getPhaseAdminScope({ ...player, isAdmin: true }))
      .resolves.toEqual({ playerId: player.playerId, isSiteAdmin: true, seasonIds: null, phaseIds: null });
    expect(mocks.getPhaseAdminScopeIds).not.toHaveBeenCalled();
    mocks.getPhaseAdminScopeIds.mockResolvedValue({ seasonIds: ['league'], phaseIds: [ID] });
    await expect(getPhaseAdminScope(player))
      .resolves.toEqual({ playerId: player.playerId, isSiteAdmin: false, seasonIds: ['league'], phaseIds: [ID] });
  });
});
