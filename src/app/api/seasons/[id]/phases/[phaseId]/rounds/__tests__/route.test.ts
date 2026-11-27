import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { GET as list } from '../route';
import { DELETE, GET as detail, PATCH } from '../[rid]/route';
import { POST } from '../manual/route';

const m = vi.hoisted(() => ({
  actor: vi.fn(), allowed: vi.fn(), mode: vi.fn(), season: vi.fn(), phase: vi.fn(), round: vi.fn(),
  rounds: vi.fn(), matches: vi.fn(), participants: vi.fn(), grouped: vi.fn(), seasonGroups: vi.fn(), phaseGroups: vi.fn(),
  create: vi.fn(), bestOf: vi.fn(), deadline: vi.fn(), status: vi.fn(), complete: vi.fn(),
  expire: vi.fn(), audit: vi.fn(), completed: vi.fn(), prepareKit: vi.fn(), deleteRound: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: m.actor,
  AuthError: class extends Error {
    constructor(message: string, readonly statusCode: number, readonly code: string) { super(message); }
  },
}));
vi.mock('@/lib/auth/phase-access', () => ({ canAdministerPhaseAccess: m.allowed }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: m.mode }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: m.season }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: m.phase, getPhaseParticipants: m.participants }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ seasonHasGroups: m.grouped, getSeasonGroups: m.seasonGroups }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupsByPhase: m.phaseGroups }));
vi.mock('@/lib/supabase/queries/phase-rounds', () => ({
  getPhaseRoundById: m.round, getRoundsByPhase: m.rounds, createPhaseRoundWithMatches: m.create,
  updatePhaseRoundBestOf: m.bestOf, updatePhaseRoundDeadline: m.deadline, updatePhaseRoundStatus: m.status, completePhaseRound: m.complete,
  deleteAdminPhaseRound: m.deleteRound,
}));
vi.mock('@/lib/supabase/queries/phase-matches', () => ({ getPhaseMatchesByRound: m.matches }));
vi.mock('@/lib/league-phase/standings-context', () => ({ loadNativeSeasonStandingsContext: vi.fn() }));
vi.mock('@/lib/supabase/queries/phase-format-runtime', () => ({ getNativeKitMatchFacts: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: m.expire }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: m.audit }));
vi.mock('../_lib/effects', () => ({ onPhaseRoundCompleted: m.completed }));
vi.mock('../_lib/kit-manual', () => ({ prepareManualKitRound: m.prepareKit }));

const id = '10000000-0000-4000-8000-0000000000a1';
const phaseId = '20000000-0000-4000-8000-0000000000b2';
const rid = '30000000-0000-4000-8000-0000000000c3';
const wrong = '40000000-0000-4000-8000-000000000004';
const p1 = '50000000-0000-4000-8000-0000000000d5';
const p2 = '60000000-0000-4000-8000-000000000006';
const p3 = '70000000-0000-4000-8000-000000000007';
const p4 = '80000000-0000-4000-8000-000000000008';
const phase = {
  id: phaseId, season_id: id, status: 'upcoming', bracket_type: 'swiss', current_round: 0,
  best_of_default: 1, bo_overrides: { 'Round 1': 3 },
};
const round = { id: rid, phase_id: phaseId, name: 'Round 1', status: 'pending', best_of: 3, deadline: null, round_number: 1, bracket_side: null, updated_at: '2026-11-18T10:00:00Z' };
const actor = { playerId: 'fake-admin', name: 'Test Admin', isAdmin: false };
const ctx = (params = { id: id.toUpperCase(), phaseId: phaseId.toUpperCase(), rid: rid.toUpperCase() }) => ({ params: Promise.resolve(params) });
const request = (method: string, body?: unknown) => new NextRequest('http://localhost', { method, body: JSON.stringify(body) });
const pairings = [{ player_1_id: p1.toUpperCase(), player_2_id: p2 }];
const confirmedDelete = () => DELETE(request('DELETE', { confirm: true }), ctx());

beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue(actor);
  m.allowed.mockResolvedValue(true);
  m.mode.mockResolvedValue('phase');
  m.season.mockResolvedValue({ id });
  m.phase.mockResolvedValue(phase);
  m.round.mockResolvedValue(round);
  m.rounds.mockResolvedValue([]);
  m.matches.mockResolvedValue([]);
  m.seasonGroups.mockResolvedValue([]);
  m.phaseGroups.mockResolvedValue([]);
  m.participants.mockResolvedValue([p1, p2, p3].map(id => ({ id })));
  m.create.mockResolvedValue(round);
});

it('checks live phase authority and scopes a delete to its round and native storage', async () => {
  m.actor.mockRejectedValueOnce(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
  expect((await confirmedDelete()).status).toBe(403);
  expect(m.mode).not.toHaveBeenCalled();
  m.mode.mockResolvedValueOnce('legacy');
  expect((await confirmedDelete()).status).toBe(404);
  m.mode.mockRejectedValueOnce(new UserFacingError('Unavailable', { code: 'phase_storage_unavailable', status: 503 }));
  expect((await confirmedDelete()).status).toBe(503);
  expect(m.season).not.toHaveBeenCalled();
  m.season.mockResolvedValueOnce(null);
  expect(await (await confirmedDelete()).json()).toMatchObject({ code: 'season_not_found' });
  m.phase.mockResolvedValueOnce({ ...phase, season_id: wrong });
  expect(await (await confirmedDelete()).json()).toMatchObject({ code: 'PHASE_NOT_FOUND' });
  m.allowed.mockResolvedValueOnce(false);
  expect((await confirmedDelete()).status).toBe(403);
  expect(m.round).not.toHaveBeenCalled();
  m.round.mockResolvedValueOnce({ ...round, phase_id: wrong });
  expect(await (await confirmedDelete()).json()).toMatchObject({ code: 'round_not_found' });
  expect(m.round).toHaveBeenCalledExactlyOnceWith(rid, phaseId);
  expect(m.deleteRound).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});

it.each([undefined, {}, { confirm: false }, { confirm: 'true' }])('requires explicit round deletion confirmation: %j', async body => {
  const response = await DELETE(request('DELETE', body), ctx());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'phase_round_delete_confirm_required' });
  expect(m.deleteRound).not.toHaveBeenCalled();
});

it('distinguishes malformed JSON from missing confirmation', async () => {
  const response = await DELETE(new NextRequest('http://localhost', { method: 'DELETE', body: '{' }), ctx());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: 'invalid_json' });
  expect(m.deleteRound).not.toHaveBeenCalled();
});

it('audits committed round metadata and expires the phase and league only after deletion', async () => {
  m.deleteRound.mockImplementationOnce(async () => {
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.expire).not.toHaveBeenCalled();
    return { name: 'Committed round name', round_number: 1, matches: 2 };
  });
  expect(await (await confirmedDelete()).json()).toEqual({ success: true, data: { deleted: true } });
  expect(m.deleteRound).toHaveBeenCalledExactlyOnceWith(id, phaseId, rid, round.updated_at, true);
  expect(m.audit).toHaveBeenCalledExactlyOnceWith({
    actor_id: actor.playerId, actor_name: actor.name, action: 'round.delete',
    resource_type: 'phase_round', resource_id: rid, resource_name: 'Committed round name',
    metadata: { season_id: id, phase_id: phaseId, round_number: 1, deleted_matches: 2 },
  });
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
});

it('returns a generation change at the transaction fence without auditing or invalidating', async () => {
  m.deleteRound.mockRejectedValueOnce({ code: 'P0001', message: 'phase_storage_not_ready' });
  const response = await confirmedDelete();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
  expect(m.audit).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it('lists native rounds and sanitizes matches in public round detail', async () => {
  m.rounds.mockResolvedValue([round]);
  m.matches.mockResolvedValue([{
    id: 'native-match', phase_id: phaseId, round_id: rid, notes: 'admin-only', submitter_id: 'private',
    auto_confirm_at: 'private', confirmed_at: 'private', games: [{ id: 'native-game', edit_lease_token: 'private' }],
  }]);
  expect(await (await list(request('GET'), ctx())).json()).toEqual({ success: true, data: [round] });
  const response = await detail(request('GET'), ctx());
  expect(response.status).toBe(200);
  expect((await response.json()).data.matches).toEqual([{
    id: 'native-match', phase_id: phaseId, round_id: rid, games: [{ id: 'native-game' }],
  }]);
  expect(m.rounds).toHaveBeenCalledExactlyOnceWith(phaseId);
  expect(m.round).toHaveBeenCalledExactlyOnceWith(rid, phaseId);
  expect(m.matches).toHaveBeenCalledExactlyOnceWith(rid);
  expect(m.actor).not.toHaveBeenCalled();
});

it('rejects malformed paths, disabled storage and frozen storage before native lookup', async () => {
  for (const [path, code] of [
    [{ id: 'bad', phaseId, rid }, 'INVALID_SEASON_ID'],
    [{ id, phaseId: 'bad', rid }, 'INVALID_PHASE_ID'],
    [{ id, phaseId, rid: 'bad' }, 'INVALID_ROUND_ID'],
  ] as const) {
    expect(await (await detail(request('GET'), ctx(path))).json()).toMatchObject({ code });
  }
  expect(m.mode).not.toHaveBeenCalled();
  m.mode.mockResolvedValueOnce('legacy');
  expect((await list(request('GET'), ctx())).status).toBe(404);
  m.mode.mockRejectedValueOnce(new UserFacingError('Unavailable', { code: 'phase_storage_unavailable', status: 503 }));
  expect((await PATCH(request('PATCH', { deadline: null }), ctx())).status).toBe(503);
  expect(m.season).not.toHaveBeenCalled();
  expect(m.rounds).not.toHaveBeenCalled();
  expect(m.deadline).not.toHaveBeenCalled();
});

it('checks league, phase and round ownership before exposing a child or writing it', async () => {
  m.season.mockResolvedValueOnce(null);
  expect(await (await list(request('GET'), ctx())).json()).toMatchObject({ code: 'season_not_found' });
  expect(m.phase).not.toHaveBeenCalled();
  m.phase.mockResolvedValueOnce({ ...phase, season_id: wrong });
  expect(await (await detail(request('GET'), ctx())).json()).toMatchObject({ code: 'PHASE_NOT_FOUND' });
  expect(m.round).not.toHaveBeenCalled();
  m.round.mockResolvedValueOnce({ ...round, phase_id: wrong });
  expect(await (await PATCH(request('PATCH', { deadline: null }), ctx())).json()).toMatchObject({ code: 'round_not_found' });
  expect(m.matches).not.toHaveBeenCalled();
  expect(m.deadline).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it('requires a live actor and the native phase admin grant before any child lookup', async () => {
  m.actor.mockRejectedValueOnce(new UserFacingError('Forbidden', { code: 'forbidden', status: 403 }));
  expect((await POST(request('POST', { pairings }), ctx())).status).toBe(403);
  expect(m.mode).not.toHaveBeenCalled();
  m.allowed.mockResolvedValueOnce(false);
  expect((await PATCH(request('PATCH', { deadline: null }), ctx())).status).toBe(403);
  expect(m.allowed).toHaveBeenCalledExactlyOnceWith(actor, phaseId);
  expect(m.round).not.toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
});

it('creates a pending native round with normalized pairings, override and bye through one write', async () => {
  const afterWrite = vi.fn().mockResolvedValue({ ...round, deadline: '2026-11-28T00:00:00Z' });
  m.prepareKit.mockResolvedValue({ revision: 5, afterWrite });
  const response = await POST(request('POST', { pairings }), ctx());
  expect(response.status).toBe(201);
  expect((await response.json()).data.deadline).toBe('2026-11-28T00:00:00Z');
  expect(m.create).toHaveBeenCalledExactlyOnceWith({
    phase_id: phaseId, name: 'Round 1', round_number: 1, best_of: 3,
    bye_player_ids: [p3], matches: [{ player_1_id: p1, player_2_id: p2 }], expected_revision: 5,
  });
  expect(afterWrite).toHaveBeenCalledExactlyOnceWith(round);
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ resource_type: 'phase_round', action: 'round.generate' }));
});

it('refuses invalid manual pairings without a round write', async () => {
  expect(await (await POST(request('POST', { pairings: [{ player_1_id: p1, player_2_id: p1 }] }), ctx())).json()).toMatchObject({ code: 'pairing_self' });
  expect(await (await POST(request('POST', { pairings: [{ player_1_id: p1, player_2_id: p4 }] }), ctx())).json()).toMatchObject({ code: 'tournament_player_not_participant' });
  expect(await (await POST(request('POST', { pairings: [...pairings, { player_1_id: p3, player_2_id: p2 }] }), ctx())).json()).toMatchObject({ code: 'pairing_player_repeated' });
  m.participants.mockResolvedValue([p1, p2, p3, p4].map(id => ({ id })));
  expect(await (await POST(request('POST', { pairings }), ctx())).json()).toMatchObject({ code: 'pairing_players_unpaired' });
  expect(m.create).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
});

it('checks the previous native round before writing manual strict Swiss pairings', async () => {
  m.prepareKit.mockResolvedValue({
    revision: 5, pairing: { kind: 'swiss', rounds: 6, avoid_repeats: true, no_consecutive_repeats: true },
  });
  m.phase.mockResolvedValue({ ...phase, current_round: 1 });
  m.rounds.mockResolvedValue([{ ...round, status: 'completed' }]);
  m.matches.mockResolvedValue([{ player_1_id: p2, player_2_id: p1 }]);
  const response = await POST(request('POST', { pairings }), ctx());
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'swiss_manual_consecutive_repeat' });
  expect(m.matches).toHaveBeenCalledExactlyOnceWith(rid);
  expect(m.create).not.toHaveBeenCalled();
});

it('does not start grouped Swiss without an existing native mirror', async () => {
  m.seasonGroups.mockResolvedValue([{ id: 'group-a', player_ids: [p1, p2, p3] }]);
  expect(await (await POST(request('POST', { pairings }), ctx())).json()).toMatchObject({ code: 'PHASE_GROUPS_STALE' });
  expect(m.create).not.toHaveBeenCalled();
  expect(m.expire).not.toHaveBeenCalled();
  m.phaseGroups.mockResolvedValue([{ season_group_id: 'group-a', members: [p1, p2, p3].map(player_id => ({ player_id })) }]);
  expect((await POST(request('POST', { pairings }), ctx())).status).toBe(201);
});

it('rejects grouped round robin, completed phases, first elimination and unfinished Swiss rounds distinctly', async () => {
  m.phase.mockResolvedValueOnce({ ...phase, bracket_type: 'round_robin' });
  m.grouped.mockResolvedValueOnce(true);
  expect(await (await POST(request('POST', { pairings }), ctx())).json()).toMatchObject({ code: 'rounds_manual_league_grouped' });
  m.phase.mockResolvedValueOnce({ ...phase, status: 'completed' });
  expect(await (await POST(request('POST', { pairings }), ctx())).json()).toMatchObject({ code: 'tournament_already_completed' });
  m.phase.mockResolvedValueOnce({ ...phase, bracket_type: 'single_elim' });
  expect(await (await POST(request('POST', { pairings }), ctx())).json()).toMatchObject({ code: 'BRACKET_V2_REQUIRED' });
  m.phase.mockResolvedValueOnce({ ...phase, current_round: 1 });
  m.rounds.mockResolvedValueOnce([round]);
  expect(await (await POST(request('POST', { pairings }), ctx())).json()).toMatchObject({ code: 'tournament_current_round_incomplete' });
  expect(m.create).not.toHaveBeenCalled();
});

it('rejects invalid bodies and a best-of change on an active round', async () => {
  const malformed = new NextRequest('http://localhost', { method: 'PATCH', body: '{' });
  expect(await (await PATCH(malformed, ctx())).json()).toMatchObject({ code: 'invalid_json' });
  expect(await (await PATCH(request('PATCH', { status: 'completed', force: true }), ctx())).json()).toMatchObject({ code: 'validation_failed' });
  m.round.mockResolvedValueOnce({ ...round, status: 'active' });
  expect(await (await PATCH(request('PATCH', { best_of: 5 }), ctx())).json()).toMatchObject({ code: 'round_best_of_locked' });
  expect(m.bestOf).not.toHaveBeenCalled();
  expect(m.complete).not.toHaveBeenCalled();
});

it('uses guarded status writes, supports clearing the deadline, and expires once', async () => {
  const deadline = '2026-11-28T00:00:00Z';
  const before = { ...round, deadline };
  m.round.mockResolvedValue(before);
  m.bestOf.mockResolvedValue({ ...before, best_of: 5 });
  m.status.mockResolvedValue({ ...before, best_of: 5, status: 'active' });
  m.deadline.mockResolvedValue({ ...round, best_of: 5, status: 'active' });
  const response = await PATCH(request('PATCH', { best_of: 5, status: 'active', deadline: null }), ctx());
  expect(await response.json()).toMatchObject({ data: { best_of: 5, status: 'active', deadline: null } });
  expect(m.status).toHaveBeenCalledExactlyOnceWith(rid, 'active', 'pending');
  expect(m.deadline).toHaveBeenCalledExactlyOnceWith(rid, null);
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ changes: { deadline: { before: deadline, after: null } } }));
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
});

it('claims completion under the native lock and audits the actual forced count only once', async () => {
  const completed = { ...round, status: 'completed' };
  m.complete.mockResolvedValueOnce({ outcome: 'unfinished', unfinished: 2 });
  const rejected = await PATCH(request('PATCH', { status: 'completed' }), ctx());
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toMatchObject({ code: 'round_matches_unfinished', params: { count: 2 } });
  expect(m.expire).not.toHaveBeenCalled();
  m.complete.mockResolvedValueOnce({ outcome: 'completed', round: completed, unfinished: 2 });
  expect((await PATCH(request('PATCH', { status: 'completed', force: true, reason: 'Matches cannot be played' }), ctx())).status).toBe(200);
  expect(m.complete).toHaveBeenLastCalledWith(rid, { force: true });
  expect(m.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    action: 'round.force_complete', metadata: expect.objectContaining({ unfinished_matches: 2, reason: 'Matches cannot be played' }),
  }));
  m.round.mockResolvedValue(completed);
  expect((await PATCH(request('PATCH', { status: 'completed' }), ctx())).status).toBe(200);
  expect(m.completed).toHaveBeenCalledExactlyOnceWith(phase, completed);
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
});

it('expires a committed completion even if later deadline editing loses to the storage freeze', async () => {
  const completed = { ...round, status: 'completed' };
  m.complete.mockResolvedValue({ outcome: 'completed', round: completed, unfinished: 0 });
  m.deadline.mockRejectedValue({ code: 'P0001', message: 'phase_storage_not_ready' });
  const response = await PATCH(request('PATCH', { status: 'completed', deadline: null }), ctx());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'phase_storage_unavailable' });
  expect(m.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(m.completed).toHaveBeenCalledExactlyOnceWith(phase, completed);
});
