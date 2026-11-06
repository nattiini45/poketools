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
  getGroupsByTournament: vi.fn(),
}));

import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { addGroupMembersBatch, createGroupBatch, deleteGroup, getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { assertKitGroupsFormed, ensureKitPhaseGroups, KIT_GROUPS_FORMING_WINDOW_MS } from '../groups';

const input = { seasonId: 's', phaseId: 'ph', seed: 'seed-0123456789', stage: { key: 'groups', groups: { count: 2, method: 'straight' as const } } };

const group = (id: string, number: number, createdAt: string) => ({ id, tournament_id: 'ph', group_number: number, created_at: createdAt, members: [] });

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

  it('forms nothing for a phase that has groups already', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, '2026-11-05T09:00:00.000Z')] as never);
    expect(await ensureKitPhaseGroups(input)).toHaveLength(1);
    expect(createGroupBatch).not.toHaveBeenCalled();
  });
});

describe('groups another request has inserted but not filled yet', () => {
  const fresh = () => new Date(Date.now() - 1000).toISOString();
  const stale = () => new Date(Date.now() - KIT_GROUPS_FORMING_WINDOW_MS - 1000).toISOString();
  const member = { player_id: 'a', player_name: 'A', seed: 1, gym_type: null };

  it('answers 409 instead of returning fresh member-less groups of a formed spec', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, fresh()), group('y', 2, fresh())] as never);
    await expect(ensureKitPhaseGroups(input)).rejects.toMatchObject({ code: 'groups_forming_in_progress', statusCode: 409 });
    expect(createGroupBatch).not.toHaveBeenCalled();
  });

  it('returns groups that have members, and old member-less ones (built by an admin)', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([{ ...group('x', 1, fresh()), members: [member] }, group('y', 2, fresh())] as never);
    expect(await ensureKitPhaseGroups(input)).toHaveLength(2);
    vi.mocked(getGroupsByTournament).mockResolvedValue([group('x', 1, stale())] as never);
    expect(await ensureKitPhaseGroups(input)).toHaveLength(1);
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
