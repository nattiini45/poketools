import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A recording fake of the PostgREST builder: every call is logged, `then` resolves the queued result for the
 * terminal operation of the chain (the tests queue one result per awaited chain, in order).
 */
const fake = vi.hoisted(() => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const results: Array<{ data?: unknown; error?: unknown }> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(results.shift() ?? { data: null, error: null });
  return { calls, results, builder };
});

vi.mock('../../client', () => ({ supabase: fake.builder }));

import {
  deletePushSubscriptionById,
  deletePushSubscriptionByEndpoint,
  deletePushSubscriptionsByIds,
  endpointFingerprint,
  listPushDevices,
  listPushTargets,
  markPushFailure,
  markPushSuccess,
  MAX_PUSH_DEVICES_PER_PLAYER,
  upsertPushSubscription,
} from '../push-subscriptions';

const input = {
  playerId: 'p1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/current',
  p256dh: 'P',
  auth: 'A',
  locale: 'de' as const,
  userAgentLabel: 'Chrome on Android',
};

const called = (method: string) => fake.calls.filter((c) => c.method === method);

beforeEach(() => {
  fake.calls.length = 0;
  fake.results.length = 0;
});

describe('upsertPushSubscription', () => {
  it('upserts by endpoint for the given player with a clean failure streak', async () => {
    fake.results.push({ error: null }, { data: [{ id: 'r1', endpoint: input.endpoint }], error: null });
    const result = await upsertPushSubscription(input);

    expect(result).toEqual({ dropped: 0 });
    expect(called('from')[0].args).toEqual(['push_subscriptions']);
    expect(called('upsert')[0].args).toEqual([
      {
        player_id: 'p1',
        endpoint: input.endpoint,
        p256dh: 'P',
        auth: 'A',
        locale: 'de',
        user_agent_label: 'Chrome on Android',
        failure_count: 0,
      },
      { onConflict: 'endpoint' },
    ]);
  });

  it(`keeps at most ${MAX_PUSH_DEVICES_PER_PLAYER} devices: drops the oldest, never the one just stored`, async () => {
    const rows = Array.from({ length: MAX_PUSH_DEVICES_PER_PLAYER + 2 }, (_, i) => ({
      id: `r${i}`,
      endpoint: i === 0 ? input.endpoint : `https://fcm.googleapis.com/fcm/send/${i}`,
    }));
    // The list is oldest first; the current endpoint is the OLDEST row (a re-subscribe of an old device).
    fake.results.push({ error: null }, { data: rows, error: null }, { error: null });
    const result = await upsertPushSubscription(input);

    expect(result).toEqual({ dropped: 2 });
    expect(called('delete')).toHaveLength(1);
    expect(called('in')[0].args).toEqual(['id', ['r1', 'r2']]);
  });

  it('rethrows an upsert error before touching anything else', async () => {
    fake.results.push({ error: new Error('db down') });
    await expect(upsertPushSubscription(input)).rejects.toThrow('db down');
    expect(called('delete')).toHaveLength(0);
  });
});

describe('listPushDevices', () => {
  it('never selects the keys and hands out a fingerprint, not the endpoint', async () => {
    fake.results.push({
      data: [{ id: 'r1', endpoint: input.endpoint, user_agent_label: 'Chrome on Android', created_at: '2026-10-01T00:00:00Z', last_success_at: null }],
      error: null,
    });
    const devices = await listPushDevices('p1');

    const select = called('select')[0].args[0] as string;
    expect(select).not.toMatch(/p256dh|auth/);
    expect(called('eq')[0].args).toEqual(['player_id', 'p1']);
    expect(devices).toEqual([
      {
        id: 'r1',
        label: 'Chrome on Android',
        createdAt: '2026-10-01T00:00:00Z',
        lastSuccessAt: null,
        fingerprint: endpointFingerprint(input.endpoint),
      },
    ]);
    expect(JSON.stringify(devices)).not.toContain('fcm.googleapis.com');
    expect(devices[0].fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('deletes', () => {
  it('by endpoint are scoped to the player and report how many rows went', async () => {
    fake.results.push({ data: [{ id: 'r1' }], error: null });
    expect(await deletePushSubscriptionByEndpoint('p1', input.endpoint)).toBe(1);
    expect(called('eq').map((c) => c.args)).toEqual([
      ['player_id', 'p1'],
      ['endpoint', input.endpoint],
    ]);
  });

  it('by id are scoped to the player too (another player\'s device id deletes nothing)', async () => {
    fake.results.push({ data: [], error: null });
    expect(await deletePushSubscriptionById('p1', 'r9')).toBe(0);
    expect(called('eq').map((c) => c.args)).toEqual([
      ['player_id', 'p1'],
      ['id', 'r9'],
    ]);
  });

  it('by ids (sender cleanup) skip the call for an empty list', async () => {
    await deletePushSubscriptionsByIds([]);
    expect(called('delete')).toHaveLength(0);
    await deletePushSubscriptionsByIds(['a', 'b']);
    expect(called('in')[0].args).toEqual(['id', ['a', 'b']]);
  });
});

describe('sender side', () => {
  it('listPushTargets maps rows, narrows an unknown locale to en and skips empty input', async () => {
    expect(await listPushTargets([])).toEqual([]);
    expect(fake.calls).toHaveLength(0);

    fake.results.push({
      data: [
        { id: 'r1', player_id: 'p1', endpoint: 'https://e/1', p256dh: 'P', auth: 'A', locale: 'de', failure_count: 2 },
        { id: 'r2', player_id: 'p2', endpoint: 'https://e/2', p256dh: 'P', auth: 'A', locale: 'fr', failure_count: 0 },
      ],
      error: null,
    });
    const targets = await listPushTargets(['p1', 'p2']);
    expect(called('in')[0].args).toEqual(['player_id', ['p1', 'p2']]);
    expect(targets.map((t) => [t.id, t.locale, t.failureCount])).toEqual([
      ['r1', 'de', 2],
      ['r2', 'en', 0],
    ]);
  });

  it('markPushSuccess stamps the time and clears the streak', async () => {
    await markPushSuccess([]);
    expect(called('update')).toHaveLength(0);
    await markPushSuccess(['a'], new Date('2026-10-28T12:00:00Z'));
    expect(called('update')[0].args).toEqual([{ last_success_at: '2026-10-28T12:00:00.000Z', failure_count: 0 }]);
  });

  it('markPushFailure records the streak for one row', async () => {
    await markPushFailure('a', 3);
    expect(called('update')[0].args).toEqual([{ failure_count: 3 }]);
    expect(called('eq')[0].args).toEqual(['id', 'a']);
  });

  it('rethrows query errors', async () => {
    fake.results.push({ data: null, error: new Error('db down') });
    await expect(listPushTargets(['p1'])).rejects.toThrow('db down');
  });
});
