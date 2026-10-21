/**
 * League groups query module (src/lib/supabase/queries/season-groups.ts). The Supabase client is a recording chain
 * mock; the RPC refusals arrive as PostgREST P0001 errors and must become `DraftRuleError`s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chain, calls, state } = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const state: { result: { data: unknown; error: unknown; count?: number | null } } = { result: { data: null, error: null } };
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'update', 'upsert']) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.maybeSingle = (...args: unknown[]) => {
    calls.push({ method: 'maybeSingle', args });
    return Promise.resolve(state.result);
  };
  chain.rpc = (...args: unknown[]) => {
    calls.push({ method: 'rpc', args });
    return Promise.resolve(state.result);
  };
  chain.then = (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve, reject);
  return { chain, calls, state };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: chain }));

import {
  getSeasonGroupMembership,
  getSeasonGroupOfPlayer,
  getSeasonGroups,
  placeSeasonGroupMember,
  removeLeagueParticipant,
  renameSeasonGroup,
  replaceSeasonGroups,
  SeasonGroupNameTakenError,
  seasonHasGroups,
  seasonGroupHasDraftingPool,
  seasonPhasesHaveRounds,
  toRosterAddError,
} from '../season-groups';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { DraftRuleError } from '@/lib/draft/errors';

function respond(result: { data: unknown; error: unknown; count?: number | null }): void {
  state.result = result;
}
const called = (method: string): unknown[][] => calls.filter((c) => c.method === method).map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  respond({ data: null, error: null });
});

describe('reads', () => {
  it('getSeasonGroups: display order, members in join order', async () => {
    respond({
      data: [
        {
          id: 'g-1', season_id: 's-1', name: 'Gold', sort_order: 1,
          season_group_members: [
            { player_id: 'p-2', created_at: '2026-10-18T10:00:01Z' },
            { player_id: 'p-1', created_at: '2026-10-18T10:00:00Z' },
          ],
        },
        { id: 'g-2', season_id: 's-1', name: 'Silber', sort_order: 2, season_group_members: null },
      ],
      error: null,
    });
    expect(await getSeasonGroups('s-1')).toEqual([
      { id: 'g-1', season_id: 's-1', name: 'Gold', sort_order: 1, player_ids: ['p-1', 'p-2'] },
      { id: 'g-2', season_id: 's-1', name: 'Silber', sort_order: 2, player_ids: [] },
    ]);
    expect(called('from')).toEqual([['season_groups']]);
    expect(called('order')).toEqual([['sort_order', { ascending: true }]]);
  });

  it('getSeasonGroups: a league without groups is empty; a query error is rethrown', async () => {
    respond({ data: [], error: null });
    expect(await getSeasonGroups('s-1')).toEqual([]);
    const failure = { code: '42P01', message: 'missing' };
    respond({ data: null, error: failure });
    await expect(getSeasonGroups('s-1')).rejects.toBe(failure);
  });

  it('seasonHasGroups: one head count', async () => {
    respond({ data: null, error: null, count: 2 });
    expect(await seasonHasGroups('s-1')).toBe(true);
    respond({ data: null, error: null, count: 0 });
    expect(await seasonHasGroups('s-1')).toBe(false);
    expect(called('select')[0]).toEqual(['id', { count: 'exact', head: true }]);
  });

  it('seasonPhasesHaveRounds: one head count over the phases; no phase reads nothing', async () => {
    expect(await seasonPhasesHaveRounds([])).toBe(false);
    expect(calls).toEqual([]);
    respond({ data: null, error: null, count: 1 });
    expect(await seasonPhasesHaveRounds(['t-1', 't-2'])).toBe(true);
    expect(called('from')).toEqual([['rounds']]);
    expect(called('in')).toEqual([['tournament_id', ['t-1', 't-2']]]);
    expect(called('select')[0]).toEqual(['id', { count: 'exact', head: true }]);
    respond({ data: null, error: null, count: 0 });
    expect(await seasonPhasesHaveRounds(['t-1'])).toBe(false);
    const failure = { code: '57014', message: 'canceling statement due to statement timeout' };
    respond({ data: null, error: failure });
    await expect(seasonPhasesHaveRounds(['t-1'])).rejects.toBe(failure);
  });

  it('seasonGroupHasDraftingPool: one head count of the group pools in submissions or drafting; errors propagate', async () => {
    respond({ data: null, error: null, count: 1 });
    expect(await seasonGroupHasDraftingPool('g-1')).toBe(true);
    expect(called('from')).toEqual([['draft_pools']]);
    expect(called('select')[0]).toEqual(['id', { count: 'exact', head: true }]);
    expect(called('eq')).toEqual([['season_group_id', 'g-1']]);
    // A Redraft in submissions locks too: its deadline publishes the outgoing trainer's drops on its own.
    expect(called('in')).toEqual([['phase', ['submissions', 'drafting']]]);
    respond({ data: null, error: null, count: 0 });
    expect(await seasonGroupHasDraftingPool('g-1')).toBe(false);
    const failure = { code: '57014', message: 'canceling statement due to statement timeout' };
    respond({ data: null, error: failure });
    await expect(seasonGroupHasDraftingPool('g-1')).rejects.toBe(failure);
  });

  it("getSeasonGroupOfPlayer: the trainer's group, or null", async () => {
    respond({ data: { season_groups: { id: 'g-1', season_id: 's-1', name: 'Gold', sort_order: 1 } }, error: null });
    expect(await getSeasonGroupOfPlayer('s-1', 'p-1')).toEqual({ id: 'g-1', season_id: 's-1', name: 'Gold', sort_order: 1 });
    expect(called('eq')).toEqual([['season_id', 's-1'], ['player_id', 'p-1']]);
    respond({ data: null, error: null });
    expect(await getSeasonGroupOfPlayer('s-1', 'p-9')).toBeNull();
  });

  it('getSeasonGroupMembership: trainer -> group id', async () => {
    respond({ data: [{ player_id: 'p-1', group_id: 'g-1' }, { player_id: 'p-4', group_id: 'g-2' }], error: null });
    expect(await getSeasonGroupMembership('s-1')).toEqual({ 'p-1': 'g-1', 'p-4': 'g-2' });
  });
});

describe('replaceSeasonGroups (season_groups_replace)', () => {
  it('sends the groups in display order and maps the result', async () => {
    respond({ data: [{ id: 'g-1', name: 'Gold', sort_order: 1, player_ids: ['p-1'] }], error: null });
    const out = await replaceSeasonGroups('s-1', [{ name: 'Gold', player_ids: ['p-1'] }]);
    expect(out).toEqual([{ id: 'g-1', season_id: 's-1', name: 'Gold', sort_order: 1, player_ids: ['p-1'] }]);
    expect(called('rpc')).toEqual([
      ['season_groups_replace', { p_season_id: 's-1', p_groups: [{ name: 'Gold', player_ids: ['p-1'] }] }],
    ]);
  });

  it('a database refusal becomes a coded DraftRuleError', async () => {
    respond({ data: null, error: { code: 'P0001', message: 'SEASON_GROUP_LOCKED', details: '' } });
    const err = await replaceSeasonGroups('s-1', []).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftRuleError);
    expect((err as DraftRuleError).code).toBe('SEASON_GROUP_LOCKED');
    expect((err as DraftRuleError).statusCode).toBe(409);
  });

  it('a member refusal carries the player in detail', async () => {
    respond({
      data: null,
      error: { code: 'P0001', message: 'SEASON_GROUP_MEMBERS_INVALID', details: '{"player_id": "p-7"}' },
    });
    const err = (await replaceSeasonGroups('s-1', [{ name: 'A', player_ids: ['p-7'] }]).catch((e: unknown) => e)) as DraftRuleError;
    expect(err.code).toBe('SEASON_GROUP_MEMBERS_INVALID');
    expect(err.detail).toEqual({ player_id: 'p-7' });
  });

  it('an unexpected payload is an error, not an empty list', async () => {
    respond({ data: { groups: [] }, error: null });
    await expect(replaceSeasonGroups('s-1', [])).rejects.toThrow('season_groups_replace returned an unexpected payload');
  });
});

describe('single-row writes', () => {
  it('renameSeasonGroup trims and scopes to the league', async () => {
    respond({ data: { id: 'g-1', season_id: 's-1', name: 'Gold', sort_order: 1 }, error: null });
    expect(await renameSeasonGroup('s-1', 'g-1', '  Gold ')).toMatchObject({ name: 'Gold' });
    expect(called('update')).toEqual([[{ name: 'Gold' }]]);
    expect(called('eq')).toEqual([['id', 'g-1'], ['season_id', 's-1']]);
  });

  it('renameSeasonGroup: a duplicate name is its own error; other errors are rethrown', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    await expect(renameSeasonGroup('s-1', 'g-1', 'Gold')).rejects.toBeInstanceOf(SeasonGroupNameTakenError);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    const failure = { code: '42501', message: 'permission denied' };
    respond({ data: null, error: failure });
    await expect(renameSeasonGroup('s-1', 'g-1', 'Gold')).rejects.toBe(failure);
  });

  it('renameSeasonGroup: the table check refusing the name is INVALID_CONFIG {field: name}, logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond({ data: null, error: { code: '23514', message: 'violates check constraint "season_groups_name_len"' } });
    const err = (await renameSeasonGroup('s-1', 'g-1', 'x'.repeat(61)).catch((e: unknown) => e)) as DraftRuleError;
    expect(err).toBeInstanceOf(DraftRuleError);
    expect(err.code).toBe('INVALID_CONFIG');
    expect(err.params).toEqual({ field: 'name' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('placeSeasonGroupMember: one upsert on the membership key (a move, or a first placement)', async () => {
    respond({ data: null, error: null });
    await expect(placeSeasonGroupMember('s-1', 'p-1', 'g-2')).resolves.toBeUndefined();
    expect(called('upsert')).toEqual([
      [{ season_id: 's-1', player_id: 'p-1', group_id: 'g-2' }, { onConflict: 'season_id,player_id' }],
    ]);
  });

  it('placeSeasonGroupMember: the lock is a DraftRuleError; a raw FK error is rethrown', async () => {
    respond({ data: null, error: { code: 'P0001', message: 'SEASON_GROUP_LOCKED', details: '{"season_group_id": "g-1"}' } });
    const err = await placeSeasonGroupMember('s-1', 'p-1', 'g-2').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftRuleError);
    expect((err as DraftRuleError).code).toBe('SEASON_GROUP_LOCKED');
    const failure = { code: '42501', message: 'permission denied' };
    respond({ data: null, error: failure });
    await expect(placeSeasonGroupMember('s-1', 'p-1', 'g-other')).rejects.toBe(failure);
  });

  it('placeSeasonGroupMember: the new refusals (schedule lock, group size) are DraftRuleErrors', async () => {
    respond({ data: null, error: { code: 'P0001', message: 'SEASON_GROUPS_SCHEDULED', details: '{"season_group_id": "g-1"}' } });
    const scheduled = (await placeSeasonGroupMember('s-1', 'p-1', 'g-2').catch((e: unknown) => e)) as DraftRuleError;
    expect([scheduled.code, scheduled.statusCode]).toEqual(['SEASON_GROUPS_SCHEDULED', 409]);
    respond({ data: null, error: { code: 'P0001', message: 'SEASON_GROUP_TOO_SMALL', details: '{"season_group_id": "g-1"}' } });
    const small = (await placeSeasonGroupMember('s-1', 'p-1', 'g-2').catch((e: unknown) => e)) as DraftRuleError;
    expect([small.code, small.statusCode]).toEqual(['SEASON_GROUP_TOO_SMALL', 422]);
  });

  it('placeSeasonGroupMember: a foreign key race keeps a distinct code per key, logged', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond({
      data: null,
      error: {
        code: '23503',
        message: 'insert or update on table "season_group_members" violates foreign key constraint "season_group_members_group_fkey"',
      },
    });
    const group = (await placeSeasonGroupMember('s-1', 'p-1', 'g-other').catch((e: unknown) => e)) as UserFacingError;
    expect(group).toBeInstanceOf(UserFacingError);
    expect([group.code, group.statusCode]).toEqual(['SEASON_GROUP_NOT_FOUND', 404]);
    respond({
      data: null,
      error: {
        code: '23503',
        message: 'insert or update on table "season_group_members" violates foreign key constraint "season_group_members_participant_fkey"',
      },
    });
    const player = (await placeSeasonGroupMember('s-1', 'p-9', 'g-1').catch((e: unknown) => e)) as UserFacingError;
    expect([player.code, player.statusCode]).toEqual(['SEASON_GROUP_PLAYER_NOT_FOUND', 422]);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe('roster writes (20261018202100)', () => {
  it('removeLeagueParticipant calls season_participant_remove and returns whether a row went', async () => {
    respond({ data: true, error: null });
    await expect(removeLeagueParticipant('s1', 'p1')).resolves.toBe(true);
    expect(called('rpc')).toEqual([['season_participant_remove', { p_season_id: 's1', p_player_id: 'p1' }]]);

    respond({ data: false, error: null });
    await expect(removeLeagueParticipant('s1', 'p1')).resolves.toBe(false);
  });

  it.each([
    ['SEASON_GROUPS_SCHEDULED', 409],
    ['SEASON_GROUP_LOCKED', 409],
    ['SEASON_GROUP_TOO_SMALL', 422],
  ] as const)('removeLeagueParticipant: the refusal %s becomes a DraftRuleError (%i)', async (code, status) => {
    respond({ data: null, error: { code: 'P0001', message: code, details: '{"season_group_id":"g1"}' } });
    const err = await removeLeagueParticipant('s1', 'p1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DraftRuleError);
    expect(err).toMatchObject({ code, statusCode: status });
  });

  it('removeLeagueParticipant: a non-boolean payload and other errors are not swallowed', async () => {
    respond({ data: { removed: true }, error: null });
    await expect(removeLeagueParticipant('s1', 'p1')).rejects.toThrow('unexpected payload');
    const dbError = { code: '57014', message: 'canceling statement' };
    respond({ data: null, error: dbError });
    await expect(removeLeagueParticipant('s1', 'p1')).rejects.toBe(dbError);
  });

  it('toRosterAddError maps the insert trigger refusal and passes everything else through', () => {
    const mapped = toRosterAddError({ code: 'P0001', message: 'SEASON_GROUPS_SCHEDULED', details: null });
    expect(mapped).toBeInstanceOf(DraftRuleError);
    expect(mapped).toMatchObject({ code: 'SEASON_GROUPS_SCHEDULED', statusCode: 409 });
    const dup = { code: '23505', message: 'duplicate key' };
    expect(toRosterAddError(dup)).toBe(dup);
  });
});
