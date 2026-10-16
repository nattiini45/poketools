import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D42 N1: every figure load carries three's meshopt decoder, and the
 * decoder's workers start at the FIRST `extendFigureLoader` call, before
 * (and independent of) the KTX2 arm. A load started before `armFigureLoader`
 * must therefore decode on the worker path: with 0 workers three's decoder
 * falls back to a synchronous main-thread decode.
 *
 * The decoder module is wrapped: every call goes to the real decoder (which
 * decodes inline here, no web Workers in the test runtime), and the wrapper
 * records how many workers it had been asked for at each decode.
 */

const record = vi.hoisted(() => ({
  workers: 0,
  useWorkers: [] as number[],
  decodes: [] as number[],
  /** ELF-1: a worker that never replies (a CSP-refused blob worker, a WASM rejected in the worker). */
  deadWorkers: false,
  /** ELF-1: `new Worker` throws inside `useWorkers`. */
  throwOnUseWorkers: false,
}));

vi.mock('three/examples/jsm/libs/meshopt_decoder.module.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three/examples/jsm/libs/meshopt_decoder.module.js')>();
  const real = actual.MeshoptDecoder;
  return {
    MeshoptDecoder: {
      supported: true,
      ready: real.ready,
      useWorkers: (count: number) => {
        record.useWorkers.push(count);
        if (record.throwOnUseWorkers && count > 0) throw new Error('SecurityError: blob worker refused');
        record.workers = count;
      },
      decodeGltfBuffer: real.decodeGltfBuffer,
      decodeGltfBufferAsync: (count: number, size: number, source: Uint8Array, mode: string, filter?: string) => {
        record.decodes.push(record.workers);
        if (record.deadWorkers && record.workers > 0) return new Promise<Uint8Array>(() => undefined);
        return real.decodeGltfBufferAsync(count, size, source, mode as never, filter as never);
      },
    },
  };
});

const drei = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock('@react-three/drei', () => {
  const useGLTF = Object.assign(
    vi.fn((...args: unknown[]) => {
      drei.calls.push(args);
      return { scene: {} };
    }),
    { preload: vi.fn() },
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

const FIXTURE = join(__dirname, '..', 'figures', '__tests__', 'fixtures', 'meshopt-fixture.glb');

function fixtureBytes(): ArrayBuffer {
  const buffer = readFileSync(FIXTURE);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function parseThroughFigureLoader(extend: (loader: never) => void): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  const { GLTFLoader } = await import('three-stdlib');
  const loader = new GLTFLoader();
  extend(loader as never);
  return new Promise((resolve, reject) => loader.parse(fixtureBytes(), '', resolve as never, reject));
}

describe('N1: the meshopt decoder in the figure loader', () => {
  beforeEach(() => {
    vi.resetModules();
    record.workers = 0;
    record.useWorkers.length = 0;
    record.decodes.length = 0;
    record.deadWorkers = false;
    record.throwOnUseWorkers = false;
    drei.calls.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a load started before armFigureLoader uses the worker path (workers > 0 at every decode)', async () => {
    vi.stubGlobal('Worker', class {});
    const loader = await import('../figures/figure-loader');
    expect(loader.isFigureLoaderArmed()).toBe(false);
    const gltf = await parseThroughFigureLoader(loader.extendFigureLoader);
    expect(loader.isFigureLoaderArmed()).toBe(false);
    expect(record.useWorkers).toEqual([loader.MESHOPT_DECODER_WORKERS]);
    expect(loader.MESHOPT_DECODER_WORKERS).toBeGreaterThan(0);
    expect(record.decodes.length).toBeGreaterThan(0);
    expect(record.decodes.every((workers) => workers === loader.MESHOPT_DECODER_WORKERS)).toBe(true);
    let triangles = 0;
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) triangles += (mesh.geometry.getIndex()?.count ?? 0) / 3;
    });
    expect(triangles).toBe(192);
    expect(gltf.animations.map((clip) => clip.name)).toEqual(['idle']);
  }, 30_000);

  it('starts the workers once per page, however many loads extend the loader', async () => {
    vi.stubGlobal('Worker', class {});
    const loader = await import('../figures/figure-loader');
    await parseThroughFigureLoader(loader.extendFigureLoader);
    await parseThroughFigureLoader(loader.extendFigureLoader);
    loader.armFigureLoader({} as never);
    await parseThroughFigureLoader(loader.extendFigureLoader);
    expect(record.useWorkers).toEqual([loader.MESHOPT_DECODER_WORKERS]);
    expect(loader.meshoptDecoderWorkersStarted()).toBe(true);
  }, 30_000);

  it('without Worker (the server, a test runtime) it never asks for workers and still decodes', async () => {
    const loader = await import('../figures/figure-loader');
    const gltf = await parseThroughFigureLoader(loader.extendFigureLoader);
    expect(record.useWorkers).toEqual([]);
    expect(record.decodes.length).toBeGreaterThan(0);
    expect(gltf.animations).toHaveLength(1);
  }, 30_000);

  it('ELF-1: a worker that never replies does not hang the load: it falls back to the main thread, counted once', async () => {
    vi.stubGlobal('Worker', class {});
    record.deadWorkers = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const loader = await import('../figures/figure-loader');
    let settled = false;
    const parsed = parseThroughFigureLoader(loader.extendFigureLoader).then((gltf) => {
      settled = true;
      return gltf;
    });
    // Every buffer goes to the (dead) workers first.
    for (let i = 0; i < 200 && record.decodes.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(record.decodes.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(loader.MESHOPT_WORKER_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(loader.meshoptWorkerFallback().count).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    const gltf = await parsed;
    let triangles = 0;
    gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) triangles += (mesh.geometry.getIndex()?.count ?? 0) / 3;
    });
    expect(triangles).toBe(192);
    expect(gltf.animations.map((clip) => clip.name)).toEqual(['idle']);
    const fallback = loader.meshoptWorkerFallback();
    expect(fallback.count).toBe(1);
    expect(fallback.decodes).toBe(record.decodes.length);
    expect(fallback.reason).toMatch(/no worker reply/);
    // The workers were released, and a later load decodes inline without a timer.
    expect(record.useWorkers).toEqual([loader.MESHOPT_DECODER_WORKERS, 0]);
    const before = record.decodes.length;
    await parseThroughFigureLoader(loader.extendFigureLoader);
    expect(record.decodes.length).toBeGreaterThan(before);
    expect(record.decodes.slice(before).every((workers) => workers === 0)).toBe(true);
    expect(loader.meshoptWorkerFallback().count).toBe(1);
    expect(errors.mock.calls.filter(([message]) => /meshopt decoder workers failed/.test(String(message)))).toHaveLength(1);
  }, 30_000);

  it('ELF-1: useWorkers throwing (new Worker refused) decodes on the main thread and is counted', async () => {
    vi.stubGlobal('Worker', class {});
    record.throwOnUseWorkers = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loader = await import('../figures/figure-loader');
    const gltf = await parseThroughFigureLoader(loader.extendFigureLoader);
    expect(gltf.animations).toHaveLength(1);
    expect(record.decodes.length).toBeGreaterThan(0);
    expect(record.decodes.every((workers) => workers === 0)).toBe(true);
    expect(loader.meshoptWorkerFallback()).toMatchObject({ count: 1, decodes: 0 });
    expect(loader.meshoptWorkerFallback().reason).toMatch(/useWorkers threw: SecurityError/);
  }, 30_000);

  it('a healthy worker path counts no fallback', async () => {
    vi.stubGlobal('Worker', class {});
    const loader = await import('../figures/figure-loader');
    await parseThroughFigureLoader(loader.extendFigureLoader);
    expect(loader.meshoptWorkerFallback()).toEqual({ count: 0, decodes: 0, reason: null });
  }, 30_000);

  it('drei’s own decoder stays off: useGLTF(url, false, false, extendFigureLoader)', async () => {
    const loader = await import('../figures/figure-loader');
    loader.useFigureGLTF('/models/world/d42/models/regular/1.glb');
    expect(drei.calls[0]).toEqual(['/models/world/d42/models/regular/1.glb', false, false, loader.extendFigureLoader]);
  });
});
