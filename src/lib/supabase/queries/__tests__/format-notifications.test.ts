import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A recording fake of the PostgREST builder: `then` resolves the queued result of the awaited chain, in order. */
const fake = vi.hoisted(() => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const results: Array<{ data?: unknown; error?: unknown; count?: number | null }> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'update', 'delete', 'eq', 'is', 'in', 'lt', 'order', 'range']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(results.shift() ?? { data: [], error: null });
  return { calls, results, builder };
});

vi.mock('server-only', () => ({}));
vi.mock('../../client', () => ({ supabase: fake.builder }));

import {
  countUnreadFormatNotifications,
  listFormatNotifications,
  markFormatNotificationsRead,
  purgeFormatNotifications,
  readCurrentLeagueMembers,
  readNotificationLeagueNames,
} from '../format-notifications';

const called = (method: string) => fake.calls.filter((call) => call.method === method).map((call) => call.args);

beforeEach(() => {
  fake.calls.length = 0;
  fake.results.length = 0;
});

describe('listFormatNotifications', () => {
  it('reads the player\'s own rows, newest first, in a stable order, and one row more than the page', async () => {
    fake.results.push({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null });
    const page = await listFormatNotifications('me', 2, 10);
    expect(called('from')).toEqual([['format_notifications']]);
    expect(called('eq')).toEqual([['player_id', 'me']]);
    expect(called('order')).toEqual([['created_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(called('range')).toEqual([[10, 12]]);
    expect(page).toEqual({ rows: [{ id: 'a' }, { id: 'b' }], hasMore: true });
  });

  it('never selects the recipient or the dedupe key', async () => {
    fake.results.push({ data: [], error: null });
    await listFormatNotifications('me', 2, 0);
    expect(called('select')[0][0]).not.toMatch(/player_id|dedupe_key/);
  });

  it('rethrows a failed read', async () => {
    const boom = new Error('boom');
    fake.results.push({ data: null, error: boom });
    await expect(listFormatNotifications('me', 2, 0)).rejects.toBe(boom);
  });
});

describe('countUnreadFormatNotifications', () => {
  it('counts the unread rows of the player with a head request', async () => {
    fake.results.push({ count: 4, error: null });
    await expect(countUnreadFormatNotifications('me')).resolves.toBe(4);
    expect(called('select')).toEqual([['id', { count: 'exact', head: true }]]);
    expect(called('is')).toEqual([['read_at', null]]);
  });
});

describe('markFormatNotificationsRead', () => {
  it('scopes a write by ids to the player', async () => {
    fake.results.push({ error: null });
    await markFormatNotificationsRead('me', ['a', 'b']);
    expect(called('eq')).toEqual([['player_id', 'me']]);
    expect(called('in')).toEqual([['id', ['a', 'b']]]);
    expect(called('is')).toEqual([['read_at', null]]);
  });

  it('marks everything of the player without an id filter', async () => {
    fake.results.push({ error: null });
    await markFormatNotificationsRead('me', 'all');
    expect(called('eq')).toEqual([['player_id', 'me']]);
    expect(called('in')).toEqual([]);
  });

  it('rethrows a failed write', async () => {
    const boom = new Error('boom');
    fake.results.push({ error: boom });
    await expect(markFormatNotificationsRead('me', 'all')).rejects.toBe(boom);
  });
});

describe('purgeFormatNotifications', () => {
  it('deletes the rows before the cutoff and returns how many', async () => {
    fake.results.push({ count: 7, error: null });
    await expect(purgeFormatNotifications(new Date('2026-08-10T00:00:00.000Z'))).resolves.toBe(7);
    expect(called('delete')).toEqual([[{ count: 'exact' }]]);
    expect(called('lt')).toEqual([['created_at', '2026-08-10T00:00:00.000Z']]);
  });
});

describe('the lookups', () => {
  it('read nothing for an empty page', async () => {
    await expect(readNotificationLeagueNames([])).resolves.toEqual(new Map());
    await expect(readCurrentLeagueMembers(['s'], [])).resolves.toEqual(new Map());
    await expect(readCurrentLeagueMembers([], ['p'])).resolves.toEqual(new Map());
    expect(fake.calls).toEqual([]);
  });

  it('read the league names by id', async () => {
    fake.results.push({ data: [{ id: 's', name: 'League' }], error: null });
    await expect(readNotificationLeagueNames(['s'])).resolves.toEqual(new Map([['s', 'League']]));
  });

  it('count a player of the league and a player of one of its phases as taking part', async () => {
    fake.results.push(
      { data: [{ season_id: 's', player_id: 'a' }], error: null },
      { data: [{ player_id: 'b', tournament_id: 't', tournaments: { season_id: 's' } }], error: null },
    );
    const members = await readCurrentLeagueMembers(['s'], ['a', 'b', 'c']);
    expect(members.get('s')).toEqual(new Set(['a', 'b']));
  });
});
