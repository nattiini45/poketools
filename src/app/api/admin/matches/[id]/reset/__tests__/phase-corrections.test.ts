import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { NativePhaseInvalidation } from '@/lib/league-phase/services';
import { POST as reset } from '../route';
import { GET as preview } from '../../reset-preview/route';
import { POST as reopen } from '../../reopen/route';

const h = vi.hoisted(() => ({
  player: vi.fn(), mode: vi.fn(), findOwner: vi.fn(), isStandalone: vi.fn(),
  phaseMatch: vi.fn(), tournamentMatch: vi.fn(), phaseAdmin: vi.fn(), tournamentAdmin: vi.fn(),
  native: vi.fn<(invalidation: NativePhaseInvalidation) => object>(),
  phaseReset: vi.fn(), phasePreview: vi.fn(), phaseReopen: vi.fn(),
  tournamentReset: vi.fn(), tournamentPreview: vi.fn(), tournamentReopen: vi.fn(),
  tournament: vi.fn(), audit: vi.fn(), path: vi.fn(), tag: vi.fn(), rate: vi.fn(),
  unexpectedIO: vi.fn(() => { throw new Error('Unexpected I/O'); }),
}));

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: h.player }));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: h.phaseAdmin }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: h.tournamentAdmin }));
vi.mock('@/lib/supabase/queries/phase-storage', () => ({ readPhaseStorageMode: h.mode }));
vi.mock('@/lib/supabase/queries/phase-route-owners', () => ({
  findNativePhaseAliasOwner: h.findOwner, standaloneMatchAliasExists: h.isStandalone,
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchById: h.phaseMatch }));
vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: h.tournamentMatch }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: h.tournament }));
vi.mock('@/lib/league-phase/services', () => ({ createNativePhaseServices: h.native }));
vi.mock('@/lib/pkmn/game-pipeline', () => ({ resetMatch: h.tournamentReset, previewMatchReset: h.tournamentPreview }));
vi.mock('@/lib/match/reopen', () => ({ reopenMatch: h.tournamentReopen }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: h.audit }));
vi.mock('next/cache', () => ({ revalidatePath: h.path, revalidateTag: h.tag }));
vi.mock('@/lib/utils/rate-limit', () => ({ checkRateLimit: h.rate }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: h.unexpectedIO, rpc: h.unexpectedIO } }));

const id = 'daa274a2-59da-43fd-84a5-8cede96e15a4';
const owner = {
  kind: 'phase',
  phase_id: 'aabbccdd-1111-4111-8111-111111111111',
  season_id: 'aabbccdd-2222-4222-8222-222222222222',
};
const tournamentId = 'aabbccdd-3333-4333-8333-333333333333';
const actor = { playerId: 'organizer', name: 'Test Organizer', isAdmin: false };
const match = {
  id, phase_id: owner.phase_id, status: 'completed', winner_id: 'p1', submitter_id: 'p1',
  player_1_name: 'Test Trainer One', player_2_name: 'Test Trainer Two',
};
const resetResult = { games_deleted: 2, has_downstream_matches: true, evolution_events: [] };
const previewResult = {
  games_to_delete: 2, was_completed: true,
  downstream: [{ id: 'later', player_1_name: 'One', player_2_name: 'Two', status: 'completed', round_name: 'Final' }],
};
const reopenResult = { from_status: 'completed', ratings_rebuilt_players: 2, bracket_matches_removed: 1, failed_steps: [] };

function send(route: typeof reset | typeof preview | typeof reopen, body: object = { reason: 'Correct result' }, matchId = id) {
  const init = route === preview ? undefined : { method: 'POST', body: JSON.stringify(body) };
  return route(new NextRequest('https://example.test/api/admin/matches', init), { params: Promise.resolve({ id: matchId }) });
}

function expectNoCorrection() {
  expect(h.native).not.toHaveBeenCalled();
  expect(h.tournamentReset).not.toHaveBeenCalled();
  expect(h.tournamentPreview).not.toHaveBeenCalled();
  expect(h.tournamentReopen).not.toHaveBeenCalled();
  expect(h.audit).not.toHaveBeenCalled();
  expect(h.tag).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('READ_PHASE_STORAGE_STATE', 'true');
  vi.stubGlobal('fetch', h.unexpectedIO);
  h.player.mockResolvedValue(actor);
  h.mode.mockResolvedValue('phase');
  h.findOwner.mockResolvedValue(owner);
  h.phaseMatch.mockResolvedValue(match);
  h.phaseAdmin.mockResolvedValue(true);
  h.tournamentAdmin.mockResolvedValue(false);
  h.native.mockReturnValue({ matches: { resetMatch: h.phaseReset, previewMatchReset: h.phasePreview, reopenMatch: h.phaseReopen } });
  h.phaseReset.mockResolvedValue(resetResult);
  h.phasePreview.mockResolvedValue(previewResult);
  h.phaseReopen.mockResolvedValue(reopenResult);
  h.rate.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  expect(h.unexpectedIO).not.toHaveBeenCalled();
});

describe('ID-only native match corrections', () => {
  it('previews the verified native phase and preserves its downstream summary without side effects', async () => {
    const response = await send(preview, {}, id.toUpperCase());
    expect(await response.json()).toEqual({ success: true, data: previewResult });
    expect(h.findOwner).toHaveBeenCalledExactlyOnceWith({ matchId: id });
    expect(h.phaseMatch).toHaveBeenCalledExactlyOnceWith(id);
    expect(h.phaseAdmin).toHaveBeenCalledExactlyOnceWith(actor, owner.phase_id);
    expect(h.phasePreview).toHaveBeenCalledExactlyOnceWith(id);
    expect(h.isStandalone).not.toHaveBeenCalled();
    expect(h.tournamentMatch).not.toHaveBeenCalled();
    expect(h.phaseReset).not.toHaveBeenCalled();
    expect(h.phaseReopen).not.toHaveBeenCalled();
    expect(h.path).not.toHaveBeenCalled();
    expect(h.tag).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('preserves the native cascade refusal and only opts in when asked', async () => {
    h.phaseReset.mockRejectedValueOnce(new UserFacingError('Confirm the downstream reset', {
      code: 'DOWNSTREAM_PLAYED', params: { count: 1 }, status: 409,
    }));
    const refusal = await send(reset);
    expect(refusal.status).toBe(409);
    expect(await refusal.json()).toMatchObject({ code: 'DOWNSTREAM_PLAYED', params: { count: 1 } });
    expect(h.phaseReset).toHaveBeenNthCalledWith(1, id, actor.playerId, false);
    expect(h.audit).not.toHaveBeenCalled();

    const response = await send(reset, { cascade: true, reason: '  Correct result  ' });
    expect(await response.json()).toEqual({ success: true, data: resetResult });
    expect(h.phaseReset).toHaveBeenNthCalledWith(2, id, actor.playerId, true);
    expect(h.tournamentReset).not.toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'match.reset', resource_type: 'phase_match', resource_id: id,
      metadata: { phase_id: owner.phase_id, season_id: owner.season_id, reason: 'Correct result',
        cascade: true, games_deleted: 2, has_downstream_matches: true },
    }));
  });

  it('expires native and shared result reads and binds native Kit invalidation', async () => {
    await send(reset);
    const leaguePath = `/leagues/${owner.season_id}`;
    const phasePath = `${leaguePath}/phases/${owner.phase_id}`;
    expect(h.path).toHaveBeenCalledWith(`${phasePath}/matches/${id}`);
    expect(h.path).toHaveBeenCalledWith(`/admin/matches/${id}`);
    for (const tag of [
      `phase:${owner.phase_id}`, `season:${owner.season_id}`, `aggregates:phase:${owner.phase_id}`,
      `aggregates:league:${owner.season_id}`, 'aggregates:all_time', 'player-profiles', 'ratings',
    ]) expect(h.tag).toHaveBeenCalledWith(tag, { expire: 0 });
    expect(h.tournament).not.toHaveBeenCalled();

    h.path.mockClear();
    h.tag.mockClear();
    const invalidation = h.native.mock.calls[0][0];
    await invalidation.invalidateMatch(owner.phase_id, id);
    expect(h.path).toHaveBeenCalledWith(`${phasePath}/matches/${id}`);
    const nextPhase = 'another-phase';
    invalidation.invalidateSeason(owner.season_id, [nextPhase]);
    expect(h.tag).toHaveBeenCalledWith(`phase:${nextPhase}`, { expire: 0 });
    expect(h.tag).not.toHaveBeenCalledWith(`tournament:${owner.phase_id}`, { expire: 0 });
  });

  it('reopens with the existing rate limit, audits a native incomplete result and still expires its cache', async () => {
    const warning = { phase_id: owner.phase_id, phase_name: 'Groups', advanced: [] };
    h.phaseReopen.mockResolvedValue({ ...reopenResult, failed_steps: ['format'], stage_already_ended: warning });
    const response = await send(reopen);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: 'match_reopen_incomplete', params: { count: 1, stage_phase: 'Groups' } });
    expect(h.rate).toHaveBeenCalledExactlyOnceWith('admin-match-reopen', actor.playerId, { limit: 20, windowSeconds: 3600 });
    expect(h.phaseReopen).toHaveBeenCalledExactlyOnceWith(id, actor.playerId);
    expect(h.tournamentReopen).not.toHaveBeenCalled();
    expect(h.tag).toHaveBeenCalledWith(`phase:${owner.phase_id}`, { expire: 0 });
    expect(h.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'match.reopen', resource_type: 'phase_match', resource_id: id,
      metadata: { phase_id: owner.phase_id, season_id: owner.season_id, reason: 'Correct result',
        from_status: 'completed', ratings_rebuilt_players: 2, bracket_matches_removed: 1, incomplete: true,
        failed_steps: ['format'], stage_already_ended: true },
    }));
  });

  it.each([['reset', reset], ['preview', preview], ['reopen', reopen]] as const)(
    '%s denies actors outside the native phase scope before dispatch',
    async (_verb, route) => {
      h.phaseAdmin.mockResolvedValue(false);
      h.tournamentAdmin.mockResolvedValue(true);
      const response = await send(route);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'forbidden' });
      expect(h.phaseAdmin).toHaveBeenCalledExactlyOnceWith(actor, owner.phase_id);
      expect(h.tournamentAdmin).not.toHaveBeenCalled();
      expect(h.rate).not.toHaveBeenCalled();
      expectNoCorrection();
    },
  );

  it.each([null, { ...match, phase_id: tournamentId }, { ...match, id: tournamentId }])(
    'does not fall back when the match disagrees with the native owner (%j)',
    async (row) => {
      h.phaseMatch.mockResolvedValue(row);
      const response = await send(reset, { cascade: true });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'match_not_found' });
      expect(h.tournamentMatch).not.toHaveBeenCalled();
      expect(h.phaseAdmin).not.toHaveBeenCalled();
      expectNoCorrection();
    },
  );

  it.each(['frozen_legacy', 'frozen_phase'])('keeps every correction closed in %s', async (mode) => {
    h.mode.mockResolvedValue(mode);
    for (const route of [reset, preview, reopen]) {
      const response = await send(route);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    }
    expect(h.findOwner).not.toHaveBeenCalled();
    expect(h.tournamentMatch).not.toHaveBeenCalled();
    expectNoCorrection();
  });

  it('does not query storage for unauthenticated requests or malformed match IDs', async () => {
    expect((await send(preview, {}, 'wrong')).status).toBe(404);
    h.player.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
    expect((await send(reset)).status).toBe(401);
    expect(h.mode).not.toHaveBeenCalled();
    expectNoCorrection();
  });
});

describe('ID-only tournament match corrections', () => {
  beforeEach(() => {
    h.findOwner.mockResolvedValue(null);
    h.tournamentAdmin.mockResolvedValue(true);
    h.tournamentMatch.mockResolvedValue({ ...match, tournament_id: tournamentId });
    h.tournamentReset.mockResolvedValue(resetResult);
    h.tournamentPreview.mockResolvedValue(previewResult);
    h.tournamentReopen.mockResolvedValue(reopenResult);
  });

  async function expectTournamentDispatch() {
    for (const route of [reset, preview, reopen]) expect((await send(route)).status).toBe(200);
    expect(h.tournamentReset).toHaveBeenCalledExactlyOnceWith(id, actor.playerId, false);
    expect(h.tournamentPreview).toHaveBeenCalledExactlyOnceWith(id);
    expect(h.tournamentReopen).toHaveBeenCalledExactlyOnceWith(id, actor.playerId);
    expect(h.tournamentAdmin).toHaveBeenCalledWith(actor.playerId, 'tournament', tournamentId);
    expect(h.phaseAdmin).not.toHaveBeenCalled();
    expect(h.phaseMatch).not.toHaveBeenCalled();
    expect(h.native).not.toHaveBeenCalled();
    expect(h.tag).toHaveBeenCalledWith(`tournament:${tournamentId}`, { expire: 0 });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'match', resource_id: id, metadata: expect.objectContaining({ tournament_id: tournamentId }),
    }));
  }

  it('dispatches a verified standalone match to the existing tournament correction entrypoints', async () => {
    h.isStandalone.mockResolvedValue(true);
    await expectTournamentDispatch();
    expect(h.isStandalone).toHaveBeenCalledTimes(3);
    expect(h.isStandalone).toHaveBeenCalledWith(id, tournamentId);
  });

  it('rejects a tournament match that is not standalone in phase mode, even for a site admin', async () => {
    h.player.mockResolvedValue({ ...actor, isAdmin: true });
    h.isStandalone.mockResolvedValue(false);
    expect((await send(reopen)).status).toBe(404);
    expect(h.isStandalone).toHaveBeenCalledExactlyOnceWith(id, tournamentId);
    expectNoCorrection();
  });

  it('makes no new-schema read and keeps the original path with readiness off', async () => {
    vi.stubEnv('READ_PHASE_STORAGE_STATE', '');
    await expectTournamentDispatch();
    expect(h.mode).not.toHaveBeenCalled();
    expect(h.findOwner).not.toHaveBeenCalled();
    expect(h.isStandalone).not.toHaveBeenCalled();
  });
});
