/**
 * `public/sw.js` has no module system, so the tests run the real file in a `vm` context with a fake worker scope:
 * the push, notificationclick and pushsubscriptionchange handlers, and the two modes (full PWA shell, and the
 * `?mode=push` form that caches and intercepts nothing).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const SOURCE = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
const ROUTING_SOURCE = readFileSync(path.join(process.cwd(), 'public', 'sw-routing.js'), 'utf8');
const ORIGIN = 'https://poketools.test';

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

function client(url: string, withNavigate = true): FakeClient {
  return {
    url,
    focus: vi.fn(async () => undefined),
    ...(withNavigate ? { navigate: vi.fn(async () => undefined) } : {}),
  };
}

function loadWorker(script = '/sw.js') {
  const handlers = new Map<string, (event: unknown) => void>();
  const cacheStore = { addAll: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
  const caches = {
    open: vi.fn(async () => cacheStore),
    keys: vi.fn(async () => ['poketools-shell-v1', 'poketools-shell-v2', 'poketools-shell-build-2', 'other-cache']),
    delete: vi.fn(async (_key: string) => true),
    match: vi.fn(async (_request?: unknown): Promise<unknown> => undefined),
  };
  const clients = {
    matchAll: vi.fn(async (): Promise<FakeClient[]> => []),
    openWindow: vi.fn(async (_url: string) => undefined),
    claim: vi.fn(async () => undefined),
  };
  const registration = {
    showNotification: vi.fn(async (_title: string, _options?: Record<string, unknown>) => undefined),
    pushManager: { subscribe: vi.fn(async (_options: Record<string, unknown>): Promise<unknown> => undefined) },
  };
  const fetchMock = vi.fn(async (_url: unknown, _init?: Record<string, unknown>): Promise<unknown> => ({ ok: true }));
  const self = {
    location: { href: `${ORIGIN}${script}`, origin: ORIGIN },
    addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
    skipWaiting: vi.fn(async () => undefined),
    registration,
    clients,
  };
  const importScripts = vi.fn((_url: string) => {
    vm.runInContext(ROUTING_SOURCE, context, { filename: 'sw-routing.js' });
  });
  const context = vm.createContext({ self, caches, URL, Response, fetch: fetchMock, console, importScripts });
  vm.runInContext(SOURCE, context, { filename: 'sw.js' });

  /** Fires an event and returns what it handed to `waitUntil` (awaited). */
  async function fire(type: string, event: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    const responses: Promise<unknown>[] = [];
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no ${type} handler`);
    handler({
      ...event,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<unknown>) => responses.push(p),
    });
    await Promise.all(waits);
    return { waited: waits.length, responded: responses.length, response: responses[0] };
  }
  return { handlers, fire, caches, cacheStore, clients, registration, fetchMock, self, importScripts };
}

const pushEvent = (data: unknown) => ({
  data: { json: () => (data instanceof Error ? (() => { throw data; })() : data) },
});

describe('push handler', () => {
  it('shows the notification the server built, replacing an older one with the same tag', async () => {
    const sw = loadWorker();
    await sw.fire('push', pushEvent({ kind: 'turn_started', title: 'Your pick in EvoLiga', body: 'You are on the clock – 2 min left.', url: '/leagues/s1/draft-room?pool=p1', tag: 'draft-p1' }));

    expect(sw.registration.showNotification).toHaveBeenCalledTimes(1);
    expect(sw.registration.showNotification).toHaveBeenCalledWith('Your pick in EvoLiga', {
      body: 'You are on the clock – 2 min left.',
      tag: 'draft-p1',
      renotify: true,
      icon: '/pwa/icon-192.png',
      data: { url: '/leagues/s1/draft-room?pool=p1' },
    });
  });

  it('keeps the page alive until the notification is shown (waitUntil)', async () => {
    const sw = loadWorker();
    const { waited } = await sw.fire('push', pushEvent({ title: 't', body: 'b', tag: 'x', url: '/' }));
    expect(waited).toBe(1);
  });

  it('still shows something for a push with no payload or a broken one (userVisibleOnly)', async () => {
    const sw = loadWorker();
    await sw.fire('push', {});
    await sw.fire('push', pushEvent(new SyntaxError('bad json')));
    await sw.fire('push', pushEvent('just a string'));
    const calls = sw.registration.showNotification.mock.calls;
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call[0]).toBe('PokéTools');
      expect(call[1]).toMatchObject({ renotify: true, tag: 'poketools', data: { url: '/' } });
    }
  });

  it('never opens a foreign URL from a payload', async () => {
    const sw = loadWorker();
    await sw.fire('push', pushEvent({ title: 't', url: 'https://evil.test/phish', tag: 'x' }));
    await sw.fire('push', pushEvent({ title: 't', url: 'javascript:alert(1)', tag: 'x' }));
    await sw.fire('push', pushEvent({ title: 't', url: 42, tag: 'x' }));
    for (const call of sw.registration.showNotification.mock.calls) {
      expect(call[1]?.data).toEqual({ url: '/' });
    }
  });

  it('clips oversized fields', async () => {
    const sw = loadWorker();
    await sw.fire('push', pushEvent({ title: 'T'.repeat(500), body: 'B'.repeat(900), tag: 'g'.repeat(500), url: '/' }));
    const [title, options] = sw.registration.showNotification.mock.calls[0];
    expect(title.length).toBe(120);
    expect(String(options?.body).length).toBe(240);
    expect(String(options?.tag).length).toBe(100);
  });
});

describe('notificationclick handler', () => {
  const target = '/leagues/s1/draft-room?pool=p1';
  const click = (url: unknown = target) => ({ notification: { close: vi.fn(), data: { url } } });

  it('closes the notification and focuses a window that already shows the page', async () => {
    const sw = loadWorker();
    const onPage = client(`${ORIGIN}${target}`);
    const other = client(`${ORIGIN}/dashboard`);
    sw.clients.matchAll.mockResolvedValue([other, onPage]);
    const event = click();
    await sw.fire('notificationclick', event);

    expect(event.notification.close).toHaveBeenCalled();
    expect(onPage.focus).toHaveBeenCalled();
    expect(onPage.navigate).not.toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(sw.clients.openWindow).not.toHaveBeenCalled();
  });

  it('sends another open PokéTools window to the page and focuses it', async () => {
    const sw = loadWorker();
    const other = client(`${ORIGIN}/dashboard`);
    sw.clients.matchAll.mockResolvedValue([other]);
    await sw.fire('notificationclick', click());

    expect(other.navigate).toHaveBeenCalledWith(target);
    expect(other.focus).toHaveBeenCalled();
    expect(sw.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window when none is open', async () => {
    const sw = loadWorker();
    await sw.fire('notificationclick', click());
    expect(sw.clients.openWindow).toHaveBeenCalledWith(target);
  });

  it('ignores windows of other origins', async () => {
    const sw = loadWorker();
    const foreign = client('https://evil.test/leagues/s1/draft-room?pool=p1');
    sw.clients.matchAll.mockResolvedValue([foreign]);
    await sw.fire('notificationclick', click());
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(sw.clients.openWindow).toHaveBeenCalledWith(target);
  });

  it('falls back to focusing when navigate() fails', async () => {
    const sw = loadWorker();
    const other = client(`${ORIGIN}/dashboard`);
    other.navigate?.mockRejectedValue(new Error('uncontrolled'));
    sw.clients.matchAll.mockResolvedValue([other]);
    await sw.fire('notificationclick', click());
    expect(other.focus).toHaveBeenCalled();
  });

  it('opens the site root for a missing or foreign target', async () => {
    const sw = loadWorker();
    await sw.fire('notificationclick', click('https://evil.test/x'));
    expect(sw.clients.openWindow).toHaveBeenLastCalledWith('/');
    await sw.fire('notificationclick', { notification: { close: vi.fn(), data: null } });
    expect(sw.clients.openWindow).toHaveBeenLastCalledWith('/');
  });
});

describe('pushsubscriptionchange handler', () => {
  const key = new Uint8Array([4, 1, 2, 3]);
  const sub = (endpoint: string) => ({
    toJSON: () => ({ endpoint, keys: { p256dh: 'P', auth: 'A' } }),
  });

  it('posts the new subscription with the endpoint it replaces', async () => {
    const sw = loadWorker();
    await sw.fire('pushsubscriptionchange', {
      oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/old' },
      newSubscription: sub('https://fcm.googleapis.com/fcm/send/new'),
    });

    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = sw.fetchMock.mock.calls[0] as unknown as [string, { method: string; credentials: string; body: string }];
    expect(url).toBe('/api/push/subscriptions');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(init.body)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/new',
      keys: { p256dh: 'P', auth: 'A' },
      replaces: 'https://fcm.googleapis.com/fcm/send/old',
    });
  });

  it('subscribes again with the old key when the browser gave no new subscription', async () => {
    const sw = loadWorker();
    sw.registration.pushManager.subscribe.mockResolvedValue(sub('https://fcm.googleapis.com/fcm/send/fresh'));
    await sw.fire('pushsubscriptionchange', {
      oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/old', options: { applicationServerKey: key } },
    });

    expect(sw.registration.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: key });
    expect(JSON.parse((sw.fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({
      endpoint: 'https://fcm.googleapis.com/fcm/send/fresh',
      replaces: 'https://fcm.googleapis.com/fcm/send/old',
    });
  });

  it('does nothing without a key to subscribe with', async () => {
    const sw = loadWorker();
    await sw.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://fcm.googleapis.com/x' } });
    expect(sw.registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a failed request (offline or signed out)', async () => {
    const sw = loadWorker();
    sw.fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      sw.fire('pushsubscriptionchange', { newSubscription: sub('https://fcm.googleapis.com/fcm/send/new') }),
    ).resolves.toBeDefined();
  });
});

const nav = (pathname: string) => ({ method: 'GET', url: `${ORIGIN}${pathname}`, mode: 'navigate', destination: 'document' });
const asset = (pathname: string, destination = 'script') => ({ method: 'GET', url: `${ORIGIN}${pathname}`, mode: 'no-cors', destination });

describe('caching modes', () => {
  it('full mode: precaches static files only (no page HTML, not `/`), prunes every other shell cache', async () => {
    const sw = loadWorker('/sw.js?v=build-2');
    expect(sw.importScripts).toHaveBeenCalledWith('/sw-routing.js?v=build-2');

    await sw.fire('install');
    expect(sw.caches.open).toHaveBeenCalledWith('poketools-shell-build-2');
    const precached = (sw.cacheStore.addAll.mock.calls[0] as unknown as [string[]])[0];
    expect(precached).not.toContain('/');
    expect(precached).toContain('/offline.html');
    expect(precached.every((url) => url === '/offline.html' || url.startsWith('/pwa/'))).toBe(true);
    expect(sw.self.skipWaiting).toHaveBeenCalled();

    await sw.fire('activate');
    expect(sw.caches.delete.mock.calls.map((call) => call[0]).sort()).toEqual(['poketools-shell-v1', 'poketools-shell-v2']);
    expect(sw.clients.claim).toHaveBeenCalled();
  });

  it('names the cache after the build id and a different id drops the earlier build', async () => {
    const sw = loadWorker('/sw.js?v=build-3');
    await sw.fire('activate');
    expect(sw.caches.delete.mock.calls.map((call) => call[0]).sort()).toEqual([
      'poketools-shell-build-2',
      'poketools-shell-v1',
      'poketools-shell-v2',
    ]);
  });

  it.each(['', '?v=', '?v=has%20space', '?v=../x', `?v=${'x'.repeat(65)}`])('an unusable version (%j) uses one fixed cache name', async (query) => {
    const sw = loadWorker(`/sw.js${query}`);
    await sw.fire('install');
    expect(sw.caches.open).toHaveBeenCalledWith('poketools-shell-unversioned');
  });

  it.each(['/leagues', '/dashboard', '/admin/players', '/broadcast/match/1/live', '/teams/shared/abc'])(
    'a navigation to %s is fetched from the network and never stored',
    async (pathname) => {
      const sw = loadWorker('/sw.js?v=build-2');
      const page = { ok: true, status: 200, clone: () => page };
      sw.fetchMock.mockResolvedValue(page);

      const result = await sw.fire('fetch', { request: nav(pathname) });
      expect(result.responded).toBe(1);
      await expect(result.response).resolves.toBe(page);
      expect(sw.cacheStore.put).not.toHaveBeenCalled();
      expect(sw.caches.open).not.toHaveBeenCalled();
    },
  );

  it('a navigation that answers 500 is passed through and never stored', async () => {
    const sw = loadWorker('/sw.js?v=build-2');
    const failed = { ok: false, status: 500, clone: () => failed };
    sw.fetchMock.mockResolvedValue(failed);

    const result = await sw.fire('fetch', { request: nav('/leagues') });
    await expect(result.response).resolves.toBe(failed);
    expect(sw.cacheStore.put).not.toHaveBeenCalled();
  });

  it('offline: a navigation shows /offline.html, never a page that was visited earlier', async () => {
    const sw = loadWorker('/sw.js?v=build-2');
    const offlinePage = { offline: true };
    const earlierDashboard = { dashboard: true };
    sw.fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    sw.caches.match.mockImplementation(async (request: unknown) => {
      if (request === '/offline.html') return offlinePage;
      return earlierDashboard;
    });

    const result = await sw.fire('fetch', { request: nav('/dashboard') });
    await expect(result.response).resolves.toBe(offlinePage);
  });

  it('static assets are cache first and stored; other assets are not intercepted', async () => {
    const sw = loadWorker('/sw.js?v=build-2');
    const fresh = { ok: true, status: 200, clone: () => fresh };
    sw.fetchMock.mockResolvedValue(fresh);

    const hit = await sw.fire('fetch', { request: asset('/_next/static/chunks/app.js') });
    expect(hit.responded).toBe(1);
    await expect(hit.response).resolves.toBe(fresh);
    expect(sw.cacheStore.put).toHaveBeenCalledTimes(1);

    sw.caches.match.mockResolvedValueOnce({ cached: true });
    const cached = await sw.fire('fetch', { request: asset('/pwa/icon-192.png', 'image') });
    await expect(cached.response).resolves.toEqual({ cached: true });

    for (const request of [
      asset('/_next/image?url=%2Fa.png&w=64&q=75', 'image'),
      asset('/avatar/me.png', 'image'),
      asset('/fonts/a.woff2', 'font'),
      asset('/manifest.webmanifest', 'manifest'),
      { method: 'POST', url: `${ORIGIN}/_next/static/a.js`, mode: 'no-cors', destination: 'script' },
      asset('/api/players', 'empty'),
    ]) {
      expect((await sw.fire('fetch', { request })).responded).toBe(0);
    }
    expect(sw.cacheStore.put).toHaveBeenCalledTimes(1);
  });

  it('push mode (?mode=push): caches nothing on install, deletes every shell cache, intercepts no request', async () => {
    const sw = loadWorker('/sw.js?mode=push');
    await sw.fire('install');
    expect(sw.caches.open).not.toHaveBeenCalled();
    expect(sw.cacheStore.addAll).not.toHaveBeenCalled();
    expect(sw.self.skipWaiting).toHaveBeenCalled();

    await sw.fire('activate');
    expect(sw.caches.delete.mock.calls.map((call) => call[0]).sort()).toEqual([
      'poketools-shell-build-2',
      'poketools-shell-v1',
      'poketools-shell-v2',
    ]);

    for (const request of [nav('/leagues'), asset('/_next/static/chunk.js')]) {
      const result = await sw.fire('fetch', { request });
      expect(result.responded).toBe(0);
    }
  });

  it('push mode still has the push handlers', () => {
    const sw = loadWorker('/sw.js?mode=push');
    expect([...sw.handlers.keys()].sort()).toEqual(
      ['activate', 'fetch', 'install', 'notificationclick', 'push', 'pushsubscriptionchange'].sort(),
    );
  });
});
