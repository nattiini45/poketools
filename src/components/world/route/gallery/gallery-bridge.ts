/**
 * D42 gallery (dev-only): `window.__routeGallery`, the page side of the
 * gallery contract TOOLS' `gallery.mjs` drives.
 *
 *   ready(): boolean   the figure is mounted and posed and the world revealed
 *                      (residency complete, reveal armed, present gate open),
 *                      OR the load failed (then `info().failed` says why, so
 *                      a driver fails fast instead of timing out);
 *   info()             { file, triangles, meshes, bounds, clips, failed }
 *                      plus the additive `fittedBounds` and `arm`;
 *   set(pose)          resolves after a frame with that pose has RENDERED
 *                      (the pose applied before it, no renderable held for
 *                      compile, the requested look mounted); rejects on an
 *                      invalid pose, a failed figure, or a timeout.
 *
 * `bounds` are the figure's raw model-unit bounds (the bake's frame, what an
 * A/B bounds check compares); `fittedBounds` are the rendered metres, grounded
 * at y = 0 and centred on x/z (what the camera frames).
 *
 * Captures still go through `window.__routeWorldPresent()`. The figure is held
 * dormant (the director never advances or breathes it), so a pose stays
 * exactly as `set` left it; do not call `__routeWorldPinPhase` on a gallery
 * page (a phase pin re-seats every directed figure).
 *
 * The logic is here, free of React and three.js, so it is unit-tested with
 * fakes; `GalleryScene` supplies the live dependencies.
 */

import type { GalleryBounds } from './gallery-camera';

export type GalleryLook = 'raw' | 'world';

export interface GalleryPose {
  azimuthDeg: number;
  elevationDeg: number;
  /** Fraction of the resting clip's loop, 0..1 (ignored by a clip-less figure). */
  clipT01: number;
  look: GalleryLook;
  /** The framed figure's on-screen size (CSS px; see `gallery-camera.ts`). */
  sizePx: number;
  /** The inside-out view (doubleSided shells). */
  inside?: boolean;
}

export interface GalleryFigureFacts {
  triangles: number;
  meshes: number;
  bounds: GalleryBounds;
  fittedBounds: GalleryBounds;
  clips: string[];
}

export interface GalleryInfo {
  file: string;
  triangles: number;
  meshes: number;
  bounds: GalleryBounds;
  clips: string[];
  failed: string | null;
  /** Additive: the rendered (metre) bounds the camera frames. */
  fittedBounds: GalleryBounds | null;
  /** Additive: the `?routeAssetBase=` arm in force (null: the configured base). */
  arm: string | null;
}

export interface RouteGalleryApi {
  ready(): boolean;
  info(): GalleryInfo;
  set(pose: GalleryPose): Promise<void>;
}

export interface GalleryBridgeDeps {
  file: string;
  arm: () => string | null;
  /** The mounted figure's facts; null until it has mounted and measured. */
  figure: () => GalleryFigureFacts | null;
  /** Why the figure failed to load, or null. */
  failed: () => string | null;
  /** Residency complete, reveal armed, present gate open. */
  worldReady: () => boolean;
  /** Writes the pose: camera, light, clip time, and the look request. */
  apply: (pose: GalleryPose) => void;
  /** Whether the frame state now matches `pose` (the look mounted, nothing held for compile). */
  settled: (pose: GalleryPose) => boolean;
  /** Frames the renderer has drawn so far (monotone). */
  renderedFrames: () => number;
  /** Run `cb` before the next frame (rAF). */
  schedule: (cb: () => void) => void;
  now: () => number;
  /** How long `set` waits for its frame before rejecting (ms). */
  timeoutMs?: number;
}

/** The default first pose (applied as soon as the figure measures). */
export const GALLERY_DEFAULT_POSE: GalleryPose = {
  azimuthDeg: 0,
  elevationDeg: 10,
  clipT01: 0,
  look: 'world',
  sizePx: 800,
};

export const GALLERY_SET_TIMEOUT_MS = 20_000;
/** Frames that must render after the pose is settled before `set` resolves. */
export const GALLERY_SETTLE_FRAMES = 2;
const SIZE_PX_MAX = 8192;

const EMPTY_BOUNDS: GalleryBounds = { min: [0, 0, 0], max: [0, 0, 0] };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The pose `value` describes, or the reason it is not one. */
export function parseGalleryPose(value: unknown): GalleryPose | string {
  if (typeof value !== 'object' || value === null) return 'pose: not an object';
  const p = value as Record<string, unknown>;
  if (!isFiniteNumber(p.azimuthDeg)) return 'pose: azimuthDeg must be a finite number';
  if (!isFiniteNumber(p.elevationDeg)) return 'pose: elevationDeg must be a finite number';
  if (!isFiniteNumber(p.clipT01) || p.clipT01 < 0 || p.clipT01 > 1) return 'pose: clipT01 must be in [0, 1]';
  if (p.look !== 'raw' && p.look !== 'world') return "pose: look must be 'raw' or 'world'";
  if (!isFiniteNumber(p.sizePx) || p.sizePx < 1 || p.sizePx > SIZE_PX_MAX) return `pose: sizePx must be in [1, ${SIZE_PX_MAX}]`;
  if (p.inside !== undefined && typeof p.inside !== 'boolean') return 'pose: inside must be a boolean';
  return {
    azimuthDeg: p.azimuthDeg,
    elevationDeg: p.elevationDeg,
    clipT01: p.clipT01,
    look: p.look,
    sizePx: p.sizePx,
    ...(p.inside === undefined ? {} : { inside: p.inside }),
  };
}

export function createGalleryApi(deps: GalleryBridgeDeps): RouteGalleryApi {
  const timeoutMs = deps.timeoutMs ?? GALLERY_SET_TIMEOUT_MS;
  /** `set` calls run one after another: a pose resolves only for its own frame. */
  let queue: Promise<void> = Promise.resolve();

  const waitForFrame = (pose: GalleryPose): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const startedAt = deps.now();
      let settledAtFrame: number | null = null;
      const poll = (): void => {
        const failure = deps.failed();
        if (failure !== null) {
          reject(new Error(`gallery: figure failed: ${failure}`));
          return;
        }
        const frames = deps.renderedFrames();
        if (deps.settled(pose)) {
          if (settledAtFrame === null) settledAtFrame = frames;
          if (frames - settledAtFrame >= GALLERY_SETTLE_FRAMES) {
            resolve();
            return;
          }
        } else {
          settledAtFrame = null;
        }
        if (deps.now() - startedAt > timeoutMs) {
          reject(new Error(`gallery: no settled frame within ${timeoutMs} ms`));
          return;
        }
        deps.schedule(poll);
      };
      // No invalidate (ENGINE-A5 audit): the gallery is routeDebug, never parked,
      // so the canvas runs `frameloop="never"` under FrameCapDriver (or `always`),
      // and the frames this poll counts come from the driver's rAF.
      deps.schedule(poll);
    });

  const runSet = (pose: GalleryPose): Promise<void> => {
    const failure = deps.failed();
    if (failure !== null) return Promise.reject(new Error(`gallery: figure failed: ${failure}`));
    if (deps.figure() === null) return Promise.reject(new Error('gallery: the figure has not mounted yet (poll ready())'));
    deps.apply(pose);
    return waitForFrame(pose);
  };

  return {
    ready: () => deps.failed() !== null || (deps.figure() !== null && deps.worldReady()),
    info: () => {
      const facts = deps.figure();
      return {
        file: deps.file,
        triangles: facts?.triangles ?? 0,
        meshes: facts?.meshes ?? 0,
        bounds: facts?.bounds ?? EMPTY_BOUNDS,
        clips: facts ? [...facts.clips] : [],
        failed: deps.failed(),
        fittedBounds: facts?.fittedBounds ?? null,
        arm: deps.arm(),
      };
    },
    set: (value: GalleryPose) => {
      const pose = parseGalleryPose(value);
      if (typeof pose === 'string') return Promise.reject(new Error(`gallery: ${pose}`));
      const next = queue.then(() => runSet(pose));
      // A rejected pose never blocks the next one.
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
