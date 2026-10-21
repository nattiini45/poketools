'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { Camera, Material, Object3D, Scene, Texture, WebGLRenderer } from 'three';
import { bandsPending } from '../content/banded-upload';
import { noteWarmStat, warmStatsOn } from '../perf/warm-stats';
import { N3_TAG_BITS } from '../post/n3-tags';
import { compileShadowVariants, lastWarmRender, shadowPrograms, type WarmRenderReport } from './shadow-variants';

/**
 * The station warm window (`requestWarm`, `armStationWarmup`,
 * `useWarmCompile`) and the compile guard, which share one per-renderer
 * `WarmState`.
 *
 * Split out of useStationWarmup.ts (M16) without a behaviour change; that
 * file re-exports it.
 */

/** How long after a latch new materials are still watched and warmed. */
const WARM_WINDOW_MS = 4000;
/** Poll interval of the warm watcher. */
const WARM_POLL_MS = 300;
/**
 * Texture uploads per poll, so a warm pass never becomes its own stall. A
 * count alone was not enough: a plaza 1440 sweep measured 811 ms of
 * `initTexture` in one warm tick (24 large canvas maps), itself a 0.9 s frame
 * gap. Uploads now also stop once a tick has spent WARM_TEXTURE_BUDGET_MS
 * (at least one upload per tick), and while uploads are queued the watcher
 * ticks every WARM_DRAIN_POLL_MS instead of WARM_POLL_MS, so the queue drains
 * in frame-sized slices between renders.
 */
const WARM_TEXTURES_PER_POLL = 24;
const WARM_TEXTURE_BUDGET_MS = 8;
const WARM_DRAIN_POLL_MS = 34;

interface WarmState {
  until: number;
  timer: number;
  seen: WeakSet<Material>;
  uploaded: WeakSet<Texture>;
  /** Textures of freshly seen materials still waiting for an upload slot. */
  pending: Texture[];
  scene: Object3D;
  camera: Camera;
  /** Renderables the compile guard is holding back (see `guardRender`). */
  held: Map<Object3D, HeldRenderable>;
  /** Renderables already held and released once; never held again. */
  released: WeakSet<Object3D>;
  /** A warm-pass material batch waits to be compiled per render target. */
  compilePending: boolean;
  /** Targets the pending batch was compiled for. */
  compiledTargets: Set<object | null>;
  /** Frame the pending batch is compiled in (−1 = not yet started). */
  compileBatchFrame: number;
  /** Frame counter stamped by `guardCompileFrame`; detection runs once per frame. */
  frame: number;
  detectedFrame: number;
  /** The route is live (the guard never holds during the load). */
  live: boolean;
  /** Frame the held-texture upload slice last ran in (once per frame). */
  uploadFrame: number;
  /** Warm-pass scans run so far (the programs-warm signal waits for one). */
  scans: number;
}

interface HeldRenderable {
  since: number;
  /** Render targets this renderable has been compiled for. */
  targets: Set<object | null>;
  /** Every program compiled for it; released when all report ready. */
  programs: Set<{ isReady?: () => boolean }>;
  /**
   * Its materials' textures (round 4): released only once they are on the
   * GPU too, uploaded by the guard in frame-sized slices — otherwise the
   * release frame paid every upload at once (the plaza aces' 333 ms gap on
   * the upward sweep, with no JS long task: a driver-side upload stall).
   */
  textures: Texture[];
  /** Restore the parked layer mask (see `hold`). */
  release: () => void;
}

export const warmers = new WeakMap<WebGLRenderer, WarmState>();

export function texturesOf(material: Material, out: Texture[]): void {
  for (const value of Object.values(material)) {
    if (value !== null && typeof value === 'object' && (value as Texture).isTexture === true) {
      out.push(value as Texture);
    }
  }
}

function warmPass(gl: WebGLRenderer, state: WarmState, scan: boolean): void {
  const fresh: Material[] = [];
  /** Shadow casters that brought a fresh material (review r5). */
  const freshCasters: Object3D[] = [];
  if (scan) state.scans += 1;
  const scanStarted = scan && warmStatsOn() ? performance.now() : 0;
  let visited = 0;
  if (scan) state.scene.traverse((object) => {
    visited += 1;
    const material = (object as Object3D & { material?: Material | Material[] }).material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    let brought = false;
    for (const entry of list) {
      if (!state.seen.has(entry)) {
        state.seen.add(entry);
        fresh.push(entry);
        brought = true;
      }
    }
    if (brought && object.castShadow) freshCasters.push(object);
  });
  if (scanStarted > 0) {
    // ENGINE-A4R work ledger (routeDebug only): one whole-scene scan.
    noteWarmStat('scans', 1, performance.now() - scanStarted);
    noteWarmStat('scanNodes', visited);
    if (fresh.length > 0) noteWarmStat('freshMaterials', fresh.length);
  }
  if (fresh.length > 0) {
    if (hasParallelCompile(gl)) {
      // Their shadow variants too, before a pre-mounted group is shown
      // (the program cache dedupes what the first-frame warm already built).
      if (freshCasters.length > 0) {
        compileShadowVariants(gl, freshCasters, state.scene, state.camera);
      }
      // Compiled by the render hook, per render target the scene is drawn
      // to — a compile from this timer would build the SCREEN variant, which
      // the post stack's buffer never draws (see the compile guard below).
      state.compilePending = true;
      state.compiledTargets.clear();
      state.compileBatchFrame = -1;
    } else {
      try {
        gl.compileAsync(state.scene, state.camera).catch(() => {});
      } catch {
        // A lost context or a half-built material: the ordinary first-render
        // compile still runs, so the warm-up is only ever an optimisation.
      }
    }
    for (const material of fresh) texturesOf(material, state.pending);
  }
  let uploads = 0;
  const started = performance.now();
  while (
    state.pending.length > 0 &&
    uploads < WARM_TEXTURES_PER_POLL &&
    (uploads === 0 || performance.now() - started < WARM_TEXTURE_BUDGET_MS)
  ) {
    const texture = state.pending.shift();
    if (!texture || state.uploaded.has(texture)) continue;
    // Not decoded yet: its first render uploads it (the image arrives with
    // a version bump that initTexture could not have consumed anyway).
    if (texture.image == null || texture.version === 0) continue;
    state.uploaded.add(texture);
    uploads += 1;
    try {
      gl.initTexture(texture);
    } catch {
      // As above: first render uploads it instead.
    }
  }
  if (uploads > 0) noteWarmStat('textureInits', uploads);
}

/** True once the route handed over (`world-route-live`); before it the load warm owns all GPU work. */
export function routeLive(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('world-route-live');
}

export function requestWarm(gl: WebGLRenderer, scene: Object3D, camera: Camera): void {
  // D23 (ENGINE r2): before the handoff the load warm ceremony owns every
  // compile and upload, in per-frame slices. r1 still opened this watcher
  // from StatueRow's staggered mount during the load: its scan ran a
  // whole-batch shadow-variant compile (an 888 ms task) and armed the compile
  // guard's whole-scene `compile` inside the warm's own pose renders.
  if (!routeLive()) return;
  const now = performance.now();
  let state = warmers.get(gl);
  if (!state) {
    state = {
      until: 0,
      timer: 0,
      seen: new WeakSet(),
      uploaded: new WeakSet(),
      pending: [],
      scene,
      camera,
      held: new Map(),
      released: new WeakSet(),
      compilePending: false,
      compiledTargets: new Set(),
      compileBatchFrame: -1,
      frame: 0,
      detectedFrame: -1,
      live: false,
      uploadFrame: -1,
      scans: 0,
    };
    warmers.set(gl, state);
  }
  state.scene = scene;
  state.camera = camera;
  state.until = now + WARM_WINDOW_MS;
  if (state.timer !== 0) return;
  const current = state;
  const tick = () => {
    // Past the window only the queued uploads drain (no new scan), so the
    // watcher always ends.
    const tickStarted = performance.now();
    const open = tickStarted < current.until;
    warmPass(gl, current, open);
    noteWarmStat('warmTicks', 1, performance.now() - tickStarted);
    if (current.pending.length > 0) {
      current.timer = window.setTimeout(tick, WARM_DRAIN_POLL_MS);
    } else if (open) {
      current.timer = window.setTimeout(tick, WARM_POLL_MS);
    } else {
      current.timer = 0;
    }
  };
  current.timer = window.setTimeout(tick, 0);
}

/**
 * Open (or extend) the warm window from outside a station window — the
 * conductor driver arms it on every nearest-station change, because a
 * crossing can bring in new programs that no window latch announced.
 */
export function armStationWarmup(gl: WebGLRenderer, scene: Object3D, camera: Camera): void {
  // D23: before the handoff the load warm ceremony owns every compile and
  // upload, in per-frame slices; a whole-scene warm window opened here during
  // the load would be exactly the synchronous batch it exists to avoid
  // (`requestWarm` refuses it).
  requestWarm(gl, scene, camera);
}

// ── Compile guard ──────────────────────────────────────────────────────────
//
// Measured on a maintainer's box (review r2, ANGLE/D3D11, KHR_parallel_shader_
// compile available): a plaza 390 pass pulse → roster → teams spent 10.2 s of
// 12 s CPU inside `getProgramInfoLog` under three's `onFirstUse`, i.e. the
// FIRST DRAW of a freshly mounted mesh waits synchronously for its program to
// link (24 new programs, ~0.4 s each). Freezes of 1.2–4.6 s followed every
// latch — mid-crossing, and at rest after an idle lead too — and starved the
// damped channel, so a landed station could not settle.
//
// Two reasons the warm pass alone could not fix it: (1) React commits the new
// content and the very next frame draws it, before any compile could finish;
// (2) a compile issued from a timer runs against the SCREEN target, but the
// scene is drawn into the post stack's buffer — a different program variant
// (tone mapping / output colour space are part of the program key), so the
// warmed program was never the one drawn.
//
// The guard runs inside `scene.onBeforeRender`, which three calls at the top
// of every `render(scene)` with the render target that draw will use:
//  - once per frame (while a warm window is open, and only once the route is
//    live — the load path compiles under the hidden canvas), it walks the
//    visible scene and HOLDS every renderable whose program is not linked yet
//    (its layer mask is parked at 0, so no camera draws it), then compiles it for the
//    current target — non-blocking under KHR_parallel_shader_compile;
//  - on each later render of the scene to another target (a mirror, a
//    prepass) it compiles the held objects for that target too;
//  - it RELEASES a held renderable as soon as every program compiled for it
//    reports ready (`WebGLProgram.isReady`, a COMPLETION_STATUS poll that
//    never blocks), or after COMPILE_HOLD_MAX_MS whatever happens (content is
//    never withheld — past it the first draw pays the compile as before).
//  - material batches the warm pass found (including hidden pre-mounted
//    groups, which the visible walk skips) are compiled for each target the
//    scene renders to, instead of for the screen.
// The frame rate stays up; a newcomer appears a few frames later instead of
// freezing the world. Without the extension the guard is off (holding would
// gain nothing: the compile itself would block) and the warm pass keeps its
// plain `compileAsync`.
//
// Holding is transparent to the rest of the app: only the layer mask is
// parked (round 3 — the old `visible` accessor was clobbered by N8AO's
// per-frame visibility snapshot/restore, see `hold`), so every read and write
// of `visible` keeps its meaning. A held mesh still reads visible, so the
// static batcher could fold it into a merged batch that draws it (content
// shown, the compile paid by the batch's first draw) — correct, only slower.
// A renderable is held at most once per session. Honest
// limits: shadow-pass depth variants still compile on first use (few, shared
// across meshes); a material whose program key changes later (light count)
// is not new and is not held.

/** Longest a renderable is held back waiting for its program. */
export const COMPILE_HOLD_MAX_MS = 5000;

export type Renderable = Object3D & { material?: Material | Material[]; isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
export type ProgramLike = { isReady?: () => boolean };
export type PropertiesLike = { get: (object: object) => { currentProgram?: ProgramLike; __version?: number } };
/** The render target a scene draw goes to; null is the screen. */
type TargetKey = object | null;

let heldTotal = 0;
let releasedTotal = 0;

/** `?routeDebug=1` event log of the guard (hold / release reasons), capped. */
type GuardEvent = { t: number; kind: 'hold' | 'release-ready' | 'release-cap' | 'recompile-stale'; n: number };
const guardLog: GuardEvent[] = [];

function logGuard(kind: GuardEvent['kind'], n: number): void {
  if (!debugSession()) return;
  guardLog.push({ t: Math.round(performance.now()), kind, n });
  if (guardLog.length > 200) guardLog.splice(0, guardLog.length - 200);
}

/** Renderables currently held back by the compile guard (probe readout). */
export function compileHeldCount(): number {
  return heldTotal;
}

let guardKill: boolean | null = null;
let guardDebug: boolean | null = null;

declare global {
  interface Window {
    /** `?routeDebug=1` only: the compile guard's live hold list (bisect aid). */
    __warmGuard?: () => { held: number; released: number; log: { t: number; kind: string; n: number }[]; entries: { name: string; ageMs: number; targets: number; programs: number; ready: number; layers: number; program: string }[]; warmRender: WarmRenderReport | null; programs: Record<string, number>; shadowKeys: string[] };
  }
}

function debugSession(): boolean {
  if (guardDebug === null) {
    try {
      guardDebug = new URLSearchParams(window.location.search).get('routeDebug') === '1';
    } catch {
      guardDebug = false;
    }
  }
  return guardDebug;
}

/**
 * Debug-only bisect switch (`?routeDebug=1&warmGuard=0`): turns the compile
 * guard off so a capture can prove whether a missing surface is the guard's
 * doing. Never read outside a debug session; visitors always get the guard.
 */
function warmGuardDisabled(): boolean {
  if (guardKill === null) {
    try {
      const params = new URLSearchParams(window.location.search);
      guardKill = params.get('routeDebug') === '1' && params.get('warmGuard') === '0';
    } catch {
      guardKill = false;
    }
  }
  return guardKill;
}

const parallelCompile = new WeakMap<WebGLRenderer, boolean>();

function hasParallelCompile(gl: WebGLRenderer): boolean {
  let known = parallelCompile.get(gl);
  if (known === undefined) {
    try {
      known = gl.extensions.has('KHR_parallel_shader_compile');
    } catch {
      known = false;
    }
    parallelCompile.set(gl, known);
  }
  return known;
}

export function isRenderable(object: Object3D): object is Renderable {
  const r = object as Renderable;
  return (r.isMesh === true || r.isPoints === true || r.isLine === true || r.isSprite === true) && r.material != null;
}

export function propertiesOf(gl: WebGLRenderer): PropertiesLike {
  return (gl as unknown as { properties: PropertiesLike }).properties;
}

export function materialsOf(object: Renderable): Material[] {
  const material = object.material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

/** Every material of `object` has a linked (ready) current program. */
function programsReady(gl: WebGLRenderer, object: Renderable): boolean {
  const properties = propertiesOf(gl);
  for (const material of materialsOf(object)) {
    const program = properties.get(material).currentProgram;
    if (!program || typeof program.isReady !== 'function' || !program.isReady()) return false;
  }
  return true;
}

/**
 * Layer mask a held renderable carries: intersects no camera, so three's
 * `projectObject` (and the shadow pass) skip it without touching `visible`.
 */
const HELD_LAYER_MASK = 0;

/**
 * D42 X15: the layer mask a held renderable gets back at its release, or null
 * to keep what it carries now.
 *
 * Only N3's tag bits (`n3-tags.ts`) may have been written while it was held:
 * the mask then has no bit outside N3_TAG_BITS, the original layers come back
 * and the tags written are kept (`saved | (current & N3_TAG_BITS)`). Any other
 * bit is a deliberate layer write (someone re-assigned the layers while it
 * was held): theirs is kept, as before X15.
 */
export function releaseHeldMask(saved: number, current: number): number | null {
  if ((current & ~N3_TAG_BITS) !== HELD_LAYER_MASK) return null;
  return saved | (current & N3_TAG_BITS);
}

function hold(state: WarmState, object: Object3D, now: number): HeldRenderable {
  // Round 3: the hold used to turn `visible` into an accessor that read false
  // and recorded writes. N8AO's `renderTransparency` snapshots `visible` for
  // the whole scene every frame and writes the snapshot back — the snapshot
  // was the accessor's `false`, so the "latest intent" became false and the
  // released mesh stayed hidden for the session (the plaza roster desk,
  // boards and pedestals vanished in every round-2 still). Any save/restore
  // of `visible` does the same, so the hold no longer touches `visible` at
  // all: it parks the layer mask, which only the renderer's camera test
  // reads, and the app's own visibility writes stay untouched.
  const mask = object.layers.mask;
  object.layers.mask = HELD_LAYER_MASK;
  const textures: Texture[] = [];
  if (isRenderable(object)) for (const material of materialsOf(object)) texturesOf(material, textures);
  const entry: HeldRenderable = {
    since: now,
    targets: new Set(),
    programs: new Set(),
    textures,
    release: () => {
      // Someone re-assigned the layers while held (a deliberate write):
      // keep theirs; otherwise put the original mask back, with any N3 tag
      // written while held (D42 X15, `releaseHeldMask`).
      const restored = releaseHeldMask(mask, object.layers.mask);
      if (restored !== null) object.layers.mask = restored;
    },
  };
  state.held.set(object, entry);
  heldTotal += 1;
  return entry;
}

/** A renderable the guard is holding back right now (tests, probes). */
export function isCompileHeld(gl: WebGLRenderer, object: Object3D): boolean {
  return warmers.get(gl)?.held.has(object) ?? false;
}

function dropHeld(state: WarmState, object: Object3D, entry: HeldRenderable): void {
  entry.release();
  state.held.delete(object);
  // Held once is enough: a renderable released on the time cap (its program
  // never reported ready, or its material's current program is another
  // variant) must not be re-detected and hidden again for another cap.
  state.released.add(object);
  releasedTotal += 1;
  heldTotal -= 1;
}

/**
 * A program three has already released (its material was disposed after the
 * compile — `usedTimes` fell to 0 and the GL program was deleted). Its
 * COMPLETION_STATUS poll can never turn true, so an entry waiting on it would
 * sit out the whole COMPILE_HOLD_MAX_MS: measured on the plaza (round 3),
 * 108 meshes whose shared MeshStandardMaterial was disposed and rebuilt right
 * after the lead mount stayed held for the full 5 s.
 */
export function isStaleProgram(program: ProgramLike): boolean {
  const usedTimes = (program as { usedTimes?: number }).usedTimes;
  return typeof usedTimes === 'number' && usedTimes <= 0;
}

/** Textures the guard could not upload (a throw): never waited on again. */
export const uploadFailed = new WeakSet<Texture>();

/**
 * A texture whose current version is on the GPU — or that has nothing to
 * upload yet (no image / version 0: its first render uploads it when the
 * image lands, which no hold could have prevented) or that failed to upload.
 */
export function textureOnGpu(gl: WebGLRenderer, texture: Texture): boolean {
  if (texture.image == null || texture.version === 0 || uploadFailed.has(texture)) return true;
  if ((texture as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true) return true;
  // ROLLOUT-PLAN E3: a banded face is allocated (three records its version)
  // before its bands land; it is not on the GPU until the last one has.
  if (bandsPending(texture)) return false;
  return propertiesOf(gl).get(texture).__version === texture.version;
}

function texturesUploaded(gl: WebGLRenderer, entry: HeldRenderable): boolean {
  for (const texture of entry.textures) if (!textureOnGpu(gl, texture)) return false;
  return true;
}

/** Per-frame budget for the guard's held-texture uploads (≥ 1 per frame). */
export const GUARD_TEXTURE_BUDGET_MS = 6;

/**
 * Upload the held renderables' textures, one frame-sized slice per frame, so
 * the release frame draws with everything resident.
 */
function uploadHeldTextures(gl: WebGLRenderer, state: WarmState): void {
  if (state.held.size === 0 || state.uploadFrame === state.frame) return;
  state.uploadFrame = state.frame;
  const started = performance.now();
  let uploads = 0;
  for (const entry of state.held.values()) {
    for (const texture of entry.textures) {
      if (textureOnGpu(gl, texture)) continue;
      if (uploads > 0 && performance.now() - started >= GUARD_TEXTURE_BUDGET_MS) return;
      uploads += 1;
      state.uploaded.add(texture);
      try {
        gl.initTexture(texture);
      } catch {
        uploadFailed.add(texture);
      }
    }
  }
}

function releaseHeld(gl: WebGLRenderer, state: WarmState, now: number): void {
  let readyN = 0;
  let capN = 0;
  let staleN = 0;
  for (const [object, entry] of state.held) {
    const detached = object.parent === null;
    const expired = now - entry.since > COMPILE_HOLD_MAX_MS;
    let stale = false;
    for (const program of entry.programs) {
      if (isStaleProgram(program)) {
        entry.programs.delete(program);
        stale = true;
      }
    }
    // Recompile against the material's new program on the next render of
    // each target (the per-target pass in `guardRender`, which runs whether
    // or not a warm window is open). Releasing it instead measured a 1.47 s
    // first-draw compile on the plaza upward sweep (round 3).
    if (stale) {
      entry.targets.clear();
      staleN += 1;
    }
    let ready = entry.programs.size > 0;
    if (ready) {
      for (const program of entry.programs) {
        if (typeof program.isReady === 'function' && !program.isReady()) {
          ready = false;
          break;
        }
      }
    }
    if (ready && !stale && !texturesUploaded(gl, entry)) ready = false;
    if (detached || expired || (ready && !stale)) {
      dropHeld(state, object, entry);
      if (expired && !detached && !ready) capN += 1;
      else if (!detached) readyN += 1;
    }
  }
  if (readyN > 0) logGuard('release-ready', readyN);
  // A cap release draws a still-linking program: the next frame pays the
  // compile — the attribution the round-3 freeze analysis asked for.
  if (capN > 0) logGuard('release-cap', capN);
  if (staleN > 0) logGuard('recompile-stale', staleN);
}

/** The guard body — see the block comment above. */
function guardRender(gl: WebGLRenderer, state: WarmState, scene: Scene, camera: Camera, target: TargetKey): void {
  const now = performance.now();
  if (state.held.size > 0) releaseHeld(gl, state, now);

  // Warm-pass batches: compile the whole scene (hidden pre-mounts included)
  // once per render target this frame draws to.
  if (state.compilePending && !state.compiledTargets.has(target)) {
    state.compiledTargets.add(target);
    const compileStarted = warmStatsOn() ? performance.now() : 0;
    try {
      gl.compile(scene, camera);
    } catch {
      // Half-built material / lost context: first draw compiles instead.
    }
    if (compileStarted > 0) noteWarmStat('sceneCompiles', 1, performance.now() - compileStarted);
  }

  // Held objects not yet compiled for this target (a second pass, or a
  // recompile after their material was rebuilt) — whenever anything is held,
  // window or not: holding without compiling would only delay the stall.
  compileHeld(gl, state, scene, camera, target, null);
  uploadHeldTextures(gl, state);

  if (!state.live || now > state.until) return;

  // Detection: once per frame, on the first scene render of that frame.
  if (state.detectedFrame === state.frame) return;
  state.detectedFrame = state.frame;
  const fresh: Renderable[] = [];
  const walkStarted = warmStatsOn() ? performance.now() : 0;
  scene.traverseVisible((object) => {
    if (!isRenderable(object) || state.held.has(object) || state.released.has(object)) return;
    if ((object.userData as { staticBatch?: unknown } | undefined)?.staticBatch) return;
    if (programsReady(gl, object)) return;
    fresh.push(object);
  });
  if (walkStarted > 0) noteWarmStat('guardWalks', 1, performance.now() - walkStarted);
  if (fresh.length === 0) return;
  noteWarmStat('guardHeld', fresh.length);
  for (const object of fresh) hold(state, object, now);
  logGuard('hold', fresh.length);
  compileHeld(gl, state, scene, camera, target, fresh);
  // Review r5: a held caster is released only once its shadow-pass
  // programs are linked too (its first shadow draw would otherwise link
  // synchronously). A held mesh is on layer mask 0, so the shadow pass skips
  // it meanwhile.
  const shadows = compileShadowVariants(gl, fresh, scene, camera);
  for (const [object, materials] of shadows) {
    const entry = state.held.get(object);
    if (entry) for (const program of shadowPrograms(gl, materials)) entry.programs.add(program);
  }
  uploadHeldTextures(gl, state);
}

/**
 * Compile every held renderable that has not been compiled for `target` yet
 * (or only `only`), with ONE `compile(scene)` call: a per-object call walks
 * the whole scene for its lights each time, and a 108-mesh hold did that 324
 * times in one frame. Programs already linked come back from three's cache
 * at no cost; the held ones start linking in parallel.
 */
function compileHeld(
  gl: WebGLRenderer,
  state: WarmState,
  scene: Scene,
  camera: Camera,
  target: TargetKey,
  only: readonly Object3D[] | null,
): void {
  if (state.held.size === 0) return;
  const due: [Object3D, HeldRenderable][] = [];
  for (const object of only ?? state.held.keys()) {
    const entry = state.held.get(object);
    if (entry && !entry.targets.has(target)) due.push([object, entry]);
  }
  if (due.length === 0) return;
  const compileStarted = warmStatsOn() ? performance.now() : 0;
  try {
    gl.compile(scene, camera);
    if (compileStarted > 0) noteWarmStat('sceneCompiles', 1, performance.now() - compileStarted);
  } catch {
    // Half-built material / lost context: let them draw (first draw compiles).
    for (const [object, entry] of due) dropHeld(state, object, entry);
    return;
  }
  const properties = propertiesOf(gl);
  for (const [object, entry] of due) {
    entry.targets.add(target);
    for (const material of materialsOf(object as Renderable)) {
      const program = properties.get(material).currentProgram;
      if (program) entry.programs.add(program);
    }
  }
}

type SceneRenderHook = (renderer: WebGLRenderer, scene: Scene, camera: Camera, renderTarget: object | null) => void;
const hookedScenes = new WeakSet<Scene>();

function installGuard(gl: WebGLRenderer, scene: Scene): void {
  if (hookedScenes.has(scene)) return;
  hookedScenes.add(scene);
  const host = scene as unknown as { onBeforeRender: SceneRenderHook };
  const previous = host.onBeforeRender;
  host.onBeforeRender = function guardedOnBeforeRender(renderer, drawn, camera, renderTarget) {
    previous.call(this, renderer, drawn, camera, renderTarget);
    const state = warmers.get(renderer);
    if (!state || renderer !== gl) return;
    guardRender(renderer, state, drawn, camera, renderTarget ?? null);
  };
}

/**
 * Run once per frame, before anything renders (the conductor driver's
 * priority −1 `useFrame`): installs the render hook once, stamps the frame
 * and the live flag. Cheap when idle: the hook itself is one map lookup and
 * a clock read outside a warm window with nothing held.
 */
export function guardCompileFrame(gl: WebGLRenderer, scene: Scene, live: boolean): void {
  const state = warmers.get(gl);
  if (!state) return;
  if (!hasParallelCompile(gl)) return;
  if (warmGuardDisabled()) return;
  installGuard(gl, scene);
  if (debugSession() && window.__warmGuard === undefined) {
    const current = state;
    window.__warmGuard = () => {
      const now = performance.now();
      const entries = [...current.held].slice(0, 40).map(([object, entry]) => {
        let ready = 0;
        for (const program of entry.programs) if (typeof program.isReady !== 'function' || program.isReady()) ready += 1;
        let name = object.name;
        for (let node = object.parent; !name && node; node = node.parent) name = node.name;
        const first = [...entry.programs][0] as { name?: string; usedTimes?: number; program?: unknown } | undefined;
        const material = materialsOf(object as Renderable)[0];
        const current = material ? propertiesOf(gl).get(material).currentProgram : undefined;
        return {
          name: name || object.type,
          ageMs: Math.round(now - entry.since),
          targets: entry.targets.size,
          programs: entry.programs.size,
          ready,
          layers: object.layers.mask,
          program: `${first?.name ?? '?'} used=${first?.usedTimes ?? '?'} current=${current === (first as unknown)} mat=${material?.type ?? '-'}:${material?.name ?? ''}`,
        };
      });
      // Program count per shader type (MeshDepthMaterial / MeshDistanceMaterial
      // are the shadow variants): a harness can diff it across a sweep.
      const programs: Record<string, number> = {};
      const shadowKeys: string[] = [];
      for (const program of (gl.info as unknown as { programs?: { type?: string; cacheKey?: string }[] | null }).programs ?? []) {
        const name = program.type ?? '?';
        programs[name] = (programs[name] ?? 0) + 1;
        if (name === 'MeshDepthMaterial' || name === 'MeshDistanceMaterial') shadowKeys.push(program.cacheKey ?? '');
      }
      return { held: current.held.size, released: releasedTotal, log: guardLog.slice(), entries, warmRender: lastWarmRender, programs, shadowKeys };
    };
  }
  state.frame += 1;
  state.live = live;
  // A warm-pass batch is compiled by the renders of ONE frame (each target
  // the scene draws to), then closed; a later batch re-opens it.
  if (state.compilePending) {
    if (state.compileBatchFrame < 0) state.compileBatchFrame = state.frame;
    else if (state.frame > state.compileBatchFrame) state.compilePending = false;
  }
}

/**
 * Warm the scene's new materials for WARM_WINDOW_MS after `active` turns true
 * (a window latching resident or pre-mounted). Shared per renderer, so ten
 * windows latching together run one watcher.
 */
export function useWarmCompile(active: boolean): void {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const warmed = useRef(false);

  useEffect(() => {
    if (!active || warmed.current) return;
    warmed.current = true;
    requestWarm(gl, scene, camera);
  }, [active, gl, scene, camera]);
}
