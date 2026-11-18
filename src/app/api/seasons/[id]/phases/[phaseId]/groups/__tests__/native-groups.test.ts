import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { DELETE, GET, POST } from '../route';

const h = vi.hoisted(() => ({
  auth: vi.fn(), mode: vi.fn(), phase: vi.fn(), groups: vi.fn(), seeds: vi.fn(),
  replace: vi.fn(), editable: vi.fn(), expire: vi.fn(), legacyRead: vi.fn(), legacyWrite: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: h.auth }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase, getPhaseParticipants: h.seeds }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupsByPhase: h.groups, replaceAdminPhaseGroups: h.replace }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: h.legacyRead, getParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: h.legacyRead, deleteGroupsByTournament: h.legacyWrite, createGroupBatch: h.legacyWrite,
  addGroupMembersBatch: h.legacyWrite,
}));
vi.mock('@/lib/tournament/group-rounds', () => ({ assertPhaseGroupsEditable: h.editable }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: h.expire, expireTournamentReads: vi.fn() }));

const id = '10000000-0000-4000-8000-000000000001';
const phaseId = '20000000-0000-4000-8000-000000000002';
const params = { params: Promise.resolve({ id, phaseId }) };
const req = (method: string, body?: unknown) => new NextRequest('http://localhost', {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const participants = [{ id: 'p1', seed: 1 }, { id: 'p2', seed: 2 }, { id: 'p3', seed: 3 }, { id: 'p4', seed: 4 }];

beforeEach(() => {
  vi.resetAllMocks();
  h.mode.mockResolvedValue('phase');
  h.phase.mockResolvedValue({ id: phaseId, season_id: id });
  h.groups.mockResolvedValue([]);
  h.seeds.mockResolvedValue(participants);
});

it('reads only the verified native groups', async () => {
  expect((await GET(req('GET'), params)).status).toBe(200);
  expect(h.groups).toHaveBeenCalledExactlyOnceWith(phaseId);
  expect(h.legacyRead).not.toHaveBeenCalled();
  h.phase.mockResolvedValueOnce({ season_id: phaseId });
  expect((await GET(req('GET'), params)).status).toBe(404);
  expect(h.groups).toHaveBeenCalledTimes(1);
});

it('applies one native replacement with the serpentine plan and expected seeds', async () => {
  expect((await POST(req('POST', { group_count: 2 }), params)).status).toBe(201);
  expect(h.replace).toHaveBeenCalledExactlyOnceWith(id, phaseId, [
    { name: 'Group A', members: ['p1', 'p4'] }, { name: 'Group B', members: ['p2', 'p3'] },
  ], participants.map(({ id: player_id, seed }) => ({ player_id, seed })));
  expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(h.legacyRead).not.toHaveBeenCalled();
  expect(h.legacyWrite).not.toHaveBeenCalled();
});

it('returns a stale roster refusal without expiring or loading groups', async () => {
  h.replace.mockRejectedValueOnce(new UserFacingError('Groups changed', { code: 'GROUP_SLOT_CHANGED', status: 409 }));
  expect((await POST(req('POST', { group_count: 2 }), params)).status).toBe(409);
  expect(h.expire).not.toHaveBeenCalled();
  expect(h.groups).not.toHaveBeenCalled();
});

it('clears only the native groups and expires their phase tags', async () => {
  expect((await DELETE(req('DELETE'), params)).status).toBe(200);
  expect(h.replace).toHaveBeenCalledExactlyOnceWith(id, phaseId, [], []);
  expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(h.legacyWrite).not.toHaveBeenCalled();
});
