'use client';

import { useEffect } from 'react';
import { pushRegistersServiceWorker, swScriptUrl } from '@/lib/push/client';

const PWA_ENABLED = process.env.NEXT_PUBLIC_PWA_ENABLED === 'true';

async function clearPwaCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  const cacheKeys = await caches.keys();
  await Promise.all(
    cacheKeys
      .filter((key) => key.startsWith('poketools-shell-'))
      .map((key) => caches.delete(key)),
  );
}

async function unregisterPwaWorker(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  const pwaRegistrations = registrations.filter((registration) => {
    const scriptUrl =
      registration.active?.scriptURL ??
      registration.waiting?.scriptURL ??
      registration.installing?.scriptURL;

    if (!scriptUrl) {
      return false;
    }

    return new URL(scriptUrl).pathname === '/sw.js';
  });

  await Promise.all(pwaRegistrations.map((registration) => registration.unregister()));
  await clearPwaCaches();
}

export default function PwaRegistrar() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '::1';

    if (!isLocalhost && window.location.protocol !== 'https:') {
      return;
    }

    const syncServiceWorker = async () => {
      // Web Push needs the worker even when the offline shell is off (docs/push.md): it then registers in
      // `?mode=push` form, which handles push only and caches nothing.
      if (!PWA_ENABLED && !pushRegistersServiceWorker()) {
        await unregisterPwaWorker();
        return;
      }

      await navigator.serviceWorker.register(swScriptUrl());
    };

    void syncServiceWorker();
  }, []);

  return null;
}
