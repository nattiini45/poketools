const CACHE_VERSION = 'v2';
const SHELL_CACHE = `poketools-shell-${CACHE_VERSION}`;
const OFFLINE_FALLBACK = '/offline.html';

// Registered as `/sw.js?mode=push` when the PWA flag is off but Web Push is configured (src/lib/push/client.ts):
// the worker then only handles push, and caches and intercepts nothing.
const PUSH_ONLY = new URL(self.location.href).searchParams.get('mode') === 'push';

const SHELL_ASSETS = [
  '/',
  OFFLINE_FALLBACK,
  '/manifest.webmanifest',
  '/favicon.ico',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/icon-192-maskable.png',
  '/pwa/icon-512-maskable.png',
  '/pwa/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  if (PUSH_ONLY) {
    event.waitUntil(self.skipWaiting());
    return;
  }

  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('poketools-shell-') && (PUSH_ONLY || key !== SHELL_CACHE))
          .map((key) => caches.delete(key)),
      );

      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(pathname, destination) {
  if (pathname.startsWith('/_next/static/')) {
    return true;
  }

  if (pathname.startsWith('/pwa/')) {
    return true;
  }

  if (pathname === '/manifest.webmanifest' || pathname === '/favicon.ico') {
    return true;
  }

  return (
    destination === 'style' ||
    destination === 'script' ||
    destination === 'font' ||
    destination === 'image' ||
    destination === 'manifest'
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(SHELL_CACHE);
    void cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener('fetch', (event) => {
  if (PUSH_ONLY) {
    return;
  }

  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          void cache.put(request, response.clone());
          return response;
        } catch {
          const cachedPage = await caches.match(request);
          if (cachedPage) {
            return cachedPage;
          }

          const offlinePage = await caches.match(OFFLINE_FALLBACK);
          return offlinePage || Response.error();
        }
      })(),
    );

    return;
  }

  if (isStaticAsset(url.pathname, request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});

// ── Web Push (draft turn alerts, docs/push.md) ───────────────────────────────

const PUSH_API_PATH = '/api/push/subscriptions';
const NOTIFICATION_ICON = '/pwa/icon-192.png';

/** A same-origin path for a click, whatever the payload says; anything else opens the site root. */
function safeTargetUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/', self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

function shortText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** The server sends `{ kind, title, body, url, tag }`. A malformed payload still has to show something. */
function readPushPayload(event) {
  let raw = null;
  try {
    raw = event.data ? event.data.json() : null;
  } catch {
    raw = null;
  }
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    title: shortText(data.title, 120) || 'PokéTools',
    body: shortText(data.body, 240),
    tag: shortText(data.tag, 100) || 'poketools',
    url: safeTargetUrl(data.url),
  };
}

self.addEventListener('push', (event) => {
  const { title, body, tag, url } = readPushPayload(event);
  // Every push shows a notification (browsers require `userVisibleOnly`; Safari revokes a subscription that
  // stays silent). `tag` + `renotify` make a newer alert for the same draft replace the older one and alert again.
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: NOTIFICATION_ICON,
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safeTargetUrl(event.notification.data && event.notification.data.url);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const targetPath = new URL(target, self.location.origin).pathname;
      // Prefer a window that already shows this page; otherwise any PokéTools window, sent to the target.
      const sameApp = windows.filter((client) => new URL(client.url).origin === self.location.origin);
      const onPage = sameApp.find((client) => new URL(client.url).pathname === targetPath);
      const client = onPage || sameApp[0];
      if (client) {
        try {
          if (new URL(client.url).pathname + new URL(client.url).search !== target && 'navigate' in client) {
            await client.navigate(target);
          }
        } catch {
          // navigate() can fail for an uncontrolled client; focusing it is still better than nothing.
        }
        if ('focus' in client) {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// The browser rotated or dropped the subscription: subscribe again and tell the server which endpoint it replaces.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint;
        let subscription = event.newSubscription;
        if (!subscription) {
          const options = event.oldSubscription && event.oldSubscription.options;
          const key = options && options.applicationServerKey;
          if (!key) return;
          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
        }
        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys) return;
        await fetch(PUSH_API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            endpoint: json.endpoint,
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
            ...(oldEndpoint && oldEndpoint !== json.endpoint ? { replaces: oldEndpoint } : {}),
          }),
        });
      } catch {
        // Offline or signed out: the draft room's bell then shows push as off for this browser, and one click turns it on.
      }
    })(),
  );
});
