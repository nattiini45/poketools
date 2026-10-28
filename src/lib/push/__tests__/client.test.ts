import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectPushSupport,
  disablePush,
  enablePush,
  readPushState,
  swScriptUrl,
  thisDeviceFingerprint,
  urlBase64ToUint8Array,
  type PushSupport,
} from '../client';
import { endpointFingerprint } from '@/lib/supabase/queries/push-subscriptions';
import { makeBrowserKeys, makeVapidKeys, FCM_ENDPOINT } from './fixtures';

const vapid = makeVapidKeys();
const browserKeys = makeBrowserKeys();

const CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE_165 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
const IPHONE_160 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const IPAD_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const env = (over: Partial<Parameters<typeof detectPushSupport>[0] & object> = {}) => ({
  userAgent: CHROME,
  maxTouchPoints: 5,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: 'default' as NotificationPermission,
  ...over,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', vapid.publicKey);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('detectPushSupport', () => {
  it.each<[string, Partial<ReturnType<typeof env>>, PushSupport]>([
    ['Chrome on Android, never asked', {}, 'available'],
    ['permission already granted', { permission: 'granted' }, 'available'],
    ['permission denied', { permission: 'denied' }, 'denied'],
    ['no service worker', { hasServiceWorker: false }, 'unsupported'],
    ['no PushManager', { hasPushManager: false }, 'unsupported'],
    ['no Notification API', { hasNotification: false, permission: null }, 'unsupported'],
    ['iPhone (16.5) in a Safari tab', { userAgent: IPHONE_165, hasPushManager: false }, 'install-required'],
    ['iPhone (16.5) installed to the Home Screen', { userAgent: IPHONE_165, standalone: true }, 'available'],
    ['iPhone older than 16.4, even in a tab', { userAgent: IPHONE_160, hasPushManager: false }, 'unsupported'],
    ['iPadOS reporting a Mac UA with touch points', { userAgent: IPAD_MAC_UA, maxTouchPoints: 5, hasPushManager: false }, 'install-required'],
    ['a real Mac (no touch points)', { userAgent: IPAD_MAC_UA, maxTouchPoints: 0 }, 'available'],
  ])('%s → %s', (_label, over, expected) => {
    expect(detectPushSupport(env(over))).toBe(expected);
  });

  it('is unsupported without a browser environment or without a configured key', () => {
    expect(detectPushSupport(null)).toBe('unsupported');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    expect(detectPushSupport(env())).toBe('unsupported');
  });

  it('a denied permission on an iPhone tab still says to install first', () => {
    expect(detectPushSupport(env({ userAgent: IPHONE_165, permission: 'denied', hasPushManager: false }))).toBe('install-required');
  });
});

describe('swScriptUrl', () => {
  it('registers the push-only form while the PWA flag is off (the test environment has it unset)', () => {
    expect(swScriptUrl()).toBe('/sw.js?mode=push');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes the VAPID public key to its 65 bytes', () => {
    const bytes = urlBase64ToUint8Array(vapid.publicKey);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(Buffer.from(bytes).toString('base64url')).toBe(vapid.publicKey);
  });
});

// ── the browser-facing operations, against faked browser APIs ───────────────

interface FakeSub {
  endpoint: string;
  toJSON(): { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSub(endpoint = FCM_ENDPOINT): FakeSub {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: browserKeys.p256dh, auth: browserKeys.auth } }),
    unsubscribe: vi.fn(async () => true),
  };
}

function installBrowser(options: {
  permission?: NotificationPermission;
  requestResult?: NotificationPermission;
  existing?: FakeSub | null;
  subscribeResult?: FakeSub;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  storage?: Record<string, string>;
}) {
  const store = new Map(Object.entries(options.storage ?? {}));
  const pushManager = {
    getSubscription: vi.fn(async () => options.existing ?? null),
    subscribe: vi.fn(async (_opts: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => options.subscribeResult ?? fakeSub()),
  };
  const registration = { pushManager };
  const serviceWorker = {
    getRegistration: vi.fn(async () => registration),
    register: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  };
  const NotificationMock = Object.assign(vi.fn(), {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(async () => options.requestResult ?? 'granted'),
  });
  const fetchMock = vi.fn(options.fetchImpl ?? (async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })));
  vi.stubGlobal('window', {
    PushManager: function PushManager() {},
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  vi.stubGlobal('navigator', { userAgent: CHROME, maxTouchPoints: 5, serviceWorker });
  vi.stubGlobal('Notification', NotificationMock);
  vi.stubGlobal('fetch', fetchMock);
  return { pushManager, serviceWorker, NotificationMock, fetchMock, store };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('enablePush', () => {
  it('asks permission, subscribes with the VAPID key and registers the device with the page language', async () => {
    const b = installBrowser({});
    const result = await enablePush('de');

    expect(result).toEqual({ ok: true });
    expect(b.NotificationMock.requestPermission).toHaveBeenCalledTimes(1);
    expect(b.serviceWorker.register).toHaveBeenCalledWith('/sw.js?mode=push');
    const subscribeArgs = b.pushManager.subscribe.mock.calls[0][0];
    expect(subscribeArgs.userVisibleOnly).toBe(true);
    expect(Buffer.from(subscribeArgs.applicationServerKey).toString('base64url')).toBe(vapid.publicKey);

    const [url, init] = b.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/push/subscriptions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: FCM_ENDPOINT,
      keys: { p256dh: browserKeys.p256dh, auth: browserKeys.auth },
      locale: 'de',
    });
    expect(b.store.get('push:locale:v1')).toBe('de');
  });

  it('reuses a subscription the browser already holds', async () => {
    const existing = fakeSub();
    const b = installBrowser({ existing });
    expect(await enablePush('en')).toEqual({ ok: true });
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
    expect(b.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a denied prompt subscribes nothing', async () => {
    const b = installBrowser({ requestResult: 'denied' });
    expect(await enablePush('en')).toEqual({ ok: false, reason: 'denied' });
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
    expect(b.fetchMock).not.toHaveBeenCalled();
  });

  it('a dismissed prompt leaves everything as it was', async () => {
    const b = installBrowser({ requestResult: 'default' });
    expect(await enablePush('en')).toEqual({ ok: false, reason: 'dismissed' });
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('is unsupported (and asks nothing) where push is impossible', async () => {
    const b = installBrowser({});
    vi.stubGlobal('navigator', { userAgent: IPHONE_165, maxTouchPoints: 5, serviceWorker: {} });
    expect(await enablePush('en')).toEqual({ ok: false, reason: 'unsupported' });
    expect(b.NotificationMock.requestPermission).not.toHaveBeenCalled();
  });

  it('drops the browser subscription again when the server refuses it, and passes the error on', async () => {
    const sub = fakeSub();
    const b = installBrowser({
      subscribeResult: sub,
      fetchImpl: async () => json(503, { success: false, error: 'Push alerts are not set up on this site.', code: 'push_disabled' }),
    });
    const result = await enablePush('en');

    expect(result).toMatchObject({ ok: false, reason: 'failed', failure: { status: 503, error: { code: 'push_disabled' } } });
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(b.store.has('push:locale:v1')).toBe(false);
  });

  it('a thrown browser error is a failed result, not an exception', async () => {
    const b = installBrowser({});
    b.pushManager.subscribe.mockRejectedValue(new DOMException('no push service', 'AbortError'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(enablePush('en')).resolves.toEqual({ ok: false, reason: 'failed', failure: null });
  });
});

describe('disablePush', () => {
  it('deletes the device on the server by endpoint, then drops the browser subscription', async () => {
    const sub = fakeSub();
    const b = installBrowser({ existing: sub, storage: { 'push:locale:v1': 'de' } });
    expect(await disablePush()).toEqual({ ok: true });

    const [, init] = b.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ endpoint: FCM_ENDPOINT });
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(b.store.has('push:locale:v1')).toBe(false);
  });

  it('treats a 404 (the server already forgot the device) as done', async () => {
    const sub = fakeSub();
    installBrowser({ existing: sub, fetchImpl: async () => json(404, { success: false, error: 'x', code: 'push_device_not_found' }) });
    expect(await disablePush()).toEqual({ ok: true });
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it('keeps the browser subscription when the server could not remove it, so the two stay in step', async () => {
    const sub = fakeSub();
    installBrowser({ existing: sub, fetchImpl: async () => json(500, { success: false, error: 'x', code: 'push_unsubscribe_failed' }) });
    const result = await disablePush();
    expect(result).toMatchObject({ ok: false, failure: { status: 500, error: { code: 'push_unsubscribe_failed' } } });
    expect(sub.unsubscribe).not.toHaveBeenCalled();
  });

  it('is a no-op without a subscription', async () => {
    const b = installBrowser({ existing: null });
    expect(await disablePush()).toEqual({ ok: true });
    expect(b.fetchMock).not.toHaveBeenCalled();
  });
});

describe('readPushState', () => {
  it('reports a subscribed browser as on, without prompting', async () => {
    const b = installBrowser({ permission: 'granted', existing: fakeSub(), storage: { 'push:locale:v1': 'en' } });
    expect(await readPushState('en')).toEqual({ support: 'available', subscribed: true, askable: false });
    expect(b.NotificationMock.requestPermission).not.toHaveBeenCalled();
    expect(b.fetchMock).not.toHaveBeenCalled();
  });

  it('a browser that was never asked is askable and not subscribed', async () => {
    installBrowser({ permission: 'default' });
    expect(await readPushState('en')).toEqual({ support: 'available', subscribed: false, askable: true });
  });

  it('a revoked permission does not count as subscribed', async () => {
    installBrowser({ permission: 'denied', existing: fakeSub() });
    expect(await readPushState('en')).toEqual({ support: 'denied', subscribed: false, askable: false });
  });

  it('re-posts the device when the page language changed since the last sync', async () => {
    const b = installBrowser({ permission: 'granted', existing: fakeSub(), storage: { 'push:locale:v1': 'en' } });
    await readPushState('de');
    await vi.waitFor(() => expect(b.fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((b.fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ locale: 'de' });
    expect(b.store.get('push:locale:v1')).toBe('de');
  });

  it('is unsupported outside a browser', async () => {
    vi.stubGlobal('window', undefined);
    expect(await readPushState('en')).toEqual({ support: 'unsupported', subscribed: false, askable: false });
  });
});

describe('thisDeviceFingerprint', () => {
  it('matches the server\'s fingerprint of the same endpoint', async () => {
    installBrowser({ existing: fakeSub() });
    expect(await thisDeviceFingerprint()).toBe(endpointFingerprint(FCM_ENDPOINT));
  });

  it('is null without a subscription', async () => {
    installBrowser({ existing: null });
    expect(await thisDeviceFingerprint()).toBeNull();
  });
});
