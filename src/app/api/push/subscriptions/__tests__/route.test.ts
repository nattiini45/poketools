import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/push/config', () => ({ readPushConfig: vi.fn() }));

vi.mock('@/lib/supabase/queries/push-subscriptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/push-subscriptions')>()),
  upsertPushSubscription: vi.fn(),
  listPushDevices: vi.fn(),
  deletePushSubscriptionByEndpoint: vi.fn(),
  deletePushSubscriptionById: vi.fn(),
}));

vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));

import { DELETE, GET, POST } from '../route';
import { AuthError, requirePlayer } from '@/lib/auth/helpers';
import { readPushConfig } from '@/lib/push/config';
import {
  deletePushSubscriptionById,
  deletePushSubscriptionByEndpoint,
  endpointFingerprint,
  listPushDevices,
  upsertPushSubscription,
} from '@/lib/supabase/queries/push-subscriptions';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { FCM_ENDPOINT, makeBrowserKeys } from '@/lib/push/__tests__/fixtures';

const ORIGIN = 'https://poketools.test';
const keys = makeBrowserKeys();
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

function request(method: 'POST' | 'DELETE', body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`${ORIGIN}/api/push/subscriptions`, {
    method,
    headers: { 'content-type': 'application/json', 'user-agent': CHROME_ANDROID, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { endpoint: FCM_ENDPOINT, keys, locale: 'de' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'player-1' } as Awaited<ReturnType<typeof requirePlayer>>);
  vi.mocked(readPushConfig).mockReturnValue({ publicKey: 'x', privateKey: 'y', subject: 'mailto:a@b.co' });
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, retryAfterSeconds: 0 });
  vi.mocked(upsertPushSubscription).mockResolvedValue({ dropped: 0 });
  vi.mocked(deletePushSubscriptionByEndpoint).mockResolvedValue(1);
  vi.mocked(deletePushSubscriptionById).mockResolvedValue(1);
  vi.mocked(listPushDevices).mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('auth, on every method', () => {
  it.each([
    ['GET', () => GET()],
    ['POST', () => POST(request('POST', validBody))],
    ['DELETE', () => DELETE(request('DELETE', { endpoint: FCM_ENDPOINT }))],
  ])('%s answers 401 for a signed-out caller and touches nothing', async (_method, call) => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Authentication required', 401, 'unauthenticated'));
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
    expect(upsertPushSubscription).not.toHaveBeenCalled();
    expect(listPushDevices).not.toHaveBeenCalled();
    expect(deletePushSubscriptionByEndpoint).not.toHaveBeenCalled();
    expect(deletePushSubscriptionById).not.toHaveBeenCalled();
  });

  it('a banned account is refused by the live guard (403)', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new AuthError('Your account has been banned', 403, 'account_banned'));
    const res = await POST(request('POST', validBody));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'account_banned' });
    expect(upsertPushSubscription).not.toHaveBeenCalled();
  });
});

describe('POST /api/push/subscriptions', () => {
  it('stores the subscription for the guard\'s player with the body language and a device label from the User-Agent', async () => {
    const res = await POST(request('POST', validBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { subscribed: true, fingerprint: endpointFingerprint(FCM_ENDPOINT), dropped: 0 },
    });
    expect(upsertPushSubscription).toHaveBeenCalledWith({
      playerId: 'player-1',
      endpoint: FCM_ENDPOINT,
      p256dh: keys.p256dh,
      auth: keys.auth,
      locale: 'de',
      userAgentLabel: 'Chrome on Android',
    });
    expect(checkRateLimit).toHaveBeenCalledWith('push-subscription', 'player-1', { limit: 30, windowSeconds: 600 });
  });

  it('falls back to the request language cookie when the body has no locale', async () => {
    await POST(request('POST', { endpoint: FCM_ENDPOINT, keys }, { cookie: 'plc_locale=de' }));
    expect(vi.mocked(upsertPushSubscription).mock.calls[0][0].locale).toBe('de');
    vi.mocked(upsertPushSubscription).mockClear();
    await POST(request('POST', { endpoint: FCM_ENDPOINT, keys }));
    expect(vi.mocked(upsertPushSubscription).mock.calls[0][0].locale).toBe('en');
  });

  it('never trusts a player id from the body (strict schema) and never echoes keys or the endpoint', async () => {
    const res = await POST(request('POST', { ...validBody, player_id: 'player-2' }));
    expect(res.status).toBe(400);
    expect(upsertPushSubscription).not.toHaveBeenCalled();

    const ok = await POST(request('POST', validBody));
    const text = JSON.stringify(await ok.json());
    expect(text).not.toContain(keys.p256dh);
    expect(text).not.toContain(keys.auth);
    expect(text).not.toContain('fcm.googleapis.com');
  });

  it('removes the endpoint a re-subscribe replaces, for the same player only', async () => {
    const old = 'https://fcm.googleapis.com/fcm/send/old-endpoint';
    const res = await POST(request('POST', { ...validBody, replaces: old }));
    expect(res.status).toBe(200);
    expect(deletePushSubscriptionByEndpoint).toHaveBeenCalledWith('player-1', old);
  });

  it('still succeeds when removing the replaced endpoint fails (logged)', async () => {
    vi.mocked(deletePushSubscriptionByEndpoint).mockRejectedValue(new Error('db down'));
    const res = await POST(request('POST', { ...validBody, replaces: `${FCM_ENDPOINT}-old` }));
    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalled();
  });

  it('reports devices dropped by the per-player cap', async () => {
    vi.mocked(upsertPushSubscription).mockResolvedValue({ dropped: 1 });
    const body = await (await POST(request('POST', validBody))).json();
    expect(body.data.dropped).toBe(1);
  });

  it('503 push_disabled without a valid server configuration, before any write', async () => {
    vi.mocked(readPushConfig).mockReturnValue(null);
    const res = await POST(request('POST', validBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, code: 'push_disabled' });
    expect(upsertPushSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown push service', 'https://push.example.com/abc'],
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['an internal address', 'https://127.0.0.1/abc'],
  ])('400 push_endpoint_not_allowed for %s (its own code, logged)', async (_label, endpoint) => {
    const res = await POST(request('POST', { ...validBody, endpoint }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'push_endpoint_not_allowed' });
    expect(upsertPushSubscription).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('400 push_endpoint_not_allowed also for a replaced endpoint on a foreign host', async () => {
    const res = await POST(request('POST', { ...validBody, replaces: 'https://evil.test/x' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'push_endpoint_not_allowed' });
  });

  it.each([
    ['malformed JSON', '{"endpoint":'],
    ['an empty body', ''],
    ['null', 'null'],
    ['an array', '[]'],
    ['missing keys', { endpoint: FCM_ENDPOINT }],
    ['bad key material', { endpoint: FCM_ENDPOINT, keys: { p256dh: 'AAAA', auth: 'AAAA' } }],
    ['an oversized body', { ...validBody, padding: 'x'.repeat(9000) }],
  ])('400 push_subscription_invalid for %s', async (_label, body) => {
    const res = await POST(request('POST', body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, code: 'push_subscription_invalid' });
    expect(upsertPushSubscription).not.toHaveBeenCalled();
  });

  it('429 rate_limited over the per-player limit, no write', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const res = await POST(request('POST', validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(await res.json()).toMatchObject({ code: 'rate_limited', params: { seconds: 42 } });
    expect(upsertPushSubscription).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin request (403 push_cross_origin) and logs it', async () => {
    const res = await POST(request('POST', validBody, { origin: 'https://evil.test' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'push_cross_origin' });
    expect(upsertPushSubscription).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('accepts a same-origin request', async () => {
    const res = await POST(request('POST', validBody, { origin: ORIGIN }));
    expect(res.status).toBe(200);
  });

  it('a failed write is a 500 with its own code and no internals', async () => {
    vi.mocked(upsertPushSubscription).mockRejectedValue(new Error('db down: secret detail'));
    const res = await POST(request('POST', validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: 'push_subscribe_failed', error: 'Failed to save the push subscription' });
    expect(JSON.stringify(body)).not.toContain('secret detail');
  });
});

describe('DELETE /api/push/subscriptions', () => {
  it('removes the caller\'s own device by endpoint', async () => {
    const res = await DELETE(request('DELETE', { endpoint: FCM_ENDPOINT }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { removed: true } });
    expect(deletePushSubscriptionByEndpoint).toHaveBeenCalledWith('player-1', FCM_ENDPOINT);
  });

  it('removes the caller\'s own device by row id', async () => {
    const id = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
    const res = await DELETE(request('DELETE', { id }));
    expect(res.status).toBe(200);
    expect(deletePushSubscriptionById).toHaveBeenCalledWith('player-1', id);
  });

  it('404 push_device_not_found when the caller owns no such device (another player\'s device included)', async () => {
    vi.mocked(deletePushSubscriptionByEndpoint).mockResolvedValue(0);
    const res = await DELETE(request('DELETE', { endpoint: FCM_ENDPOINT }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ success: false, code: 'push_device_not_found' });
  });

  it.each([
    ['both selectors', { endpoint: FCM_ENDPOINT, id: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' }],
    ['a player id', { endpoint: FCM_ENDPOINT, player_id: 'player-2' }],
    ['a non-uuid id', { id: 'nope' }],
    ['nothing', {}],
    ['malformed JSON', '{'],
  ])('400 push_subscription_invalid for %s', async (_label, body) => {
    const res = await DELETE(request('DELETE', body));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'push_subscription_invalid' });
    expect(deletePushSubscriptionByEndpoint).not.toHaveBeenCalled();
    expect(deletePushSubscriptionById).not.toHaveBeenCalled();
  });

  it('refuses cross-origin and over-limit requests', async () => {
    expect((await DELETE(request('DELETE', { endpoint: FCM_ENDPOINT }, { origin: 'https://evil.test' }))).status).toBe(403);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 5 });
    expect((await DELETE(request('DELETE', { endpoint: FCM_ENDPOINT }))).status).toBe(429);
    expect(deletePushSubscriptionByEndpoint).not.toHaveBeenCalled();
  });

  it('a failed delete is a 500 with its own code', async () => {
    vi.mocked(deletePushSubscriptionByEndpoint).mockRejectedValue(new Error('db down'));
    const res = await DELETE(request('DELETE', { endpoint: FCM_ENDPOINT }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'push_unsubscribe_failed' });
  });
});

describe('GET /api/push/subscriptions', () => {
  const device = {
    id: 'r1',
    label: 'Chrome on Android',
    createdAt: '2026-10-01T00:00:00Z',
    lastSuccessAt: null,
    fingerprint: endpointFingerprint(FCM_ENDPOINT),
  };

  it('lists the guard player\'s devices, not cacheable, with the server\'s push state', async () => {
    vi.mocked(listPushDevices).mockResolvedValue([device]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ success: true, data: { enabled: true, devices: [device] } });
    expect(listPushDevices).toHaveBeenCalledWith('player-1');
  });

  it('reports enabled: false while the server has no push configuration', async () => {
    vi.mocked(readPushConfig).mockReturnValue(null);
    expect((await (await GET()).json()).data.enabled).toBe(false);
  });

  it('never carries keys, endpoints or private player data', async () => {
    vi.mocked(listPushDevices).mockResolvedValue([device]);
    const body = await (await GET()).json();
    expectNoPrivatePlayerData(body);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/p256dh|"auth"|endpoint|fcm\.googleapis\.com/);
  });

  it('a failed read is a 500 with its own code', async () => {
    vi.mocked(listPushDevices).mockRejectedValue(new Error('db down'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('push_list_failed');
  });
});
