/**
 * Cache Storage owned by the service worker (`public/sw.js`). Client-safe; nothing runs at module load.
 */

/** Every cache the worker creates starts with this (`poketools-shell-<build id>`). */
export const PWA_CACHE_PREFIX = 'poketools-shell-';

/**
 * Deletes every cache the worker created. Called before sign-out and when the offline shell is switched off.
 * Never throws: a browser without Cache Storage, or a failed delete, must not block signing out.
 */
export async function clearPwaCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;

  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(PWA_CACHE_PREFIX)).map((key) => caches.delete(key)));
  } catch {
    // Cache Storage can be unavailable (private mode, blocked storage); there is then nothing to clear.
  }
}
