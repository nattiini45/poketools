import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
import { POST } from '../route';
import { DELETE, PATCH } from '../[phaseId]/route';

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(), mode: vi.fn(), season: vi.fn(), format: vi.fn(), legacyFormatPhases: vi.fn(),
  list: vi.fn(), create: vi.fn(), shift: vi.fn(), detail: vi.fn(), update: vi.fn(), remove: vi.fn(), rounds: vi.fn(),
  sync: vi.fn(), assign: vi.fn(), legacyList: vi.fn(), legacyCreate: vi.fn(), legacyDetail: vi.fn(), legacyRead: vi.fn(),
  legacyUpdate: vi.fn(), legacyRemove: vi.fn(), legacyRounds: vi.fn(), legacySync: vi.fn(), legacyAssign: vi.fn(),
  createPin: vi.fn(), changePin: vi.fn(), expire: vi.fn(), announce: vi.fn(), audit: vi.fn(), react: vi.fn(), enroll: vi.fn(),
  rebuild: vi.fn(),
}));

vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: h.requireAdmin }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: h.season }));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getSeasonKitHead: h.format, getKitPhases: h.legacyFormatPhases }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({
  getPhasesBySeasonId: h.list, insertAdminPhase: h.create, shiftPhaseStageOrders: h.shift, getPhaseWithDetails: h.detail,
  updatePhase: h.update, deleteAdminPhase: h.remove,
}));
vi.mock('@/lib/league-phase/entity-rebuild', () => ({ createMixedEntityDeleteRebuilder: () => ({ rebuildAfterPhaseDelete: h.rebuild }) }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({ getRoundsByPhase: vi.fn(), listRoundStatusesByPhaseIds: h.rounds }));
vi.mock('@/lib/league-phase/enrollment-services', () => ({ createNativePhaseEnrollment: () => ({ sync: h.sync, enroll: h.enroll }) }));
vi.mock('@/lib/supabase/queries/phase-admins', () => ({ addPhaseAdmin: h.assign }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: h.legacyList, createTournament: h.legacyCreate, getTournamentWithDetails: h.legacyDetail,
  getTournamentById: h.legacyRead, updateTournament: h.legacyUpdate, deleteTournament: h.legacyRemove,
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: h.legacyRounds }));
vi.mock('@/lib/tournament/enrollment-sync', () => ({ syncStandingsEnrollment: h.legacySync }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ addResourceAdmin: h.legacyAssign }));
vi.mock('@/lib/ruleset-studio/pin-change', () => ({
  assertRulesetUsableForCreate: h.createPin, assertRulesetChangeAllowed: h.changePin,
}));
vi.mock('next/cache', () => ({ revalidateTag: h.expire }));
vi.mock('@/lib/format-engine/runtime/hooks', () => ({ onNativePhaseStatusChanged: h.react }));
vi.mock('@/lib/league-phase/announcements', () => ({ announcePhaseCompletion: h.announce }));
vi.mock('@/lib/audit/log', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/audit/log')>(),
  logAuditEvent: h.audit,
}));

const SEASON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PHASE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = { playerId: 'admin-1', name: 'Admin', isAdmin: false };
const ROW = {
  id: PHASE, season_id: SEASON, name: 'Qualifiers', status: 'upcoming', bracket_type: 'swiss',
  stage_order: 1, ruleset_id: PIN, best_of_default: 3, bo_overrides: {}, format_stage_key: null,
};
const args = { params: Promise.resolve({ id: SEASON, phaseId: PHASE }) };
const createBody = { name: ROW.name, bracket_type: ROW.bracket_type, ruleset_id: PIN };

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost:3000/api/phases', {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  h.requireAdmin.mockResolvedValue(ADMIN);
  h.mode.mockResolvedValue('phase');
  h.season.mockResolvedValue({ id: SEASON, name: 'League' });
  h.format.mockResolvedValue(null);
  h.list.mockResolvedValue([]);
  h.create.mockResolvedValue({ phase: ROW, shiftedIds: [] });
  h.detail.mockResolvedValue(ROW);
  h.update.mockResolvedValue({ ...ROW, status: 'completed' });
  h.rounds.mockResolvedValue([]);
  for (const legacy of [h.legacyFormatPhases, h.legacyList, h.legacyRead, h.legacyDetail, h.legacyRounds, h.legacyCreate,
    h.legacyUpdate, h.legacyRemove, h.legacySync, h.legacyAssign]) {
    legacy.mockImplementation(() => { throw new Error('unexpected legacy phase access'); });
  }
});

describe('native phase creation', () => {
  it('appends, grants phase administration, syncs native enrollment and expires native reads', async () => {
    const response = await POST(req('POST', createBody), args);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { id: PHASE, season_id: SEASON } });
    expect(h.requireAdmin).toHaveBeenCalledWith('season', SEASON);
    expect(h.createPin).toHaveBeenCalledWith(ADMIN, PIN);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ ...createBody, season_id: SEASON }), undefined);
    expect(h.list).not.toHaveBeenCalled();
    expect(h.assign).toHaveBeenCalledWith(ADMIN.playerId, PHASE);
    expect(h.sync).toHaveBeenCalledWith(SEASON, PHASE);
    expect(h.detail).toHaveBeenCalledWith(PHASE, SEASON);
    expect(h.expire).toHaveBeenCalledWith(`phase:${PHASE}`, { expire: 0 });
    expect(h.expire).not.toHaveBeenCalledWith(`tournament:${PHASE}`, expect.anything());
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'phase.create', resource_type: 'season', resource_id: SEASON }));
  });

  it('checks the live admin before consulting generation or any phase storage', async () => {
    h.requireAdmin.mockRejectedValue(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
    expect((await POST(req('POST', createBody), args)).status).toBe(403);
    expect(h.mode).not.toHaveBeenCalled();
    expect(h.season).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('refuses an attached format and a forbidden pin before creating anything', async () => {
    h.format.mockResolvedValueOnce({ engine: 'kit' });
    const attached = await POST(req('POST', createBody), args);
    expect(await attached.json()).toMatchObject({ code: 'format_phase_owned' });
    h.createPin.mockRejectedValue(new RulesetStudioError('ruleset_forbidden'));
    const forbidden = await POST(req('POST', createBody), args);
    expect(await forbidden.json()).toMatchObject({ code: 'ruleset_forbidden' });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.shift).not.toHaveBeenCalled();
  });

  it('expires the committed native phase even when enrollment fails', async () => {
    h.sync.mockRejectedValue(new Error('enrollment failed'));
    expect((await POST(req('POST', createBody), args)).status).toBe(500);
    expect(h.expire).toHaveBeenCalledWith(`phase:${PHASE}`, { expire: 0 });
    expect(h.legacySync).not.toHaveBeenCalled();
  });

  it('uses the committed shifted ids and propagates a refused native insertion', async () => {
    h.create.mockResolvedValueOnce({ phase: ROW, shiftedIds: [OTHER] })
      .mockRejectedValueOnce(new UserFacingError('Cannot insert a phase before stages that have already started', { code: 'PHASE_INSERT_LOCKED' }));
    const insert = () => POST(req('POST', { ...createBody, insert_at: 1 }), args);
    expect((await insert()).status).toBe(201);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ season_id: SEASON }), 1);
    expect(h.expire).toHaveBeenCalledWith(`phase:${OTHER}`, { expire: 0 });
    h.expire.mockClear();
    expect(await (await insert()).json()).toMatchObject({ code: 'PHASE_INSERT_LOCKED' });
    expect(h.shift).not.toHaveBeenCalled();
    expect(h.legacyCreate).not.toHaveBeenCalled();
    expect(h.expire).not.toHaveBeenCalledWith(`phase:${OTHER}`, expect.anything());
  });
});

describe('native phase update', () => {
  it('takes a status-CAS, sends a native completion announcement and audits the native phase', async () => {
    h.detail.mockResolvedValueOnce(ROW).mockResolvedValueOnce({ ...ROW, status: 'completed' });
    h.rounds.mockResolvedValue([{ status: 'completed' }, { status: 'active' }]);
    const response = await PATCH(req('PATCH', { status: 'completed' }), args);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: PHASE, status: 'completed', rounds_total: 2, rounds_completed: 1 } });
    expect(h.update).toHaveBeenCalledWith(PHASE, { status: 'completed' }, { from: 'upcoming', seasonId: SEASON });
    expect(h.announce).toHaveBeenCalledWith(expect.objectContaining({ id: PHASE, season_id: SEASON, status: 'completed' }));
    expect(h.expire).toHaveBeenCalledWith(`phase:${PHASE}`, { expire: 0 });
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ resource_type: 'phase', resource_id: PHASE }));
  });

  it('refuses cross-league ownership before evaluating any write guard', async () => {
    h.detail.mockResolvedValue({ ...ROW, season_id: OTHER });
    const response = await PATCH(req('PATCH', { status: 'completed' }), args);
    expect(response.status).toBe(404);
    expect(h.changePin).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('refuses edits to managed structure or status using native ownership', async () => {
    h.detail.mockResolvedValue({ ...ROW, format_stage_key: 'qualifiers' });
    for (const body of [{ status: 'active' }, { bracket_type: 'round_robin' }]) {
      const response = await PATCH(req('PATCH', body), args);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'format_phase_owned' });
    }
    expect(h.legacyFormatPhases).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('does not publish side effects when the phase has changed status concurrently', async () => {
    h.update.mockRejectedValue(new UserFacingError('Status changed', { code: 'tournament_status_changed', status: 409 }));
    const response = await PATCH(req('PATCH', { status: 'completed' }), args);
    expect(await response.json()).toMatchObject({ code: 'tournament_status_changed' });
    expect(h.expire).not.toHaveBeenCalled();
    expect(h.announce).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('does not overwrite a live pin move when the caller resends the stored ruleset id', async () => {
    const active = { ...ROW, status: 'active' };
    h.detail.mockResolvedValue(active);
    h.update.mockResolvedValue({ ...active, description: 'New description', ruleset_id: OTHER });
    const response = await PATCH(req('PATCH', { ruleset_id: PIN, description: 'New description' }), args);
    expect(response.status).toBe(200);
    expect(h.changePin).toHaveBeenCalledWith({ player: ADMIN, current: PIN, requested: PIN, started: true });
    expect(h.update).toHaveBeenCalledWith(PHASE, { description: 'New description' }, { from: 'active', seasonId: SEASON });
  });

  it('runs the native idempotent format reaction on an unchanged active status', async () => {
    const managed = { ...ROW, status: 'active', format_stage_key: 'qualifiers' };
    h.detail.mockResolvedValue(managed);
    h.update.mockResolvedValue(managed);
    h.react.mockResolvedValue({ applied: false, held: false, advance: { ran: false, results: [], error: null } });
    const response = await PATCH(req('PATCH', { status: 'active' }), args);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ warnings: [{ code: 'format_reaction_failed' }] });
    expect(h.react).toHaveBeenCalledWith(
      { phase: managed, from: 'upcoming', to: 'active', retry: true },
      expect.objectContaining({ invalidate: expect.any(Function) }),
    );
    expect(h.announce).not.toHaveBeenCalled();
    expect(h.legacyFormatPhases).not.toHaveBeenCalled();
  });
});

it('refuses wrong-owner or format-owned deletion without calling either store’s writer', async () => {
  const remove = () => DELETE(req('DELETE', { confirm: true }), args);
  h.detail.mockResolvedValueOnce({ ...ROW, season_id: OTHER });
  expect((await remove()).status).toBe(404);
  h.detail.mockResolvedValueOnce({ ...ROW, format_stage_key: 'qualifiers' });
  expect(await (await remove()).json()).toMatchObject({ code: 'format_phase_owned' });
  expect(h.legacyRead).not.toHaveBeenCalled();
  expect(h.legacyRemove).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.expire).not.toHaveBeenCalled();
});

it('checks round confirmation inside the native delete and rebuilds only after it commits', async () => {
  h.remove.mockRejectedValueOnce(new UserFacingError('Deleting a phase with rounds requires confirm: true', {
    code: 'PHASE_DELETE_CONFIRM_REQUIRED', status: 400,
  })).mockResolvedValueOnce({ name: ROW.name, playerIds: [OTHER] });
  const unconfirmed = await DELETE(req('DELETE'), args);
  expect(unconfirmed.status).toBe(400);
  expect(h.remove).toHaveBeenCalledWith(SEASON, PHASE, false);
  expect(h.rebuild).not.toHaveBeenCalled();
  expect(h.expire).not.toHaveBeenCalled();

  const confirmed = await DELETE(req('DELETE', { confirm: true }), args);
  expect(confirmed.status).toBe(200);
  expect(await confirmed.json()).toMatchObject({ data: { rebuild_warning: null } });
  expect(h.remove).toHaveBeenLastCalledWith(SEASON, PHASE, true);
  expect(h.legacyRemove).not.toHaveBeenCalled();
  expect(h.rebuild).toHaveBeenCalledExactlyOnceWith({ phaseId: PHASE, seasonId: SEASON, playerIds: [OTHER] });
  expect(h.expire).toHaveBeenCalledWith(`phase:${PHASE}`, { expire: 0 });
  expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'phase.delete', resource_type: 'phase', resource_id: PHASE }));
});

it('returns a rebuild warning without reporting a committed native delete as failed', async () => {
  h.remove.mockResolvedValue({ name: ROW.name, playerIds: [] });
  h.rebuild.mockRejectedValue(new Error('rebuild failed'));
  const response = await DELETE(req('DELETE', { confirm: true }), args);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { rebuild_warning: { code: 'derived_data_rebuild_failed' } } });
});

it('refuses all lifecycle writes while the storage generation is frozen', async () => {
  h.mode.mockRejectedValue(new UserFacingError('Unavailable', { code: 'phase_storage_unavailable', status: 503 }));
  const responses = await Promise.all([
    POST(req('POST', createBody), args), PATCH(req('PATCH', { status: 'active' }), args), DELETE(req('DELETE'), args),
  ]);
  expect(responses.map((response) => response.status)).toEqual([503, 503, 503]);
  expect(h.season).not.toHaveBeenCalled();
  expect(h.detail).not.toHaveBeenCalled();
  expect(h.legacyRead).not.toHaveBeenCalled();
});
