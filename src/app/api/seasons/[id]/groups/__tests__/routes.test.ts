import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { fullPlayerRow, expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

const mocks = vi.hoisted(() => ({
  requireResourceAdmin: vi.fn(),
  getSeasonGroups: vi.fn(),
  replaceSeasonGroups: vi.fn(),
  renameSeasonGroup: vi.fn(),
  placeSeasonGroupMember: vi.fn(),
  seasonPhasesHaveRounds: vi.fn(),
  getSeasonParticipants: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  getParticipants: vi.fn(),
  getDraftPoolsBySeasonWithGroups: vi.fn(),
  logAuditEvent: vi.fn(),
  expireSeasonReads: vi.fn(),
  expireDraftReads: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/helpers', () => ({ requireResourceAdmin: mocks.requireResourceAdmin }));
vi.mock('@/lib/supabase/queries/season-groups', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase/queries/season-groups')>(
    '@/lib/supabase/queries/season-groups',
  );
  return {
    SeasonGroupNameTakenError: actual.SeasonGroupNameTakenError,
    getSeasonGroups: mocks.getSeasonGroups,
    replaceSeasonGroups: mocks.replaceSeasonGroups,
    renameSeasonGroup: mocks.renameSeasonGroup,
    placeSeasonGroupMember: mocks.placeSeasonGroupMember,
    seasonPhasesHaveRounds: mocks.seasonPhasesHaveRounds,
  };
});
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonParticipants: mocks.getSeasonParticipants }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: mocks.getStagesBySeasonId,
  getParticipants: mocks.getParticipants,
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolsBySeasonWithGroups: mocks.getDraftPoolsBySeasonWithGroups,
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: mocks.logAuditEvent }));
vi.mock('@/lib/revalidation', () => ({
  expireSeasonReads: mocks.expireSeasonReads,
  expireDraftReads: mocks.expireDraftReads,
}));

import { GET, PUT } from '../route';
import { PATCH as RENAME } from '../[groupId]/route';
import { PATCH as PLACE } from '../members/route';
import { plannedGroupNames, plannedGroups } from '../_lib/plan';
import { seedOrder } from '../_lib/load';
import { seasonGroupsReplaceSchema } from '../_lib/schemas';
import { DraftRuleError } from '@/lib/draft/errors';
import { SeasonGroupNameTakenError } from '@/lib/supabase/queries/season-groups';

const SEASON = '5eaf0000-0000-4000-8000-000000000001';
const G1 = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G2 = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const [A, B, C, D, E] = ['a', 'b', 'c', 'd', 'e'].map((x) => `${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`);
const ADMIN = { playerId: 'admin-1', name: 'Admin', isAdmin: true };

function roster(...ids: string[]) {
  return ids.map((id, i) => fullPlayerRow({ id, name: `Trainer ${i + 1}` }));
}

function req(body?: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}
const ctx = (id = SEASON) => ({ params: Promise.resolve({ id }) });
const groupCtx = (groupId: string, id = SEASON) => ({ params: Promise.resolve({ id, groupId }) });

const GROUPS = [
  { id: G1, season_id: SEASON, name: 'Group A', sort_order: 1, player_ids: [A, D] },
  { id: G2, season_id: SEASON, name: 'Group B', sort_order: 2, player_ids: [B, C] },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.requireResourceAdmin.mockResolvedValue(ADMIN);
  mocks.getSeasonParticipants.mockResolvedValue(roster(A, B, C, D));
  mocks.getStagesBySeasonId.mockResolvedValue([{ id: 'stage-1' }, { id: 'stage-2' }]);
  // First phase seeds: D 1, C 2, B 3, A 4.
  mocks.getParticipants.mockResolvedValue([
    { id: D, seed: 1 },
    { id: C, seed: 2 },
    { id: B, seed: 3 },
    { id: A, seed: 4 },
  ]);
  mocks.getSeasonGroups.mockResolvedValue(GROUPS);
  mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([]);
  mocks.seasonPhasesHaveRounds.mockResolvedValue(false);
  mocks.replaceSeasonGroups.mockImplementation(async (_s: string, groups: { name: string; player_ids: string[] }[]) =>
    groups.map((g, i) => ({ id: `g${i}`, season_id: SEASON, name: g.name, sort_order: i + 1, player_ids: g.player_ids })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('seedOrder / plannedGroups (pure)', () => {
  it('seeded participants by seed, then the unseeded by name; only id, name and seed leave', () => {
    const order = seedOrder(roster(A, B, C), new Map([[C, 1]]));
    expect(order.map((p) => p.id)).toEqual([C, A, B]);
    expect(order[0]).toEqual({ id: C, name: 'Trainer 3', seed: 1 });
    expectNoPrivatePlayerData(order);
  });

  it('serpentine: 1 → A, 2 → B, 3 → B, 4 → A; existing names are kept by position, new ones are Group X', () => {
    const participants = seedOrder(roster(A, B, C, D), new Map([[A, 1], [B, 2], [C, 3], [D, 4]]));
    const planned = plannedGroups({ mode: 'serpentine', group_count: 2 }, participants, [{ name: 'Nord' }]);
    expect(planned).toEqual([
      { name: 'Nord', player_ids: [A, D] },
      { name: 'Group B', player_ids: [B, C] },
    ]);
  });

  it('serpentine never repeats a kept name: a group renamed to "Group C" pushes the new third group to "Group D"', () => {
    expect(plannedGroupNames(3, [{ name: 'Group A' }, { name: 'Group C' }])).toEqual(['Group A', 'Group C', 'Group D']);
    expect(plannedGroupNames(3, [{ name: 'group c' }])).toEqual(['group c', 'Group B', 'Group D']);
    expect(plannedGroupNames(2, [{ name: 'Nord' }, { name: 'Süd' }, { name: 'Ost' }])).toEqual(['Nord', 'Süd']);
    const participants = seedOrder(roster(A, B, C, D, E, '99999999-9999-4999-8999-999999999999'), new Map());
    const planned = plannedGroups({ mode: 'serpentine', group_count: 3 }, participants, [
      { name: 'Group A' },
      { name: 'Group C' },
    ]);
    expect(new Set(planned.map((g) => g.name.toLowerCase())).size).toBe(3);
  });

  it('manual: a group of fewer than two trainers is SEASON_GROUP_TOO_SMALL (422), before any write', () => {
    const participants = seedOrder(roster(A, B, C), new Map());
    expect(() =>
      plannedGroups({ mode: 'manual', groups: [{ name: 'X', player_ids: [A, B] }, { name: 'Y', player_ids: [C] }] }, participants, []),
    ).toThrow(expect.objectContaining({ code: 'SEASON_GROUP_TOO_SMALL', statusCode: 422 }));
  });

  it('serpentine refuses groups of fewer than two trainers (SEASON_GROUPS_TOO_MANY)', () => {
    const participants = seedOrder(roster(A, B, C), new Map());
    expect(() => plannedGroups({ mode: 'serpentine', group_count: 2 }, participants, [])).toThrow(
      expect.objectContaining({ code: 'SEASON_GROUPS_TOO_MANY', statusCode: 422, params: { participants: 3, count: 2 } }),
    );
  });

  it('manual: every participant exactly once, nobody from outside the roster', () => {
    const participants = seedOrder(roster(A, B, C), new Map());
    expect(() =>
      plannedGroups({ mode: 'manual', groups: [{ name: 'X', player_ids: [A] }, { name: 'Y', player_ids: [B] }] }, participants, []),
    ).toThrow(expect.objectContaining({ code: 'SEASON_GROUPS_INCOMPLETE', params: { count: 1 } }));
    expect(() =>
      plannedGroups({ mode: 'manual', groups: [{ name: 'X', player_ids: [A, E] }, { name: 'Y', player_ids: [B, C] }] }, participants, []),
    ).toThrow(expect.objectContaining({ code: 'SEASON_GROUP_PLAYER_NOT_FOUND' }));
    expect(plannedGroups({ mode: 'clear' }, participants, [])).toEqual([]);
  });

  it('the schema refuses duplicate names, a trainer in two groups, one group, and unknown keys', () => {
    const two = (a: object, b: object) => ({ mode: 'manual', groups: [a, b] });
    expect(seasonGroupsReplaceSchema.safeParse(two({ name: 'X', player_ids: [] }, { name: 'x', player_ids: [] })).success).toBe(false);
    expect(seasonGroupsReplaceSchema.safeParse(two({ name: 'X', player_ids: [A] }, { name: 'Y', player_ids: [A] })).success).toBe(false);
    expect(seasonGroupsReplaceSchema.safeParse({ mode: 'manual', groups: [{ name: 'X', player_ids: [] }] }).success).toBe(false);
    expect(seasonGroupsReplaceSchema.safeParse({ mode: 'serpentine', group_count: 2, extra: 1 }).success).toBe(false);
    expect(seasonGroupsReplaceSchema.safeParse({ mode: 'serpentine', group_count: 27 }).success).toBe(false);
  });
});

describe('GET /api/seasons/[id]/groups', () => {
  it('is league-admin only and answers the editor DTO without private player data', async () => {
    mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([
      { season_group_id: G1, phase: 'drafting' },
      { season_group_id: G2, phase: 'cancelled' },
    ]);
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(mocks.requireResourceAdmin).toHaveBeenCalledWith('season', SEASON);
    expect(res.status).toBe(200);
    expect(body.data.participants.map((p: { id: string }) => p.id)).toEqual([D, C, B, A]);
    expect(body.data.groups.map((g: { locked: boolean }) => g.locked)).toEqual([true, false]);
    expect(body.data.replaceLocked).toBe(true);
    expectNoPrivatePlayerData(body);
  });

  it('once a phase has a round: scheduleLocked, every group locked, no re-split (one round count over the phases)', async () => {
    mocks.seasonPhasesHaveRounds.mockResolvedValue(true);
    const body = await (await GET(req(), ctx())).json();
    expect(mocks.seasonPhasesHaveRounds).toHaveBeenCalledWith(['stage-1', 'stage-2']);
    expect(body.data.scheduleLocked).toBe(true);
    expect(body.data.replaceLocked).toBe(true);
    expect(body.data.groups.map((g: { locked: boolean }) => g.locked)).toEqual([true, true]);
    expect(mocks.getStagesBySeasonId).toHaveBeenCalledTimes(1);
  });

  it('before any round: scheduleLocked false', async () => {
    const body = await (await GET(req(), ctx())).json();
    expect(body.data.scheduleLocked).toBe(false);
    expect(body.data.replaceLocked).toBe(false);
  });

  it('a malformed league id is 404 INVALID_SEASON_ID before the guard or any read', async () => {
    const res = await GET(req(), ctx('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('INVALID_SEASON_ID');
    expect(mocks.requireResourceAdmin).not.toHaveBeenCalled();
    expect(mocks.getSeasonGroups).not.toHaveBeenCalled();
  });
});

describe('PUT /api/seasons/[id]/groups', () => {
  it('serpentine by the first phase’s seeds: one atomic replace, audited, caches expired', async () => {
    const res = await PUT(req({ mode: 'serpentine', group_count: 2 }), ctx());
    expect(res.status).toBe(200);
    // Seeds D1, C2, B3, A4 → A gets D and A, B gets C and B (existing names kept).
    expect(mocks.replaceSeasonGroups).toHaveBeenCalledWith(SEASON, [
      { name: 'Group A', player_ids: [D, A] },
      { name: 'Group B', player_ids: [C, B] },
    ]);
    expect(mocks.expireSeasonReads).toHaveBeenCalledWith(SEASON, ['stage-1', 'stage-2']);
    expect(mocks.expireDraftReads).toHaveBeenCalledWith(SEASON);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.groups.replace', resource_id: SEASON, actor_id: 'admin-1', metadata: { mode: 'serpentine' } }),
    );
    // One stages read serves both the seeds and the cache expiry.
    expect(mocks.getStagesBySeasonId).toHaveBeenCalledTimes(1);
  });

  it('passes the database refusal through with its code (SEASON_GROUP_LOCKED, 409) and writes no audit', async () => {
    mocks.replaceSeasonGroups.mockRejectedValue(new DraftRuleError('SEASON_GROUP_LOCKED'));
    const res = await PUT(req({ mode: 'clear' }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SEASON_GROUP_LOCKED');
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
    expect(mocks.expireSeasonReads).not.toHaveBeenCalled();
  });

  it('once a phase has a round the re-split is refused with its own code (SEASON_GROUPS_SCHEDULED, 409)', async () => {
    mocks.replaceSeasonGroups.mockRejectedValue(new DraftRuleError('SEASON_GROUPS_SCHEDULED'));
    const res = await PUT(req({ mode: 'serpentine', group_count: 2 }), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('SEASON_GROUPS_SCHEDULED');
    expect(body.error).toMatch(/already has rounds/);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('an invalid body is 400 validation_failed; a malformed body 400 invalid_json; neither writes', async () => {
    expect((await (await PUT(req({ mode: 'serpentine', group_count: 1 }), ctx())).json()).code).toBe('validation_failed');
    const bad = { json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')) } as unknown as NextRequest;
    const res = await PUT(bad, ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_json');
    expect(mocks.replaceSeasonGroups).not.toHaveBeenCalled();
  });

  it('refuses a non-admin before reading the body', async () => {
    // Duck-typed like the real AuthError (`safeErrorResponse` reads its numeric statusCode).
    mocks.requireResourceAdmin.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }));
    const request = req({ mode: 'clear' });
    const res = await PUT(request, ctx());
    expect(res.status).toBe(403);
    expect(request.json).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id]/groups/[groupId] (rename)', () => {
  it('renames, audits before/after and expires the caches', async () => {
    mocks.renameSeasonGroup.mockResolvedValue({ id: G1, season_id: SEASON, name: 'Nord', sort_order: 1 });
    const res = await RENAME(req({ name: '  Nord ' }), groupCtx(G1));
    expect(res.status).toBe(200);
    expect(mocks.renameSeasonGroup).toHaveBeenCalledWith(SEASON, G1, 'Nord');
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.group.rename', changes: { name: { before: 'Group A', after: 'Nord' } } }),
    );
  });

  it('a group of another league is 404 SEASON_GROUP_NOT_FOUND; a taken name 409 SEASON_GROUP_NAME_TAKEN', async () => {
    const other = await RENAME(req({ name: 'Nord' }), groupCtx('33333333-cccc-4ccc-8ccc-cccccccccccc'));
    expect(other.status).toBe(404);
    expect((await other.json()).code).toBe('SEASON_GROUP_NOT_FOUND');
    mocks.renameSeasonGroup.mockRejectedValue(new SeasonGroupNameTakenError());
    const taken = await RENAME(req({ name: 'Group B' }), groupCtx(G1));
    expect(taken.status).toBe(409);
    expect((await taken.json()).code).toBe('SEASON_GROUP_NAME_TAKEN');
  });

  it('a malformed group id is 404 INVALID_GROUP_ID before any read', async () => {
    const res = await RENAME(req({ name: 'Nord' }), groupCtx('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('INVALID_GROUP_ID');
    expect(mocks.requireResourceAdmin).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id]/groups/members (move / place)', () => {
  it('moves a trainer, audits from → to and answers the fresh DTO', async () => {
    const res = await PLACE(req({ player_id: A, group_id: G2 }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.placeSeasonGroupMember).toHaveBeenCalledWith(SEASON, A, G2);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.group.member.place',
        changes: { season_group_id: { before: G1, after: G2 } },
        metadata: { player_id: A },
      }),
    );
    expectNoPrivatePlayerData(await res.json());
  });

  it('places a participant who is in no group yet (from: null)', async () => {
    mocks.getSeasonParticipants.mockResolvedValue(roster(A, B, C, D, E));
    await PLACE(req({ player_id: E, group_id: G1 }), ctx());
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ changes: { season_group_id: { before: null, after: G1 } } }),
    );
  });

  it('a move refused because a group has a live pool keeps its code (SEASON_GROUP_LOCKED, 409)', async () => {
    mocks.placeSeasonGroupMember.mockRejectedValue(new DraftRuleError('SEASON_GROUP_LOCKED'));
    const res = await PLACE(req({ player_id: A, group_id: G2 }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SEASON_GROUP_LOCKED');
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('once a phase has a round a move is SEASON_GROUPS_SCHEDULED (409); leaving one trainer behind SEASON_GROUP_TOO_SMALL (422)', async () => {
    mocks.placeSeasonGroupMember.mockRejectedValueOnce(new DraftRuleError('SEASON_GROUPS_SCHEDULED'));
    const scheduled = await PLACE(req({ player_id: A, group_id: G2 }), ctx());
    expect([scheduled.status, (await scheduled.json()).code]).toEqual([409, 'SEASON_GROUPS_SCHEDULED']);
    mocks.placeSeasonGroupMember.mockRejectedValueOnce(new DraftRuleError('SEASON_GROUP_TOO_SMALL'));
    const small = await PLACE(req({ player_id: A, group_id: G2 }), ctx());
    expect([small.status, (await small.json()).code]).toEqual([422, 'SEASON_GROUP_TOO_SMALL']);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it('refuses a trainer outside the roster and a group of another league', async () => {
    const outsider = await PLACE(req({ player_id: E, group_id: G1 }), ctx());
    expect((await outsider.json()).code).toBe('SEASON_GROUP_PLAYER_NOT_FOUND');
    const foreign = await PLACE(req({ player_id: A, group_id: '33333333-cccc-4ccc-8ccc-cccccccccccc' }), ctx());
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).code).toBe('SEASON_GROUP_NOT_FOUND');
    expect(mocks.placeSeasonGroupMember).not.toHaveBeenCalled();
  });

  it('placing a trainer in their own group writes nothing', async () => {
    const res = await PLACE(req({ player_id: A, group_id: G1 }), ctx());
    expect(res.status).toBe(200);
    expect(mocks.placeSeasonGroupMember).not.toHaveBeenCalled();
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });
});
