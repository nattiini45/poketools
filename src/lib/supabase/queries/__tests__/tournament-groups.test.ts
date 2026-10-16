import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';

// ── Chainable Supabase mock (the tournaments.test.ts pattern) ──────
const chainMethods = [
  'from', 'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
  'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
  'limit', 'range', 'match', 'returns', 'throwOnError',
];

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'is', 'in', 'contains', 'filter', 'not', 'or', 'order',
    'limit', 'range', 'match', 'returns', 'throwOnError',
  ];
  for (const m of methods) {
    mb[m] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockBuilder,
}));

import {
  getGroupMembershipsInTournament,
  groupSwapWroteBeforeFailure,
  swapGroupMemberInTournament,
} from '../tournament-groups';

beforeEach(() => {
  for (const m of [...chainMethods, 'single', 'maybeSingle']) {
    mockBuilder[m].mockClear();
  }
  for (const m of chainMethods) {
    mockBuilder[m].mockReturnValue(mockBuilder);
  }
  mockBuilder.single.mockResolvedValue({ data: null, error: null });
  mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
});

// ── Helpers ────────────────────────────────────────────────────────

type Call = [method: string, ...args: unknown[]];

/**
 * Every builder call in invocation order, split into one list per statement
 * (a statement starts at `from`), so a test can assert which filters belong
 * to which read or write.
 */
function statements(): Call[][] {
  const calls: Array<{ order: number; call: Call }> = [];
  for (const method of [...chainMethods, 'single', 'maybeSingle']) {
    const { calls: argLists, invocationCallOrder } = mockBuilder[method].mock;
    argLists.forEach((args, i) => {
      calls.push({ order: invocationCallOrder[i], call: [method, ...args] });
    });
  }
  calls.sort((a, b) => a.order - b.order);
  const result: Call[][] = [];
  for (const { call } of calls) {
    if (call[0] === 'from') result.push([call]);
    else result.at(-1)?.push(call);
  }
  return result;
}

interface GroupRow {
  id: string;
  name: string;
  group_number: number;
}

interface MemberRow {
  group_id: string;
  player_id: string;
  seed: number;
}

const GROUPS: GroupRow[] = [
  { id: 'g1', name: 'Group A', group_number: 1 },
  { id: 'g2', name: 'Group B', group_number: 2 },
  { id: 'g3', name: 'Group C', group_number: 3 },
];

/**
 * Resolve each statement at its terminal call: the groups read ends at
 * `.order`, the members read at `.in('player_id')`, and a delete or an update
 * at its trailing `.select('group_id')` (the rows it changed). By default a
 * delete or update changes the one row its `group_id` filter names;
 * `deletedRows` / `updatedRows` override that (`[]`: the row was gone by the
 * time the statement ran).
 */
function stubDb(db: {
  groups?: GroupRow[];
  members?: MemberRow[];
  groupsError?: Error;
  membersError?: Error;
  deleteError?: Error;
  updateError?: Error;
  deletedRows?: Array<{ group_id: string }>;
  updatedRows?: Array<{ group_id: string }>;
} = {}) {
  mockBuilder.order.mockReturnValue({
    data: db.groupsError ? null : (db.groups ?? GROUPS),
    error: db.groupsError ?? null,
  });
  mockBuilder.in.mockImplementation((column: string) =>
    column === 'player_id'
      ? { data: db.membersError ? null : (db.members ?? []), error: db.membersError ?? null }
      : mockBuilder,
  );
  let statement: 'read' | 'delete' | 'update' = 'read';
  let filteredGroupId: unknown = null;
  mockBuilder.from.mockImplementation(() => {
    statement = 'read';
    return mockBuilder;
  });
  mockBuilder.delete.mockImplementation(() => {
    statement = 'delete';
    return mockBuilder;
  });
  mockBuilder.update.mockImplementation(() => {
    statement = 'update';
    return mockBuilder;
  });
  mockBuilder.eq.mockImplementation((column: string, value: unknown) => {
    if (statement !== 'read' && column === 'group_id') filteredGroupId = value;
    return mockBuilder;
  });
  mockBuilder.select.mockImplementation(() => {
    if (statement === 'update') {
      return {
        data: db.updateError ? null : (db.updatedRows ?? [{ group_id: filteredGroupId }]),
        error: db.updateError ?? null,
      };
    }
    if (statement === 'delete') {
      return {
        data: db.deleteError ? null : (db.deletedRows ?? [{ group_id: filteredGroupId }]),
        error: db.deleteError ?? null,
      };
    }
    return mockBuilder;
  });
}

/** The UPDATE that hands the slot in `groupId` from p-out to p-in. */
function slotUpdate(groupId: string): Call[] {
  return [
    ['from', 'tournament_group_members'],
    ['update', { player_id: 'p-in' }],
    ['eq', 'group_id', groupId],
    ['eq', 'player_id', 'p-out'],
    ['select', 'group_id'],
  ];
}

/** The DELETE of one stale row, reporting the rows it removed. */
function rowDelete(groupId: string, playerId: string): Call[] {
  return [
    ['from', 'tournament_group_members'],
    ['delete'],
    ['eq', 'group_id', groupId],
    ['eq', 'player_id', playerId],
    ['select', 'group_id'],
  ];
}

const GROUPS_READ: Call[] = [
  ['from', 'tournament_groups'],
  ['select', 'id, name, group_number'],
  ['eq', 'tournament_id', 't1'],
  ['order', 'group_number'],
];

// ════════════════════════════════════════════════════════════════════
// getGroupMembershipsInTournament
// ════════════════════════════════════════════════════════════════════

describe('getGroupMembershipsInTournament', () => {
  it('returns [] without a query when no player ids are given', async () => {
    stubDb();

    const result = await getGroupMembershipsInTournament('t1', []);

    expect(result).toEqual([]);
    expect(mockBuilder.from).not.toHaveBeenCalled();
  });

  it('reads only the groups when the phase has none', async () => {
    stubDb({ groups: [] });

    const result = await getGroupMembershipsInTournament('t1', ['p1']);

    expect(result).toEqual([]);
    expect(statements()).toEqual([GROUPS_READ]);
    expect(mockBuilder.in).not.toHaveBeenCalled();
  });

  it("reads the phase's groups, then these players' rows in them", async () => {
    stubDb({ members: [] });

    await getGroupMembershipsInTournament('t1', ['p1', 'p2']);

    expect(statements()).toEqual([
      GROUPS_READ,
      [
        ['from', 'tournament_group_members'],
        ['select', 'group_id, player_id, seed'],
        ['in', 'group_id', ['g1', 'g2', 'g3']],
        ['in', 'player_id', ['p1', 'p2']],
      ],
    ]);
  });

  it('maps each row to its group name and number, ordered by group number', async () => {
    stubDb({
      members: [
        { group_id: 'g3', player_id: 'p2', seed: 1 },
        { group_id: 'g1', player_id: 'p1', seed: 2 },
        { group_id: 'g2', player_id: 'p3', seed: 4 },
      ],
    });

    const result = await getGroupMembershipsInTournament('t1', ['p1', 'p2', 'p3']);

    expect(result).toEqual([
      { group_id: 'g1', group_name: 'Group A', group_number: 1, player_id: 'p1', seed: 2 },
      { group_id: 'g2', group_name: 'Group B', group_number: 2, player_id: 'p3', seed: 4 },
      { group_id: 'g3', group_name: 'Group C', group_number: 3, player_id: 'p2', seed: 1 },
    ]);
  });

  it('drops a row whose group is not one of the phase groups', async () => {
    stubDb({ members: [{ group_id: 'g-elsewhere', player_id: 'p1', seed: 1 }] });

    const result = await getGroupMembershipsInTournament('t1', ['p1']);

    expect(result).toEqual([]);
  });

  it('throws a groups read error without reading members', async () => {
    stubDb({ groupsError: new Error('groups err') });

    await expect(getGroupMembershipsInTournament('t1', ['p1'])).rejects.toThrow('groups err');
    expect(statements()).toEqual([GROUPS_READ]);
  });

  it('throws a members read error', async () => {
    stubDb({ membersError: new Error('members err') });

    await expect(getGroupMembershipsInTournament('t1', ['p1'])).rejects.toThrow('members err');
  });
});

// ════════════════════════════════════════════════════════════════════
// swapGroupMemberInTournament
// ════════════════════════════════════════════════════════════════════

describe('swapGroupMemberInTournament', () => {
  /** The statements after the two reads (groups, members). */
  const writes = () => statements().slice(2);

  it("reads both players' rows in the phase", async () => {
    stubDb({ members: [] });

    await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    expect(mockBuilder.in).toHaveBeenCalledWith('player_id', ['p-out', 'p-in']);
  });

  it('holds nothing and writes nothing when neither player holds a group row', async () => {
    stubDb({ members: [] });

    const result = await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    expect(result).toEqual({ written: false, held: null });
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(mockBuilder.update).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('keeps the slot an interrupted run already moved: the outgoing player holds no row, the incoming player one', async () => {
    // A re-run after the group step ran but the enrollment swap failed: the
    // incoming player's row IS the handed-over slot and must survive.
    stubDb({ members: [{ group_id: 'g2', player_id: 'p-in', seed: 3 }] });

    const result = await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    expect(writes()).toEqual([]);
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(mockBuilder.update).not.toHaveBeenCalled();
    expect(result).toEqual({
      written: false,
      held: {
        group_id: 'g2',
        group_name: 'Group B',
        group_number: 2,
        player_id: 'p-in',
        seed: 3,
      },
    });
  });

  it("keeps only the incoming player's lowest group row when the outgoing player holds none", async () => {
    stubDb({
      members: [
        { group_id: 'g3', player_id: 'p-in', seed: 4 },
        { group_id: 'g1', player_id: 'p-in', seed: 2 },
      ],
    });

    const result = await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    expect(writes()).toEqual([rowDelete('g3', 'p-in')]);
    expect(mockBuilder.update).not.toHaveBeenCalled();
    expect(result.written).toBe(true);
    expect(result.held).toMatchObject({ group_id: 'g1', player_id: 'p-in' });
  });

  it('does not count a stale-row delete that matched no row as a write', async () => {
    // The extra row was removed between the read and the DELETE.
    stubDb({
      members: [
        { group_id: 'g3', player_id: 'p-in', seed: 4 },
        { group_id: 'g1', player_id: 'p-in', seed: 2 },
      ],
      deletedRows: [],
    });

    const result = await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    expect(writes()).toEqual([rowDelete('g3', 'p-in')]);
    expect(result.written).toBe(false);
    expect(result.held).toMatchObject({ group_id: 'g1', player_id: 'p-in' });
  });

  it('holds nothing and writes nothing in an ungrouped phase', async () => {
    stubDb({ groups: [] });

    const result = await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    expect(result).toEqual({ written: false, held: null });
    expect(statements()).toEqual([GROUPS_READ]);
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(mockBuilder.update).not.toHaveBeenCalled();
  });

  it("moves the slot with one UPDATE filtered by the slot's group and the outgoing player", async () => {
    stubDb({ members: [{ group_id: 'g2', player_id: 'p-out', seed: 3 }] });

    const result = await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    expect(writes()).toEqual([slotUpdate('g2')]);
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      written: true,
      held: {
        group_id: 'g2',
        group_name: 'Group B',
        group_number: 2,
        player_id: 'p-in',
        seed: 3,
      },
    });
  });

  it("deletes the incoming player's stale row and the outgoing player's extra rows before the update", async () => {
    stubDb({
      members: [
        { group_id: 'g3', player_id: 'p-out', seed: 5 },
        { group_id: 'g2', player_id: 'p-in', seed: 2 },
        { group_id: 'g1', player_id: 'p-out', seed: 1 },
      ],
    });

    const result = await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    // The slot is the outgoing player's row in the lowest group number (g1).
    expect(writes()).toEqual([
      rowDelete('g2', 'p-in'),
      rowDelete('g3', 'p-out'),
      slotUpdate('g1'),
    ]);
    expect(result).toEqual({
      written: true,
      held: {
        group_id: 'g1',
        group_name: 'Group A',
        group_number: 1,
        player_id: 'p-in',
        seed: 1,
      },
    });
  });

  it("ends the update chain with .select('group_id') so it can tell whether the row moved", async () => {
    stubDb({ members: [{ group_id: 'g1', player_id: 'p-out', seed: 1 }] });

    await swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    const update = writes().find((statement) => statement.some(([method]) => method === 'update'));
    expect(update?.at(-1)).toEqual(['select', 'group_id']);
  });

  it('throws an update error', async () => {
    stubDb({
      members: [{ group_id: 'g1', player_id: 'p-out', seed: 1 }],
      updateError: new Error('update err'),
    });

    await expect(swapGroupMemberInTournament('t1', 'p-out', 'p-in')).rejects.toThrow('update err');
  });

  it('marks an error thrown after a stale row was deleted, and only then', async () => {
    // The incoming player's stale row is deleted, then the slot UPDATE finds no row.
    stubDb({
      members: [
        { group_id: 'g1', player_id: 'p-out', seed: 1 },
        { group_id: 'g2', player_id: 'p-in', seed: 2 },
      ],
      updatedRows: [],
    });
    const afterDelete = await swapGroupMemberInTournament('t1', 'p-out', 'p-in').catch((err: unknown) => err);
    expect(afterDelete).toMatchObject({ code: 'GROUP_SLOT_CHANGED' });
    expect(groupSwapWroteBeforeFailure(afterDelete)).toBe(true);

    // The same failure with nothing deleted before it.
    stubDb({ members: [{ group_id: 'g1', player_id: 'p-out', seed: 1 }], updatedRows: [] });
    const noDelete = await swapGroupMemberInTournament('t1', 'p-out', 'p-in').catch((err: unknown) => err);
    expect(noDelete).toMatchObject({ code: 'GROUP_SLOT_CHANGED' });
    expect(groupSwapWroteBeforeFailure(noDelete)).toBe(false);

    // A failing first delete wrote nothing.
    stubDb({
      members: [
        { group_id: 'g1', player_id: 'p-out', seed: 1 },
        { group_id: 'g2', player_id: 'p-in', seed: 2 },
      ],
      deleteError: new Error('delete err'),
    });
    const deleteFailed = await swapGroupMemberInTournament('t1', 'p-out', 'p-in').catch((err: unknown) => err);
    expect(deleteFailed).toBeInstanceOf(Error);
    expect(groupSwapWroteBeforeFailure(deleteFailed)).toBe(false);
    expect(groupSwapWroteBeforeFailure(null)).toBe(false);
    expect(groupSwapWroteBeforeFailure('GROUP_SLOT_CHANGED')).toBe(false);
  });

  it('throws GROUP_SLOT_CHANGED (409) when the update changed no row', async () => {
    // The slot row was removed or moved between the read and the UPDATE.
    stubDb({
      members: [{ group_id: 'g1', player_id: 'p-out', seed: 1 }],
      updatedRows: [],
    });

    const result = swapGroupMemberInTournament('t1', 'p-out', 'p-in');

    await expect(result).rejects.toBeInstanceOf(UserFacingError);
    await expect(result).rejects.toMatchObject({ code: 'GROUP_SLOT_CHANGED', statusCode: 409 });
    expect(writes()).toEqual([slotUpdate('g1')]);
  });

  it('throws a delete error without running the update', async () => {
    stubDb({
      members: [
        { group_id: 'g1', player_id: 'p-out', seed: 1 },
        { group_id: 'g2', player_id: 'p-in', seed: 2 },
      ],
      deleteError: new Error('delete err'),
    });

    await expect(swapGroupMemberInTournament('t1', 'p-out', 'p-in')).rejects.toThrow('delete err');
    expect(mockBuilder.update).not.toHaveBeenCalled();
  });

  it('throws a read error without writing', async () => {
    stubDb({ membersError: new Error('members err') });

    await expect(swapGroupMemberInTournament('t1', 'p-out', 'p-in')).rejects.toThrow('members err');
    expect(mockBuilder.delete).not.toHaveBeenCalled();
    expect(mockBuilder.update).not.toHaveBeenCalled();
  });
});
