/**
 * POST /api/seasons with `clone_from`: the policy runs before any write, the
 * copy reports what it took over, and a failure removes the new league again.
 * The clone module itself runs for real; only the data layer is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAnyAdmin: vi.fn(),
  getSeasonById: vi.fn(),
  createSeason: vi.fn(),
  deleteSeason: vi.fn(),
  addResourceAdmin: vi.fn(),
  removeResourceAdmin: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getResourceAdmins: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  createTournament: vi.fn(),
  deleteTournament: vi.fn(),
  listSeasonParticipantIds: vi.fn(),
  addSeasonParticipants: vi.fn(),
  syncStandingsEnrollment: vi.fn(),
  expireSeasonReads: vi.fn(),
  logAuditEvent: vi.fn(),
  initializeEpbFormatRules: vi.fn(),
  ensurePointBuyBattleRuleset: vi.fn(),
  getActiveListVersion: vi.fn(),
  bindSeasonToList: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: mocks.requireAnyAdmin,
  getLiveAccess: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  listSeasons: vi.fn(),
  listArchivedSeasons: vi.fn(),
  createSeason: mocks.createSeason,
  getSeasonById: mocks.getSeasonById,
  deleteSeason: mocks.deleteSeason,
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  addResourceAdmin: mocks.addResourceAdmin,
  removeResourceAdmin: mocks.removeResourceAdmin,
  isResourceAdminFor: mocks.isResourceAdminFor,
  getResourceAdmins: mocks.getResourceAdmins,
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: mocks.getStagesBySeasonId,
  createTournament: mocks.createTournament,
  deleteTournament: mocks.deleteTournament,
}));
vi.mock('@/lib/supabase/queries/season-clone', () => ({
  listSeasonParticipantIds: mocks.listSeasonParticipantIds,
  addSeasonParticipants: mocks.addSeasonParticipants,
}));
vi.mock('@/lib/tournament/enrollment-sync', () => ({ syncStandingsEnrollment: mocks.syncStandingsEnrollment }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: mocks.expireSeasonReads }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock('@/lib/season/format-rules-defaults', () => ({ initializeEpbFormatRules: mocks.initializeEpbFormatRules }));
vi.mock('@/lib/season/point-buy-battle-ruleset', () => ({
  ensurePointBuyBattleRuleset: mocks.ensurePointBuyBattleRuleset,
}));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getActiveListVersion: mocks.getActiveListVersion,
  bindSeasonToList: mocks.bindSeasonToList,
}));

import { POST } from '@/app/api/seasons/route';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';

const siteAdmin = { playerId: 'admin-1', name: 'Admin', isAdmin: true, isResourceAdmin: false };
const resourceAdmin = { playerId: 'radmin-1', name: 'Resource Admin', isAdmin: false, isResourceAdmin: true };

const sourceSeason = { id: SOURCE_ID, name: 'Autumn League', format_type: 'singles', archived: true };
const newSeason = { id: 'season-new', name: 'Spring League', format_type: 'singles' };

function phase(id: string, order: number, name: string) {
  return {
    id,
    name,
    description: '',
    season_id: SOURCE_ID,
    bracket_type: 'round_robin',
    ruleset_id: 'rs-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'private',
    status: 'completed',
    stage_order: order,
    advancement_rule: null,
  };
}

function request(body: Record<string, unknown>): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

const cloneBody = (clone: Record<string, unknown> = {}) => ({
  name: 'Spring League',
  format_type: 'singles',
  clone_from: { season_id: SOURCE_ID, ...clone },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.requireAnyAdmin.mockResolvedValue(siteAdmin);
  mocks.getSeasonById.mockResolvedValue(sourceSeason);
  mocks.createSeason.mockResolvedValue(newSeason);
  mocks.getStagesBySeasonId.mockResolvedValue([phase('src-a', 1, 'Groups'), phase('src-b', 3, 'Playoffs')]);
  let n = 0;
  mocks.createTournament.mockImplementation(async () => ({ id: `new-ph-${++n}` }));
  mocks.listSeasonParticipantIds.mockResolvedValue(['p1', 'p2']);
  mocks.getResourceAdmins.mockResolvedValue([{ player_id: 'a2' }]);
  mocks.isResourceAdminFor.mockResolvedValue(true);
  mocks.getActiveListVersion.mockResolvedValue(null);
});

describe('POST /api/seasons with clone_from — refusals write nothing', () => {
  it('404 for an unknown source: no ruleset ensure, no league, no admin grant', async () => {
    mocks.requireAnyAdmin.mockResolvedValue(resourceAdmin);
    mocks.getSeasonById.mockResolvedValue(null);

    const response = await POST(
      request({ name: 'Evo', format_type: 'evolution_point_buy', clone_from: { season_id: SOURCE_ID } }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe('SEASON_NOT_FOUND');
    expect(mocks.ensurePointBuyBattleRuleset).not.toHaveBeenCalled();
    expect(mocks.createSeason).not.toHaveBeenCalled();
    expect(mocks.addResourceAdmin).not.toHaveBeenCalled();
  });

  it('403 for a source the resource admin does not administer', async () => {
    mocks.requireAnyAdmin.mockResolvedValue(resourceAdmin);
    mocks.isResourceAdminFor.mockResolvedValue(false);

    const response = await POST(
      request({ name: 'Evo', format_type: 'evolution_point_buy', clone_from: { season_id: SOURCE_ID } }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('SEASON_CLONE_FORBIDDEN');
    expect(mocks.ensurePointBuyBattleRuleset).not.toHaveBeenCalled();
    expect(mocks.createSeason).not.toHaveBeenCalled();
    expect(mocks.addResourceAdmin).not.toHaveBeenCalled();
  });

  it('409 for a custom-format source: no ruleset ensure, no league, no admin grant, no phase read', async () => {
    mocks.getSeasonById.mockResolvedValue({ ...sourceSeason, format_type: 'custom' });

    const response = await POST(request(cloneBody({ copy_roster: true })));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('SEASON_CLONE_CUSTOM_FORMAT');
    expect(mocks.ensurePointBuyBattleRuleset).not.toHaveBeenCalled();
    expect(mocks.createSeason).not.toHaveBeenCalled();
    expect(mocks.addResourceAdmin).not.toHaveBeenCalled();
    expect(mocks.getStagesBySeasonId).not.toHaveBeenCalled();
    expect(mocks.createTournament).not.toHaveBeenCalled();
  });

  it('403 when a resource admin copies the league admins, even from their own league', async () => {
    mocks.requireAnyAdmin.mockResolvedValue(resourceAdmin);

    const response = await POST(request(cloneBody({ copy_admins: true })));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('SEASON_CLONE_ADMINS_FORBIDDEN');
    expect(mocks.createSeason).not.toHaveBeenCalled();
    expect(mocks.addResourceAdmin).not.toHaveBeenCalled();
  });

  it('400 for a malformed clone block, before any read', async () => {
    const response = await POST(request({ name: 'X', format_type: 'singles', clone_from: { season_id: 'nope' } }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(mocks.getSeasonById).not.toHaveBeenCalled();
    expect(mocks.createSeason).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons with clone_from — copy', () => {
  it('site admin: 201 with the copy report, one audit entry, reads expired with the new phase ids', async () => {
    const response = await POST(request(cloneBody({ copy_roster: true, copy_admins: true })));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      ...newSeason,
      clone: { source_id: SOURCE_ID, phases: 2, participants: 2, admins: 1 },
    });
    // clone_from is not a league field.
    expect(mocks.createSeason).toHaveBeenCalledWith({ name: 'Spring League', format_type: 'singles' });
    expect(mocks.addSeasonParticipants).toHaveBeenCalledWith('season-new', ['p1', 'p2']);
    expect(mocks.addResourceAdmin).toHaveBeenCalledWith('a2', 'season', 'season-new');
    expect(mocks.logAuditEvent.mock.calls.filter(([e]) => e.action === 'season.clone')).toHaveLength(1);
    expect(mocks.expireSeasonReads).toHaveBeenCalledWith('season-new', ['new-ph-1', 'new-ph-2']);
  });

  it('resource admin: becomes league admin of the copy; phases only without options', async () => {
    mocks.requireAnyAdmin.mockResolvedValue(resourceAdmin);

    const response = await POST(request(cloneBody()));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.clone).toEqual({ source_id: SOURCE_ID, phases: 2, participants: 0, admins: 0 });
    expect(mocks.addResourceAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.addResourceAdmin).toHaveBeenCalledWith('radmin-1', 'season', 'season-new');
    expect(mocks.addSeasonParticipants).not.toHaveBeenCalled();
    expect(mocks.getResourceAdmins).not.toHaveBeenCalled();
  });

  it('a point-buy destination from a singles source gets the normal setup and reads nothing of the source rules', async () => {
    const epb = { ...newSeason, format_type: 'evolution_point_buy' };
    mocks.createSeason.mockResolvedValue(epb);
    mocks.ensurePointBuyBattleRuleset.mockResolvedValue({
      ruleset: { id: 'rs-pack', name: 'Pack' },
      created: false,
      bansCleared: false,
    });
    mocks.getActiveListVersion.mockResolvedValue({ id: 'list-active' });

    const response = await POST(
      request({ name: 'Evo', format_type: 'evolution_point_buy', clone_from: { season_id: SOURCE_ID } }),
    );

    expect(response.status).toBe(201);
    expect(mocks.initializeEpbFormatRules).toHaveBeenCalledTimes(1);
    expect(mocks.initializeEpbFormatRules).toHaveBeenCalledWith('season-new');
    // The list binding concerns the new league only; the source's list is never looked up.
    expect(mocks.bindSeasonToList).toHaveBeenCalledWith('season-new', 'list-active');
    expect(mocks.getActiveListVersion).toHaveBeenCalledTimes(1);
    expect(mocks.createSeason).toHaveBeenCalledWith(expect.objectContaining({ ruleset_id: 'rs-pack' }));
  });
});

describe('POST /api/seasons with clone_from — failure removes the new league', () => {
  it('a failure mid-copy: 500 SEASON_CLONE_FAILED, the created phase and the league are deleted', async () => {
    mocks.createTournament.mockReset();
    mocks.createTournament.mockResolvedValueOnce({ id: 'new-ph-1' }).mockRejectedValueOnce(new Error('insert failed'));

    const response = await POST(request(cloneBody({ copy_roster: true })));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.code).toBe('SEASON_CLONE_FAILED');
    expect(mocks.deleteTournament).toHaveBeenCalledWith('new-ph-1');
    expect(mocks.deleteSeason).toHaveBeenCalledWith('season-new');
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'season.clone_failed' }));
    expect(mocks.logAuditEvent).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'season.clone' }));
  });

  it('a non-site-admin creator loses the league admin row that was granted for the failed league', async () => {
    mocks.requireAnyAdmin.mockResolvedValue(resourceAdmin);
    mocks.syncStandingsEnrollment.mockRejectedValue(new Error('sync failed'));

    const response = await POST(request(cloneBody()));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('SEASON_CLONE_FAILED');
    expect(mocks.removeResourceAdmin).toHaveBeenCalledWith('radmin-1', 'season', 'season-new');
    expect(mocks.deleteSeason).toHaveBeenCalledWith('season-new');
  });

  it('a failure in the point-buy setup after the league exists also removes it', async () => {
    mocks.createSeason.mockResolvedValue({ ...newSeason, format_type: 'evolution_point_buy' });
    mocks.ensurePointBuyBattleRuleset.mockResolvedValue({
      ruleset: { id: 'rs-pack', name: 'Pack' },
      created: false,
      bansCleared: false,
    });
    mocks.initializeEpbFormatRules.mockRejectedValue(new Error('rules failed'));

    const response = await POST(
      request({ name: 'Evo', format_type: 'evolution_point_buy', clone_from: { season_id: SOURCE_ID } }),
    );

    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('SEASON_CLONE_FAILED');
    expect(mocks.deleteSeason).toHaveBeenCalledWith('season-new');
    expect(mocks.createTournament).not.toHaveBeenCalled();
  });

  it('a cleanup that fails too answers SEASON_CLONE_CLEANUP_FAILED naming the remains', async () => {
    mocks.createTournament.mockReset();
    mocks.createTournament.mockResolvedValueOnce({ id: 'new-ph-1' }).mockRejectedValueOnce(new Error('insert failed'));
    mocks.deleteSeason.mockRejectedValue(new Error('still referenced'));

    const response = await POST(request(cloneBody({ copy_roster: true })));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('SEASON_CLONE_CLEANUP_FAILED');
    expect(body.params).toEqual({ league_id: 'season-new', phases: 0, participants: 2 });
  });
});

describe('POST /api/seasons without clone_from', () => {
  it('behaves as before: same calls, a 201 body without a clone key, nothing read from any source', async () => {
    mocks.requireAnyAdmin.mockResolvedValue(resourceAdmin);

    const response = await POST(request({ name: 'Spring League', format_type: 'singles' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ success: true, data: newSeason });
    expect(mocks.createSeason).toHaveBeenCalledWith({ name: 'Spring League', format_type: 'singles' });
    expect(mocks.addResourceAdmin).toHaveBeenCalledWith('radmin-1', 'season', 'season-new');
    expect(mocks.expireSeasonReads).toHaveBeenCalledWith('season-new');
    for (const untouched of [
      mocks.getSeasonById,
      mocks.getStagesBySeasonId,
      mocks.createTournament,
      mocks.listSeasonParticipantIds,
      mocks.isResourceAdminFor,
      mocks.logAuditEvent,
    ]) {
      expect(untouched).not.toHaveBeenCalled();
    }
  });

  it('a failure after the league exists passes through without a rollback', async () => {
    mocks.requireAnyAdmin.mockResolvedValue(resourceAdmin);
    mocks.addResourceAdmin.mockRejectedValue(new Error('grant failed'));

    const response = await POST(request({ name: 'Spring League', format_type: 'singles' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to create league');
    expect(body.code).toBeUndefined();
    expect(mocks.deleteSeason).not.toHaveBeenCalled();
    expect(mocks.deleteTournament).not.toHaveBeenCalled();
  });
});
