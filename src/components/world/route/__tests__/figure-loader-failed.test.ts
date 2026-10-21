import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D42 commit G: a failed GLB load is no longer silent. The committed meshopt
 * fixture, parsed by a GLTFLoader WITHOUT a meshopt decoder, is exactly the
 * W6 negative control (mirror B served to a tree without N1): the preload
 * settles (residency still completes) but `failedFigureLoads` counts it, with
 * its URL, and the console reports it.
 *
 * drei's cache is replaced by a stand-in with suspend-react's semantics: the
 * preload stores an entry whose promise resolves on success AND failure, and
 * a later read throws the stored error. The load itself is the real
 * three-stdlib GLTFLoader parsing the fixture bytes.
 */

const FIXTURE = join(__dirname, '..', 'figures', '__tests__', 'fixtures', 'meshopt-fixture.glb');

const harness = vi.hoisted(() => ({
  /** Runs after the figure loader's extend hook: strips the decoder (the pre-N1 tree). */
  stripDecoder: true,
  /** URL → bytes the fake fetch serves (missing: a network error). */
  files: new Map<string, ArrayBuffer>(),
}));

vi.mock('@react-three/drei', async () => {
  const { GLTFLoader } = await import('three-stdlib');
  type Entry = { promise: Promise<void>; response?: unknown; error?: unknown };
  const cache = new Map<string, Entry>();
  const read = (url: string): unknown => {
    const entry = cache.get(url);
    if (!entry) throw new Error(`not preloaded: ${url}`);
    if ('error' in entry) throw entry.error;
    if ('response' in entry) return entry.response;
    throw entry.promise;
  };
  const useGLTF = Object.assign(
    (url: string) => read(url),
    {
      preload: (url: string, _draco: unknown, _meshopt: unknown, extend: (loader: unknown) => void) => {
        if (cache.has(url)) return;
        const loader = new GLTFLoader();
        extend(loader);
        if (harness.stripDecoder) loader.setMeshoptDecoder(null as never);
        const entry: Entry = { promise: Promise.resolve() };
        entry.promise = new Promise<unknown>((resolve, reject) => {
          const bytes = harness.files.get(url);
          if (!bytes) {
            reject(new Error(`404 ${url}`));
            return;
          }
          loader.parse(bytes.slice(0), '', resolve, reject);
        })
          .then((response) => {
            entry.response = response;
          })
          .catch((error: unknown) => {
            entry.error = error;
          });
        cache.set(url, entry);
      },
    },
  );
  return { useGLTF };
});

vi.mock('three/examples/jsm/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    setTranscoderPath() {
      return this;
    }
    setWorkerLimit() {
      return this;
    }
    detectSupport() {
      return this;
    }
  },
}));

function fixtureBytes(): ArrayBuffer {
  const buffer = readFileSync(FIXTURE);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function settledLoads(loader: typeof import('../figures/figure-loader')): Promise<void> {
  for (let i = 0; i < 200 && loader.pendingFigureLoads() > 0; i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe('failedFigureLoads (D42 commit G)', () => {
  beforeEach(() => {
    vi.resetModules();
    harness.files.clear();
    harness.stripDecoder = true;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a meshopt file with no decoder settles, increments failedFigureLoads with its URL, and fails loudly', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const url = '/models/world/d42/models/regular/fixture.glb';
    harness.files.set(url, fixtureBytes());
    const loader = await import('../figures/figure-loader');
    loader.armFigureLoader({} as never);
    loader.preloadFigure(url);
    await settledLoads(loader);
    expect(loader.pendingFigureLoads()).toBe(0);
    const failed = loader.failedFigureLoads();
    expect(failed.count).toBe(1);
    expect(failed.failures[0].url).toBe(url);
    expect(failed.failures[0].message).toMatch(/setMeshoptDecoder/);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining(url));
  }, 30_000);

  it('a missing file is counted too; a healthy one is not; each URL counts once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    harness.stripDecoder = false;
    const loader = await import('../figures/figure-loader');
    loader.armFigureLoader({} as never);
    loader.preloadFigure('/models/world/missing.glb');
    loader.preloadFigure('/models/world/missing.glb');
    await settledLoads(loader);
    expect(loader.failedFigureLoads().count).toBe(1);
    expect(loader.failedFigureLoads().failures.map((f) => f.url)).toEqual(['/models/world/missing.glb']);
    loader.resetFailedFigureLoadsForTests();
    expect(loader.failedFigureLoads()).toEqual({ count: 0, failures: [] });
  }, 30_000);

  it('ELF-2: a 404 manifest counts as one failed load, with its URL, and a healthy manifest counts none', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    try {
      const manifest = await import('@/lib/route-world/model-manifest');
      const loader = await import('../figures/figure-loader');
      expect(loader.failedFigureLoads()).toEqual({ count: 0, failures: [] });
      const loaded = await manifest.loadWorldManifest();
      expect(loaded.figures).toEqual([]);
      const failed = loader.failedFigureLoads();
      expect(failed.count).toBe(1);
      expect(failed.failures).toHaveLength(1);
      expect(failed.failures[0].url).toMatch(/\/manifest\.v3\.json$/);
      expect(failed.failures[0].message).toBe('manifest 404');
      // A manifest that loads (the test seam) clears it.
      manifest.__setWorldManifestForTests({ version: 3, generatedAt: '', figures: [], props: [], environment: [], missingForms: [], pool: null } as never);
      expect(loader.failedFigureLoads()).toEqual({ count: 0, failures: [] });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the readout is a copy (a reader cannot reset the counter)', async () => {
    const loader = await import('../figures/figure-loader');
    const read = loader.failedFigureLoads();
    read.count = 99;
    read.failures.push({ url: 'x', message: 'y' });
    expect(loader.failedFigureLoads()).toEqual({ count: 0, failures: [] });
  });
});
