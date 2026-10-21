import { describe, expect, it } from 'vitest';
import { isOtherGroupReadOnly, poolGroupOptions, scopePoolsToGroup } from '../group-pools';

const GA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-0000-4000-8000-000000000000`;

const pool = (n: number, group: string | null, name: string | null = null, sort: number | null = null) => ({
  id: id(n),
  season_group_id: group,
  season_group_name: name,
  season_group_sort_order: sort,
});

describe('scopePoolsToGroup', () => {
  it('a league without groups gets every pool back, no group list (unchanged pages)', () => {
    const pools = [pool(1, null), pool(2, null)];
    expect(scopePoolsToGroup(pools, id(2), 'whatever')).toEqual({ grouped: false, groupId: null, pools, groups: [] });
  });

  const grouped = [pool(1, GB, 'Group B', 2), pool(2, GA, 'Group A', 1), pool(3, GB, 'Group B', 2)];

  it('lists the groups with pools in display order', () => {
    expect(poolGroupOptions(grouped)).toEqual([
      { id: GA, name: 'Group A', sortOrder: 1 },
      { id: GB, name: 'Group B', sortOrder: 2 },
    ]);
  });

  it('defaults to the viewer’s group', () => {
    const scope = scopePoolsToGroup(grouped, undefined, GB);
    expect(scope.groupId).toBe(GB);
    expect(scope.pools.map((p) => p.id)).toEqual([id(1), id(3)]);
  });

  it('a ?pool= of another group selects that group (case-insensitive, first array value)', () => {
    expect(scopePoolsToGroup(grouped, [id(2).toUpperCase()], GB).groupId).toBe(GA);
  });

  it('a malformed or foreign ?pool= is ignored', () => {
    expect(scopePoolsToGroup(grouped, 'nope', GB).groupId).toBe(GB);
    expect(scopePoolsToGroup(grouped, id(9), GB).groupId).toBe(GB);
  });

  it('a spectator, or a viewer whose group has no pool, sees the first group', () => {
    expect(scopePoolsToGroup(grouped, null, null).groupId).toBe(GA);
    expect(scopePoolsToGroup(grouped, null, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc').groupId).toBe(GA);
  });
});

describe('isOtherGroupReadOnly', () => {
  const base = { shownGroupId: 'gA', viewerGroupId: 'gB', viewerIsParticipant: true, isPoolAdmin: false };

  it('a trainer of another group: read-only; their own group: not', () => {
    expect(isOtherGroupReadOnly(base)).toBe(true);
    expect(isOtherGroupReadOnly({ ...base, viewerGroupId: 'gA' })).toBe(false);
  });

  it('a trainer of the league in no group: read-only (they pick in no group draft)', () => {
    expect(isOtherGroupReadOnly({ ...base, viewerGroupId: null })).toBe(true);
  });

  it('spectators, pool admins and leagues without groups: no note', () => {
    expect(isOtherGroupReadOnly({ ...base, viewerGroupId: null, viewerIsParticipant: false })).toBe(false);
    expect(isOtherGroupReadOnly({ ...base, isPoolAdmin: true })).toBe(false);
    expect(isOtherGroupReadOnly({ ...base, shownGroupId: null })).toBe(false);
  });
});
