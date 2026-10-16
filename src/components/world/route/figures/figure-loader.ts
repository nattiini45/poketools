'use client';

import { useGLTF } from '@react-three/drei';
import type { Object3D, WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BASIS_TRANSCODER_PATH, worldManifestLoadFailure } from '@/lib/route-world/model-manifest';
import { emptyVertexPromotion, promoteSceneVertexFormats, type VertexPromotion } from './vertex-formats';

/**
 * One KTX2 transcoder per page, wired into drei's cached GLTFLoader — armed
 * LAZILY (D42 N7b).
 *
 * `detectSupport` needs the live renderer, which exists only from the canvas
 * `onCreated` (`armFigureLoader`, see `RouteWorldCanvas`). Before N7b every
 * preload waited for that arm (queued here), although no world GLB carries a
 * KTX2 texture (the bake asserts 0 `KHR_texture_basisu` files). Now every load
 * starts at once and gets a lazy stand-in (`lazyKtx2`): the real transcoder
 * (its loader, worker pool and `detectSupport`) is created only when a GLB
 * actually asks for a KTX2 texture, and such a request waits for the renderer
 * if it comes first. With no KTX2 file in the manifest it is never created.
 */
let renderer: WebGLRenderer | null = null;
let ktx2: KTX2Loader | null = null;
/** KTX2 texture loads that arrived before the renderer (run at the arm). */
const awaitingRenderer: ((gl: WebGLRenderer) => void)[] = [];

/** drei's GLTFLoader (three-stdlib) as seen through `useGLTF`'s extend hook. */
type DreiExtendLoader = NonNullable<Parameters<typeof useGLTF>[3]>;
type DreiGLTFLoader = Parameters<DreiExtendLoader>[0];
type DreiKTX2Loader = Parameters<DreiGLTFLoader['setKTX2Loader']>[0];

function transcoder(gl: WebGLRenderer): KTX2Loader {
  if (!ktx2) {
    ktx2 = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH).setWorkerLimit(2);
    ktx2.detectSupport(gl);
  }
  return ktx2;
}

/**
 * The stand-in GLTFLoader holds as its KTX2 loader: the `KHR_texture_basisu`
 * extension only calls `load` (three-stdlib `loadImageSource`).
 */
const lazyKtx2 = {
  load(url: string, onLoad: (texture: unknown) => void, onProgress: ((event: ProgressEvent) => void) | undefined, onError: (error: unknown) => void): void {
    const run = (gl: WebGLRenderer): void => {
      transcoder(gl).load(url, onLoad as never, onProgress, onError as never);
    };
    if (renderer) run(renderer);
    else awaitingRenderer.push(run);
  },
};

export function armFigureLoader(gl: WebGLRenderer): void {
  if (renderer) return;
  renderer = gl;
  for (const run of awaitingRenderer.splice(0)) run(gl);
}

/** Whether a KTX2 transcoder has been created (only a KTX2 texture request creates one). */
export function isKtx2TranscoderCreated(): boolean {
  return ktx2 !== null;
}

/**
 * R6 E4 + D42: what the load path promoted to Float32 so far, and what it
 * cost on the main thread (trace; `vertexPromotionTotals`, read into
 * `renderPath.vertexPromotion`). `ms` is the summed promotion time over every
 * parsed GLB, `longestMs` the longest single file's, `loads` the parses timed.
 */
export interface VertexPromotionTrace extends VertexPromotion {
  ms: number;
  longestMs: number;
  loads: number;
}

const promotion: VertexPromotionTrace = { ...emptyVertexPromotion(), ms: 0, longestMs: 0, loads: 0 };

/** D42: the User Timing name of one file's promotion (W4 reads it from a trace). */
export const VERTEX_PROMOTION_MEASURE = 'route:vertexPromotion';

function clockNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * D42 (commit G): one parsed file's promotion, timed. A `performance.measure`
 * per file (name `route:vertexPromotion`, the file's promoted bytes in
 * `detail`) lands in a performance trace; the summed and longest ms land in
 * the render-path readout. Pixel-neutral: the promotion itself is unchanged.
 */
function promoteTimed(scenes: readonly Object3D[]): void {
  const start = clockNow();
  const bytesBefore = promotion.bytesAfter;
  for (const scene of scenes) promoteSceneVertexFormats(scene, promotion);
  const end = clockNow();
  const ms = Math.max(0, end - start);
  promotion.ms += ms;
  promotion.loads += 1;
  if (ms > promotion.longestMs) promotion.longestMs = ms;
  if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
    try {
      performance.measure(VERTEX_PROMOTION_MEASURE, { start, end, detail: { promotedBytes: promotion.bytesAfter - bytesBefore } });
    } catch {
      // A runtime without User Timing L3 (start/end options): the totals still count.
    }
  }
}

/**
 * R6 E4: a GLTF parser plugin that promotes the D3D11-hostile vertex formats
 * (3-component SHORT/BYTE normals and positions, non-normalized joints) to
 * Float32 in `afterRoot` — after the scene graph is built, BEFORE the result
 * resolves into the suspend-react cache, so no consumer (a clone, the warm's
 * compile, the first upload) ever sees the quantized storage. See
 * `vertex-formats.ts`. One module-level callback: `register` de-duplicates by
 * identity, and drei re-runs the extend hook on every load.
 */
function float32VertexPlugin(): { name: string; afterRoot: (result: { scenes?: Object3D[] }) => void } {
  return {
    name: 'ROUTE_float32_vertex_formats',
    afterRoot: (result) => {
      promoteTimed(result.scenes ?? []);
    },
  };
}

/** R6 E4: the Float32 promotions done by the GLB load path, with their cost (trace readout). */
export function vertexPromotionTotals(): Readonly<VertexPromotionTrace> {
  return promotion;
}

// ── The meshopt decoder (D42 N1) ────────────────────────────────────────────
//
// three's `meshopt_decoder.module.js` (inline WASM) decodes
// EXT_meshopt_compression buffers. three-stdlib's GLTFLoader calls its
// `decodeGltfBufferAsync`, which runs in the decoder's workers when they
// exist and falls back to a SYNCHRONOUS main-thread decode when they do not
// (a load started before the workers would decode on the main thread). So
// the workers start once, at the FIRST `extendFigureLoader` call — the first
// GLB load of the page, whoever starts it — independent of the KTX2 arm
// (`armFigureLoader`), which can come later. drei's own decoder path stays
// off (`useGLTF(url, false, false, …)`): it would install three-stdlib's
// synchronous decoder after this hook.
//
// D42 N1-fix (ELF-1): a dead worker must not hang the load. The decoder's
// `useWorkers` throws only when `new Worker` throws synchronously; a blob
// worker refused by a CSP is still constructed (its failure is an async
// `error` event nobody listens to), and a WASM instantiate rejected INSIDE
// the worker leaves its `self.ready.then` unhandled, so the worker never
// replies. Either way the decoder keeps routing every buffer to it and every
// meshopt GLB stays pending until the residency deadline sends the page to
// Lite. So the loader holds a thin wrapper (`figureMeshoptDecoder`): each
// worker decode races `MESHOPT_WORKER_TIMEOUT_MS`; the first timeout abandons
// the workers for the page (`useWorkers(0)`), decodes every pending and later
// buffer on the main thread, counts the fallback
// (`renderPath.meshoptWorkerFallback`, gated at 0 on every capture) and
// reports it on the console.

/** Decoder workers (the plan's LD1: two, like the KTX2 transcoder's limit). */
export const MESHOPT_DECODER_WORKERS = 2;

/**
 * How long one worker decode may take before the workers are declared dead.
 * A healthy worker decodes a figure's largest buffer in single-digit ms; the
 * margin covers a main thread busy with compiles (the reply is a main-thread
 * message, like the timer).
 */
export const MESHOPT_WORKER_TIMEOUT_MS = 8000;

/** The decode modes and filters three's decoder takes (glTF extension strings). */
type MeshoptMode = Parameters<typeof MeshoptDecoder.decodeGltfBuffer>[4];
type MeshoptFilter = Parameters<typeof MeshoptDecoder.decodeGltfBuffer>[5];

let decoderWorkersStarted = false;
/** Whether the decoder currently routes decodes to workers (false once abandoned). */
let decoderWorkersActive = false;

export interface MeshoptWorkerFallback {
  /** How many times the workers were abandoned for the main thread (0 or 1 per page). */
  count: number;
  /** Buffers decoded on the main thread because of it. */
  decodes: number;
  /** Why (the first fallback). */
  reason: string | null;
}

const workerFallback: MeshoptWorkerFallback = { count: 0, decodes: 0, reason: null };
/** Pending worker decodes, each able to switch to the main thread at once. */
const pendingWorkerDecodes = new Set<() => void>();

/** The decoder's worker request (`useWorkers`; not a React hook despite its name). */
function spawnDecoderWorkers(count: number): void {
  Reflect.apply(MeshoptDecoder.useWorkers, MeshoptDecoder, [count]);
}

function abandonDecoderWorkers(reason: string): void {
  workerFallback.count += 1;
  workerFallback.reason ??= reason;
  console.error(`[route-world] meshopt decoder workers failed (${reason}); decoding on the main thread`);
  if (!decoderWorkersActive) return;
  decoderWorkersActive = false;
  try {
    spawnDecoderWorkers(0);
  } catch {
    // Closing a dead worker cannot matter: the decoder no longer routes to it.
  }
  for (const fallBack of [...pendingWorkerDecodes]) fallBack();
}

function startDecoderWorkers(): void {
  if (decoderWorkersStarted) return;
  decoderWorkersStarted = true;
  // No Worker (the server, a test runtime): the decoder's async path decodes inline.
  if (typeof Worker === 'undefined') return;
  try {
    spawnDecoderWorkers(MESHOPT_DECODER_WORKERS);
    decoderWorkersActive = true;
  } catch (error) {
    // `new Worker` threw (a CSP enforced at construction): no worker was kept,
    // so the decoder decodes on the main thread. Counted like a dead worker.
    abandonDecoderWorkers(`useWorkers threw: ${errorMessage(error)}`);
  }
}

/** A main-thread decode into a fresh buffer (the worker path copies `source`, so the view is intact). */
function decodeOnMainThread(count: number, size: number, source: Uint8Array, mode: MeshoptMode, filter?: MeshoptFilter): Promise<Uint8Array> {
  return MeshoptDecoder.ready.then(() => {
    const target = new Uint8Array(count * size);
    MeshoptDecoder.decodeGltfBuffer(target, count, size, source, mode, filter);
    return target;
  });
}

/**
 * The decoder the figure loader hands three-stdlib: three's decoder, with
 * every worker decode raced against `MESHOPT_WORKER_TIMEOUT_MS` (see above).
 */
export const figureMeshoptDecoder = {
  supported: true,
  ready: MeshoptDecoder.ready,
  decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: MeshoptMode, filter?: MeshoptFilter): void {
    MeshoptDecoder.decodeGltfBuffer(target, count, size, source, mode, filter);
  },
  decodeGltfBufferAsync(count: number, size: number, source: Uint8Array, mode: MeshoptMode, filter?: MeshoptFilter): Promise<Uint8Array> {
    if (!decoderWorkersActive) return MeshoptDecoder.decodeGltfBufferAsync(count, size, source, mode, filter);
    return new Promise<Uint8Array>((resolve, reject) => {
      let done = false;
      const finish = (): boolean => {
        if (done) return false;
        done = true;
        clearTimeout(timer);
        pendingWorkerDecodes.delete(fallBack);
        return true;
      };
      function fallBack(): void {
        if (!finish()) return;
        workerFallback.decodes += 1;
        decodeOnMainThread(count, size, source, mode, filter).then(resolve, reject);
      }
      // Declared after the closures that clear it; none of them can run before this line.
      const timer = setTimeout(() => {
        abandonDecoderWorkers(`no worker reply within ${MESHOPT_WORKER_TIMEOUT_MS} ms`);
        fallBack();
      }, MESHOPT_WORKER_TIMEOUT_MS);
      pendingWorkerDecodes.add(fallBack);
      let decoding: Promise<Uint8Array>;
      try {
        decoding = MeshoptDecoder.decodeGltfBufferAsync(count, size, source, mode, filter);
      } catch (error) {
        finish();
        reject(error);
        return;
      }
      decoding.then(
        (decoded) => {
          if (finish()) resolve(decoded);
        },
        (error: unknown) => {
          // A worker's own decode error (a malformed buffer): the load fails, counted in `failedFigureLoads`.
          if (finish()) reject(error);
        },
      );
    });
  },
};

/** Whether the decoder workers were requested (tests, readouts). */
export function meshoptDecoderWorkersStarted(): boolean {
  return decoderWorkersStarted;
}

/** D42 N1-fix: the worker fallback readout (`renderPath.meshoptWorkerFallback`). A fresh copy per read. */
export function meshoptWorkerFallback(): MeshoptWorkerFallback {
  return { ...workerFallback };
}

/**
 * three's KTX2Loader and three-stdlib's declare the same runtime surface the
 * GLTF `KHR_texture_basisu` extension calls (`load`, `detectSupport`); only
 * their declaration files disagree on chaining return types, hence the cast.
 * D42 N1: every figure load also gets three's meshopt decoder (through the
 * worker-timeout wrapper), its workers started on the first call. D42 N7b: the KTX2 loader is the lazy stand-in,
 * set on every load whether or not the renderer exists yet.
 */
export function extendFigureLoader(loader: DreiGLTFLoader): void {
  startDecoderWorkers();
  loader.setMeshoptDecoder(figureMeshoptDecoder);
  loader.setKTX2Loader(lazyKtx2 as unknown as DreiKTX2Loader);
  (loader as unknown as { register: (callback: () => unknown) => unknown }).register(float32VertexPlugin);
}

/** Whether the canvas has handed the loader its renderer (`armFigureLoader`). */
export function isFigureLoaderArmed(): boolean {
  return renderer !== null;
}

export function useFigureGLTF(url: string) {
  return useGLTF(url, false, false, extendFigureLoader);
}

// ── Preload settlement (D23 complete-at-reveal) ─────────────────────────────
//
// The residency store (`residency-store.ts`) holds the reveal until every
// queued preload has SETTLED (loaded or failed). drei's preload returns
// nothing, so settlement is read back from the same suspend-react cache entry
// the preload filled: reading it outside render throws the entry's promise
// while pending (a promise that always resolves, success or error), returns
// the data once loaded, and throws the stored error once failed. The alias
// keeps the read out of the hook linter's reach; drei's `useGLTF` is a plain
// cache read here (fiber's `useLoader` calls no React hook).
const gltfCacheRead: typeof useGLTF = useGLTF;
function readGLTFCache(url: string): unknown {
  return gltfCacheRead(url, false, false, extendFigureLoader);
}

/** URLs asked for through `preloadFigure` that have not settled yet. */
const unsettled = new Set<string>();
/**
 * URLs whose preload already settled (loaded or failed). ENGINE r2: a second
 * `preloadFigure` of a settled URL is a no-op and notifies nothing. Before,
 * it re-entered `unsettled` and settled again synchronously — two residency
 * changes per call — so any consumer whose preload effect re-ran on a
 * re-render (sakura's figure groups on every progress notification) re-armed
 * the residency quiet window forever: residency never completed and the load
 * went to Lite at the deadline.
 */
const settledUrls = new Set<string>();
const loadListeners = new Set<() => void>();

function notifyLoads(): void {
  for (const listener of loadListeners) listener();
}

function settle(url: string): void {
  settledUrls.add(url);
  if (unsettled.delete(url)) notifyLoads();
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

// ── Failed loads (D42 commit G) ─────────────────────────────────────────────
//
// A failed GLB load used to be silent: the preload settled, residency went
// on, and the seat's boundary showed nothing. A meshopt file served to a tree
// without the decoder fails exactly that way, so every failure is now counted
// (`renderPath.failedFigureLoads`, gated at 0 on every capture), its URL kept,
// and reported on the console. Settlement is unchanged: residency still
// completes, the world still reveals (pixel-neutral on a healthy load).

/** Most failed URLs kept for the readout (the count is never capped). */
export const FAILED_FIGURE_URLS_MAX = 32;

export interface FailedFigureLoads {
  /** Every failed GLB load (preloads and prefetches), page life. */
  count: number;
  /** The first `FAILED_FIGURE_URLS_MAX` failed URLs, with the error message. */
  failures: { url: string; message: string }[];
}

const failedLoads: FailedFigureLoads = { count: 0, failures: [] };
const failedUrls = new Set<string>();

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

function noteFailedLoad(url: string, error: unknown): void {
  if (failedUrls.has(url)) return;
  failedUrls.add(url);
  failedLoads.count += 1;
  const message = errorMessage(error);
  if (failedLoads.failures.length < FAILED_FIGURE_URLS_MAX) failedLoads.failures.push({ url, message });
  console.error(`[route-world] figure load failed: ${url}: ${message}`);
}

/** Test seam: forget every recorded failure. */
export function resetFailedFigureLoadsForTests(): void {
  failedLoads.count = 0;
  failedLoads.failures = [];
  failedUrls.clear();
}

/**
 * D42: the failed-load readout (`renderPath.failedFigureLoads`). A fresh copy
 * per read. ELF-2: a failed manifest load counts as one more failure (first in
 * the list): a world served from the wrong tree or a mirror without its
 * manifest renders no figures at all, and must trip the same gate.
 */
export function failedFigureLoads(): FailedFigureLoads {
  const failures = failedLoads.failures.map((failure) => ({ ...failure }));
  const manifest = worldManifestLoadFailure();
  if (manifest === null) return { count: failedLoads.count, failures };
  return { count: failedLoads.count + 1, failures: [manifest, ...failures].slice(0, FAILED_FIGURE_URLS_MAX) };
}

/**
 * The cache entry's state once its promise has resolved: the stored error
 * (suspend-react resolves the entry promise on success AND failure and keeps
 * the error to throw on the next read), or nothing.
 */
function checkSettledEntry(url: string): void {
  try {
    readGLTFCache(url);
  } catch (thrown) {
    if (!isThenable(thrown)) noteFailedLoad(url, thrown);
  }
}

function startPreload(url: string): void {
  try {
    useGLTF.preload(url, false, false, extendFigureLoader);
  } catch (error) {
    // A synchronous throw from the loader setup is a failed load too.
    noteFailedLoad(url, error);
    settle(url);
    return;
  }
  try {
    readGLTFCache(url);
    settle(url);
  } catch (thrown) {
    if (isThenable(thrown)) {
      thrown.then(
        () => {
          checkSettledEntry(url);
          settle(url);
        },
        (error: unknown) => {
          noteFailedLoad(url, error);
          settle(url);
        },
      );
    } else {
      // A failed load is settled (the seat's own boundary shows nothing) and counted.
      noteFailedLoad(url, thrown);
      settle(url);
    }
  }
}

export function preloadFigure(url: string): void {
  // Already loaded (or failed): the cache holds it; nothing to fetch or report.
  if (settledUrls.has(url)) return;
  const fresh = !unsettled.has(url);
  if (fresh) {
    unsettled.add(url);
    notifyLoads();
  }
  // D42 N7b: no wait for the canvas (the KTX2 arm is lazy): the fetch starts now.
  if (fresh) startPreload(url);
  else useGLTF.preload(url, false, false, extendFigureLoader);
}

// ── Prefetch (D42 N7a) ──────────────────────────────────────────────────────

/** URLs `prefetchFigureGLB` already started (page life). */
const prefetched = new Set<string>();

/**
 * D42 N7a: start a GLB's fetch and parse NOW, into the same cache entry its
 * consumer's `useFigureGLTF` will read, without residency accounting: the
 * consumer's own `ResidentSuspense` boundary holds the reveal for it, as
 * before. For texture-free GLBs a world knows it will mount (the façade kit),
 * so their fetches run in parallel with the boundary's other suspensions
 * instead of one after another. It does not wait for the renderer: a KTX2
 * texture in it waits for the lazy arm (N7b; the kit has no images at all).
 * Idempotent; a failure is counted (`failedFigureLoads`).
 */
export function prefetchFigureGLB(url: string): void {
  if (prefetched.has(url) || settledUrls.has(url) || unsettled.has(url)) return;
  prefetched.add(url);
  try {
    useGLTF.preload(url, false, false, extendFigureLoader);
  } catch (error) {
    noteFailedLoad(url, error);
    return;
  }
  try {
    readGLTFCache(url);
  } catch (thrown) {
    if (isThenable(thrown)) {
      thrown.then(
        () => checkSettledEntry(url),
        (error: unknown) => noteFailedLoad(url, error),
      );
    } else {
      noteFailedLoad(url, thrown);
    }
  }
}

/** How many `preloadFigure` requests are still loading. */
export function pendingFigureLoads(): number {
  return unsettled.size;
}

/** Fires whenever the pending preload count changes. */
export function subscribeFigureLoads(listener: () => void): () => void {
  loadListeners.add(listener);
  return () => {
    loadListeners.delete(listener);
  };
}
