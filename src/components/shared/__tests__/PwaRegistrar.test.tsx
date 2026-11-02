/** @vitest-environment jsdom */
/**
 * Which service worker script `PwaRegistrar` registers (docs/push.md, "Service worker"): the build-versioned full
 * shell with the PWA flag on, the push-only form when only Web Push is configured, and none (an existing worker is
 * removed) when neither is.
 *
 * Nothing here depends on module load order or timers: the flag is a mocked getter read per access, the component is
 * imported once, and every assertion waits for the registrar's own async work to finish rather than for a delay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import PwaRegistrar from '../PwaRegistrar';

const flags = vi.hoisted(() => ({ pwa: false }));
vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>();
  return Object.defineProperties({ ...actual }, { ENABLE_PWA: { get: () => flags.pwa, enumerable: true } });
});

// A generous ceiling: waitFor returns as soon as the condition holds, so it only matters when the machine is slow.
const SETTLE = { timeout: 10_000 };

const registration = (path: string) => ({ active: { scriptURL: `http://localhost${path}` }, unregister: vi.fn(async () => true) });

function stubServiceWorker(existing: Array<ReturnType<typeof registration>> = []) {
  const serviceWorker = {
    register: vi.fn(async (_url: string) => ({})),
    getRegistrations: vi.fn(async () => existing),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
  const deleted: string[] = [];
  vi.stubGlobal('caches', {
    keys: vi.fn(async () => ['poketools-shell-v1', 'poketools-shell-abc', 'other']),
    delete: vi.fn(async (key: string) => {
      deleted.push(key);
      return true;
    }),
  });
  return { serviceWorker, deleted };
}

beforeEach(() => {
  flags.pwa = false;
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('PwaRegistrar', () => {
  it('PWA flag on: registers the full shell worker, versioned with the build id', async () => {
    flags.pwa = true;
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'abc123def456');
    const { serviceWorker } = stubServiceWorker();
    render(<PwaRegistrar />);
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js?v=abc123def456'), SETTLE);
    expect(serviceWorker.register).toHaveBeenCalledTimes(1);
  });

  it('PWA flag on without a baked-in build id: registers the dev version', async () => {
    flags.pwa = true;
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', '');
    const { serviceWorker } = stubServiceWorker();
    render(<PwaRegistrar />);
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js?v=dev'), SETTLE);
  });

  it('PWA flag off but push configured: registers the push-only worker and removes nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'configured-key');
    const stale = registration('/sw.js');
    const { serviceWorker, deleted } = stubServiceWorker([stale]);
    render(<PwaRegistrar />);
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js?mode=push'), SETTLE);
    expect(stale.unregister).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('neither configured: unregisters the worker and clears its caches (the previous behaviour)', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    const stale = registration('/sw.js');
    const unrelated = registration('/other-worker.js');
    const { serviceWorker, deleted } = stubServiceWorker([stale, unrelated]);
    render(<PwaRegistrar />);
    await waitFor(() => expect(deleted.sort()).toEqual(['poketools-shell-abc', 'poketools-shell-v1']), SETTLE);
    expect(stale.unregister).toHaveBeenCalled();
    expect(unrelated.unregister).not.toHaveBeenCalled();
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });
});