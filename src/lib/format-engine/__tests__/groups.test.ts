import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/revalidation', () => ({ expireTournamentReads: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ seasonHasGroups: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  addGroupMembersBatch: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroup: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  getGroupsByTournament: vi.fn(),
}));

import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { addGroupMembersBatch, createGroupBatch, deleteGroup, deleteGroupsByTournament, getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { assertKitGroupsFormed, ensureKitPhaseGroups, KIT_GROUPS_FORMING_WINDOW_MS, mapGroupWriteConflict } from '../groups';

const input = { seasonId: 's', phaseId: 'ph', seed: 'seed-0123456789', stage: { key: 'groups', groups: { count: 2, method: 'straight' as const } } };

const member = (player_id: string, seed = 1) => ({ player_id, player_name: player_id.toUpperCase(), seed, gym_type: null });
const group = (id: string, number: number, createdAt: string, players: string[] = []) => ({
  id,
  tournament_id: 'ph',
  group_number: number,
  created_at: createdAt,
  members: players.map((player) => member(player)),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(seasonHasGroups).mockResolvedValue(false);
  vi.mocked(getRoundsByTournament).mockResolvedValue([]);
  vi.mocked(getParticipants).mockResolvedValue(['a', 'b', 'c', 'd'].map((id, i) => ({ id, seed: i + 1 })) as never);
  vi.mocked(createGroupBatch).mockResolvedValue([
    { id: 'mine-1', group_number: 1 },
    { id: 'mine-2', group_number: 2 },
  ] as never);
});

describe('ensureKitPhaseGroups', () => {
  it('forms the groups once and fills them', async () => {
    const mine = [group('mine-1', 1, '2026-11-05T10:00:00.000Z'), group('mine-2', 2, '2026-11-05T10:00:00.000Z')];
    vi.mocked(getGroupsByTournament).mockResolvedValueOnce([]).mockResolvedValue(mine as never);
    const groups = await ensureKitPhaseGroups(input);
    expect(groups).toHaveLength(2);
    expect(addGroupMembersBatch).toHaveBeenCalledTimes(1);
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it('removes its own groups and answers 409 when another call formed them first', async () => {
    const earlier = [group('theirs-1', 1, '2026-11-05T09:59:59.000Z'), group('theirs-2', 2, '2026-11-05T09:59:59.000Z')];
    const mine = [group('mine-1', 1, '2026-11-05T10:00:00.000Z'), group('mine-2', 2, '2026-11-05T10:00:00.000Z')];
    vi.mocked(getGroupsByTournament).mockResolvedValueOnce([]).mockResolvedValue([...earlier, ...mine] as never);
    await expect(ensureKitPhaseGroups(input)).rejects.toMatchObject({ code: 'groups_forming_in_progress', statusCode: 409 });
    expect(vi.mocked(deleteGroup).mock.calls.map(([id]) => id).sort()).toEqual(['mine-1', 'mine-2']);
    expect(addGroupMembersBatch).not.toHaveBeenCalled();
  });

  it('keeps its groups when the other call inserted later, and that call is the one that backs off', async () => {
    const mine = [group('mine-1', 1, '2026-11-05T10:00:00.000Z'), group('mine-2', 2, '2026-11-05T10:00:00.000Z')];
    const later = [group('theirs-1', 1, '2026-11-05T10:00:01.000Z')];
    vi.mocked(getGroupsByTournament).mockResolvedValueOnce([]).mockResolvedValue([...mine, ...later] as never);
    await ensureKitPhaseGroups(input);
    expect(deleteGroup).not.toHaveBeenCalled();
    expect(addGroupMembersBatch).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when a unique key refused the second insert', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(createGroupBatch).mockRejectedValue({ code: '23505' });
    await expect(ensureKitPhaseGroups(input)).rejects.toMatchObject({ code: 'groups_forming_in_progress' });
  });

  it('lets any other insert error through', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(createGroupBatch).mockRejectedValue(new Error('db down'));
    await expect(ensureKitPhaseGroups(input)).rejects.toThrow('db down');
  });

  it('answers 409 when the members insert lost its groups to the other call (foreign key)', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(addGroupMembersBatch).mockRejectedValue({ code: '23503' });
    await expect(ensureKitPhaseGroups(input)).rejects.toMatchObject({ code: 'groups_forming_in_progress' });
  });

  it('forms nothing for a phase whose groups hold the enrolled players (an admin may have moved them)', async () => {
    const old = '2026-11-05T09:00:00.000Z';
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, old, ['a', 'd', 'c']), group('y', 2, old, ['b'])] as never);
    expect(await ensureKitPhaseGroups(input)).toHaveLength(2);
    expect(createGroupBatch).not.toHaveBeenCalled();
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
  });

  it('forms nothing for a phase that has rounds, whatever its groups hold', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([{ id: 'r1' }] as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, '2026-11-05T09:00:00.000Z', ['a'])] as never);
    expect(await ensureKitPhaseGroups(input)).toHaveLength(1);
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
  });

  it('forms nothing for a league whose groups the phase mirrors', async () => {
    vi.mocked(seasonHasGroups).mockResolvedValue(true);
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, '2026-11-05T09:00:00.000Z', ['a'])] as never);
    expect(await ensureKitPhaseGroups(input)).toHaveLength(1);
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
  });

  it('forms the groups again when a player was added or removed since they were formed (before the first round)', async () => {
    const old = '2026-11-05T09:00:00.000Z';
    const fresh = [group('mine-1', 1, '2026-11-05T10:00:00.000Z'), group('mine-2', 2, '2026-11-05T10:00:00.000Z')];
    // Formed for a, b, c, x; the roster is now a, b, c, d.
    vi.mocked(getGroupsByTournament)
      .mockResolvedValueOnce([group('x', 1, old, ['a', 'b']), group('y', 2, old, ['c', 'x'])] as never)
      .mockResolvedValue(fresh as never);
    await ensureKitPhaseGroups(input);
    expect(deleteGroupsByTournament).toHaveBeenCalledWith('ph');
    expect(createGroupBatch).toHaveBeenCalledTimes(1);
    expect(addGroupMembersBatch).toHaveBeenCalledTimes(1);
  });
});

describe('groups another request has inserted but not filled yet', () => {
  const fresh = () => new Date(Date.now() - 1000).toISOString();
  const stale = () => new Date(Date.now() - KIT_GROUPS_FORMING_WINDOW_MS - 1000).toISOString();
  it('answers 409 instead of returning fresh member-less groups of a formed spec', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, fresh()), group('y', 2, fresh())] as never);
    await expect(ensureKitPhaseGroups(input)).rejects.toMatchObject({ code: 'groups_forming_in_progress', statusCode: 409 });
    expect(createGroupBatch).not.toHaveBeenCalled();
  });

  it('returns groups that have members (the other call is filling the rest)', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, fresh(), ['a', 'b']), group('y', 2, fresh(), ['c', 'd'])] as never);
    expect(await ensureKitPhaseGroups(input)).toHaveLength(2);
    expect(deleteGroupsByTournament).not.toHaveBeenCalled();
  });

  it('forms old member-less groups again: the call that inserted them died before it added the members', async () => {
    const formed = [group('mine-1', 1, fresh(), ['a', 'b']), group('mine-2', 2, fresh(), ['c', 'd'])];
    vi.mocked(getGroupsByTournament).mockResolvedValueOnce([group('x', 1, stale()), group('y', 2, stale())] as never).mockResolvedValue(formed as never);
    expect(await ensureKitPhaseGroups(input)).toHaveLength(2);
    expect(deleteGroupsByTournament).toHaveBeenCalledWith('ph');
    expect(createGroupBatch).toHaveBeenCalledTimes(1);
  });

  it('never applies to a manual spec, where empty groups are legitimate', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, fresh())] as never);
    const manual = { ...input, stage: { key: 'groups', groups: { count: 2, method: 'manual' as const } } };
    expect(await ensureKitPhaseGroups(manual)).toHaveLength(1);
  });

  it('assertKitGroupsFormed is the same check for a caller that read the groups itself', () => {
    const stage = input.stage;
    expect(() => assertKitGroupsFormed([group('x', 1, fresh())] as never, stage)).toThrow(expect.objectContaining({ code: 'groups_forming_in_progress' }));
    expect(() => assertKitGroupsFormed([group('x', 1, stale())] as never, stage)).not.toThrow();
    expect(() => assertKitGroupsFormed([] as never, stage)).not.toThrow();
    expect(() => assertKitGroupsFormed([group('x', 1, fresh())] as never, { groups: undefined })).not.toThrow();
  });
});

describe('mapGroupWriteConflict', () => {
  it('maps the unique and the foreign key violations of concurrent writers to the retryable 409, and passes any other error', () => {
    expect(mapGroupWriteConflict({ code: '23505' })).toMatchObject({ code: 'groups_forming_in_progress', statusCode: 409 });
    expect(mapGroupWriteConflict({ code: '23503' })).toMatchObject({ code: 'groups_forming_in_progress', statusCode: 409 });
    const other = new Error('db down');
    expect(mapGroupWriteConflict(other)).toBe(other);
    expect(mapGroupWriteConflict(null)).toBeNull();
  });
});
