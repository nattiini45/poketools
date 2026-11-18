import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { DELETE, PATCH } from '../route';

const f = vi.hoisted(() => ({
  requirePlayer: vi.fn(), requireOpenPhaseRouteMode: vi.fn(),
  canAdministerPhaseAccess: vi.fn(), isResourceAdminFor: vi.fn(),
  getGameById: vi.fn(), getMatchById: vi.fn(), getPhaseGameById: vi.fn(), getPhaseMatchById: vi.fn(),
  findNativePhaseAliasOwner: vi.fn(), standaloneMatchAliasExists: vi.fn(),
  deleteGame: vi.fn(), editGame: vi.fn(), deletePhaseGame: vi.fn(), editPhaseGame: vi.fn(),
  createNativePhaseServices: vi.fn(), logAuditEvent: vi.fn(),
  revalidateMatchPages: vi.fn(), revalidatePhaseMatchPages: vi.fn(), expireSeasonReads: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: f.requirePlayer, AuthError: class AuthError extends Error {} }));
vi.mock('@/lib/auth/phase-access', () => f);
vi.mock('@/lib/league-phase/route-mode', () => f);
vi.mock('@/lib/league-phase/services', () => f);
vi.mock('@/lib/supabase/queries/resource-admins', () => f);
vi.mock('@/lib/supabase/queries/games', () => f);
vi.mock('@/lib/supabase/queries/matches', () => f);
vi.mock('@/lib/supabase/queries/phase-games', () => f);
vi.mock('@/lib/supabase/queries/phase-matches', () => f);
vi.mock('@/lib/supabase/queries/phase-route-owners', () => f);
vi.mock('@/lib/pkmn/game-pipeline', () => f);
vi.mock('@/lib/audit/log', () => f);
vi.mock('@/lib/revalidation', () => f);

const [gameId, matchId, phaseId, leagueId, p1, p2, downstream] = Array.from({ length: 7 }, (_, i) =>
  `ba000000-0000-4000-8000-00000000000${i + 1}`);
const game = { id: gameId, match_id: matchId, game_number: 1, winner_id: p1 };
const match = { id: matchId, phase_id: phaseId, player_1_name: 'Aster', player_2_name: 'Birch' };
const owner = { kind: 'phase', phase_id: phaseId, season_id: leagueId };
const params = { params: Promise.resolve({ id: gameId.toUpperCase() }) };
const del = (data: unknown = {}) => DELETE(new NextRequest('http://localhost/api/admin/games/' + gameId, {
  method: 'DELETE', body: JSON.stringify(data),
}), params);
const patch = (data: unknown = { winner_id: p2 }) => PATCH(new NextRequest('http://localhost/api/admin/games/' + gameId, {
  method: 'PATCH', body: JSON.stringify(data),
}), params);

beforeEach(() => {
  vi.resetAllMocks();
  f.requirePlayer.mockResolvedValue({ playerId: 'phase-admin', name: 'Cedar', isAdmin: false });
  f.requireOpenPhaseRouteMode.mockResolvedValue('phase');
  f.getPhaseGameById.mockResolvedValue(game);
  f.findNativePhaseAliasOwner.mockResolvedValue(owner);
  f.getPhaseMatchById.mockResolvedValue(match);
  f.canAdministerPhaseAccess.mockResolvedValue(true);
  f.createNativePhaseServices.mockReturnValue({
    matches: { deleteGame: f.deletePhaseGame, editGame: f.editPhaseGame },
  });
});

describe('ID-only native game corrections', () => {
  it('checks the phase role and preserves the edit version and cascade approval', async () => {
    const expected = '2026-11-18T12:00:00Z';
    f.editPhaseGame.mockResolvedValue({ match_status: 'in_progress', match_winner_id: p2 });
    expect((await patch({ winner_id: p2, expected_updated_at: expected, confirm_downstream: [downstream] })).status).toBe(200);
    expect(f.getPhaseGameById).toHaveBeenCalledExactlyOnceWith(gameId);
    expect(f.findNativePhaseAliasOwner).toHaveBeenCalledExactlyOnceWith({ matchId });
    expect(f.canAdministerPhaseAccess).toHaveBeenCalledExactlyOnceWith({ playerId: 'phase-admin', isAdmin: false }, phaseId);
    expect(f.editPhaseGame).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ game_id: gameId, winner_id: p2, expected_updated_at: expected }),
      expect.objectContaining({ confirmDownstream: [downstream] }),
    );
    expect(f.getGameById).not.toHaveBeenCalled();
    expect(f.editGame).not.toHaveBeenCalled();
    expect(f.isResourceAdminFor).not.toHaveBeenCalled();
    expect(f.revalidatePhaseMatchPages).toHaveBeenCalledExactlyOnceWith(phaseId, matchId, leagueId);
    expect(f.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'phase_game', metadata: expect.objectContaining({ phase_id: phaseId, season_id: leagueId, match_id: matchId }),
    }));
    expect(f.logAuditEvent.mock.calls[0][0].metadata).not.toHaveProperty('tournament_id');
  });

  it('audits a saved native delete that lost the match status CAS and returns the original 409', async () => {
    f.deletePhaseGame.mockResolvedValue({ match_status_conflict: true, games_remaining: 0 });
    const result = await del({ reason: 'Duplicate fixture', confirm_downstream: [downstream] });
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: 'admin_game_match_status_conflict' });
    expect(f.deletePhaseGame).toHaveBeenCalledWith(gameId, 'phase-admin', expect.objectContaining({ confirmDownstream: [downstream] }));
    expect(f.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'game.delete', metadata: expect.objectContaining({ phase_id: phaseId, reason: 'Duplicate fixture', match_status_conflict: true }),
    }));
    expect(f.deleteGame).not.toHaveBeenCalled();
  });

  it('refuses an unrelated phase owner or admin without falling back to old records', async () => {
    f.getPhaseMatchById.mockResolvedValueOnce({ ...match, phase_id: 'different-phase' });
    expect((await del()).status).toBe(404);
    f.canAdministerPhaseAccess.mockResolvedValueOnce(false);
    expect((await patch()).status).toBe(403);
    expect(f.getGameById).not.toHaveBeenCalled();
    expect(f.createNativePhaseServices).not.toHaveBeenCalled();
    expect(f.logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses frozen storage before looking up a game in either store', async () => {
    f.requireOpenPhaseRouteMode.mockRejectedValueOnce(new UserFacingError('Maintenance', {
      status: 503, code: 'phase_storage_unavailable',
    }));
    const result = await del();
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    expect(f.getPhaseGameById).not.toHaveBeenCalled();
    expect(f.getGameById).not.toHaveBeenCalled();
  });

  it('only forwards a verified standalone through the legacy write path in phase mode', async () => {
    f.getPhaseGameById.mockResolvedValue(null);
    f.getGameById.mockResolvedValue(game);
    f.getMatchById.mockResolvedValue({ ...match, tournament_id: 'standalone' });
    f.isResourceAdminFor.mockResolvedValue(true);
    f.deleteGame.mockResolvedValue({ games_remaining: 0 });
    f.standaloneMatchAliasExists.mockResolvedValueOnce(false);
    expect((await del()).status).toBe(404);
    expect(f.standaloneMatchAliasExists).toHaveBeenCalledWith(matchId, 'standalone');
    expect(f.isResourceAdminFor).not.toHaveBeenCalled();
    f.standaloneMatchAliasExists.mockResolvedValueOnce(true);
    expect((await del()).status).toBe(200);
    expect(f.deleteGame).toHaveBeenCalledExactlyOnceWith(gameId.toUpperCase(), 'phase-admin', expect.any(Object));
    expect(f.createNativePhaseServices).not.toHaveBeenCalled();
  });
});
