/** @vitest-environment jsdom */
/**
 * Which service worker script `PwaRegistrar` registers (docs/push.md, "Service worker"): the full shell with the PWA
 * flag on, the push-only form when only Web Push is configured, and none (an existing worker is removed) when neither is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const registration = (path: string) => ({ active: { scriptURL: `http://localhost${path}` }, unregister: vi.fn(async () => true) });

function stubServiceWorker(existing: Array<ReturnType<typeof registration>> = []) {
  const serviceWorker = {
    register: vi.fn(async () => ({})),
    getRegistrations: vi.fn(async () => existing),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => ['poketools-shell-v1', 'other']),
    delete: vi.fn(async (key: string) => {
      deleted.push(key);
      return true;
    }),
  });
  return { serviceWorker, deleted };
}

async function mount() {
  vi.resetModules();
  const { default: PwaRegistrar } = await import('../PwaRegistrar');
  return render(<PwaRegistrar />);
}

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('PwaRegistrar', () => {
  it('PWA flag on: registers the full shell worker', async () => {
    vi.stubEnv('NEXT_PUBLIC_PWA_ENABLED', 'true');
    const { serviceWorker } = stubServiceWorker();
    await mount();
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js'));
  });

  it('PWA flag off but push configured: registers the push-only worker and removes nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_PWA_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'configured-key');
    const stale = registration('/sw.js');
    const { serviceWorker, deleted } = stubServiceWorker([stale]);
    await mount();
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js?mode=push'));
    expect(stale.unregister).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('neither configured: unregisters the worker and clears its caches (the previous behaviour)', async () => {
    vi.stubEnv('NEXT_PUBLIC_PWA_ENABLED', 'false');
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    const stale = registration('/sw.js');
    const unrelated = registration('/other-worker.js');
    const { serviceWorker, deleted } = stubServiceWorker([stale, unrelated]);
    await mount();
    await waitFor(() => expect(stale.unregister).toHaveBeenCalled());
    expect(unrelated.unregister).not.toHaveBeenCalled();
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(deleted).toEqual(['poketools-shell-v1']);
  });
});
