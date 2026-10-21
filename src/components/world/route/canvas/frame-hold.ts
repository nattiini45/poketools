import type * as THREE from 'three';
import { noteFrameRender, warmStatsOn } from '../perf/warm-stats';
import { drawFrameRender, secondaryRendersDisabled } from '../secondary-renders';

/**
 * The renderer's draw wrapper and frame-hold registry: `holdFirstRender`
 * installs the counting pass-through on `gl.render`; the per-renderer maps
 * here are shared with the LoadWarmer, the ceremony render gate and the
 * readiness reporter.
 *
 * Split out of RouteWorldCanvas.tsx (M15) without a behaviour change; the
 * canvas entry mounts it.
 */

/**
 * W7 wobble latency (review r3): M2 (`noteRendererLive`, in `onCreated`)
 * is followed by the renderer's first frame, which compiles every program
 * in one long task (r2: the M2 wobble started 0.8–1.1 s after its rise,
 * while M1's landed within ~50 ms). Holding the first real render until the
 * browser has had one rendering opportunity lets the milestone's wobble
 * commit and start on the compositor first — it then plays through the
 * compile stall instead of after it. Frame callbacks still run while held;
 * only `gl.render` is skipped, for at most two animation frames, with the
 * canvas still at opacity 0 (inert until the handoff). After the hold the
 * wrapper is a counting pass-through (see below).
 */
export function holdFirstRender(gl: THREE.WebGLRenderer, root: THREE.Object3D | null = null): void {
  const render = gl.render.bind(gl);
  // ENGINE-A3 fix: read once (dev A/B switch; always false in production).
  const fullSecondaries = secondaryRendersDisabled();
  // ENGINE-A4R: the per-frame work ledger (routeDebug only; perf/warm-stats.ts).
  const stats = warmStatsOn();
  // D23: the load warm's offscreen pose renders bypass the hold and the
  // draw counter (they are not frames).
  rawRenders.set(gl, render);
  // D23: draws start HELD for the load warm (the LoadWarmer releases them at
  // its frame stage, or at the handoff). Without this default the frames
  // between the renderer's creation and the warm's first step drew the whole
  // scene, linking every program synchronously on first use.
  setFrameHold(gl, 'warm', true);
  let held = true;
  // Wave-2 r2: the wrapper STAYS installed as a pass-through that counts real
  // draws (`drawnFrames`, M4's source). Restoring the renderer's own method
  // was also unsafe: a debug hook that wrapped `gl.render` inside the hold
  // window captured the held wrapper as its base and, when it uninstalled,
  // put a permanently held renderer back.
  drawCounts.set(gl, 0);
  gl.render = (scene, camera) => {
    // D23: the load warm's offscreen renders (post-pass warm) pass straight
    // through — not held, not counted as frames.
    if (rawScopes.has(gl)) {
      render(scene, camera);
      return;
    }
    if (held) return;
    // Wave-2 r2: the ceremony hold and the inert-canvas link hold, decided
    // once per frame (`heldFrames`).
    if (frameHeld(gl)) return;
    drawCounts.set(gl, (drawCounts.get(gl) ?? 0) + 1);
    lastDrawAt.set(gl, performance.now());
    // ENGINE-A3 fix (D23 headroom): the composer's repeat renders of the
    // world scene in one frame (N8AO's transparency renders) keep the first
    // render's matrices, shadow maps and bones (secondary-renders.ts).
    if (!stats) {
      drawFrameRender(gl, render, scene, camera, root, fullSecondaries);
      return;
    }
    const target = gl.getRenderTarget();
    const callsBefore = gl.info.render.calls;
    const started = performance.now();
    drawFrameRender(gl, render, scene, camera, root, fullSecondaries);
    const callsAfter = gl.info.render.calls;
    noteFrameRender(
      scene === root ? 'world' : scene.name || scene.type,
      target ? `${target.width}x${target.height}` : 'screen',
      performance.now() - started,
      callsAfter >= callsBefore ? callsAfter - callsBefore : callsAfter,
    );
  };
  const release = () => {
    held = false;
  };
  if (typeof window.requestAnimationFrame !== 'function') {
    release();
    return;
  }
  window.requestAnimationFrame(() => window.requestAnimationFrame(release));
  // A hidden or throttled document can starve rAF; the hold is a latency
  // nicety, never a gate, so a timer releases it too.
  window.setTimeout(release, 250);
}

/** Real `gl.render` draws since the renderer was created (see `holdFirstRender`). */
const drawCounts = new WeakMap<THREE.WebGLRenderer, number>();

/** The renderer's own `render`, bound, before the hold wrapper (D23 pose renders). */
export const rawRenders = new WeakMap<THREE.WebGLRenderer, (scene: THREE.Object3D, camera: THREE.Camera) => void>();

/** Renderers inside a raw-render scope (`withRawRenders`). */
const rawScopes = new WeakSet<THREE.WebGLRenderer>();

/**
 * Run `fn` with every `gl.render` it makes bypassing the hold wrapper and the
 * draw counter (D23: the post-pass warm renders passes whose own internals
 * call `renderer.render`; they are offscreen warm work, not frames).
 */
export function withRawRenders(gl: THREE.WebGLRenderer, fn: () => void): void {
  const nested = rawScopes.has(gl);
  rawScopes.add(gl);
  try {
    fn();
  } finally {
    if (!nested) rawScopes.delete(gl);
  }
}

export function drawnFrames(gl: THREE.WebGLRenderer): number {
  return drawCounts.get(gl) ?? 0;
}

/** `performance.now()` of the last real draw per renderer. */
export const lastDrawAt = new WeakMap<THREE.WebGLRenderer, number>();

/**
 * Renderers whose draws are held for the CURRENT frame, and why. Decided
 * ONCE per frame, before any other frame callback (`CeremonyRenderGate`, the
 * load warm's link check), so a post-processed frame is drawn whole or not
 * at all — never a composer pass without its screen blit.
 */
export const heldFrames = new WeakMap<THREE.WebGLRenderer, { ceremony: boolean; warm: boolean }>();

/**
 * D23: a renderer with no recorded hold is HELD for the load warm — draws are
 * released only by the LoadWarmer (its frame stage, or the handoff). A
 * StrictMode / remount cleanup can drop the entry; the default keeps the
 * frames between that cleanup and the warm's next step from drawing the
 * whole scene (and linking every program synchronously on first use).
 */
export function frameHeld(gl: THREE.WebGLRenderer): boolean {
  const held = heldFrames.get(gl);
  return held === undefined || held.ceremony || held.warm;
}

export function setFrameHold(gl: THREE.WebGLRenderer, reason: 'ceremony' | 'warm', on: boolean): void {
  const held = heldFrames.get(gl) ?? { ceremony: false, warm: true };
  held[reason] = on;
  heldFrames.set(gl, held);
}
