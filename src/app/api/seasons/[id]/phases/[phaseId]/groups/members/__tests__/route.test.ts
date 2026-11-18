import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { PATCH } from '../route';

const h = vi.hoisted(() => ({
  auth: vi.fn(), mode: vi.fn(), phase: vi.fn(), tournament: vi.fn(), groups: vi.fn(),
  move: vi.fn(), legacyMove: vi.fn(), expire: vi.fn(), editable: vi.fn(),
}));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: h.auth }));
vi.mock('@/lib/league-phase/route-mode', () => ({ requireOpenPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/queries/league-phases', () => ({ getPhaseById: h.phase }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: h.tournament }));
vi.mock('@/lib/supabase/queries/phase-groups', () => ({ getGroupsByPhase: h.groups, movePhaseGroupMember: h.move }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({ getGroupsByTournament: vi.fn(), moveGroupMember: h.legacyMove }));
vi.mock('@/lib/revalidation', () => ({ expirePhaseReads: h.expire, expireTournamentReads: vi.fn() }));
vi.mock('@/lib/tournament/group-rounds', () => ({ assertPhaseGroupsEditable: h.editable }));

const id = '10000000-0000-4000-8000-000000000001';
const phaseId = '20000000-0000-4000-8000-00000000000a';
const player = '30000000-0000-4000-8000-00000000000b';
const source = '40000000-0000-4000-8000-00000000000c';
const target = '50000000-0000-4000-8000-00000000000d';
const call = (group = target) => PATCH(new NextRequest('http://localhost', {
  method: 'PATCH',
  body: JSON.stringify({
    player_id: player.toUpperCase(), from_group_id: source.toUpperCase(), to_group_id: group.toUpperCase(),
  }),
}), { params: Promise.resolve({ id, phaseId: phaseId.toUpperCase() }) });

beforeEach(() => {
  vi.resetAllMocks();
  h.mode.mockResolvedValue('phase');
  h.phase.mockResolvedValue({ season_id: id });
  h.groups.mockResolvedValue([{ id: source, members: [{ player_id: player }] }, { id: target, members: [] }]);
});

it('moves a member only within the verified native phase and expires its tags', async () => {
  expect((await call()).status).toBe(200);
  expect(h.groups).toHaveBeenCalledExactlyOnceWith(phaseId);
  expect(h.move).toHaveBeenCalledExactlyOnceWith(phaseId, source, target, player, 1);
  expect(h.expire).toHaveBeenCalledExactlyOnceWith(phaseId, id);
  expect(h.tournament).not.toHaveBeenCalled();
  expect(h.legacyMove).not.toHaveBeenCalled();
});

it('refuses an unrelated league or target group', async () => {
  h.phase.mockResolvedValueOnce({ season_id: target });
  expect((await call()).status).toBe(404);
  expect(h.groups).not.toHaveBeenCalled();
  expect((await call(phaseId)).status).toBe(400);
  expect(h.move).not.toHaveBeenCalled();
});

it('refuses a frozen generation without resolving or moving a group', async () => {
  h.mode.mockRejectedValue(new UserFacingError('Unavailable', { code: 'phase_storage_unavailable', status: 503 }));
  expect((await call()).status).toBe(503);
  expect(h.phase).not.toHaveBeenCalled();
  expect(h.move).not.toHaveBeenCalled();
});
