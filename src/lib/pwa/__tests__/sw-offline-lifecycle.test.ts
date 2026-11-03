/** @vitest-environment jsdom */
/**
 * Runs the real `public/sw.js` (with the real `public/sw-routing.js`) against an in-memory Cache Storage, and the real
 * `clearPwaCaches`, to follow one browser through install, sign-out, an unchanged registration and an offline
 * navigation: the worker installs only once per version, so what sign-out leaves behind is all the offline fallback
 * it will ever have.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPwaCaches } from '../caches';
import { FakeCacheStorage } from './fake-cache-storage';

const ORIGIN = 'https://poketools.test';
const SW_SOURCE = readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');
const ROUTING_SOURCE = readFileSync(path.join(process.cwd(), 'public', 'sw-routing.js'), 'utf8');
const SHELL_CACHE = 'poketools-shell-build1';
const OFFLINE_BODY = '<html>You are offline</html>';
const SHELL_PATHS = [
  '/offline.html',
  '/pwa/apple-touch-icon.png',
  '/pwa/icon-192-maskable.png',
  '/pwa/icon-192.png',
  '/pwa/icon-512-maskable.png',
  '/pwa/icon-512.png',
];

interface Network {
  online: boolean;
  requests: string[];
}

type Listener = (event: Record<string, unknown>) => void;

/** One loaded worker script: dispatches the events it listens to, as the browser would. */
function loadWorker(storage: FakeCacheStorage, network: Network, search = '?v=build1') {
  const listeners = new Map<string, Listener>();
  const self = {
    location: { href: `${ORIGIN}/sw.js${search}`, origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async () => undefined },
    registration: { showNotification: async () => undefined },
  };

  const workerFetch = async (input: string | { url: string }) => {
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN);
    network.requests.push(url.pathname);
    if (!network.online) throw new TypeError('Failed to fetch');
    return new Response(url.pathname === '/offline.html' ? OFFLINE_BODY : `body of ${url.pathname}`, { status: 200 });
  };

  storage.fetcher = (url) => workerFetch(url);

  const context = vm.createContext({
    self,
    caches: storage,
    fetch: workerFetch,
    Response,
    URL,
    importScripts: () => vm.runInContext(ROUTING_SOURCE, context, { filename: 'sw-routing.js' }),
  });
  vm.runInContext(SW_SOURCE, context, { filename: 'sw.js' });

  async function dispatchLifecycle(type: 'install' | 'activate') {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)!({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }

  return {
    install: () => dispatchLifecycle('install'),
    activate: () => dispatchLifecycle('activate'),
    async navigate(pathname: string): Promise<Response> {
      const pending: Promise<unknown>[] = [];
      let answer: Promise<Response> | undefined;
      listeners.get('fetch')!({
        request: { method: 'GET', mode: 'navigate', url: `${ORIGIN}${pathname}` },
        respondWith: (promise: Promise<Response>) => (answer = promise),
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      });
      const response = await answer!;
      await Promise.all(pending);
      return response;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

async function installedBrowser(network: Network) {
  const storage = new FakeCacheStorage();
  vi.stubGlobal('caches', storage);
  const worker = loadWorker(storage, network);
  await worker.install();
  await worker.activate();
  return { storage, worker };
}

describe('offline fallback across sign-out', () => {
  it('installs the offline page and the static shell and nothing else', async () => {
    const { storage } = await installedBrowser({ online: true, requests: [] });
    expect(storage.paths()).toEqual({ [SHELL_CACHE]: SHELL_PATHS });
  });

  it('still shows the offline page after install, sign-out, an unchanged registration and an offline navigation', async () => {
    const network: Network = { online: true, requests: [] };
    const { storage, worker } = await installedBrowser(network);

    // Signed in, browsing. An earlier worker version stored pages; they are what sign-out must remove.
    await (await storage.open(SHELL_CACHE)).put(`${ORIGIN}/dashboard`, new Response('<html>Hello, Alice</html>'));
    await worker.navigate('/dashboard');

    await clearPwaCaches();

    // Sign-out leaves the worker alone, and registering the same script again installs nothing (no `install` here).
    expect(storage.paths()).toEqual({ [SHELL_CACHE]: SHELL_PATHS });

    network.online = false;
    const response = await worker.navigate('/dashboard');
    expect(response.ok).toBe(true);
    expect(await response.text()).toBe(OFFLINE_BODY);
    expect(await storage.match('/dashboard')).toBeUndefined();
  });

  it('serves the offline page for a page that was never visited, too', async () => {
    const network: Network = { online: true, requests: [] };
    const { worker } = await installedBrowser(network);
    await clearPwaCaches();
    network.online = false;
    expect(await (await worker.navigate('/leagues')).text()).toBe(OFFLINE_BODY);
  });

  it('restores the offline page on the next page that loads, when a cache lost it', async () => {
    const network: Network = { online: true, requests: [] };
    const { storage, worker } = await installedBrowser(network);
    // What the previous sign-out did (and what storage eviction does): the whole cache is gone and no install follows.
    await storage.delete(SHELL_CACHE);

    network.online = false;
    expect((await worker.navigate('/dashboard')).type).toBe('error');

    network.online = true;
    expect(await (await worker.navigate('/')).text()).toBe('body of /');
    expect(storage.paths()[SHELL_CACHE]).toEqual(['/offline.html']);

    network.online = false;
    expect(await (await worker.navigate('/dashboard')).text()).toBe(OFFLINE_BODY);
  });

  it('fetches the offline page once, not on every page that loads', async () => {
    const network: Network = { online: true, requests: [] };
    const { worker } = await installedBrowser(network);
    network.requests.length = 0;
    await worker.navigate('/');
    await worker.navigate('/leagues');
    expect(network.requests.filter((request) => request === '/offline.html')).toEqual([]);
  });

  it('never stores a page it served', async () => {
    const network: Network = { online: true, requests: [] };
    const { storage, worker } = await installedBrowser(network);
    for (const pathname of ['/', '/dashboard', '/teams/shared/abc']) await worker.navigate(pathname);
    expect(storage.paths()).toEqual({ [SHELL_CACHE]: SHELL_PATHS });
  });

  it('installs no shell in the push-only worker', async () => {
    const storage = new FakeCacheStorage();
    const worker = loadWorker(storage, { online: true, requests: [] }, '?mode=push');
    await worker.install();
    expect(storage.paths()).toEqual({});
  });
});
