import { Skeleton, type Camera, type Object3D, type WebGLRenderer } from 'three';

/**
 * Secondary renders of the world scene (ENGINE-A3 fix, D23 headroom).
 *
 * A route frame draws the world scene three times, all inside one
 * `EffectComposer.render`: the RenderPass, then N8AO's two transparency
 * renders (`renderTransparency`, transparent objects with / without depth
 * write, everything else hidden). three treats each `gl.render` as a new
 * frame (`info.render.frame++`), so each of them:
 *
 * - walked the whole scene graph again (`scene.updateMatrixWorld`),
 * - re-rendered every shadow map (`shadowMap.autoUpdate`), now with only
 *   the transparent casters visible, and
 * - updated every visible skinned mesh's skeleton again (`WebGLObjects.update`
 *   keys its once-per-frame skeleton update on that counter): bone matrices
 *   recomputed and each bone texture re-uploaded.
 *
 * Even the first render updates a shadow-casting skeleton twice: three
 * projects the scene (skeleton update at frame F), THEN bumps the counter,
 * then renders the shadow maps (update again at F + 1).
 *
 * Nothing moves between those renders: the frame callbacks that pose bones
 * and move objects all ran before the composer. On the plaza (60 skeletons,
 * 5016 bones) the repeats cost ~40% of the skeleton work (99 updates a
 * frame for 60 skeletons: 65 from projection, 34 from the shadow pass) plus
 * two scene-wide matrix walks and two shadow passes, per frame, every frame
 * after the reveal. Under CPU contention that
 * turned the plaza's ~35 ms route frame into 50–110 ms long tasks in the
 * post-reveal sweep / jump / veil-after windows (verify-a3 D23 failure).
 *
 * A render of the ROOT scene with the same camera, again within the same
 * task as its first render, is a secondary: it keeps the first render's
 * world matrices, shadow maps and bone matrices. The first render of a task
 * is always a full one; the task boundary (a microtask queued at the first
 * render) resets the marker, so a render in a later callback — or any render
 * outside the frame loop — is never treated as a secondary. Offscreen warm
 * renders bypass this entirely (RouteWorldCanvas `rawScopes`).
 *
 * Skeletons: each first render opens an epoch; while a root-scene render of
 * that epoch runs (first or secondary), a skeleton updates at most once, so
 * the shadow pass reuses the projection's bone matrices. Outside those
 * renders (figure bounds, warm poses) `Skeleton.update` is three's own.
 */

type Marker = { scene: Object3D; camera: Camera };

const markers = new WeakMap<WebGLRenderer, Marker>();
const counts = { primary: 0, secondary: 0, skeletonSkips: 0 };

/** The frame epoch (bumped by each first render); 0 = none open. */
let epoch = 0;
/** > 0 while a root-scene frame render runs: skeletons update once per epoch. */
let renderDepth = 0;
const updatedIn = new WeakMap<Skeleton, number>();
let skeletonGuardInstalled = false;

/**
 * Wrap `Skeleton.prototype.update` once: inside a root-scene frame render a
 * skeleton already updated in the current epoch keeps its bone matrices and
 * bone texture. Any call outside those renders runs three's update unchanged.
 */
export function installSkeletonGuard(): void {
  if (skeletonGuardInstalled) return;
  skeletonGuardInstalled = true;
  const base = Skeleton.prototype.update;
  Skeleton.prototype.update = function guardedSkeletonUpdate(this: Skeleton) {
    if (renderDepth > 0) {
      if (updatedIn.get(this) === epoch) {
        counts.skeletonSkips += 1;
        return;
      }
      updatedIn.set(this, epoch);
    }
    base.call(this);
  };
}

/**
 * Dev A/B only: `?routeDebug=1&routeSecondaryRenders=full` restores three's
 * full work on every render, so a capture pair can be shot in one window.
 * Never in production.
 */
export function secondaryRendersDisabled(): boolean {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('routeDebug') === '1' && params.get('routeSecondaryRenders') === 'full';
  } catch {
    return false;
  }
}

/**
 * Draw `scene` through `render` (the renderer's own, bound). `root` is the
 * world scene; any other scene (post-pass quads, helpers) always renders in
 * full.
 */
export function drawFrameRender(
  gl: WebGLRenderer,
  render: (scene: Object3D, camera: Camera) => void,
  scene: Object3D,
  camera: Camera,
  root: Object3D | null,
  disabled: boolean,
): void {
  if (disabled || root === null || scene !== root) {
    render(scene, camera);
    return;
  }
  const marker = markers.get(gl);
  if (marker === undefined || marker.scene !== scene || marker.camera !== camera) {
    const next: Marker = { scene, camera };
    markers.set(gl, next);
    counts.primary += 1;
    epoch += 1;
    queueMicrotask(() => {
      if (markers.get(gl) === next) markers.delete(gl);
    });
    renderDepth += 1;
    try {
      render(scene, camera);
    } finally {
      renderDepth -= 1;
    }
    return;
  }
  counts.secondary += 1;
  const matrixAuto = scene.matrixWorldAutoUpdate;
  const shadowAuto = gl.shadowMap.autoUpdate;
  const shadowNeeds = gl.shadowMap.needsUpdate;
  scene.matrixWorldAutoUpdate = false;
  gl.shadowMap.autoUpdate = false;
  gl.shadowMap.needsUpdate = false;
  renderDepth += 1;
  try {
    render(scene, camera);
  } finally {
    renderDepth -= 1;
    scene.matrixWorldAutoUpdate = matrixAuto;
    gl.shadowMap.autoUpdate = shadowAuto;
    gl.shadowMap.needsUpdate = shadowNeeds;
  }
}

/** Counters since page load (debug readouts and tests). */
export function secondaryRenderCounts(): { primary: number; secondary: number; skeletonSkips: number } {
  return { ...counts };
}
