import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSet } from '@/test/team-fixtures';

const mock = vi.hoisted(() => ({
  requirePlayer: vi.fn(), requireAdmin: vi.fn(), getPhaseRouteMode: vi.fn(),
  getPhaseTeamById: vi.fn(), getPhaseTeamVisibilityFacts: vi.fn(), writePhaseTeam: vi.fn(),
  // The phase services build one object from every storage export, so each must exist on the mock.
  listPhaseTeams: vi.fn(), getPlannedPhaseTeam: vi.fn(), getPlayerPhaseTeamForMatch: vi.fn(),
  getPhaseMatchPrepTeams: vi.fn(), listPhaseLibraryTeams: vi.fn(), createPhaseTeam: vi.fn(),
  setPhaseTeamShareToken: vi.fn(), disablePhaseTeamShareToken: vi.fn(), publishPhaseTeam: vi.fn(),
  unpublishPhaseTeam: vi.fn(), forkPhaseTeamToLibrary: vi.fn(), releasePhaseTeamsFromMatches: vi.fn(),
  getPhaseById: vi.fn(), getPhaseMatchById: vi.fn(), getSeasonById: vi.fn(),
  getTeamById: vi.fn(), updateTeamPokemon: vi.fn(), deleteTeam: vi.fn(), getTeamVisibilityFacts: vi.fn(),
  getTournamentById: vi.fn(), adviseKitTeam: vi.fn(),
  expirePhaseReads: vi.fn(), expirePublicTags: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({ requirePlayer: mock.requirePlayer, requireAdmin: mock.requireAdmin }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: mock.getPhaseRouteMode }));
vi.mock('@/lib/supabase/queries/phase-teams', () => mock);
vi.mock('@/lib/supabase/queries/league-phases', () => mock);
vi.mock('@/lib/supabase/queries/phase-matches', () => mock);
vi.mock('@/lib/supabase/queries/seasons', () => mock);
vi.mock('@/lib/supabase/queries/teams', () => mock);
vi.mock('@/lib/supabase/queries/tournaments', () => mock);
vi.mock('@/lib/team/kit-team-gate', () => ({ adviseKitTeam: mock.adviseKitTeam }));
vi.mock('@/lib/revalidation', () => ({
  ...mock,
  publicTags: { aggregates: (scope: string, id: string | null) => ['aggregates', scope, id].filter(Boolean).join(':') },
}));

// ─── Fixtures ───────────────────────────────────────────────────────

const teamId = 'ac000000-0000-4000-8000-000000000001';
const phaseId = 'ac000000-0000-4000-8000-000000000002';
const seasonId = 'ac000000-0000-4000-8000-000000000003';
const matchId = 'ac000000-0000-4000-8000-000000000004';
const playerId = 'ac000000-0000-4000-8000-000000000005';
const otherId = 'ac000000-0000-4000-8000-000000000006';

const pokemon = [makeSet('Pikachu')];

const team = {
  id: teamId,
  player_id: playerId,
  phase_id: phaseId,
  season_id: seasonId as string | null,
  name: 'League team',
  match_id: null as string | null,
  pokemon,
  import_source: 'manual',
  locked: false,
  is_draft_team: false,
  draft_pool_id: null,
  library_published_at: null,
  library_title: null,
  library_description: null,
  library_tags: null,
  forked_from_team_id: null,
  forked_from_phase_team_id: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

const phase = { id: phaseId, season_id: seasonId, status: 'active', archived: false };
const season = { id: seasonId, status: 'active', archived: false };
const request = (body: Record<string, unknown> = {}) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;
const params = { params: Promise.resolve({ id: teamId }) };
const bodyPayload = { pokemon, import_source: 'manual' };

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, PATCH, DELETE } from '@/app/api/teams/[id]/route';
import { REDACTED_POKEMON } from '@/lib/team/visibility';

beforeEach(() => {
  vi.resetAllMocks();
  mock.requirePlayer.mockResolvedValue({ playerId, isAdmin: false });
  mock.requireAdmin.mockResolvedValue({ playerId, isAdmin: true });
  mock.getPhaseRouteMode.mockResolvedValue('phase');
  mock.getPhaseTeamById.mockResolvedValue(team);
  mock.getPhaseTeamVisibilityFacts.mockResolvedValue(new Map());
  mock.writePhaseTeam.mockImplementation(async (args: { p_operation: string }) =>
    args.p_operation === 'edit' ? { ...team, pokemon } : null);
  mock.getPhaseById.mockResolvedValue(phase);
  mock.getPhaseMatchById.mockResolvedValue({ id: matchId, phase_id: phaseId, status: 'scheduled' });
  mock.getSeasonById.mockResolvedValue(season);
  mock.adviseKitTeam.mockResolvedValue({});
  mock.getTeamVisibilityFacts.mockResolvedValue(new Map());
});

describe('a native phase team id', () => {
  it('GET answers the owner with the phase team, without the share columns and without deciding any roster', async () => {
    const response = await GET(request() as NextRequest, params);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toMatchObject({ id: teamId, phase_id: phaseId, season_id: seasonId, pokemon });
    expect(json.data).not.toHaveProperty('share_token');
    expect(json.data).not.toHaveProperty('share_enabled_at');
    expect(mock.getPhaseTeamVisibilityFacts).toHaveBeenCalledExactlyOnceWith([]);
    expect(mock.getTeamById).not.toHaveBeenCalled();
  });

  it('GET redacts another player\'s unpublished planned roster, and still answers a completed match\'s', async () => {
    mock.requirePlayer.mockResolvedValue({ playerId: otherId, isAdmin: false });
    mock.getPhaseTeamVisibilityFacts.mockResolvedValue(new Map([[teamId, { match_status: 'scheduled', tournament_visibility: 'hidden' }]]));
    expect((await (await GET(request() as NextRequest, params)).json()).data.pokemon).toEqual(REDACTED_POKEMON);

    mock.getPhaseTeamById.mockResolvedValue({ ...team, match_id: matchId });
    mock.getPhaseTeamVisibilityFacts.mockResolvedValue(new Map([[teamId, { match_status: 'completed', tournament_visibility: 'hidden' }]]));
    expect((await (await GET(request() as NextRequest, params)).json()).data.pokemon).toEqual(pokemon);
  });

  it('GET reads no phase storage in legacy mode', async () => {
    mock.getPhaseRouteMode.mockResolvedValue('legacy');
    mock.getTeamById.mockResolvedValue(null);
    expect((await GET(request() as NextRequest, params)).status).toBe(404);
    expect(mock.getPhaseTeamById).not.toHaveBeenCalled();
  });

  it('PATCH writes through the phase writer with the live owner and expires the phase reads after the commit', async () => {
    const response = await PATCH(request({ ...bodyPayload, name: 'Renamed' }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ id: teamId, phase_id: phaseId });
    expect(mock.writePhaseTeam).toHaveBeenCalledExactlyOnceWith({
      p_operation: 'edit', p_team_id: teamId, p_phase_id: phaseId, p_player_id: playerId,
      p_pokemon: pokemon, p_import_source: 'manual', p_name: 'Renamed', p_actor: 'owner',
    });
    expect(mock.expirePhaseReads).toHaveBeenCalledExactlyOnceWith(phaseId, seasonId);
    expect(mock.expirePhaseReads.mock.invocationCallOrder[0])
      .toBeGreaterThan(mock.writePhaseTeam.mock.invocationCallOrder[0]);
    expect(mock.expirePublicTags).not.toHaveBeenCalled();
    expect(mock.updateTeamPokemon).not.toHaveBeenCalled();
    expect(mock.getTournamentById).not.toHaveBeenCalled();
  });

  it('PATCH expires the item usage scopes of a match-linked row, and reads the season only when the row carries none', async () => {
    mock.getPhaseTeamById.mockResolvedValue({ ...team, match_id: matchId, season_id: null });
    mock.writePhaseTeam.mockResolvedValue({ ...team, match_id: matchId, season_id: null });
    expect((await PATCH(request(bodyPayload), params)).status).toBe(200);
    expect(mock.expirePhaseReads).toHaveBeenCalledExactlyOnceWith(phaseId, seasonId);
    expect(mock.expirePublicTags).toHaveBeenCalledExactlyOnceWith([
      'aggregates:all_time', `aggregates:phase:${phaseId}`, `aggregates:league:${seasonId}`,
    ]);
    expect(mock.getPhaseById).toHaveBeenCalledWith(phaseId);
  });

  it('PATCH answers 403 team_not_owner for another player and writes nothing', async () => {
    mock.requirePlayer.mockResolvedValue({ playerId: otherId, isAdmin: false });
    const response = await PATCH(request(bodyPayload), params);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'team_not_owner' });
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('PATCH answers 409 team_locked on a manually locked team, for its owner and for a site admin alike', async () => {
    mock.getPhaseTeamById.mockResolvedValue({ ...team, locked: true });
    expect(await (await PATCH(request(bodyPayload), params)).json()).toMatchObject({ code: 'team_locked' });

    // The machine has no edit transition out of `locked`; only a force-delete is a correction.
    mock.requirePlayer.mockResolvedValue({ playerId: otherId, isAdmin: true });
    expect(await (await PATCH(request(bodyPayload), params)).json()).toMatchObject({ code: 'team_locked' });
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('PATCH answers the closure code of a completed phase or a closed league, and nothing is written', async () => {
    mock.getPhaseById.mockResolvedValue({ ...phase, status: 'completed' });
    expect(await (await PATCH(request(bodyPayload), params)).json()).toMatchObject({ code: 'team_submission_closed' });

    mock.getPhaseById.mockResolvedValue(phase);
    mock.getSeasonById.mockResolvedValue({ ...season, archived: true });
    expect(await (await PATCH(request(bodyPayload), params)).json()).toMatchObject({ code: 'team_submission_league_closed' });
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('PATCH keeps a completed match\'s roster final for its owner (409 team_match_completed)', async () => {
    mock.getPhaseTeamById.mockResolvedValue({ ...team, match_id: matchId });
    mock.getPhaseMatchById.mockResolvedValue({ id: matchId, phase_id: phaseId, status: 'completed' });
    const response = await PATCH(request(bodyPayload), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'team_match_completed' });
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('PATCH answers 409 team_changed when the row moved on under the write', async () => {
    mock.writePhaseTeam.mockResolvedValue(null);
    const response = await PATCH(request(bodyPayload), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'team_changed' });
    expect(mock.expirePhaseReads).not.toHaveBeenCalled();
  });

  it('DELETE removes the native row through the phase writer and expires the phase reads', async () => {
    const response = await DELETE(request() as NextRequest, params);
    expect(await response.json()).toEqual({ success: true, data: null });
    expect(mock.writePhaseTeam).toHaveBeenCalledExactlyOnceWith({
      p_operation: 'delete', p_team_id: teamId, p_phase_id: phaseId, p_player_id: playerId, p_actor: 'owner',
    });
    expect(mock.expirePhaseReads).toHaveBeenCalledExactlyOnceWith(phaseId, seasonId);
    expect(mock.deleteTeam).not.toHaveBeenCalled();
  });

  it('DELETE answers 409 team_locked for the owner, and re-checks the live admin role before a force-delete', async () => {
    mock.getPhaseTeamById.mockResolvedValue({ ...team, locked: true });
    expect((await DELETE(request() as NextRequest, params)).status).toBe(409);
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();

    mock.requirePlayer.mockResolvedValue({ playerId: otherId, isAdmin: true });
    expect((await DELETE(request() as NextRequest, params)).status).toBe(200);
    expect(mock.requireAdmin).toHaveBeenCalledOnce();
    expect(mock.writePhaseTeam).toHaveBeenCalledWith(expect.objectContaining({ p_operation: 'delete', p_actor: 'admin' }));
  });

  it('DELETE answers 403 team_not_owner for another player', async () => {
    mock.requirePlayer.mockResolvedValue({ playerId: otherId, isAdmin: false });
    const response = await DELETE(request() as NextRequest, params);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'team_not_owner' });
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('answers 503 phase_storage_unavailable on every method while the storage is frozen mid-transfer', async () => {
    mock.getPhaseRouteMode.mockResolvedValue('frozen_phase');
    for (const response of [
      await GET(request() as NextRequest, params),
      await PATCH(request(bodyPayload), params),
      await DELETE(request() as NextRequest, params),
    ]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
    }
    expect(mock.writePhaseTeam).not.toHaveBeenCalled();
  });

  it('keeps the legacy path for an id no native row holds, in phase mode', async () => {
    mock.getPhaseTeamById.mockResolvedValue(null);
    mock.getTeamById.mockResolvedValue(null);
    expect((await GET(request() as NextRequest, params)).status).toBe(404);
    expect(mock.getPhaseTeamById).toHaveBeenCalledOnce();
  });
});
