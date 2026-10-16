const CACHE_VERSION = 'v1';
const SHELL_CACHE = `poketools-shell-${CACHE_VERSION}`;
const OFFLINE_FALLBACK = '/offline.html';

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
          .filter((key) => key.startsWith('poketools-shell-') && key !== SHELL_CACHE)
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
