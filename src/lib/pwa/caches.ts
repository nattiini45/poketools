/**
 * Cache Storage owned by the service worker (`public/sw.js`). Client-safe; nothing runs at module load.
 */

/** Every cache the worker creates starts with this (`poketools-shell-<build id>`). */
export const PWA_CACHE_PREFIX = 'poketools-shell-';

/**
 * The entries the worker keeps for every visitor: the offline page and the static files it serves cache first. Same
 * rule as `isShellEntry` in `public/sw-routing.js` (the lifecycle test runs both against one worker).
 */
export function isPwaShellEntry(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url, 'https://pwa.invalid').pathname;
  } catch {
    return false;
  }
  return pathname === '/offline.html' || pathname.startsWith('/_next/static/') || pathname.startsWith('/pwa/');
}

async function pwaCacheKeys(): Promise<string[]> {
  return (await caches.keys()).filter((key) => key.startsWith(PWA_CACHE_PREFIX));
}

/**
 * Removes whatever a session could have left in the worker's caches, before sign-out. The offline page and the static
 * files stay: they hold nothing about anyone, and the worker stores the offline page only when it installs, so
 * deleting it would leave the next offline navigation without a page until the worker is replaced. Any other entry
 * (an earlier worker's page HTML) goes. Never throws: a browser without Cache Storage, or a failed delete, must not
 * block signing out.
 */
export async function clearPwaCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;

  try {
    const keys = await pwaCacheKeys();
    await Promise.allSettled(
      keys.map(async (key) => {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        await Promise.all(requests.filter((request) => !isPwaShellEntry(request.url)).map((request) => cache.delete(request)));
      }),
    );
  } catch {
    // Cache Storage can be unavailable (private mode, blocked storage); there is then nothing to clear.
  }
}

/**
 * Deletes every cache the worker created. Called when the offline shell is switched off and its worker is
 * unregistered, so nothing is left to serve. Never throws.
 */
export async function deletePwaCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;

  try {
    const keys = await pwaCacheKeys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    // Cache Storage can be unavailable (private mode, blocked storage); there is then nothing to clear.
  }
}
