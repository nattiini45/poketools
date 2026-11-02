'use client';

import { useEffect } from 'react';
import { ENABLE_PWA } from '@/lib/feature-flags';
import { pushRegistersServiceWorker, swScriptUrl } from '@/lib/push/client';
import { clearPwaCaches } from '@/lib/pwa/caches';

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
      if (!ENABLE_PWA && !pushRegistersServiceWorker()) {
        await unregisterPwaWorker();
        return;
      }

      await navigator.serviceWorker.register(swScriptUrl());
    };

    void syncServiceWorker();
  }, []);

  return null;
}
