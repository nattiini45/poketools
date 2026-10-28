import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  readPushConfig: vi.fn(),
  listPushTargets: vi.fn(),
  markPushSuccess: vi.fn(),
  markPushFailure: vi.fn(),
  deletePushSubscriptionsByIds: vi.fn(),
}));

vi.mock('web-push', () => ({ sendNotification: hoisted.sendNotification }));
vi.mock('../config', () => ({ readPushConfig: hoisted.readPushConfig }));
vi.mock('@/lib/supabase/queries/push-subscriptions', () => ({
  listPushTargets: hoisted.listPushTargets,
  markPushSuccess: hoisted.markPushSuccess,
  markPushFailure: hoisted.markPushFailure,
  deletePushSubscriptionsByIds: hoisted.deletePushSubscriptionsByIds,
}));

import {
  PUSH_CONCURRENCY,
  PUSH_FAILURE_LIMIT,
  PUSH_MAX_TTL_SECONDS,
  PUSH_MIN_TTL_SECONDS,
  pushTopic,
  sendPushToPlayer,
  sendPushToPlayers,
  ttlUntil,
  type PushSpec,
} from '../send';
import { turnPayload } from '../payload';

const CONFIG = { publicKey: 'PUB', privateKey: 'PRIV', subject: 'mailto:admin@example.com' };

function target(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    playerId: 'p1',
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: `p256dh-${id}`,
    auth: `auth-${id}`,
    locale: 'en',
    failureCount: 0,
    ...overrides,
  };
}

const spec: PushSpec = {
  payloadFor: (locale) =>
    turnPayload({ kind: 'turn_started', leagueName: 'EvoLiga', seasonId: 's1', poolId: 'pool-1', timerSeconds: 120 }, locale),
  ttlSeconds: 3600,
  urgency: 'high',
  topicKey: 'draft-pool-1',
};

class PushError extends Error {
  constructor(readonly statusCode: number) {
    super(`push service answered ${statusCode}`);
    this.name = 'WebPushError';
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.readPushConfig.mockReturnValue(CONFIG);
  hoisted.listPushTargets.mockResolvedValue([]);
  hoisted.sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  hoisted.markPushSuccess.mockResolvedValue(undefined);
  hoisted.markPushFailure.mockResolvedValue(undefined);
  hoisted.deletePushSubscriptionsByIds.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('sendPushToPlayers', () => {
  it('with no valid configuration sends nothing and reads nothing', async () => {
    hoisted.readPushConfig.mockReturnValue(null);
    const summary = await sendPushToPlayers(['p1'], spec);
    expect(summary).toEqual({ attempted: 0, delivered: 0, removed: 0, failed: 0 });
    expect(hoisted.listPushTargets).not.toHaveBeenCalled();
    expect(hoisted.sendNotification).not.toHaveBeenCalled();
  });

  it('sends one message per device, each in the device language, with VAPID details, TTL, urgency and a valid topic', async () => {
    hoisted.listPushTargets.mockResolvedValue([target('a', { locale: 'en' }), target('b', { locale: 'de' })]);
    const summary = await sendPushToPlayers(['p1'], spec);

    expect(summary).toEqual({ attempted: 2, delivered: 2, removed: 0, failed: 0 });
    expect(hoisted.sendNotification).toHaveBeenCalledTimes(2);

    const [subA, bodyA, optsA] = hoisted.sendNotification.mock.calls[0];
    expect(subA).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', keys: { p256dh: 'p256dh-a', auth: 'auth-a' } });
    expect(JSON.parse(bodyA)).toMatchObject({ kind: 'turn_started', title: 'Your pick in EvoLiga', tag: 'draft-pool-1' });
    expect(optsA).toMatchObject({
      vapidDetails: { subject: CONFIG.subject, publicKey: CONFIG.publicKey, privateKey: CONFIG.privateKey },
      TTL: 3600,
      urgency: 'high',
    });
    expect(optsA.topic).toBe(pushTopic('draft-pool-1'));
    expect(optsA.topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);

    const bodyB = JSON.parse(hoisted.sendNotification.mock.calls[1][1]);
    expect(bodyB).toMatchObject({ title: 'Dein Pick in EvoLiga' });
  });

  it('stamps the delivered devices in one write', async () => {
    hoisted.listPushTargets.mockResolvedValue([target('a'), target('b')]);
    await sendPushToPlayers(['p1'], spec);
    expect(hoisted.markPushSuccess).toHaveBeenCalledWith(['a', 'b']);
    expect(hoisted.markPushFailure).not.toHaveBeenCalled();
    expect(hoisted.deletePushSubscriptionsByIds).toHaveBeenCalledWith([]);
  });

  it.each([404, 410])('a %s answer deletes the device and counts no failure streak', async (status) => {
    hoisted.listPushTargets.mockResolvedValue([target('gone'), target('ok')]);
    hoisted.sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('/gone')) throw new PushError(status);
      return { statusCode: 201 };
    });
    const summary = await sendPushToPlayers(['p1'], spec);

    expect(summary).toEqual({ attempted: 2, delivered: 1, removed: 1, failed: 1 });
    expect(hoisted.deletePushSubscriptionsByIds).toHaveBeenCalledWith(['gone']);
    expect(hoisted.markPushSuccess).toHaveBeenCalledWith(['ok']);
    expect(hoisted.markPushFailure).not.toHaveBeenCalled();
  });

  it('another failure grows the streak and keeps the device', async () => {
    hoisted.listPushTargets.mockResolvedValue([target('flaky', { failureCount: 1 })]);
    hoisted.sendNotification.mockRejectedValue(new PushError(503));
    const summary = await sendPushToPlayers(['p1'], spec);

    expect(summary).toEqual({ attempted: 1, delivered: 0, removed: 0, failed: 1 });
    expect(hoisted.markPushFailure).toHaveBeenCalledWith('flaky', 2);
    expect(hoisted.deletePushSubscriptionsByIds).toHaveBeenCalledWith([]);
  });

  it('a network error without a status counts like any other failure', async () => {
    hoisted.listPushTargets.mockResolvedValue([target('offline')]);
    hoisted.sendNotification.mockRejectedValue(new Error('socket hang up'));
    await sendPushToPlayers(['p1'], spec);
    expect(hoisted.markPushFailure).toHaveBeenCalledWith('offline', 1);
  });

  it(`deletes a device whose streak reaches ${PUSH_FAILURE_LIMIT}`, async () => {
    hoisted.listPushTargets.mockResolvedValue([target('dead', { failureCount: PUSH_FAILURE_LIMIT - 1 })]);
    hoisted.sendNotification.mockRejectedValue(new PushError(403));
    const summary = await sendPushToPlayers(['p1'], spec);

    expect(summary.removed).toBe(1);
    expect(hoisted.deletePushSubscriptionsByIds).toHaveBeenCalledWith(['dead']);
    expect(hoisted.markPushFailure).not.toHaveBeenCalled();
  });

  it('logs the push service host and status, never the endpoint path, keys or payload', async () => {
    hoisted.listPushTargets.mockResolvedValue([target('secret-token-123', { p256dh: 'KEYMATERIAL', auth: 'AUTHSECRET' })]);
    hoisted.sendNotification.mockRejectedValue(new PushError(500));
    await sendPushToPlayers(['p1'], spec);
    const logged = vi.mocked(console.error).mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('fcm.googleapis.com');
    expect(logged).toContain('500');
    expect(logged).not.toContain('secret-token-123');
    expect(logged).not.toContain('KEYMATERIAL');
    expect(logged).not.toContain('AUTHSECRET');
    expect(logged).not.toContain('PRIV');
  });

  it('never throws: a failed device read is logged and reported as nothing sent', async () => {
    hoisted.listPushTargets.mockRejectedValue(new Error('db down'));
    await expect(sendPushToPlayers(['p1'], spec)).resolves.toEqual({ attempted: 0, delivered: 0, removed: 0, failed: 0 });
    expect(console.error).toHaveBeenCalled();
    expect(hoisted.sendNotification).not.toHaveBeenCalled();
  });

  it('a failing bookkeeping write is logged and does not fail the call', async () => {
    hoisted.listPushTargets.mockResolvedValue([target('a')]);
    hoisted.markPushSuccess.mockRejectedValue(new Error('db down'));
    await expect(sendPushToPlayers(['p1'], spec)).resolves.toMatchObject({ delivered: 1 });
    expect(console.error).toHaveBeenCalled();
  });

  it('reads the devices of every player once, de-duplicated', async () => {
    await sendPushToPlayers(['p1', 'p2', 'p1'], spec);
    expect(hoisted.listPushTargets).toHaveBeenCalledTimes(1);
    expect(hoisted.listPushTargets).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('sends nothing for an empty recipient list', async () => {
    await sendPushToPlayers([], spec);
    expect(hoisted.readPushConfig).toHaveBeenCalled();
    expect(hoisted.listPushTargets).not.toHaveBeenCalled();
  });

  it(`never has more than ${PUSH_CONCURRENCY} requests in flight`, async () => {
    const targets = Array.from({ length: 30 }, (_, i) => target(`d${i}`));
    hoisted.listPushTargets.mockResolvedValue(targets);
    let inFlight = 0;
    let peak = 0;
    hoisted.sendNotification.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return { statusCode: 201 };
    });
    const summary = await sendPushToPlayers(['p1'], spec);
    expect(summary.delivered).toBe(30);
    expect(peak).toBeLessThanOrEqual(PUSH_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it('clamps the TTL handed to the push service', async () => {
    hoisted.listPushTargets.mockResolvedValue([target('a')]);
    await sendPushToPlayers(['p1'], { ...spec, ttlSeconds: 5 });
    expect(hoisted.sendNotification.mock.calls[0][2].TTL).toBe(PUSH_MIN_TTL_SECONDS);
    await sendPushToPlayers(['p1'], { ...spec, ttlSeconds: 99 * 86_400 });
    expect(hoisted.sendNotification.mock.calls[1][2].TTL).toBe(PUSH_MAX_TTL_SECONDS);
  });
});

describe('sendPushToPlayer', () => {
  it('is the single-player form', async () => {
    hoisted.listPushTargets.mockResolvedValue([target('a')]);
    await sendPushToPlayer('p1', spec);
    expect(hoisted.listPushTargets).toHaveBeenCalledWith(['p1']);
  });
});

describe('ttlUntil', () => {
  const now = Date.parse('2026-10-28T12:00:00.000Z');
  it('runs until the deadline, within the clamp', () => {
    expect(ttlUntil('2026-10-28T12:10:00.000Z', now)).toBe(600);
    expect(ttlUntil('2026-10-28T12:00:10.000Z', now)).toBe(PUSH_MIN_TTL_SECONDS);
    expect(ttlUntil('2026-10-25T12:00:00.000Z', now)).toBe(PUSH_MIN_TTL_SECONDS);
    expect(ttlUntil('2026-11-28T12:00:00.000Z', now)).toBe(PUSH_MAX_TTL_SECONDS);
    expect(ttlUntil('not a date', now)).toBe(PUSH_MAX_TTL_SECONDS);
  });
});

describe('pushTopic', () => {
  it('is a stable URL-safe token of at most 32 characters, different per pool', () => {
    const a = pushTopic('draft-4b1a1d0e-aaaa-bbbb-cccc-000000000001');
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pushTopic('draft-4b1a1d0e-aaaa-bbbb-cccc-000000000001')).toBe(a);
    expect(pushTopic('draft-4b1a1d0e-aaaa-bbbb-cccc-000000000002')).not.toBe(a);
  });
});
