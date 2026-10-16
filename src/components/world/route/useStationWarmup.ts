'use client';

import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CubeReflectionMapping,
  CubeRefractionMapping,
  DoubleSide,
  EquirectangularReflectionMapping,
  EquirectangularRefractionMapping,
  FrontSide,
  HalfFloatType,
  InstancedMesh,
  Line,
  LinearFilter,
  Mesh,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  NearestFilter,
  OrthographicCamera,
  PMREMGenerator,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  SkinnedMesh,
  Sprite,
  SpriteMaterial,
  UnsignedByteType,
  VSMShadowMap,
  WebGLRenderTarget,
} from 'three';
import type { Camera, Light, Material, Object3D, Side, Texture, ToneMapping, WebGLRenderer } from 'three';
import type { QualityStep } from '@/lib/route-world/quality';
import { useQuality } from './QualityGovernor';
import { useWorldHandoff, useWorldState } from './WorldStateProvider';
import { skipThroughOf, type SkipThrough } from './useScrollConductor';
import { BAND_MAX_BYTES, bandedCandidates, bandedUploadWanted, bandsPending, nextBandedStepBytes, stepBandedUpload } from './content/banded-upload';
import { uncappedFrameMs } from './frame-cap';
import { noteWarmStat, warmStatsOn } from './perf/warm-stats';
import { assertLatchVisible } from './residency-store';
import { N3_TAG_BITS } from './post/n3-tags';

/**
 * Station-window warm-up (W6 round 2: mid-crossing render stalls).
 *
 * The judge's sweeps showed 1–3 s frame gaps at the SAME progress on every
 * run (plaza pulse → roster 0.52–0.82; clouds 0.74; sakura 3.75): the
 * residency windows latch when the hysteretic nearest station flips, i.e.
 * mid-crossing, and the freshly mounted population then pays React commit,
 * GLB parse, texture upload and shader-program compile inside the crossing.
 * Two levers live here, shared by the plaza and the theme window hooks:
 *
 * 1. `useStationLead` — an IDLE lead: when the visitor has rested for
 *    STATION_LEAD_IDLE_MS one station before a window (`from − 1`, or
 *    `to + 1` when approaching from below), the window may latch early, in a
 *    browser idle callback, so the mount cost lands while nothing moves.
 *    Gated on the route being live (never competes with the 10 s readiness
 *    deadline or the reveal) and on the quality ladder (`stationLeadAllowed`).
 *    Round 4 adds a TRAVEL lead under the same gates: moving toward a window
 *    and within STATION_TRAVEL_LEAD of its near edge latches it at once,
 *    measured the same way in both directions (`travelLeadWanted`).
 * 2. `useWarmCompile` — once a window is mounted, compile the scene's new
 *    materials with `renderer.compileAsync` (KHR_parallel_shader_compile when
 *    available) and upload their textures with `renderer.initTexture`, for a
 *    short window while the Suspense content streams in. `compile()` walks
 *    the whole scene (`traverse`, not `traverseVisible`), so hidden or
 *    frustum-culled content is warmed before it first reaches the camera.
 *
 * Honest limits: shadow-pass depth materials are compiled by the shadow map
 * on first use, not by `compile()` — review r5 prepares them without a
 * draw (`compileShadowVariants`: the first-frame warm, the warm-pass scan and
 * the compile guard), so only a shadow-casting line / point, or a renderer
 * without parallel compile, still pays a first-use depth compile; without the parallel-compile extension the compile
 * is synchronous (it still moves the cost to mount time, off the camera's
 * arrival); GLB parse and React commit are unchanged — only the idle lead
 * moves those, and only where a consumer opts in (see the window hooks).
 */

/** Rest time one station before a window before the idle lead may fire. */
export const STATION_LEAD_IDLE_MS = 1200;

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

/**
 * Quality gate for the idle lead (quality.ts stays the only authority: this
 * reads a ladder field, it does not invent a tier). Only rungs that still
 * carry the post stack (0–1) have the headroom to hold a station's population
 * early; lower rungs keep the plain entry latch.
 */
export function stationLeadAllowed(step: QualityStep): boolean {
  return step.post;
}

/** Whether `station` sits exactly one station outside `[from, to]`. */
export function isLeadStation(station: number, from: number, to: number): boolean {
  return station === from - 1 || station === to + 1;
}

/**
 * TRAVEL lead distance, in station units (round 4). The idle lead needs the
 * visitor to rest; a sweep or fling that starts at once mounted the window at
 * its mid-crossing entry latch — the plaza upward sweep from rules mounted
 * the aces window [1,3] at smooth ≈ 3.65 and their first draw froze the frame
 * for 333 ms at 3.44. While the latched direction points AT the window and
 * the position is within this many stations of the window's near edge, the
 * window latches. The measure is symmetric by construction: going down it is
 * `from − position`, going up `position − to`, so station k−1 is warmed at
 * k + 0.6 on the way up exactly as k+1 is at k − 0.6 on the way down.
 */
export const STATION_TRAVEL_LEAD = 1.65;

/** The progress fields the travel lead reads. */
export interface TravelLeadProgress {
  /** Scroll-mapped position (the conductor's `exact`, which leads `smooth`). */
  position: number;
  /** Latched travel direction (−1 up, +1 down, 0 at rest). */
  direction: -1 | 0 | 1;
}

/**
 * Whether a window `[from, to]` should be pre-mounted by the travel lead:
 * the visitor is moving toward it and is within STATION_TRAVEL_LEAD stations
 * of its near edge (inside the window is the entry latch's business).
 */
export function travelLeadWanted(progress: TravelLeadProgress, from: number, to: number): boolean {
  if (progress.direction === 0) return false;
  const distance = progress.direction < 0 ? progress.position - to : from - progress.position;
  return distance > 0 && distance <= STATION_TRAVEL_LEAD + 1e-9;
}

type IdleHandle = { cancel: () => void };

function onIdle(callback: () => void): IdleHandle {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1000 });
    return { cancel: () => window.cancelIdleCallback(id) };
  }
  const id = window.setTimeout(callback, 0);
  return { cancel: () => window.clearTimeout(id) };
}

/**
 * True once the visitor has rested one station ahead of the window (see the
 * module note); latches for the session like the residency it feeds.
 * `enabled` false keeps it permanently false.
 */
export function useStationLead(station: number, from: number, to: number, enabled: boolean): boolean {
  const { conductor } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const quality = useQuality();
  const allowed = enabled && routeSceneLive && stationLeadAllowed(quality);
  const adjacent = isLeadStation(station, from, to);
  const [lead, setLead] = useState(false);

  useEffect(() => {
    if (lead || !allowed || !adjacent) return;
    let idle: IdleHandle | null = null;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        const progress = conductor.progress.current;
        // Still travelling (latched direction, or `exact` not at rest on the
        // lead station): re-arm instead of mounting under a moving camera.
        if (progress.direction !== 0 || !isLeadStation(progress.nearest, from, to)) {
          arm();
          return;
        }
        idle = onIdle(() => setLead(true));
      }, STATION_LEAD_IDLE_MS);
    };
    arm();
    return () => {
      window.clearTimeout(timer);
      idle?.cancel();
    };
  }, [lead, allowed, adjacent, conductor, from, to]);

  // Travel lead (round 4): latch as soon as the visitor heads toward the
  // window and is within STATION_TRAVEL_LEAD of it — both directions alike.
  // Read on the conductor's change channel (every scroll sample), so the
  // commit lands before the next frame, a full station ahead of the entry.
  useEffect(() => {
    if (lead || !allowed) return;
    const check = () => {
      const progress = conductor.progress.current;
      if (!progress) return;
      if (travelLeadWanted({ position: progress.exact, direction: progress.direction }, from, to)) setLead(true);
    };
    check();
    return conductor.subscribe(check);
  }, [lead, allowed, conductor, from, to]);

  return lead;
}

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

const warmers = new WeakMap<WebGLRenderer, WarmState>();

function texturesOf(material: Material, out: Texture[]): void {
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
function routeLive(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('world-route-live');
}

function requestWarm(gl: WebGLRenderer, scene: Object3D, camera: Camera): void {
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

type Renderable = Object3D & { material?: Material | Material[]; isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
type ProgramLike = { isReady?: () => boolean };
type PropertiesLike = { get: (object: object) => { currentProgram?: ProgramLike; __version?: number } };
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

function isRenderable(object: Object3D): object is Renderable {
  const r = object as Renderable;
  return (r.isMesh === true || r.isPoints === true || r.isLine === true || r.isSprite === true) && r.material != null;
}

function propertiesOf(gl: WebGLRenderer): PropertiesLike {
  return (gl as unknown as { properties: PropertiesLike }).properties;
}

function materialsOf(object: Renderable): Material[] {
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
function isStaleProgram(program: ProgramLike): boolean {
  const usedTimes = (program as { usedTimes?: number }).usedTimes;
  return typeof usedTimes === 'number' && usedTimes <= 0;
}

/** Textures the guard could not upload (a throw): never waited on again. */
const uploadFailed = new WeakSet<Texture>();

/**
 * A texture whose current version is on the GPU — or that has nothing to
 * upload yet (no image / version 0: its first render uploads it when the
 * image lands, which no hold could have prevented) or that failed to upload.
 */
function textureOnGpu(gl: WebGLRenderer, texture: Texture): boolean {
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

// ── Staggered mount (review r5, plaza aces) ──────────────────────────────
//
// The plaza upward sweep still froze 550 ms (GPU) + 211 ms (long task) when
// the eight roster aces mounted in ONE commit: eight skinned clones, their
// geometry buffers and textures all reaching the GPU in the same frame. The
// window's content now arrives one member per idle slice: a slice runs only
// when the browser reports at least MOUNT_SLICE_BUDGET_MS of idle time left
// in the frame (or after MOUNT_SLICE_TIMEOUT_MS, so the row always completes
// even under a busy main thread), and every arrival re-opens the warm window
// so the compile guard and the texture slices run over the newcomer before
// it is drawn. Honest limit: the slice gates WHEN a member commits, not what
// its commit costs — one figure's clone + first upload can still exceed 4 ms,
// it is just never eight at once.

/** Idle time a slice needs before it mounts the next member. */
export const MOUNT_SLICE_BUDGET_MS = 4;
/** Longest a slice waits for idle time before mounting anyway. */
export const MOUNT_SLICE_TIMEOUT_MS = 120;

type IdleDeadlineLike = { timeRemaining: () => number; didTimeout: boolean };

/**
 * Schedule `callback` on the next idle slice with at least `budgetMs` left
 * (re-requesting when a slice is too short), or at `timeoutMs` regardless.
 */
export function onIdleSlice(callback: () => void, budgetMs: number, timeoutMs: number): IdleHandle {
  if (typeof window.requestIdleCallback !== 'function') {
    const id = window.setTimeout(callback, 16);
    return { cancel: () => window.clearTimeout(id) };
  }
  const started = performance.now();
  let id = 0;
  const run = (deadline: IdleDeadlineLike) => {
    const waited = performance.now() - started;
    if (deadline.didTimeout || waited >= timeoutMs || deadline.timeRemaining() >= budgetMs) {
      callback();
      return;
    }
    id = window.requestIdleCallback(run, { timeout: Math.max(1, timeoutMs - waited) });
  };
  id = window.requestIdleCallback(run, { timeout: timeoutMs });
  return { cancel: () => window.cancelIdleCallback(id) };
}

/**
 * How many of `count` members may be mounted: 0 while `active` is false,
 * then one more per idle slice until all are. Each arrival re-opens the warm
 * window (compile guard + texture slices) for the newcomer.
 */
export function useStaggeredMount(count: number, active: boolean): number {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const [mounted, setMounted] = useState(0);

  useEffect(() => {
    if (!active || mounted >= count) return;
    const handle = onIdleSlice(
      () => {
        requestWarm(gl, scene, camera);
        setMounted((current) => Math.min(count, current + 1));
      },
      MOUNT_SLICE_BUDGET_MS,
      MOUNT_SLICE_TIMEOUT_MS,
    );
    return () => handle.cancel();
  }, [active, mounted, count, gl, scene, camera]);

  return active ? Math.min(mounted, count) : 0;
}

// ── Skip-through window gate (wave 2, W6 residual 1) ───────────────────────
//
// A nav-chip jump lands the nearest station on the target in one sample, so
// every window containing the target used to latch at once, mid-flight — the
// plaza pulse → schedule jump froze 250–267 ms as the roster/teams
// populations it only skims past mounted. While the conductor's skip-through
// (`skipThroughOf`) is in flight each window is classified once per jump by
// the station its population belongs to (`windowStation`):
// - `target` — the jump's target: latches once `smooth` has covered
//   SKIP_APPROACH of the jump, through the shared latch queue (one window per
//   idle slice, at least a frame apart; the compile guard and the warm
//   window then hold and warm it before its first draw);
// - `passed` — strictly between the start and the target: never latches
//   during the jump, nor at its landing. It resumes latching (queued) when
//   the visitor's station changes, or (so the residency the control capture
//   expects still arrives) after resting STATION_LEAD_IDLE_MS on the landing
//   station with the route live — through the same queue, never a burst;
// - `other` (a prefetch window beyond the target, or one behind the start) —
//   held until the jump ends, then queued.
// A jump released by visitor input (wheel / touch / key, or a scroll off the
// target) is no longer a skip: the camera resumes flying the real path, so
// every held or passed window that wants to latch is queued at once — normal
// latching, minus the burst. A second chip click re-aims: the new jump
// re-classifies every window.
//
// Honest limits: the classification is by ONE station per window, supplied
// by the window hook (plaza: `from + 1`, its C-089 one-station-lead contract;
// themes: `from`). A population that belongs to several stations (a window
// sized for content seen from two of them) is gated by the one it names.
// The gate moves WHEN a latch commits, not what that commit costs.

/** A window's role in the skip in flight. */
export type SkipWindowRole = 'target' | 'passed' | 'other';

/** Classify a window's station against a jump from `from` (smooth) to `to`. */
export function skipWindowRole(from: number, to: number, windowStation: number): SkipWindowRole {
  if (windowStation === to) return 'target';
  const start = Math.round(from);
  const lo = Math.min(start, to);
  const hi = Math.max(start, to);
  return windowStation > lo && windowStation < hi ? 'passed' : 'other';
}

/**
 * Gate modes: `free` = latching is the window's own business (open);
 * `target` / `held` / `passed` = closed for the jump in flight (see above);
 * `queued` = waiting for its turn in the latch queue.
 */
export type SkipGateMode = 'free' | 'target' | 'held' | 'passed' | 'queued';

export interface SkipGateState {
  mode: SkipGateMode;
  /** The skip token this state has classified (or adopted). */
  token: number;
  /** The station a `passed` window was skipped at (the jump's target). */
  landing: number;
}

/** The skip-through fields the gate reads. */
export type SkipView = Pick<SkipThrough, 'token' | 'active' | 'approaching' | 'from' | 'to' | 'end'>;

export interface SkipGateInput {
  skip: SkipView;
  /** The window would latch now without the gate (entry or lead). */
  want: boolean;
  /** Already latched: nothing left to gate. */
  done: boolean;
  /** The visitor's nearest station. */
  station: number;
  /** The station this window's population belongs to. */
  windowStation: number;
}

/** Initial gate for a window mounting now (an active skip is classified on the first step). */
export function initSkipGate(skip: SkipView): SkipGateState {
  return { mode: 'free', token: skip.active ? -1 : skip.token, landing: skip.to };
}

/**
 * One pure step of the gate. Idempotent — stepping its own output again
 * returns that same object — and it returns `state` itself when nothing
 * changes, so a hook can derive it during render and commit it in an effect.
 */
export function stepSkipGate(state: SkipGateState, input: SkipGateInput): SkipGateState {
  const { skip } = input;
  if (input.done) {
    return state.mode === 'free' && state.token === skip.token ? state : { mode: 'free', token: skip.token, landing: state.landing };
  }
  let s = state;
  if (skip.token !== s.token) {
    if (skip.active) {
      const role = skipWindowRole(skip.from, skip.to, input.windowStation);
      s = { mode: role === 'other' ? 'held' : role, token: skip.token, landing: skip.to };
    } else {
      // A jump that began and ended between two reads: adopt it; any gate
      // still closed for an older jump resolves below as ended.
      s = { ...s, token: skip.token };
    }
  }
  const ended = !skip.active;
  switch (s.mode) {
    case 'target':
      if (!ended && !skip.approaching) return s;
      return { ...s, mode: input.want ? 'queued' : 'free' };
    case 'held':
      if (!ended) return s;
      return { ...s, mode: input.want ? 'queued' : 'free' };
    case 'passed':
      if (!ended) return s;
      // Released mid-flight: the camera flies the real path through this
      // station after all — resume normally (queued, no burst).
      if (skip.end !== 'landed') return { ...s, mode: input.want ? 'queued' : 'free' };
      // Landed: stay closed until the visitor moves on (or the rest latch),
      // then queue — several skipped windows resuming on one station change
      // must not commit together.
      if (input.station !== s.landing) return { ...s, mode: input.want ? 'queued' : 'free' };
      return s;
    default:
      return s;
  }
}

/** Whether the gate lets the window latch now. */
export function skipGateOpen(state: SkipGateState): boolean {
  return state.mode === 'free';
}

// The shared latch queue: one granted window per idle slice, and at least a
// frame between two grants, so the commits (and first draws) of windows that
// resume together never share a frame.
const latchQueue: Array<() => void> = [];
let latchPump: IdleHandle | null = null;
let latchFrameWait = false;

function nextFrame(callback: () => void): void {
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => callback());
  else window.setTimeout(callback, 16);
}

function pumpLatchQueue(): void {
  if (latchPump || latchFrameWait || latchQueue.length === 0) return;
  latchPump = onIdleSlice(
    () => {
      latchPump = null;
      const job = latchQueue.shift();
      job?.();
      latchFrameWait = true;
      nextFrame(() => {
        latchFrameWait = false;
        pumpLatchQueue();
      });
    },
    MOUNT_SLICE_BUDGET_MS,
    MOUNT_SLICE_TIMEOUT_MS,
  );
}

/** Queue one window latch; returns a cancel (a no-op once granted). */
export function enqueueWindowLatch(grant: () => void): () => void {
  const job = () => grant();
  latchQueue.push(job);
  pumpLatchQueue();
  return () => {
    const index = latchQueue.indexOf(job);
    if (index >= 0) latchQueue.splice(index, 1);
  };
}

/** Queued (not yet granted) window latches — a debug readout and a test hook. */
export function queuedWindowLatches(): number {
  return latchQueue.length;
}

export function resetWindowLatchQueueForTests(): void {
  latchQueue.length = 0;
  latchPump?.cancel();
  latchPump = null;
  latchFrameWait = false;
}

/**
 * The skip-through gate of one residency window (see the section note).
 * `want` is the window's own latch condition (entry or lead), `done` whether
 * it has latched. Returns whether it may latch now plus the gate mode for
 * the windows' diagnosis readouts.
 */
export function useSkipGate(
  windowStation: number,
  want: boolean,
  done: boolean,
  station: number,
): { open: boolean; mode: SkipGateMode } {
  const { conductor } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const [skip, setSkip] = useState<SkipView>(() => skipThroughOf(conductor.progress.current));
  // Same change channel as the station index: the jump sample marks the skip
  // before notifying, so the skip and the jumped station arrive in ONE commit.
  useEffect(() => {
    const read = () => {
      const next = skipThroughOf(conductor.progress.current);
      setSkip((current) => (current === next ? current : next));
    };
    read();
    return conductor.subscribe(read);
  }, [conductor]);

  const [gate, setGate] = useState<SkipGateState>(() => initSkipGate(skip));
  const next = stepSkipGate(gate, { skip, want, done, station, windowStation });
  // Derived during render (React's "adjust state while rendering" pattern):
  // the step is idempotent, so this settles in one extra render pass and the
  // caller's latch effect never sees a stale open gate.
  if (next !== gate) setGate(next);

  // Queued: wait for a grant from the shared latch queue.
  const queued = next.mode === 'queued';
  useEffect(() => {
    if (!queued) return;
    return enqueueWindowLatch(() => setGate((g) => (g.mode === 'queued' ? { ...g, mode: 'free' } : g)));
  }, [queued]);

  // Rest latch for a window the jump skipped: after STATION_LEAD_IDLE_MS at
  // rest on the landing station (route live), queue it like any other.
  const restArmed = next.mode === 'passed' && !skip.active && routeSceneLive;
  const restToken = next.token;
  const restStation = next.landing;
  useEffect(() => {
    if (!restArmed) return;
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        const progress = conductor.progress.current;
        if (progress.direction !== 0 || progress.nearest !== restStation || skipThroughOf(progress).active) {
          arm();
          return;
        }
        setGate((g) => (g.mode === 'passed' && g.token === restToken ? { ...g, mode: 'queued' } : g));
      }, STATION_LEAD_IDLE_MS);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [restArmed, restToken, restStation, conductor]);

  return { open: skipGateOpen(next), mode: next.mode };
}

// ── Shadow-variant warm (review r5, W6 (a)) ──────────────────────────────
//
// `compile()` builds each material's MAIN-pass program only. The shadow pass
// draws casters with its own depth / distance materials, whose programs vary
// per caster (skinning, morph targets, instancing, alpha-test map, side), and
// three builds them on first DRAW — a synchronous link inside the frame: the
// r4 traces measured 25–52 ms per variant after the reveal, and a first try at
// this round (one forced draw of the whole scene, hidden content shown, into a
// 1×1 target) blocked the plaza's hidden canvas for 9.7 s on 11 new variants.
//
// So the variants are built the way `compile()` builds main-pass programs —
// without drawing: for every shadow caster a proxy (same geometry, same
// skinned / instanced kind) carries the exact depth material the shadow map
// would derive for it (`WebGLShadowMap.getDepthMaterial`: side, alpha map /
// test, map, displacement, clipping), and ONE `compile(proxies, camera,
// scene)` against the real scene's lights prepares them. Under
// KHR_parallel_shader_compile that is non-blocking; the program cache is
// keyed on the parameters, so the shadow pass's own material later picks up
// the already-linked program. Proxies are deduplicated by variant, and their
// materials are kept (never disposed — a dispose would release the shared
// program before the shadow pass ever used it).
//
// Three callers: the first-frame warm (every caster in the scene, hidden
// pre-mounts included — `programsWarm` then waits for them to link, bounded by
// the reveal cap), the warm-pass scan (casters of freshly seen materials,
// before a pre-mounted group is shown) and the compile guard (a held
// newcomer is released only once its shadow programs are linked too).
// Without the parallel-compile extension nothing is pre-built (the compile
// itself would block); only meshes are covered (shadow-casting lines and
// points keep first-use compiles).

/** Debug readout of the first-frame shadow warm (`window.__warmGuard`). */
export interface WarmRenderReport {
  ms: number;
  programsBefore: number;
  programsAfter: number;
  casters: number;
  variants: number;
}

let lastWarmRender: WarmRenderReport | null = null;

/** The renderer surface the shadow warm touches (a WebGLRenderer fits). */
export type ShadowWarmRenderer = Pick<
  WebGLRenderer,
  'compile' | 'getRenderTarget' | 'setRenderTarget' | 'getActiveCubeFace' | 'getActiveMipmapLevel' | 'shadowMap' | 'info' | 'properties'
>;

/** Per renderer: the 1×1 target a screen-time compile borrows (never drawn into). */
const warmTargets = new WeakMap<object, WebGLRenderTarget>();

function programCount(gl: Pick<WebGLRenderer, 'info'>): number {
  return ((gl.info as unknown as { programs?: unknown[] | null }).programs ?? []).length;
}

const SHADOW_SIDE: Record<number, Side> = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };

type ShadowBase = 'depth' | 'distance';
type DepthLike = MeshDepthMaterial | MeshDistanceMaterial;

/** Per renderer: variant key → the kept proxy material. */
const shadowVariants = new WeakMap<object, Map<string, Material>>();

/** Which shadow materials the scene's casting lights need (effectively visible lights). */
function shadowBases(scene: Object3D): ShadowBase[] {
  let depth = false;
  let distance = false;
  scene.traverseVisible((object) => {
    const light = object as Light & { isPointLight?: boolean };
    if (light.isLight !== true || !light.castShadow) return;
    if (light.isPointLight === true) distance = true;
    else depth = true;
  });
  const bases: ShadowBase[] = [];
  if (depth) bases.push('depth');
  if (distance) bases.push('distance');
  return bases;
}

type ShadowCaster = Mesh & {
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  instanceColor?: InstancedMesh['instanceColor'];
  morphTexture?: InstancedMesh['morphTexture'];
  customDepthMaterial?: Material;
  customDistanceMaterial?: Material;
};

type SourceMaterial = Material & {
  alphaMap?: Texture | null;
  map?: Texture | null;
  displacementMap?: Texture | null;
  displacementScale?: number;
  displacementBias?: number;
  wireframe?: boolean;
  wireframeLinewidth?: number;
  linewidth?: number;
};

function textureKey(texture: Texture | null | undefined): string {
  if (!texture) return '-';
  return `${texture.channel}${(texture as Texture & { isVideoTexture?: boolean }).isVideoTexture ? 'v' : ''}`;
}

/** The variant key: everything the shadow program's cache key can see. */
function shadowVariantKey(caster: ShadowCaster, material: SourceMaterial, base: ShadowBase, vsm: boolean, custom: Material | undefined): string {
  const geometry = caster.geometry;
  const morph = geometry.morphAttributes;
  const kind = caster.isSkinnedMesh
    ? 'skin'
    : caster.isInstancedMesh
      ? `inst${caster.instanceColor ? 'c' : ''}${caster.morphTexture ? 'm' : ''}`
      : 'mesh';
  const side = material.shadowSide !== null ? material.shadowSide : vsm ? material.side : SHADOW_SIDE[material.side];
  const alphaTest = material.alphaToCoverage === true ? 0.5 : material.alphaTest;
  // three r185 folds the presence of position (hasPositionAttribute) and
  // normal (vertexNormals) into every program key, depth programs included.
  const attributes = ['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3']
    .filter((name) => geometry.getAttribute(name) !== undefined)
    .join('');
  return [
    base,
    kind,
    custom ? `custom:${custom.uuid}` : '',
    side,
    alphaTest > 0 ? 'at' : '',
    textureKey(material.alphaMap),
    textureKey(material.map),
    material.displacementMap && material.displacementScale !== 0 ? 'disp' : '',
    Object.entries(morph as Record<string, readonly unknown[] | undefined>)
      .map(([name, list]) => `${name}${list?.length ?? 0}`)
      .join(','),
    geometry.morphTargetsRelative ? 'rel' : '',
    attributes,
    material.clipShadows && Array.isArray(material.clippingPlanes) ? material.clippingPlanes.length : 0,
  ].join('|');
}

/** The depth material the shadow map would derive for `material` (getDepthMaterial). */
function deriveShadowMaterial(material: SourceMaterial, base: ShadowBase, vsm: boolean): DepthLike {
  const result: DepthLike = base === 'distance' ? new MeshDistanceMaterial() : new MeshDepthMaterial();
  result.visible = material.visible;
  // `wireframe` is draw state (not part of the program key); set where it exists.
  (result as DepthLike & { wireframe?: boolean }).wireframe = material.wireframe === true;
  result.side = material.shadowSide !== null ? material.shadowSide : vsm ? material.side : SHADOW_SIDE[material.side];
  result.alphaMap = material.alphaMap ?? null;
  result.alphaTest = material.alphaToCoverage === true ? 0.5 : material.alphaTest;
  result.map = material.map ?? null;
  result.clipShadows = material.clipShadows;
  result.clippingPlanes = material.clippingPlanes;
  result.clipIntersection = material.clipIntersection;
  result.displacementMap = material.displacementMap ?? null;
  result.displacementScale = material.displacementScale ?? 1;
  result.displacementBias = material.displacementBias ?? 0;
  return result;
}

/** A proxy of `caster`'s kind carrying `material` (same geometry; never drawn). */
function shadowProxy(caster: ShadowCaster, material: Material): Mesh {
  if (caster.isSkinnedMesh) {
    const proxy = new SkinnedMesh(caster.geometry, material);
    return proxy;
  }
  if (caster.isInstancedMesh) {
    const proxy = new InstancedMesh(caster.geometry, material, 1);
    proxy.instanceColor = caster.instanceColor ?? null;
    proxy.morphTexture = caster.morphTexture ?? null;
    return proxy;
  }
  return new Mesh(caster.geometry, material);
}

/**
 * Prepare (never draw) the shadow-pass programs of `casters` against
 * `scene`'s lights. Returns, per caster, the kept proxy materials whose
 * `currentProgram` is the variant the shadow pass will use. Empty when the
 * renderer has no parallel compile, shadows are off, or nothing casts.
 */
export function compileShadowVariants(
  gl: ShadowWarmRenderer,
  casters: Iterable<Object3D>,
  scene: Object3D,
  camera: Camera,
): Map<Object3D, Material[]> {
  const out = new Map<Object3D, Material[]>();
  if (gl.shadowMap?.enabled !== true) return out;
  const bases = shadowBases(scene);
  if (bases.length === 0) return out;
  const statsStarted = warmStatsOn() ? performance.now() : 0;
  const vsm = gl.shadowMap.type === VSMShadowMap;
  let variants = shadowVariants.get(gl);
  if (!variants) {
    variants = new Map();
    shadowVariants.set(gl, variants);
  }
  const proxies = new Scene();
  for (const object of casters) {
    const caster = object as ShadowCaster;
    if (caster.isMesh !== true || caster.isBatchedMesh === true || !caster.castShadow || !caster.material) continue;
    const materials = (Array.isArray(caster.material) ? caster.material : [caster.material]) as SourceMaterial[];
    const kept: Material[] = [];
    for (const material of materials) {
      if (!material.visible) continue;
      for (const base of bases) {
        const custom = base === 'distance' ? caster.customDistanceMaterial : caster.customDepthMaterial;
        const key = shadowVariantKey(caster, material, base, vsm, custom);
        let proxyMaterial = variants.get(key);
        if (!proxyMaterial) {
          proxyMaterial = custom ?? deriveShadowMaterial(material, base, vsm);
          variants.set(key, proxyMaterial);
          proxies.add(shadowProxy(caster, proxyMaterial));
        }
        kept.push(proxyMaterial);
      }
    }
    if (kept.length > 0) out.set(caster, kept);
  }
  if (statsStarted > 0) noteWarmStat('shadowCasters', out.size);
  if (proxies.children.length === 0) {
    if (statsStarted > 0) noteWarmStat('shadowVariantCalls', 1, performance.now() - statsStarted);
    return out;
  }
  // Match the shadow pass's program key exactly (verified against live cache
  // keys): it draws into the shadow maps — a render target, so linear output
  // and no tone mapping, with the renderer's own output colour space left as
  // is — and with a null scene, so no fog. On the screen target a 1×1 target
  // is bound for the compile and the previous binding restored (the shadow
  // pass itself re-binds targets the same way inside a render); the scene's
  // fog is lifted for the compile's duration only.
  const previous = gl.getRenderTarget();
  const cubeFace = gl.getActiveCubeFace();
  const mipLevel = gl.getActiveMipmapLevel();
  const host = scene as Scene;
  const fog = host.fog;
  let target: WebGLRenderTarget | null = null;
  if (previous === null) {
    target = warmTargets.get(gl) ?? new WebGLRenderTarget(1, 1);
    warmTargets.set(gl, target);
  }
  try {
    if (target) gl.setRenderTarget(target);
    host.fog = null;
    gl.compile(proxies, camera, host);
  } catch {
    // Half-built material / lost context: the shadow pass compiles on first use.
  } finally {
    host.fog = fog;
    if (target) gl.setRenderTarget(previous, cubeFace, mipLevel);
  }
  if (statsStarted > 0) noteWarmStat('shadowVariantCalls', 1, performance.now() - statsStarted);
  return out;
}

/** Shadow programs of `materials` (kept proxies), as compiled. */
function shadowPrograms(gl: Pick<WebGLRenderer, 'properties'>, materials: readonly Material[]): ProgramLike[] {
  const properties = gl.properties as unknown as PropertiesLike;
  const programs: ProgramLike[] = [];
  for (const material of materials) {
    const program = properties.get(material).currentProgram;
    if (program) programs.push(program);
  }
  return programs;
}

/**
 * The first-frame shadow warm: every caster in the scene — hidden pre-mounted
 * content included — gets its shadow variants prepared (non-blocking).
 */
export function warmShadowVariants(gl: ShadowWarmRenderer, scene: Object3D, camera: Camera): WarmRenderReport {
  const started = performance.now();
  const programsBefore = programCount(gl);
  const casters: Object3D[] = [];
  scene.traverse((object) => {
    if ((object as Mesh).isMesh === true && object.castShadow) casters.push(object);
  });
  const prepared = compileShadowVariants(gl, casters, scene, camera);
  const variants = new Set<Material>();
  for (const list of prepared.values()) for (const material of list) variants.add(material);
  lastWarmRender = {
    ms: Math.round(performance.now() - started),
    programsBefore,
    programsAfter: programCount(gl),
    casters: prepared.size,
    variants: variants.size,
  };
  return lastWarmRender;
}

// ── Programs-warm signal (review r4, the W7 reveal gate's input) ─────────
//
// The r3 loader traces froze the reveal beam for 0.5–1.4 s: ~550 ms after
// `routeSceneLive` the EffectComposer's render hit `onFirstUse` →
// `getProgramInfoLog` on programs that were still linking. The conductor
// driver now opens a warm window on the FIRST frame of every canvas (before
// the reveal can arm), so the whole scene — hidden pre-mounts included — is
// compiled for every render target the frame draws to (the post stack's
// buffer as well as the screen). `programsWarm` then reports when that work
// has landed: a warm scan has run, its compile batch closed, its texture
// queue drained, every program the renderer knows reports ready
// (`isReady`, a non-blocking COMPLETION_STATUS poll) and the program count
// has not changed for PROGRAMS_WARM_STABLE_FRAMES frames. It latches per
// renderer; content that streams in later is the compile guard's business.

/** Frames the renderer's program count must hold still before `programsWarm`. */
export const PROGRAMS_WARM_STABLE_FRAMES = 2;

export interface ProgramsWarmTrack {
  count: number;
  stable: number;
  warm: boolean;
}

export function createProgramsWarmTrack(): ProgramsWarmTrack {
  return { count: -1, stable: 0, warm: false };
}

/**
 * One frame of the programs-warm latch (pure; unit-tested). `count` is the
 * renderer's program count this frame, `allReady` whether every program
 * reports linked, `warmDone` whether the warm pass has scanned and drained.
 */
export function stepProgramsWarm(
  track: ProgramsWarmTrack,
  count: number,
  allReady: boolean,
  warmDone: boolean,
): boolean {
  if (track.warm) return true;
  if (count !== track.count) {
    track.count = count;
    track.stable = 0;
  } else {
    track.stable += 1;
  }
  if (warmDone && allReady && track.stable >= PROGRAMS_WARM_STABLE_FRAMES) track.warm = true;
  return track.warm;
}

let programsTrackGl: WebGLRenderer | null = null;
let programsTrack = createProgramsWarmTrack();
/** The first-frame shadow warm (`warmShadowVariants`) has run for the tracked renderer. */
let programsWarmRendered = false;
const programsListeners = new Set<() => void>();

/** The current renderer's shader programs are compiled and linked (see above). */
export function getProgramsWarm(): boolean {
  return programsTrack.warm;
}

/** Notified when `getProgramsWarm()` changes (latch, or a new renderer). */
export function subscribeProgramsWarm(listener: () => void): () => void {
  programsListeners.add(listener);
  return () => {
    programsListeners.delete(listener);
  };
}

function emitProgramsWarm(): void {
  for (const listener of [...programsListeners]) listener();
}

/**
 * Per frame, from the conductor driver: track the renderer and advance the
 * programs-warm latch (trace only).
 *
 * D23: this no longer ARMS anything. It used to open a warm window on the
 * first frame of every renderer (a whole-scene `compile` on the first render
 * and a whole-scene shadow-variant compile) — exactly the large synchronous
 * batches that stalled the GPU process and froze the ceremony on ANGLE. The
 * load warm ceremony (`stepLoadWarm`, driven by RouteWorldCanvas) now does
 * that work in per-frame slices, and its completion (`markLoadWarmComplete`)
 * is what feeds this latch: the whole warm pass has run, so `warmDone`.
 */
export function noteProgramsFrame(gl: WebGLRenderer, _scene: Object3D, _camera: Camera): void {
  if (programsTrackGl !== gl) {
    const wasWarm = programsTrack.warm;
    programsTrackGl = gl;
    programsTrack = createProgramsWarmTrack();
    programsWarmRendered = false;
    if (wasWarm) emitProgramsWarm();
    return;
  }
  if (programsTrack.warm) return;
  const warmDone = programsWarmRendered;
  const programs = (gl.info as unknown as { programs?: ProgramLike[] | null }).programs ?? [];
  let allReady = true;
  for (const program of programs) {
    if (typeof program.isReady === 'function' && !program.isReady()) {
      allReady = false;
      break;
    }
  }
  if (stepProgramsWarm(programsTrack, programs.length, allReady, warmDone)) emitProgramsWarm();
}

/** Tests only: forget the tracked renderer. */
export function resetProgramsWarmForTests(): void {
  programsTrackGl = null;
  programsTrack = createProgramsWarmTrack();
  programsWarmRendered = false;
}

// ── Load warm ceremony (D23 "complete at reveal", LOOK-PLAN §2 G3) ─────────
//
// Owner, verbatim: "I don't want anything to stream in after the world
// appears, that's what the pokeball loading animation is for". Every
// program, shadow variant, post pass and texture upload the session can need
// lands during the ceremony, in ONE ordered pass per scene generation:
//
//   1. prepare  — the registered pre-compile hooks (`registerWarmPrepare`:
//                 the plaza's paint sweep, station-0 light / shadow-fit /
//                 calm-rect uniforms), every frame before any compile, so a
//                 material is patched before its first compile;
//   2. compile  — every renderable's program, sliced: proxies (same
//                 geometry, same object kind) compiled against the real
//                 scene's lights into a scratch render target (the composer's
//                 variant: linear output, no tone mapping), a few new
//                 programs per frame, never more than a few links in flight;
//                 repeated for whatever mounts until the content is complete
//                 (assets idle AND residency complete);
//   3. shadows  — every caster's shadow-pass variants at the final map,
//                 sliced by caster (`compileShadowVariants`);
//   4. textures — `initTexture` for every scene texture, sliced under
//                 GUARD_TEXTURE_BUDGET_MS per frame (PMREM is built by the
//                 compile that first sees the environment);
//   5. passes   — every post pass the start rung and the rungs below it can
//                 draw (`registerWarmPostPass`, filtered by
//                 `postPassesFrom`): pre-compiled, then rendered once into a
//                 small target — a governor step later only flips `.enabled`;
//   6. poses    — one offscreen render per frozen station pose at quarter
//                 resolution, one pose per frame (flushes skinning,
//                 instancing and UBO state; first-use of every drawn range);
//   7. frame    — the renderer's first real frame (held until now);
//   8. settle   — the program count holds still for
//                 PROGRAMS_WARM_STABLE_FRAMES frames with nothing linking and
//                 nothing left to upload: warm.
//
// Milestones: `compiled` rises when 2, 3 and 5 are done and linked,
// `uploaded` when 4 and 6 are done; `warm` gates the reveal. The ANGLE box
// freezes even CSS animations on large synchronous compile/upload batches
// (wave-2 residual), so EVERY stage is a per-frame slice: the ceremony keeps
// animating while the work drains. The compile guard stays as the safety net
// and is idle at reveal (the warm seeds its state, `seedStationWarm`).

/** The ordered stages of the load warm (see the section note). */
export const LOAD_WARM_STAGES = ['compile', 'shadows', 'verify', 'textures', 'buffers', 'passes', 'poses', 'frame', 'settle', 'done'] as const;
export type LoadWarmStage = (typeof LOAD_WARM_STAGES)[number];

/**
 * New programs one compile slice may add in a frame (ENGINE r2). Under
 * KHR_parallel_shader_compile the ANGLE / D3D11 links run on GPU-process
 * worker threads (a Chrome trace shows 0.5-1.3 s worker tasks per program),
 * so throughput scales with the links in flight; but a cold burst of many
 * links still starves the compositor (r2 harness: 16 at once froze the
 * screencast 0.8-0.96 s). So the number in flight is an adaptive cap
 * (`stepLinkCap`) under WARM_MAX_LINKS_IN_FLIGHT.
 */
export const WARM_NEW_PROGRAMS_PER_FRAME = 4;
/** Main-thread budget of one compile slice (at least one variant per frame). */
export const WARM_COMPILE_BUDGET_MS = 12;
/** No new compiles are issued while this many programs are still linking. */
export const WARM_MAX_LINKS_IN_FLIGHT = 12;
/** A frame interval this long means the GPU process is busy: issue one program at most. */
export const WARM_FRAME_SLOW_MS = 50;
/** A frame interval this long means it is stalled: issue nothing while links are in flight. */
export const WARM_FRAME_STALLED_MS = 120;

/** The link cap a load starts from (see `stepLinkCap`). */
export const WARM_LINK_CAP_START = 3;
/** A frame interval this short counts as smooth for the link-cap ramp. */
export const WARM_FRAME_SMOOTH_MS = 30;
/** Smooth frames in a row before the link cap grows by 1. */
export const WARM_LINK_CAP_RAMP_FRAMES = 3;

export interface LinkCapState {
  cap: number;
  smooth: number;
}

export function createLinkCap(): LinkCapState {
  return { cap: WARM_LINK_CAP_START, smooth: 0 };
}

/**
 * One frame of the adaptive link cap (pure, additive-increase /
 * multiplicative-decrease). r2 harness traces: 16 programs issued in the
 * first frames froze the screencast 0.96 s, 8 kept it under 0.25 s but
 * compiled the plaza in 5 s. So the cap starts at WARM_LINK_CAP_START, grows
 * by 1 after WARM_LINK_CAP_RAMP_FRAMES smooth frames in a row, up to
 * WARM_MAX_LINKS_IN_FLIGHT, and halves (never below 2) on a slow frame: a
 * device whose GPU process keeps up compiles fast, one that does not keeps
 * its ceremony smooth.
 */
export function stepLinkCap(state: LinkCapState, frameIntervalMs: number): LinkCapState {
  if (frameIntervalMs >= WARM_FRAME_SLOW_MS) return { cap: Math.max(2, Math.ceil(state.cap / 2)), smooth: 0 };
  if (frameIntervalMs >= WARM_FRAME_SMOOTH_MS) return state.smooth === 0 ? state : { cap: state.cap, smooth: 0 };
  const smooth = state.smooth + 1;
  if (smooth < WARM_LINK_CAP_RAMP_FRAMES) return { cap: state.cap, smooth };
  return { cap: Math.min(WARM_MAX_LINKS_IN_FLIGHT, state.cap + 1), smooth: 0 };
}

/**
 * How many NEW programs the warm may issue this frame (pure): at most
 * WARM_NEW_PROGRAMS_PER_FRAME, never past `cap` links in flight (the adaptive
 * cap, `stepLinkCap`), one on a slow frame, and on a stalled frame one only
 * when nothing is linking (the load always moves on).
 */
export function warmLinkBudget(frameIntervalMs: number, inFlight: number, cap: number = WARM_MAX_LINKS_IN_FLIGHT): number {
  const room = Math.min(cap, WARM_MAX_LINKS_IN_FLIGHT) - inFlight;
  if (room <= 0) return 0;
  if (frameIntervalMs >= WARM_FRAME_STALLED_MS) return inFlight === 0 ? 1 : 0;
  if (frameIntervalMs >= WARM_FRAME_SLOW_MS) return 1;
  return Math.min(WARM_NEW_PROGRAMS_PER_FRAME, room);
}
/**
 * ENGINE-FIX (D32): the warm's budgets behind the OPAQUE theme veil. The
 * per-frame slices, the GPU fence and the link cap exist to keep a VISIBLE
 * ceremony smooth (the compositor shares the ANGLE GPU main thread with the
 * warm); under the veil there is nothing to keep smooth — a static sheet in
 * the page colour — and every millisecond is the visitor's wait. So the host
 * runs several warm steps per frame (`frameBudgetMs` of main thread), the
 * fence is not waited on, and more links are issued per step. The fade-in
 * and fade-out themselves are compositor transitions of an idle page: no
 * warm step runs during either.
 */
export const VEILED_WARM = {
  /** Main-thread ms of warm steps per animation frame. */
  frameBudgetMs: 40,
  /** Programs linking at once. */
  maxLinksInFlight: 32,
  /** New programs one step may issue. */
  newProgramsPerStep: 12,
  /** First-drawn executables one `buffers` step may carry (and one draw). */
  freshDrawsPerStep: 8,
  freshPerDraw: 4,
} as const;

/** How many new programs a veiled warm step may issue (pure). */
export function veiledLinkBudget(inFlight: number): number {
  return Math.max(0, Math.min(VEILED_WARM.newProgramsPerStep, VEILED_WARM.maxLinksInFlight - inFlight));
}

/** Casters per shadow-variant slice. */
export const WARM_SHADOW_CASTERS_PER_FRAME = 24;
/** Station pose renders run at this fraction of the drawing buffer (each axis). */
export const WARM_POSE_SCALE = 0.25;
/** Longest one program may be waited on before the warm moves on (bounded). */
export const WARM_LINK_MAX_MS = 5000;
/**
 * Geometry bytes one `buffers` slice may upload. r2 probes: the first pose
 * render uploaded every buffer in view at once, a 0.4-0.66 s task and a
 * 0.28 s compositor stall; slices of this size stay frame-sized (3 MB still
 * showed 0.3-0.4 s periodic-film gaps in the dark harness runs).
 */
export const WARM_BUFFER_BYTES_PER_FRAME = 1.5 * 1024 * 1024;
/**
 * R6: texel bytes one `textures` (or data-face) step may upload. The step was
 * budgeted by main-thread time only (GUARD_TEXTURE_BUDGET_MS), but an
 * ImageBitmap / canvas `texImage2D` costs the main thread almost nothing
 * while the GPU main thread pays the copy and the mip build (the R6 plaza
 * trace: four ~33 ms `WebGL` tasks issued in ONE step, 135 ms back to back —
 * a 150-215 ms compositor and rAF gap in the harness runs). With a byte
 * budget, the GPU fence (`gpuIdle`) spaces the uploads: at least one
 * texture per step, never more than this much behind it.
 */
export const WARM_TEXTURE_BYTES_PER_STEP = 3 * 1024 * 1024;
/**
 * ENGINE-FIX A2 (loading cadence): the texel budget of a step taken while
 * programs are still linking (the compile stage's `uploadWhileLinking`). The
 * GPU main thread then also runs the links' shader translations, so a
 * 3 MiB copy + mip build behind one stacked into a single compositor-starving
 * GPU task; next to a link the step carries at most this much (at least one
 * texture, as ever). Not behind the theme veil (nothing to keep smooth).
 */
export const WARM_TEXTURE_BYTES_WHILE_LINKING = 1024 * 1024;

/**
 * R6: an estimate of the bytes one texture upload moves to the GPU (its
 * base level, plus a third for generated mips): compressed levels as
 * stored, data textures as their typed array, image sources at 4 bytes per
 * texel. Pure; unknown shapes count as 0 (they never block a step).
 */
export function textureUploadBytes(texture: Texture): number {
  const t = texture as Texture & {
    isCompressedTexture?: boolean;
    isRenderTargetTexture?: boolean;
    mipmaps?: { data?: { byteLength?: number } }[];
  };
  if (t.isRenderTargetTexture === true) return 0;
  if (t.isCompressedTexture === true) {
    let bytes = 0;
    for (const level of t.mipmaps ?? []) bytes += level?.data?.byteLength ?? 0;
    return bytes;
  }
  const images: unknown[] = Array.isArray(t.image) ? t.image : [t.image];
  let bytes = 0;
  for (const image of images) {
    const source = image as { width?: number; height?: number; depth?: number; data?: { byteLength?: number } } | null | undefined;
    if (source == null) continue;
    if (source.data !== undefined && typeof source.data.byteLength === 'number') bytes += source.data.byteLength;
    else bytes += Math.max(0, source.width ?? 0) * Math.max(0, source.height ?? 0) * Math.max(1, source.depth ?? 1) * 4;
  }
  const mips = t.generateMipmaps && t.minFilter !== LinearFilter && t.minFilter !== NearestFilter;
  return mips ? Math.round((bytes * 4) / 3) : bytes;
}
/**
 * Materials drawn for the FIRST time into an output that one `buffers`
 * slice may carry (ENGINE r3): each first draw can build D3D executables
 * synchronously in the GPU process (10-35 ms each on the ANGLE box).
 */
export const WARM_BUFFER_NEW_MATERIALS = 1;
/**
 * ENGINE r4: the adaptive first-draw budget's ceiling (steps whose GPU work
 * finished within a frame grow it). D42 N8: 1 → 2 — while the GPU fence is
 * idle (the last step's fence signalled at its first poll and the step was
 * not heavy), a `buffers` step may carry two first-drawn materials; any step
 * that needed more frames halves it back to WARM_BUFFER_NEW_MATERIALS. Each
 * DRAW still carries at most WARM_BUFFER_DRAW_NEW_MATERIALS. Without fences
 * (WebGL1) the budget never grows.
 */
export const WARM_BUFFER_NEW_MATERIALS_MAX = 2;

/**
 * D42 N8: the next adaptive first-draw budget after a fenced step settled.
 * `fencePolls` is how many polls found the fence unsignalled (0: idle at the
 * first poll), `busyMs` fence-to-signal time. Grows by one only on an idle,
 * light step (below WARM_GPU_HEAVY_MS); halves (never below the base) after
 * a step the GPU needed more frames for.
 */
export function nextFreshBudget(current: number, fencePolls: number, busyMs: number): number {
  if (fencePolls === 0 && busyMs < WARM_GPU_HEAVY_MS) return Math.min(WARM_BUFFER_NEW_MATERIALS_MAX, current + 1);
  if (fencePolls === 0) return Math.min(WARM_BUFFER_NEW_MATERIALS_MAX, Math.max(WARM_BUFFER_NEW_MATERIALS, current));
  return Math.max(WARM_BUFFER_NEW_MATERIALS, Math.floor(current / 2));
}
/**
 * ENGINE r4: draws one `buffers` step may carry (at most
 * WARM_BUFFER_NEW_MATERIALS of them with a first-drawn material). With the
 * GPU fence (`gpuIdle`) a step's D3D executable build finishes before the
 * next is issued, so the compositor gets the GPU main thread between them
 * (r3's three per step made 42-55 ms GPU tasks and 150-190 ms ceremony gaps).
 */
export const WARM_BUFFER_DRAWS_PER_STEP = 6;
/** ENGINE r4: first-drawn materials one buffer DRAW may carry (each draw is flushed as its own GPU task). */
export const WARM_BUFFER_DRAW_NEW_MATERIALS = 1;
/** The camera layer the `buffers` slices draw through (unused by the app). */
export const WARM_BUFFER_LAYER = 31;
/** Main-thread budget of one program first-use slice (`primeSlice`; at least one program per frame). */
export const WARM_PRIME_BUDGET_MS = 6;
/** Verification passes before the warm moves on regardless (see `verify`). */
export const WARM_VERIFY_MAX_PASSES = 4;
/** Frames the scene's program state (lights, environment, fog) must hold before compiling. */
export const WARM_SIGNATURE_STABLE_FRAMES = 2;

/**
 * The effectful side of the load warm, one method per stage slice. The
 * machine (`stepLoadWarm`) only sequences them; `createLoadWarmIO` is the
 * three.js implementation and the tests drive fakes.
 */
export interface LoadWarmIO {
  /** Run the registered pre-compile hooks (idempotent; every frame before `done`). */
  prepare(): void;
  /** Queue compile work for variants not seen yet; returns how many were queued now. */
  collect(): number;
  /** Compile queued variants (the start rung's output) within this frame's slice; returns how many remain queued. */
  compileSlice(): number;
  /**
   * ENGINE r3: one slice of the lower rungs' outputs (`WarmOutput`), run in
   * the compile stage once the start rung's output is linked; ends with a
   * verification compile of the whole scene per output. Returns the work
   * remaining (0 = every variant linked and verified). Optional: a
   * single-output IO has none.
   */
  laterSlice?(): number;
  /** Any program still linking (bounded by WARM_LINK_MAX_MS each). */
  linksPending(): boolean;
  /**
   * R6: one byte-budgeted texture-upload step run INSIDE the compile stage,
   * on a frame whose compile slice issued no program (the links in flight
   * are at their cap — the GPU main thread is idle while the workers link).
   * A no-op unless the content is complete and the compile gate is open.
   * The `textures` stage then only uploads what is left. Optional (fakes).
   */
  uploadWhileLinking?(): void;
  /** The content is complete: assets idle AND residency complete. */
  contentComplete(): boolean;
  /** One shadow-variant slice; returns casters remaining. */
  shadowSlice(): number;
  /**
   * One verification pass over the REAL scene (not proxies): a whole-scene
   * compile and every caster's shadow variants against the live lights,
   * environment and fog. Returns how many programs it created — 0 means the
   * proxy compile missed nothing.
   */
  verifySlice(): number;
  /** One texture-upload slice; returns textures remaining. */
  textureSlice(): number;
  /**
   * ENGINE r3: one slice of program first-use work (three's `onFirstUse`:
   * the uniform / attribute tables and, with `checkShaderErrors`, the info
   * logs — synchronous GL queries per program) for linked programs not yet
   * used, under a per-frame budget. Returns the programs still unprimed.
   * r3 probe: the first pose render at an output paid it for ~50 programs
   * in one 0.42 s task. Optional (fakes need none).
   */
  primeSlice?(): number;
  /**
   * One geometry-upload slice: a byte-budgeted chunk of the visible
   * renderables drawn once offscreen (vertex / index / instance buffers,
   * bone and morph textures reach the GPU); returns renderables remaining.
   */
  bufferSlice(): number;
  /** One post-pass step (pre-compile, then render); returns steps remaining. */
  passSlice(): number;
  /** One station pose render; returns poses remaining. */
  poseSlice(): number;
  /** Let the renderer draw its first real frame. */
  requestFrame(): void;
  /** A real frame was drawn since `requestFrame`. */
  frameDrawn(): boolean;
  /** `renderer.info.programs.length`. */
  programCount(): number;
  /**
   * ENGINE r4 (CAR r3: the theme worlds' ceremony dropped to 26-33 compositor
   * fps with 160-190 ms gaps in the buffers stage). The main thread issues a
   * slice every 16.7 ms, but a slice's GPU work (first draws that build D3D
   * executables, uploads, whole-scene pose draws) takes the ANGLE GPU main
   * thread 40-70 ms: without backpressure the command queue backs up and the
   * compositor — which draws on that same thread — waits behind it. The warm
   * inserts a fence after every step that issued GPU work and issues nothing
   * more until the GPU has finished it (a non-blocking poll, bounded by
   * WARM_FENCE_MAX_MS). False = skip this frame. Optional (fakes need none).
   */
  gpuIdle?(): boolean;
  /** Fence the GPU work issued so far (after a step). */
  fenceGpu?(): void;
  /**
   * ENGINE r4 (CAR r3 veto: a plaza-dark reveal with blank LED boards): one
   * slice of the data faces' own residency — every registered face painted,
   * its mesh mounted and visible, and every texture it will sample uploaded
   * (uploading the missing ones under the texture budget). Returns the faces
   * not ready yet. `uploaded` never rises, and the warm never settles, while
   * it is above 0. Optional (a world without faces).
   */
  facesSlice?(): number;
  /**
   * ENGINE r4 (CAR r3: a 100-190 ms compositor gap at the arm in every
   * world): one slice of the post chain's full-size render targets — bound
   * and cleared once each, one per step. The first real frame used to pay
   * their allocation and ANGLE's robust zero-initialisation (tens of MB on
   * the integrated GPU) in one GPU batch right before the arm. Returns the
   * targets left. Optional (fakes and worlds without post need none).
   */
  targetSlice?(): number;
  /**
   * ENGINE r5 (CAR r4: ~30 compositor fps in the theme worlds' loads): GPU
   * time of each step, measured with EXT_disjoint_timer_query_webgl2 where the
   * context has it. `gpuTimerBegin` opens a TIME_ELAPSED query before a step's
   * body and `gpuTimerEnd` closes it after; the result lands a few frames
   * later (polled in `gpuIdle`). Optional (fakes and contexts without the
   * extension measure nothing).
   */
  gpuTimerBegin?(): void;
  gpuTimerEnd?(): void;
}

/** Longest one GPU fence is waited on before the warm moves on regardless (context loss, a driver that never signals). */
export const WARM_FENCE_MAX_MS = 250;
/** ENGINE r4: a warm step whose GPU work outlasted this (ms, fence to signal) is heavy and earns a rest. */
export const WARM_GPU_HEAVY_MS = 24;
/** ENGINE r4: the rest after a heavy step, as a multiple of its GPU time (1 = at most half the GPU main thread). */
export const WARM_GPU_REST_FACTOR = 0;

export interface LoadWarmState {
  stage: LoadWarmStage;
  /** Frames the program count has held still in `settle`. */
  stable: number;
  /** Program count at the previous `settle` frame (−1 before). */
  lastPrograms: number;
  /** Milestone M4 reached (monotone). */
  compiled: boolean;
  /** Milestone M5 reached (monotone). */
  uploaded: boolean;
  /** The warm settled (the reveal-gate input; monotone). */
  warm: boolean;
  frameRequested: boolean;
  /** Frames stepped so far (trace). */
  frames: number;
  /** Verification passes run in the current `verify` stage. */
  verifyPasses: number;
}

export function createLoadWarm(): LoadWarmState {
  return {
    stage: 'compile',
    stable: 0,
    lastPrograms: -1,
    compiled: false,
    uploaded: false,
    warm: false,
    frameRequested: false,
    frames: 0,
    verifyPasses: 0,
  };
}

/**
 * One frame of the load warm (see the section note). Exactly ONE stage's
 * slice runs per frame, so the order is strict and every frame's GPU work
 * stays bounded. Content that mounts after the compile stage (a late
 * population) sends the machine back to `compile`; the milestones already
 * reached stay reached (they are monotone), and `warm` is only ever set by a
 * full settle.
 */
export function stepLoadWarm(prev: LoadWarmState, io: LoadWarmIO): LoadWarmState {
  if (prev.stage === 'done') return prev;
  // ENGINE r4: backpressure — the previous step's GPU work first (`gpuIdle`).
  if (io.gpuIdle !== undefined && !io.gpuIdle()) return { ...prev, frames: prev.frames + 1 };
  io.gpuTimerBegin?.();
  let state: LoadWarmState;
  try {
    state = stepLoadWarmBody({ ...prev, frames: prev.frames + 1 }, io);
  } finally {
    io.gpuTimerEnd?.();
  }
  io.fenceGpu?.();
  return state;
}

function stepLoadWarmBody(state: LoadWarmState, io: LoadWarmIO): LoadWarmState {
  io.prepare();
  const fresh = io.collect();
  if (fresh > 0 && state.stage !== 'compile') {
    state.stage = 'compile';
    state.stable = 0;
    state.lastPrograms = -1;
    state.frameRequested = false;
    state.verifyPasses = 0;
  }
  switch (state.stage) {
    case 'compile': {
      // The start rung's output first, then (ENGINE r3) the lower rungs'
      // outputs — sequential: r3 probes overlapping them with the later
      // stages gained nothing (the links are GPU-process bound, ~15/s) and
      // put 0.3-0.45 s tasks into the buffer draws.
      const remaining = io.compileSlice();
      const later = remaining === 0 ? (io.laterSlice?.() ?? 0) : 1;
      if (remaining === 0 && later === 0 && !io.linksPending() && io.contentComplete()) state.stage = 'shadows';
      // R6: a frame that issued no compile uploads textures while the links run.
      else io.uploadWhileLinking?.();
      break;
    }
    case 'shadows': {
      const remaining = io.shadowSlice();
      if (remaining === 0 && !io.linksPending()) state.stage = 'verify';
      break;
    }
    case 'verify': {
      // Repeats (a frame apart, links landed in between) until a pass over
      // the real scene creates nothing: every program a real frame can link
      // is linked before the first real draw.
      if (io.linksPending()) break;
      state.verifyPasses += 1;
      const created = io.verifySlice();
      // Bounded: content that mints a program on every compile would
      // otherwise hold the warm here forever (the deadline would end it).
      if ((created === 0 && !io.linksPending()) || state.verifyPasses >= WARM_VERIFY_MAX_PASSES) state.stage = 'textures';
      break;
    }
    case 'textures': {
      // Program first use first (its own budget), then the uploads.
      if ((io.primeSlice?.() ?? 0) > 0) break;
      if (io.textureSlice() === 0) state.stage = 'buffers';
      break;
    }
    case 'buffers': {
      if (io.bufferSlice() === 0) state.stage = 'passes';
      break;
    }
    case 'passes': {
      const remaining = io.passSlice();
      if (remaining === 0 && !io.linksPending()) {
        // ENGINE r4: the post chain's full-size targets, one per step.
        if ((io.targetSlice?.() ?? 0) > 0) break;
        state.compiled = true;
        state.stage = 'poses';
      }
      break;
    }
    case 'poses': {
      // The post passes' programs linked since the textures stage.
      if ((io.primeSlice?.() ?? 0) > 0) break;
      if (io.poseSlice() === 0) {
        // ENGINE r4: every data face painted, mounted, visible and uploaded
        // before `uploaded` rises (never on counters alone).
        if ((io.facesSlice?.() ?? 0) > 0) break;
        state.uploaded = true;
        state.stage = 'frame';
      }
      break;
    }
    case 'frame': {
      if (!state.frameRequested) {
        io.requestFrame();
        state.frameRequested = true;
      } else if (io.frameDrawn()) {
        state.stage = 'settle';
      }
      break;
    }
    case 'settle': {
      const count = io.programCount();
      if (count === state.lastPrograms && !io.linksPending()) state.stable += 1;
      else state.stable = 0;
      state.lastPrograms = count;
      if (state.stable >= PROGRAMS_WARM_STABLE_FRAMES && io.textureSlice() === 0 && (io.facesSlice?.() ?? 0) === 0) {
        state.warm = true;
        state.stage = 'done';
      }
      break;
    }
  }
  return state;
}

/** Whether the renderer may draw a real frame in this warm state (held before `frame`). */
export function loadWarmAllowsDraw(state: LoadWarmState): boolean {
  return state.stage === 'frame' ? state.frameRequested : state.stage === 'settle' || state.stage === 'done';
}

// Registries: the warm's contracts with the seats that own the content.

/** A pre-compile hook (LIGHT: `paintSweep(scene)`, then station-0 uniforms). */
export type WarmPrepareHook = (scene: Object3D, camera: Camera, gl: WebGLRenderer) => void;

const prepareHooks: WarmPrepareHook[] = [];

/**
 * Register a hook the load warm runs every frame before it compiles
 * (LOOK-PLAN §2 G3.1–2). Hooks run in registration order; they must be
 * idempotent (the plaza's paint sweep keeps a WeakSet). Returns the release.
 * Worlds that register none are untouched (the blast-radius law).
 */
export function registerWarmPrepare(hook: WarmPrepareHook): () => void {
  prepareHooks.push(hook);
  return () => {
    const index = prepareHooks.indexOf(hook);
    if (index >= 0) prepareHooks.splice(index, 1);
  };
}

/** Run every registered pre-compile hook (a throw never stops the warm). */
export function runWarmPrepare(scene: Object3D, camera: Camera, gl: WebGLRenderer): void {
  for (const hook of [...prepareHooks]) {
    try {
      hook(scene, camera, gl);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.error('[load-warm] prepare hook failed', error);
    }
  }
}

/** Which post pass an entry is (the ladder's `post` / `!post` / `ao`). */
export type WarmPostPassKey = 'rich' | 'lean' | 'ao';

/**
 * A post pass the warm must have linked before the reveal (PostStack
 * registers its passes). `materials()` lists every material the pass draws
 * with (pre-compiled without a draw); `warm()` renders the pass once into a
 * small target with `.enabled` forced on and restored. An entry without
 * `warm` is linked by the warm's first real frame instead (N8AO: its
 * internal targets are sized to the composer, so it is only ever drawn by a
 * real frame — it is enabled at the start rung whenever it is needed).
 */
export interface WarmPostPass {
  key: WarmPostPassKey;
  materials: () => Material[];
  warm?: () => void;
}

const postPasses: WarmPostPass[] = [];

export function registerWarmPostPass(entry: WarmPostPass): () => void {
  postPasses.push(entry);
  return () => {
    const index = postPasses.indexOf(entry);
    if (index >= 0) postPasses.splice(index, 1);
  };
}

/**
 * The registered passes a session starting at `startIndex` must warm: those
 * whose key the start rung or any lower rung draws (`postPassesFrom`, from
 * quality.ts — the governor only steps down). Pure.
 */
export function postPassesToWarm(
  registered: readonly WarmPostPass[],
  needed: { rich: boolean; lean: boolean; ao: boolean },
): WarmPostPass[] {
  return registered.filter((entry) => needed[entry.key]);
}

export function registeredWarmPostPasses(): readonly WarmPostPass[] {
  return postPasses;
}

/** Tests only: drop every registration. */
export function resetLoadWarmRegistriesForTests(): void {
  prepareHooks.length = 0;
  postPasses.length = 0;
}

/**
 * The warm finished for `gl`: seed the station warm state with everything
 * the load compiled and uploaded (so a post-live station change finds
 * nothing "fresh" and the compile guard stays idle), and latch the
 * programs-warm trace.
 */
export function markLoadWarmComplete(gl: WebGLRenderer, scene: Object3D, camera: Camera): void {
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
      scans: 1,
    };
    warmers.set(gl, state);
  }
  const seeded = state;
  scene.traverse((object) => {
    const material = (object as Object3D & { material?: Material | Material[] }).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      seeded.seen.add(entry);
      const textures: Texture[] = [];
      texturesOf(entry, textures);
      for (const texture of textures) seeded.uploaded.add(texture);
    }
  });
  if (programsTrackGl === gl) programsWarmRendered = true;
}

/** A position / orientation / lens to render one station pose from. */
export interface WarmPose {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  fov: number;
}

/**
 * The variant key a compile proxy stands for: the material plus everything
 * of the OBJECT that three folds into the program key (kind, instancing
 * colour / morph, skinning, geometry morph targets and the extra UV sets).
 * Two renderables with the same key compile to the same program.
 */
export function compileVariantKey(object: Object3D, material: Material): string {
  const r = object as Renderable & ShadowCaster & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean; geometry?: Mesh['geometry'] };
  const kind = r.isSkinnedMesh
    ? 'skin'
    : r.isInstancedMesh
      ? `inst${r.instanceColor ? 'c' : ''}${r.morphTexture ? 'm' : ''}`
      : r.isBatchedMesh
        ? `batch:${object.uuid}`
        : r.isPoints
          ? 'points'
          : r.isLine
            ? 'line'
            : r.isSprite
              ? 'sprite'
              : 'mesh';
  const geometry = r.geometry;
  let geo = '';
  if (geometry && !r.isSprite) {
    const morph = geometry.morphAttributes as Record<string, readonly unknown[] | undefined>;
    geo = [
      Object.entries(morph)
        .map(([name, list]) => `${name}${list?.length ?? 0}`)
        .join(','),
      geometry.morphTargetsRelative ? 'rel' : '',
      ['position', 'normal', 'uv', 'uv1', 'uv2', 'uv3', 'tangent', 'color']
        .filter((name) => geometry.getAttribute(name) !== undefined)
        .map((name) => (name === 'color' ? `color${geometry.getAttribute(name).itemSize}` : name))
        .join(''),
    ].join('|');
  }
  return `${material.uuid}|${kind}|${geo}`;
}

/**
 * R6 E7: a relative estimate of what compiling (translating + linking) one
 * variant costs, for longest-processing-time-first ordering of the warm's
 * compile queue. The links run in parallel on the GPU process's workers
 * (up to WARM_MAX_LINKS_IN_FLIGHT); issued in traversal order, a heavy
 * lit / patched program met late links ALONE at the end of the stage while
 * every other worker idles (the R6 plaza trace: single D3DCompile tasks up to
 * 0.7 s). Issuing the heaviest first lets the light ones fill in behind them.
 * Only the ORDER changes — every variant is still compiled. Pure; unit-free.
 *
 * The estimate follows what grows an ANGLE program: the material family's
 * shader (physical > standard > phong/lambert/toon > basic), a custom
 * `onBeforeCompile` patch (the plaza's painted-light, ashlar, ground and
 * canopy programs), every sampled map (a define and a code path each),
 * skinning / morphs, and for a ShaderMaterial its own source length.
 */
export function compileWeight(object: Object3D, material: Material): number {
  const m = material as Material & {
    isMeshPhysicalMaterial?: boolean;
    isMeshStandardMaterial?: boolean;
    isMeshPhongMaterial?: boolean;
    isMeshLambertMaterial?: boolean;
    isMeshToonMaterial?: boolean;
    isMeshBasicMaterial?: boolean;
    isShaderMaterial?: boolean;
    vertexShader?: string;
    fragmentShader?: string;
    [slot: string]: unknown;
  };
  let weight: number;
  if (m.isShaderMaterial === true) weight = 4 + ((m.vertexShader?.length ?? 0) + (m.fragmentShader?.length ?? 0)) / 1000;
  else if (m.isMeshPhysicalMaterial === true) weight = 60;
  else if (m.isMeshStandardMaterial === true) weight = 45;
  else if (m.isMeshPhongMaterial === true || m.isMeshLambertMaterial === true || m.isMeshToonMaterial === true) weight = 30;
  else if (m.isMeshBasicMaterial === true) weight = 10;
  else weight = 8;
  // A patched program (own `onBeforeCompile`: painted light, ashlar, ground, canopy).
  if (Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')) weight += 20;
  for (const slot of COMPILE_WEIGHT_MAPS) {
    const value = m[slot] as { isTexture?: boolean } | null | undefined;
    if (value !== null && value !== undefined && value.isTexture === true) weight += 3;
  }
  const r = object as Renderable & ShadowCaster & { geometry?: Mesh['geometry']; morphTargetInfluences?: number[] };
  if (r.isSkinnedMesh === true) weight += 10;
  if (r.geometry && Object.keys(r.geometry.morphAttributes).length > 0) weight += 8;
  return weight;
}

/** The texture slots `compileWeight` counts (each is a define and a code path). */
const COMPILE_WEIGHT_MAPS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'lightMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'envMap',
  'clearcoatMap',
  'sheenColorMap',
  'transmissionMap',
] as const;

/** One memoised `compileVariantKey` result and the inputs it was built from (see `collect`). */
interface VariantKeyMemo {
  material: Material;
  geometry: unknown;
  instanceColor: unknown;
  morphTexture: unknown;
  attributeCount: number;
  morphCount: number;
  key: string;
}

/** A compile proxy of `object`'s kind carrying `material` (same geometry; never drawn). */
function compileProxy(object: Object3D, material: Material): Object3D | null {
  const r = object as Renderable & ShadowCaster & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
  if (r.isSkinnedMesh) return new SkinnedMesh(r.geometry, material);
  if (r.isInstancedMesh) {
    const proxy = new InstancedMesh(r.geometry, material, 1);
    proxy.instanceColor = r.instanceColor ?? null;
    proxy.morphTexture = r.morphTexture ?? null;
    return proxy;
  }
  if (r.isBatchedMesh) return null; // compiled as itself (see compileSlice)
  if (r.isPoints) return new Points(r.geometry, material);
  if (r.isLine) return new Line(r.geometry, material);
  if (r.isSprite) return material instanceof SpriteMaterial ? new Sprite(material) : null;
  if (r.isMesh) return new Mesh(r.geometry, material);
  return null;
}

/** Every texture a material samples, own slots and ShaderMaterial uniforms alike. */
function materialTextures(material: Material, out: Set<Texture>): void {
  const list: Texture[] = [];
  texturesOf(material, list);
  for (const texture of list) out.add(texture);
  if (material instanceof ShaderMaterial) {
    for (const uniform of Object.values(material.uniforms)) {
      const value: unknown = uniform?.value;
      const values: unknown[] = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        if (entry !== null && typeof entry === 'object' && (entry as Texture).isTexture === true) out.add(entry as Texture);
      }
    }
  }
}

/**
 * Materials reachable from a post pass object (its fullscreen material and
 * the internal passes / materials of its effects): a shallow, bounded walk.
 * Best effort: a material it misses is linked by the warm's render of the
 * pass, or by the warm's first real frame. `exclude` MUST name the world's
 * own scene (N8AO keeps a reference to it): its materials are the scene
 * compile's business, and compiling them here against no lights would mint
 * junk programs.
 */
export function passMaterials(root: object, exclude: readonly object[] = [], depth = 5): Material[] {
  const found = new Set<Material>();
  const visited = new WeakSet<object>(exclude);
  const walk = (value: unknown, level: number) => {
    if (value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    const node = value as {
      isMaterial?: boolean;
      isTexture?: boolean;
      isWebGLRenderTarget?: boolean;
      isObject3D?: boolean;
      isCamera?: boolean;
      isBufferGeometry?: boolean;
      domElement?: unknown;
    };
    if (node.isMaterial === true) {
      found.add(value as Material);
      return;
    }
    if (node.isTexture || node.isWebGLRenderTarget || node.isCamera || node.isBufferGeometry || node.domElement !== undefined) return;
    if (node.isObject3D === true) {
      // A pass's fullscreen mesh / scene: its materials only.
      (value as Object3D).traverse((child) => {
        const material = (child as Object3D & { material?: unknown }).material;
        if (material) walk(material, level);
      });
      return;
    }
    if (level <= 0) return;
    const entries: unknown[] = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const entry of entries) walk(entry, level - 1);
  };
  walk(root, depth);
  return [...found];
}

// ── Upload deferral during the load (ENGINE r2) ─────────────────────────────
//
// drei's `useTexture` / `useKTX2` call `gl.initTexture` on EVERY texture they
// load, all at once, in a passive effect — a synchronous batch of uploads and
// mip generations inside one React task. r2 plaza probe: 0.6-0.8 s React
// tasks each froze the compositor (and the CSS ceremony) for the same time.
// While the load warm runs, such calls are DEFERRED: the texture joins the
// warm's own upload queue, which uploads one texture at a time under a
// per-frame budget. The warm's uploads (and anything after the handoff) go
// straight through.

interface UploadDeferral {
  original: (texture: Texture) => void;
  wrapper: (texture: Texture) => void;
  deferred: Set<Texture>;
  active: boolean;
}

const uploadDeferrals = new WeakMap<WebGLRenderer, UploadDeferral>();

/** Start deferring outside `initTexture` calls on `gl` (idempotent); returns the stop. */
export function deferExternalUploads(gl: WebGLRenderer): () => void {
  let entry = uploadDeferrals.get(gl);
  if (!entry) {
    const original = gl.initTexture.bind(gl);
    const created: UploadDeferral = {
      original,
      deferred: new Set(),
      active: true,
      wrapper: (texture: Texture) => {
        if (created.active && !routeLive()) {
          created.deferred.add(texture);
          return;
        }
        original(texture);
      },
    };
    entry = created;
    uploadDeferrals.set(gl, entry);
    gl.initTexture = entry.wrapper;
  }
  const current = entry;
  current.active = true;
  return () => {
    current.active = false;
    // Anything still deferred uploads on its first draw (as before r2).
    current.deferred.clear();
  };
}

/** Upload `texture` now, bypassing the deferral (the warm's own slices). */
function uploadNow(gl: WebGLRenderer, texture: Texture): void {
  const entry = uploadDeferrals.get(gl);
  if (entry) {
    entry.deferred.delete(texture);
    entry.original(texture);
  } else {
    gl.initTexture(texture);
  }
}

/** Textures an outside caller asked to upload during the load (the warm uploads them). */
function deferredUploads(gl: WebGLRenderer): Texture[] {
  return [...(uploadDeferrals.get(gl)?.deferred ?? [])];
}

/** three's `materialNeedsLights` (WebGLRenderer): the lit materials whose key carries the light counts. */
function materialNeedsLights(material: Material): boolean {
  const m = material as Material & {
    isMeshLambertMaterial?: boolean;
    isMeshToonMaterial?: boolean;
    isMeshPhongMaterial?: boolean;
    isMeshStandardMaterial?: boolean;
    isShadowMaterial?: boolean;
    isShaderMaterial?: boolean;
    lights?: boolean;
  };
  return (
    m.isMeshLambertMaterial === true ||
    m.isMeshToonMaterial === true ||
    m.isMeshPhongMaterial === true ||
    m.isMeshStandardMaterial === true ||
    m.isShadowMaterial === true ||
    (m.isShaderMaterial === true && m.lights === true)
  );
}

/** The PMREMGenerator internals the pre-link drives (three r185; guarded by a try). */
interface PmremInternals {
  _setSize(cubeSize: number): void;
  _allocateTargets(): WebGLRenderTarget;
  _lodMeshes?: Mesh[];
  _equirectMaterial?: Material | null;
  _cubemapMaterial?: Material | null;
  _ggxMaterial?: Material | null;
  _blurMaterial?: Material | null;
}

function isCubeMapping(texture: Texture): boolean {
  return texture.mapping === CubeReflectionMapping || texture.mapping === CubeRefractionMapping;
}

/** A texture the renderer turns into a PMREM when it is a scene environment. */
function isPmremSource(texture: Texture): boolean {
  return (
    isCubeMapping(texture) ||
    texture.mapping === EquirectangularReflectionMapping ||
    texture.mapping === EquirectangularRefractionMapping
  );
}

/**
 * ENGINE-FIX: the environment's shape as three's program key sees it — its
 * mapping and source size (the PMREM cube-UV height follows the size), never
 * its identity. Two maps of one shape give every program the same key.
 */
function environmentShape(texture: Texture): string {
  const image = texture.image as { width?: number; height?: number; length?: number } | null | undefined;
  const size = image == null ? '0' : isCubeMapping(texture) ? `c${image.length ?? 0}` : `${image.width ?? 0}x${image.height ?? 0}`;
  return `${texture.mapping}/${size}`;
}

/** Whether a signature's point-light field (`count/shadowed`) rose from `before` to `after`. Exported for tests. */
export function pointCountRose(before: string | undefined, after: string | undefined): boolean {
  const count = (field: string | undefined) => Number.parseInt((field ?? '0').split('/')[0] ?? '0', 10) || 0;
  return count(after) > count(before);
}

/** The key-relevant part of a scene signature's environment field (`uuid:ready:shape`, or '-'). Exported for tests. */
export function envProgramState(field: string | undefined): string {
  if (field === undefined || field === '-') return '-';
  const parts = field.split(':');
  return parts.slice(1).join(':');
}

/** The environment's pixels are there (three builds no PMREM before; the program keys differ). */
function environmentReady(texture: Texture): boolean {
  if ((texture as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture === true) return true;
  const image = texture.image as { height?: number; length?: number } | null | undefined;
  if (image == null) return false;
  if (isCubeMapping(texture)) return typeof image.length === 'number' && image.length === 6;
  return typeof image.height === 'number' && image.height > 0;
}

/**
 * ENGINE r3: an output a real frame of this session can draw the scene into.
 * three keys every scene program on its output (tone mapping + colour space
 * of the bound target): `hdr` is the composer's linear, un-tone-mapped HDR
 * buffer (rungs with post); `screen` is the default framebuffer with the
 * renderer's own operator (the post-off rungs: ACES, sRGB). r3 rung-2 cold
 * load: the warm compiled only the `hdr` variant, so the first real frame at
 * a post-off rung linked every scene program synchronously (a 9.4 s task)
 * and the stall detector sent the load to Lite.
 */
export interface WarmOutput {
  kind: 'hdr' | 'screen';
  /** The renderer operator a `screen` output draws with (ignored for `hdr`). */
  toneMapping: ToneMapping;
}

/** The distinct outputs of `paths` (start rung first), deduplicated by program key. */
export function warmOutputsFor(paths: readonly { composer: boolean; toneMapping: ToneMapping }[]): WarmOutput[] {
  const out: WarmOutput[] = [];
  for (const path of paths) {
    const next: WarmOutput = path.composer ? { kind: 'hdr', toneMapping: path.toneMapping } : { kind: 'screen', toneMapping: path.toneMapping };
    if (out.some((entry) => entry.kind === next.kind && (entry.kind === 'hdr' || entry.toneMapping === next.toneMapping))) continue;
    out.push(next);
  }
  return out;
}

export interface LoadWarmDeps {
  gl: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  /** Assets idle AND residency complete for the warm's generation. */
  contentComplete: () => boolean;
  /**
   * The compile may start (the loading manager went idle once: the
   * environment map and the GLBs that bring lights are in). Compiling before
   * it minted programs for a light count and an environment the scene no
   * longer has by its first frame (plaza r1: 18 -> 20 point lights, envMap
   * none -> PMREM): every lit program linked twice, the second time
   * synchronously inside a pose render (8 s frames).
   */
  compileReady?: () => boolean;
  /** The frozen station poses (the landed endpoints), in route order. */
  poses: () => readonly WarmPose[];
  /** Draw without the canvas's hold wrapper (pose renders are offscreen, never counted as frames). */
  rawRender: (scene: Scene, camera: Camera) => void;
  requestFrame: () => void;
  frameDrawn: () => boolean;
  /** The post passes to warm (already filtered by `postPassesToWarm`). */
  passes: () => readonly WarmPostPass[];
  /**
   * The materials that draw to the SCREEN (the composer's terminal pass):
   * compiled for the default framebuffer too, since the output colour space
   * is part of the key (r2: the trailing CopyPass linked on the first frame).
   */
  screenMaterials?: () => readonly Material[];
  /** Progress signals for the stall detector (name, monotone value). */
  signal: (name: string, value: number) => void;
  /**
   * ENGINE r3: every output a real frame of this session can draw into, the
   * START rung's first (see `WarmOutput`). The compile and verify stages
   * compile every variant for each; the buffer and pose renders draw into
   * the first. Default: the composer's `hdr` buffer only.
   */
  outputs?: () => readonly WarmOutput[];
  /**
   * ENGINE r4: the mounted data faces (residency-store `dataFaceEntries`,
   * read through): painted, their content mesh, and every texture they will
   * sample. Default: none.
   */
  faces?: () => readonly WarmDataFace[];
  /** ENGINE r5: time each step on the GPU (timer queries; trace runs only). */
  gpuTiming?: boolean;
  /** ENGINE r4: the post chain's render targets (see `LoadWarmIO.targetSlice`). Default: none. */
  renderTargets?: () => readonly WebGLRenderTarget[];
  /**
   * ENGINE-FIX (D32): the warm runs behind the OPAQUE theme veil (a day/night
   * swap of a live world). Nothing it does can be seen — the veil is a static
   * sheet — so the per-frame budgets that keep a VISIBLE ceremony smooth are
   * lifted (`VEILED_WARM`), and no compiled variant is evicted on a light
   * change: the palette the visitor left keeps its programs, so swapping back
   * links nothing. Default: never veiled.
   */
  veiled?: () => boolean;
}

/**
 * Render targets reachable from a post chain object (the composer, its
 * passes and their effects): a shallow, bounded walk like `passMaterials`.
 */
export function renderTargetsOf(root: object, depth = 8): WebGLRenderTarget[] {
  const found = new Set<WebGLRenderTarget>();
  const visited = new WeakSet<object>();
  const walk = (value: unknown, level: number) => {
    if (value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    const node = value as {
      isWebGLRenderTarget?: boolean;
      isRenderTarget?: boolean;
      isTexture?: boolean;
      isMaterial?: boolean;
      isObject3D?: boolean;
      isCamera?: boolean;
      isBufferGeometry?: boolean;
      isWebGLRenderer?: boolean;
      domElement?: unknown;
    };
    if (node.isWebGLRenderTarget === true || node.isRenderTarget === true) {
      found.add(value as WebGLRenderTarget);
      return;
    }
    if (node.isTexture || node.isMaterial || node.isObject3D || node.isCamera || node.isBufferGeometry || node.isWebGLRenderer || node.domElement !== undefined) return;
    if (level <= 0) return;
    const entries: unknown[] = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    for (const entry of entries) walk(entry, level - 1);
  };
  walk(root, depth);
  return [...found];
}

/** One data face as the warm checks it (see `LoadWarmDeps.faces`). */
export interface WarmDataFace {
  id: string;
  painted: boolean;
  object: Object3D | null;
  textures: readonly Texture[];
}

/** The face is shown: mounted under a scene and visible up its whole parent chain. */
function faceShown(object: Object3D | null): boolean {
  if (object === null) return false;
  let node: Object3D | null = object;
  let root: Object3D | null = null;
  while (node !== null) {
    if (!node.visible) return false;
    root = node;
    node = node.parent;
  }
  return (root as (Object3D & { isScene?: boolean }) | null)?.isScene === true;
}

/**
 * ENGINE r5 (trace only): why a data face is or is not ready for the warm —
 * the first hidden node up its chain (or `no-scene` when it is detached) and
 * how many of its textures are on the GPU. `__routeWorldRenderPath().dataFaces`.
 */
export function describeDataFace(
  gl: WebGLRenderer,
  face: Pick<WarmDataFace, 'object' | 'textures'>,
): { shown: boolean; hiddenAt: string | null; onGpu: number } {
  let hiddenAt: string | null = null;
  let node: Object3D | null = face.object;
  let root: Object3D | null = null;
  while (node !== null) {
    if (!node.visible && hiddenAt === null) hiddenAt = node.name || node.type;
    root = node;
    node = node.parent;
  }
  if (face.object === null) hiddenAt = 'no-object';
  else if (hiddenAt === null && (root as (Object3D & { isScene?: boolean }) | null)?.isScene !== true) hiddenAt = 'no-scene';
  let onGpu = 0;
  for (const texture of face.textures) if (textureOnGpu(gl, texture)) onGpu += 1;
  return { shown: faceShown(face.object), hiddenAt, onGpu };
}

export interface LoadWarmIOHandle extends LoadWarmIO {
  /** ENGINE r4: always implemented by the three.js IO (see `LoadWarmIO.facesSlice`). */
  facesSlice(): number;
  /** ENGINE r5: attach the last step's GPU time (when it resolves) to `sink.gpuMs` (trace). */
  bindGpuSink(sink: { gpuMs?: number }): void;
  /** Release the scratch targets and the proxy geometry. */
  dispose(): void;
  /** Trace readout. */
  report(): {
    variants: number;
    compiledVariants: number;
    uploads: number;
    poses: number;
    passes: number;
    verifyPasses: number;
    verifyCreated: number;
    buffers: number;
    evicted: number;
    screenMaterials: number;
    signature: string | null;
    signatureLog: { t: number; signature: string }[];
    pmrem: number | null;
    /** ENGINE r4: frames the warm skipped waiting on its GPU fence. */
    fenceWaits: number;
    /** ENGINE r4: frames the warm rested after a heavy GPU step. */
    restFrames: number;
    /** ENGINE r4: the adaptive first-draw budget now. */
    freshBudget: number;
    /** ENGINE r4: post-chain targets bound and cleared before the first real frame. */
    targetsCleared: number;
    /** ENGINE r4: data-face textures the warm uploaded itself. */
    faceUploads: number;
    /** ROLLOUT-PLAN E3: banded upload steps of giant painted faces (≤ 2 MiB each). */
    bandSteps: number;
    /** ROLLOUT-PLAN E6: of those, steps run while the warm waited for complete content. */
    earlyBandSteps: number;
    /** ENGINE r4: data faces ready at the last check (−1 before). */
    facesReady: number;
    /** R6: texture-upload steps run inside the compile stage (`uploadWhileLinking`). */
    earlyUploadSteps: number;
    gpu: { steps: number; totalMs: number; maxMs: number; lastMs: number | null } | null;
  };
  /** Debug trace: every program's cache key with the warm stage it first appeared in. */
  programOrigins(): { stage: string; name: string; key: string }[];
  /** When the compile gate first opened (content complete, program state still), null before. */
  compileOpenedAt(): number | null;
  /** Whether the compile gate was open at its last check (ENGINE-FIX: the veiled multi-step host). */
  compileGateOpen(): boolean;
  /** The last frame interval the warm saw and its adaptive link cap (trace). */
  frameStats(): { frameMs: number; cap: number };
}

/**
 * The three.js implementation of `LoadWarmIO` (see the section note). Every
 * method is a bounded per-frame slice.
 */
export function createLoadWarmIO(deps: LoadWarmDeps): LoadWarmIOHandle {
  const { gl, scene, camera } = deps;
  const scratch = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  // ENGINE r3: the `screen` output's stand-in. three derives a program's tone
  // mapping and output colour space from the bound target; an XR-flagged
  // target reads both exactly as the default framebuffer does (the
  // renderer's operator, the texture's colour space), so a compile or draw
  // into it builds the screen variant without touching the visible canvas.
  const screenScratch = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
  (screenScratch as WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
  const outputs = (): readonly WarmOutput[] => {
    const list = deps.outputs?.() ?? [];
    return list.length > 0 ? list : [{ kind: 'hdr', toneMapping: gl.toneMapping }];
  };
  const seenKeys = new Set<string>();
  /** R6 E7: `compileWeight` per (object, material), memoised for the sort. */
  const weights = new WeakMap<Object3D, Map<Material, number>>();
  const weightOf = (object: Object3D, material: Material): number => {
    let perObject = weights.get(object);
    if (perObject === undefined) {
      perObject = new Map();
      weights.set(object, perObject);
    }
    let weight = perObject.get(material);
    if (weight === undefined) {
      weight = compileWeight(object, material);
      perObject.set(material, weight);
    }
    return weight;
  };
  const byCompileWeight = (a: { object: Object3D; material: Material }, b: { object: Object3D; material: Material }): number =>
    weightOf(b.object, b.material) - weightOf(a.object, a.material);
  /** Compile work for the start rung's output (first) and for the other outputs (after it). */
  const queue: { object: Object3D; material: Material; output: WarmOutput }[] = [];
  const laterQueue: { object: Object3D; material: Material; output: WarmOutput }[] = [];
  const proxyScene = new Scene();
  /** Programs seen still linking, with the time first seen (bounded wait). */
  const linking = new Map<ProgramLike, number>();
  let compiledVariants = 0;

  let casters: Object3D[] | null = null;
  let castersDone = 0;
  let textures: Texture[] | null = null;
  let uploads = 0;

  const fullscreen = new BufferGeometry();
  fullscreen.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  fullscreen.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let passQueue: { entry: WarmPostPass; compiled: boolean; pending?: Material[] }[] | null = null;
  let passesDone = 0;
  let passSteps = 0;

  let verifyPasses = 0;
  let verifyCreated = 0;
  /** Interval between the last two warm frames (the link budget's input). */
  let frameIntervalMs = 16;
  let lastPrepareAt: number | null = null;
  /** ENGINE r4: one frame's interval (the last two ticks); idempotent within a frame. */
  const tickFrame = (now: number): void => {
    if (lastPrepareAt !== null && now - lastPrepareAt <= 1) return;
    // D38: a frame the cap skipped on purpose is not a busy GPU (frame-cap.ts).
    frameIntervalMs = lastPrepareAt === null ? 16 : uncappedFrameMs(now - lastPrepareAt);
    lastPrepareAt = now;
  };
  let linkCap = createLinkCap();

  /** Pose renders: every station pose for every output (the start rung's first). */
  let poseQueue: { pose: WarmPose; output: number }[] | null = null;
  const poseTargets = new Map<number, WebGLRenderTarget>();
  const poseCamera = new PerspectiveCamera();
  let posesDone = 0;

  /** ENGINE r4: end the GPU task here (a WebGL flush; the GPU scheduler may run the compositor next). */
  const flushGpu = (): void => {
    try {
      (gl.getContext?.() as WebGLRenderingContext | undefined)?.flush();
    } catch {
      // A lost context: nothing to flush.
    }
  };

  const programs = (): ProgramLike[] => (gl.info as unknown as { programs?: ProgramLike[] | null }).programs ?? [];

  /** Debug trace: the warm stage in which each program first appeared (cache key → stage). */
  const origins = new Map<string, { stage: string; name: string }>();
  const noteOrigins = (stage: string): void => {
    for (const program of programs() as (ProgramLike & { cacheKey?: string; name?: string })[]) {
      const key = program.cacheKey;
      if (key !== undefined && !origins.has(key)) origins.set(key, { stage, name: program.name ?? '?' });
    }
  };

  /** Run `fn` with the scratch target bound (the composer's variant), restoring the binding. */
  const intoScratch = (fn: () => void): void => {
    const previous = gl.getRenderTarget();
    const face = gl.getActiveCubeFace();
    const mip = gl.getActiveMipmapLevel();
    gl.setRenderTarget(scratch);
    try {
      fn();
    } finally {
      gl.setRenderTarget(previous, face, mip);
    }
  };

  /**
   * Run `fn` with `output`'s program state bound (ENGINE r3): the `hdr`
   * scratch, or the screen stand-in with the output's operator set on the
   * renderer for the call (restored). `target` overrides the stand-in (the
   * pose / buffer renders' sized targets), flagged the same way.
   */
  const intoOutput = (output: WarmOutput, fn: () => void, target?: WebGLRenderTarget): void => {
    const previous = gl.getRenderTarget();
    const face = gl.getActiveCubeFace();
    const mip = gl.getActiveMipmapLevel();
    const toneMapping = gl.toneMapping;
    if (output.kind === 'screen') {
      screenScratch.texture.colorSpace = gl.outputColorSpace;
      gl.toneMapping = output.toneMapping;
    }
    gl.setRenderTarget(target ?? (output.kind === 'screen' ? screenScratch : scratch));
    try {
      fn();
    } finally {
      gl.toneMapping = toneMapping;
      gl.setRenderTarget(previous, face, mip);
    }
  };

  /** A sized render target for `output`'s draws (pose / buffer renders). */
  const drawTargetFor = (output: WarmOutput, width: number, height: number): WebGLRenderTarget => {
    if (output.kind === 'hdr') return new WebGLRenderTarget(width, height, { type: HalfFloatType });
    const target = new WebGLRenderTarget(width, height, { type: UnsignedByteType });
    (target as WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
    target.texture.colorSpace = gl.outputColorSpace;
    return target;
  };

  // Program state of the scene (ENGINE r2). Every lit program's key carries
  // the scene's light counts (per type, with shadow casters), the
  // environment map (PMREM size) and the fog type. A program compiled before
  // a light or the environment arrived is the wrong variant: its first real
  // draw links the right one synchronously. So the warm keys its whole
  // compile on this signature: a change clears every compiled variant and the
  // machine compiles again (the program cache makes the unchanged ones free),
  // and the compile only starts once it has held still for
  // WARM_SIGNATURE_STABLE_FRAMES frames.
  let signature: string | null = null;
  let signatureStable = 0;
  const signatureLog: { t: number; signature: string }[] = [];
  const sceneSignature = (): string => {
    const n = { dir: 0, dirS: 0, point: 0, pointS: 0, spot: 0, spotS: 0, spotMap: 0, hemi: 0, rect: 0, probe: 0 };
    scene.traverseVisible((object) => {
      const light = object as Light & {
        isDirectionalLight?: boolean;
        isPointLight?: boolean;
        isSpotLight?: boolean;
        isHemisphereLight?: boolean;
        isRectAreaLight?: boolean;
        isLightProbe?: boolean;
        map?: unknown;
      };
      if (light.isLight !== true || !object.layers.test(camera.layers)) return;
      const casts = light.castShadow === true;
      if (light.isDirectionalLight) {
        n.dir += 1;
        if (casts) n.dirS += 1;
      } else if (light.isPointLight) {
        n.point += 1;
        if (casts) n.pointS += 1;
      } else if (light.isSpotLight) {
        n.spot += 1;
        if (casts) n.spotS += 1;
        if (light.map) n.spotMap += 1;
      } else if (light.isHemisphereLight) n.hemi += 1;
      else if (light.isRectAreaLight) n.rect += 1;
      else if (light.isLightProbe) n.probe += 1;
    });
    const env = scene.environment as Texture | null;
    const fog = scene.fog as { isFogExp2?: boolean } | null;
    return [
      `${n.dir}/${n.dirS}`,
      `${n.point}/${n.pointS}`,
      `${n.spot}/${n.spotS}/${n.spotMap}`,
      n.hemi,
      n.rect,
      n.probe,
      env ? `${env.uuid}:${environmentReady(env) ? 1 : 0}:${environmentShape(env)}` : '-',
      fog ? (fog.isFogExp2 ? 'exp2' : 'lin') : '-',
      gl.shadowMap.enabled ? gl.shadowMap.type : 'off',
    ].join('|');
  };

  // PMREM pre-link (ENGINE r2). The renderer builds the environment's PMREM
  // the first time a compile or draw meets it, and PMREMGenerator RENDERS at
  // once with its equirect / GGX / blur shaders: first-use links,
  // synchronous. A private generator of the same size compiles the identical
  // materials (same sources and defines, drawn on the same lod mesh, into a
  // render target like the real one) without drawing; once they are linked,
  // the real generation reuses them from the program cache. The generator is
  // kept: disposing it would release the programs before the real
  // generation used them.
  let pmrem: { texture: Texture; materials: Material[]; generator: PMREMGenerator } | null = null;
  const pmremReady = (): boolean => {
    const env = scene.environment as Texture | null;
    if (!env || !isPmremSource(env)) return true;
    if (!environmentReady(env)) return false;
    if (pmrem === null || pmrem.texture !== env) {
      const generator = new PMREMGenerator(gl);
      const internals = generator as unknown as PmremInternals;
      const materials: Material[] = [];
      try {
        const cube = isCubeMapping(env);
        const image = env.image as { width?: number; length?: number; [index: number]: { width?: number; image?: { width?: number } } };
        internals._setSize(cube ? (image.length === 0 ? 16 : (image[0]?.width ?? image[0]?.image?.width ?? 16)) : (image.width ?? 64) / 4);
        internals._allocateTargets().dispose();
        if (cube) generator.compileCubemapShader();
        else generator.compileEquirectangularShader();
        const entry = cube ? internals._cubemapMaterial : internals._equirectMaterial;
        for (const material of [entry, internals._ggxMaterial, internals._blurMaterial]) if (material) materials.push(material);
        const mesh = internals._lodMeshes?.[0];
        if (mesh) {
          const original = mesh.material;
          intoScratch(() => {
            for (const material of materials) {
              mesh.material = material;
              gl.compile(mesh, ortho);
            }
          });
          mesh.material = original;
        }
      } catch {
        // A three internals change: the real generation links on first use (as before r2).
      }
      pmrem = { texture: env, materials, generator };
      noteOrigins('pmrem');
    }
    const properties = propertiesOf(gl);
    for (const material of pmrem.materials) {
      const program = properties.get(material).currentProgram;
      if (program && typeof program.isReady === 'function' && !program.isReady()) return false;
    }
    return true;
  };

  // Stale-variant eviction (ENGINE r2). three keeps every variant a material
  // was ever compiled for (its per-material program map) until the material
  // is disposed, so the programs compiled before a light / environment / fog
  // change stay alive — linked GPU work nobody draws, and +26 on the plaza's
  // program count (r2 probe: 112 vs 86). Disposing a material only releases
  // its GPU state (programs whose last user it was are deleted); three
  // re-initialises it on its next compile, which the machine runs at once.
  const compiledMaterials = new Set<Material>();
  let evicted = 0;
  const evictStaleVariants = (before: string, after: string): void => {
    const a = before.split('|');
    const b = after.split('|');
    // ENGINE-FIX (D32): behind the theme veil nothing is evicted — the
    // variants of the palette the visitor left stay linked for the way back.
    // One exception: a RISE of the point-light count. The host pads the
    // scene to that count from now on (RouteWorldCanvas `syncPointLightPad`),
    // so the lower count's variants can never be drawn again — evicted as at
    // load (live materials re-initialise on the compile that follows).
    const veiledSwap = deps.veiled?.() === true;
    if (veiledSwap && !pointCountRose(a[1], b[1])) {
      compiledMaterials.clear();
      return;
    }
    const lightsChanged = [0, 1, 2, 3, 4, 5, 8].some((index) => a[index] !== b[index]);
    // ENGINE-FIX: only the environment's KEY-relevant state (present, pixels
    // in, mapping and size — `envProgramState`) makes a variant stale. A new
    // map of the same shape (the other palette's HDRI) keeps every key, and
    // evicting on its uuid alone re-linked ~40 identical programs per swap.
    const envChanged = envProgramState(a[6]) !== envProgramState(b[6]);
    const fogChanged = a[7] !== b[7];
    for (const material of compiledMaterials) {
      const m = material as Material & { isMeshStandardMaterial?: boolean; fog?: boolean };
      const stale =
        (lightsChanged && materialNeedsLights(material)) || (envChanged && m.isMeshStandardMaterial === true) || (fogChanged && m.fog === true);
      if (!stale) continue;
      try {
        // The prototype's dispose: behind the veil the swap capture defers
        // own-property disposals, and this eviction must really happen.
        if (veiledSwap) (Object.getPrototypeOf(material) as Material).dispose.call(material);
        else material.dispose();
        evicted += 1;
      } catch {
        // Never let an eviction stop the load.
      }
    }
    compiledMaterials.clear();
  };

  /** Whether the compile may run this frame (see `compileReady` and the two notes above). */
  let compileOpenedAt: number | null = null;
  let lastGateOpen = false;
  const compileGate = (): boolean => {
    // The PMREM pre-link starts as soon as the environment is in (it does
    // not depend on the populations), so it has linked by the time they are.
    const pmremLinked = pmremReady();
    const open = pmremLinked && (deps.compileReady?.() ?? true) && signatureStable >= WARM_SIGNATURE_STABLE_FRAMES;
    lastGateOpen = open;
    if (open && compileOpenedAt === null) compileOpenedAt = performance.now();
    return open;
  };

  const linksPending = (): boolean => {
    const now = performance.now();
    let pending = false;
    for (const program of programs()) {
      if (typeof program.isReady !== 'function' || isStaleProgram(program)) continue;
      if (program.isReady()) {
        linking.delete(program);
        continue;
      }
      const since = linking.get(program);
      if (since === undefined) {
        linking.set(program, now);
        pending = true;
      } else if (now - since <= WARM_LINK_MAX_MS) {
        pending = true;
      }
    }
    return pending;
  };

  const readyCount = (): number => {
    let ready = 0;
    for (const program of programs()) if (typeof program.isReady !== 'function' || program.isReady()) ready += 1;
    return ready;
  };

  /** Programs still linking (a non-blocking COMPLETION_STATUS poll each). */
  const linksInFlight = (): number => {
    let inFlight = 0;
    for (const program of programs()) {
      if (typeof program.isReady === 'function' && !isStaleProgram(program) && !program.isReady()) inFlight += 1;
    }
    return inFlight;
  };

  /** New programs this step may issue: the adaptive cap, or the veiled budget (ENGINE-FIX, D32). */
  const linkBudget = (): number =>
    deps.veiled?.() === true ? veiledLinkBudget(linksInFlight()) : warmLinkBudget(frameIntervalMs, linksInFlight(), linkCap.cap);

  const signalPrograms = () => {
    deps.signal('programs', programs().length);
    deps.signal('programsReady', readyCount());
  };

  // ENGINE r3 (per-frame main-thread cost): `collect` runs every warm frame
  // over the whole scene, and building every renderable's variant key string
  // each time cost 0.1-0.18 s per frame burst on dev. The key is memoised
  // per (object, material) and recomputed only when an input it reads
  // changes identity (geometry, instance colour, morph texture) or the
  // geometry's attribute / morph sets change size. The verify stage's
  // whole-scene compile stays the backstop for anything a key misses.
  const keyMemo = new WeakMap<Object3D, VariantKeyMemo[]>();
  const cachedVariantKey = (object: Object3D, material: Material): string => {
    const r = object as Renderable & { geometry?: Mesh['geometry']; instanceColor?: unknown; morphTexture?: unknown };
    const geometry = r.geometry;
    const attributeCount = geometry ? Object.keys(geometry.attributes).length : 0;
    const morphCount = geometry ? Object.keys(geometry.morphAttributes).length : 0;
    const list = keyMemo.get(object);
    if (list !== undefined) {
      for (const entry of list) {
        if (
          entry.material === material &&
          entry.geometry === geometry &&
          entry.instanceColor === (r.instanceColor ?? null) &&
          entry.morphTexture === (r.morphTexture ?? null) &&
          entry.attributeCount === attributeCount &&
          entry.morphCount === morphCount
        ) {
          return entry.key;
        }
      }
    }
    const key = compileVariantKey(object, material);
    const entry: VariantKeyMemo = {
      material,
      geometry,
      instanceColor: r.instanceColor ?? null,
      morphTexture: r.morphTexture ?? null,
      attributeCount,
      morphCount,
      key,
    };
    const next = (list ?? []).filter((item) => item.material !== material);
    next.push(entry);
    keyMemo.set(object, next);
    return key;
  };

  const collect = (): number => {
    let fresh = 0;
    const next = sceneSignature();
    if (next !== signature) {
      if (signature !== null) {
        // The program state moved: every variant compiled so far may be the
        // wrong one. Forget them all; unchanged ones come back from three's
        // program cache for free.
        seenKeys.clear();
        queue.length = 0;
        laterQueue.length = 0;
        evictStaleVariants(signature, next);
      }
      signature = next;
      signatureStable = 0;
      if (signatureLog.length < 32) signatureLog.push({ t: Math.round(performance.now()), signature: next });
    } else {
      signatureStable += 1;
    }
    const targets = outputs();
    scene.traverse((object) => {
      if (!isRenderable(object)) return;
      for (const material of materialsOf(object)) {
        const key = cachedVariantKey(object, material);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        // The start rung's output first; the lower rungs' outputs after the
        // whole first pass (the reveal needs every one, the frame the first).
        targets.forEach((output, index) => (index === 0 ? queue : laterQueue).push({ object, material, output }));
        fresh += 1;
      }
    });
    if (fresh > 0) {
      // R6 E7: longest first (LPT) — the heavy programs start linking while
      // the light ones fill the workers behind them (see `compileWeight`).
      // Stable, so equal weights keep the traversal order.
      queue.sort(byCompileWeight);
      laterQueue.sort(byCompileWeight);
      // New content invalidates the later stages' lists.
      casters = null;
      textures = null;
      bufferQueue = null;
      passQueue = null;
      poseQueue = null;
    }
    return fresh;
  };

  /** R6: whether this frame's compile / later slice issued a program (`uploadWhileLinking`). */
  let issuedThisFrame = false;
  /** Compile items of `list` under this frame's link budget and `budgetMs`; returns what remains. */
  const drain = (list: typeof queue, budgetMs: number): number => {
    if (list.length === 0) return 0;
    // Never more than a few links in flight: the ANGLE GPU process stalls
    // (and freezes the compositor) on large batches.
    const allowed = linkBudget();
    if (allowed <= 0) return list.length;
    const started = performance.now();
    const before = programs().length;
    let first = true;
    issuedThisFrame = true;
    while (list.length > 0) {
      if (!first && (performance.now() - started >= budgetMs || programs().length - before >= allowed)) {
        break;
      }
      // R6 E7: the queue is longest first. A step takes the HEAVIEST
      // remaining variant first and fills the rest of its program budget from
      // the LIGHT end: the heavy links still start earliest (the LPT tail
      // saving), but no step stacks several heavy translations on the GPU
      // main thread (sakura r6 i2, plain head-first: a 207 ms compositor gap
      // at compile-open). The number of programs per step is unchanged — the
      // warm's GPU fence after a step waits out that step's links, so fewer
      // per step serializes linking (r6 probe: a per-step cost cap stretched
      // the clouds compile from 1.4 s to 6.9 s).
      const next = first ? list.shift() : list.pop();
      first = false;
      if (!next) break;
      if (next.object.parent === null) continue; // unmounted since it was queued
      try {
        const proxy = compileProxy(next.object, next.material);
        intoOutput(next.output, () => {
          if (proxy === null) {
            // BatchedMesh (or an unknown kind): compile the object itself.
            gl.compile(next.object, camera, scene);
          } else {
            proxyScene.add(proxy);
            try {
              gl.compile(proxyScene, camera, scene);
            } finally {
              proxyScene.remove(proxy);
            }
          }
        });
        compiledVariants += 1;
        compiledMaterials.add(next.material);
        // ENGINE r4: each compile request its own GPU task (shader
        // translation runs on the GPU main thread before the parallel link).
        flushGpu();
        deps.signal('variants', compiledVariants);
        noteOrigins(list === queue ? 'compile' : 'compile-later');
      } catch {
        // A half-built material / lost context: the pose renders or the first frame compile it.
      }
    }
    return list.length;
  };

  /**
   * ENGINE-FIX (D32): behind the opaque theme veil the queued variants of
   * `items` compile in ONE compile call into `output` — every proxy in the
   * proxy scene at once, one light setup against the real scene — instead
   * of a compile (a scene light traversal) and a GPU flush per variant. The
   * slicing exists to keep a VISIBLE ceremony smooth; under the veil it only
   * lengthens the wait (a swap's ~100 cached variants took 3-4 frames of
   * 40-50 ms). The variants are exactly the queued ones (a whole-scene
   * compile would also link what the warm never draws); new programs link
   * in parallel and the stage waits for them as before.
   */
  const compileVeiled = (items: readonly (typeof queue)[number][], output: WarmOutput | undefined, stage: string): void => {
    if (output === undefined || items.length === 0) return;
    issuedThisFrame = true;
    const own: Object3D[] = [];
    try {
      intoOutput(output, () => {
        for (const item of items) {
          if (item.object.parent === null) continue; // unmounted since it was queued
          const proxy = compileProxy(item.object, item.material);
          if (proxy === null) own.push(item.object);
          else proxyScene.add(proxy);
        }
        try {
          gl.compile(proxyScene, camera, scene);
        } finally {
          proxyScene.clear();
        }
        // BatchedMesh (or an unknown kind): compiled as itself (see `drain`).
        for (const object of own) gl.compile(object, camera, scene);
      });
    } catch {
      // A half-built material / lost context: the verify pass or the first frame compiles it.
    }
    for (const item of items) compiledMaterials.add(item.material);
    compiledVariants += items.length;
    flushGpu();
    deps.signal('variants', compiledVariants);
    noteOrigins(stage);
  };

  const compileSlice = (): number => {
    if (!compileGate()) {
      signalPrograms();
      // Not started yet: report work outstanding so the machine waits here.
      return Math.max(1, queue.length);
    }
    if (deps.veiled?.() === true && queue.length > 0) {
      compileVeiled(queue.splice(0), outputs()[0], 'compile');
      signalPrograms();
      return 0;
    }
    const remaining = drain(queue, WARM_COMPILE_BUDGET_MS);
    signalPrograms();
    return remaining;
  };

  /** Whether the lower rungs' outputs passed their verification compile (reset by new work). */
  let laterVerified = false;
  const laterSlice = (): number => {
    const targets = outputs();
    if (targets.length < 2) return 0;
    if (laterQueue.length > 0 && deps.veiled?.() === true) {
      // ENGINE-FIX (D32): one whole-scene compile per lower output (see `compileVeiled`).
      laterVerified = false;
      const items = laterQueue.splice(0);
      for (const output of targets.slice(1)) compileVeiled(items.filter((item) => item.output === output), output, 'compile-later');
      signalPrograms();
      return 1;
    }
    if (laterQueue.length > 0) {
      laterVerified = false;
      const remaining = drain(laterQueue, WARM_COMPILE_BUDGET_MS);
      signalPrograms();
      return remaining + 1;
    }
    if (laterVerified) return 0;
    // Verification (as `verify` does for the start rung's output): a
    // whole-scene compile per lower output once its links have landed;
    // anything it creates is linked on the following frames.
    if (linksPending()) return 1;
    const before = programs().length;
    for (const output of targets.slice(1)) {
      try {
        intoOutput(output, () => gl.compile(scene, camera));
      } catch {
        // A half-built material / lost context: the pose renders show it.
      }
    }
    const created = programs().length - before;
    verifyCreated += created;
    signalPrograms();
    noteOrigins('verify-later');
    if (created === 0) laterVerified = true;
    return created === 0 ? 0 : 1;
  };

  const shadowSlice = (): number => {
    if (casters === null) {
      const list: Object3D[] = [];
      scene.traverse((object) => {
        if ((object as Mesh).isMesh === true && object.castShadow) list.push(object);
      });
      casters = list;
    }
    // Chunks until the frame's budget is spent (cached variants cost ~nothing;
    // a chunk that mints new programs ends the slice through the program cap).
    const allowed = linkBudget();
    if (allowed <= 0) {
      signalPrograms();
      return Math.max(1, casters.length);
    }
    const started = performance.now();
    const before = programs().length;
    do {
      const chunk = casters.splice(0, WARM_SHADOW_CASTERS_PER_FRAME);
      if (chunk.length === 0) break;
      compileShadowVariants(gl, chunk, scene, camera);
      // Progress for the stall detector even when every variant was cached.
      castersDone += chunk.length;
    } while (casters.length > 0 && performance.now() - started < WARM_COMPILE_BUDGET_MS && programs().length - before < allowed);
    deps.signal('casters', castersDone);
    signalPrograms();
    noteOrigins('shadows');
    return casters.length;
  };

  const verifySlice = (): number => {
    const before = programs().length;
    try {
      // The start rung's output; the lower rungs' outputs verify in `laterSlice`.
      intoOutput(outputs()[0], () => gl.compile(scene, camera));
    } catch {
      // A half-built material / lost context: the pose renders show it.
    }
    const all: Object3D[] = [];
    scene.traverse((object) => {
      if ((object as Mesh).isMesh === true && object.castShadow) all.push(object);
    });
    compileShadowVariants(gl, all, scene, camera);
    verifyPasses += 1;
    const created = programs().length - before;
    verifyCreated += created;
    deps.signal('verifies', verifyPasses);
    signalPrograms();
    noteOrigins(`verify:${verifyPasses}`);
    return created;
  };

  // Buffers (ENGINE r2): the scene's renderables drawn in byte-budgeted
  // chunks. A chunk is isolated by a camera layer nobody else uses: the
  // chunk's objects and EVERY light gain the layer for the draw (so the light
  // state, and with it every program key, is the real one), frustum culling
  // is off for the chunk, and everything is restored in the same call.
  let bufferQueue: { object: Object3D; output: number }[] | null = null;
  // Per output: the geometries whose bytes were counted, and the materials
  // already drawn once (their programs' first draw into that output).
  const bufferGeometries = new Map<number, WeakSet<object>>();
  let buffersDone = 0;
  const bufferTargets = new Map<number, WebGLRenderTarget>();

  const bufferCamera = new PerspectiveCamera();
  const geometryBytes = (object: Object3D, output: number): number => {
    const geometry = (object as Mesh).geometry as (Mesh['geometry'] & { index?: { array?: ArrayLike<number> & { byteLength?: number } } | null }) | undefined;
    let seen = bufferGeometries.get(output);
    if (seen === undefined) {
      seen = new WeakSet<object>();
      bufferGeometries.set(output, seen);
    }
    if (!geometry || seen.has(geometry)) return 0;
    seen.add(geometry);
    let bytes = 0;
    for (const attribute of Object.values(geometry.attributes)) {
      const array = (attribute as { array?: { byteLength?: number } }).array;
      bytes += array?.byteLength ?? 0;
    }
    bytes += geometry.index?.array?.byteLength ?? 0;
    const instanced = object as Object3D & { instanceMatrix?: { array?: { byteLength?: number } } };
    bytes += instanced.instanceMatrix?.array?.byteLength ?? 0;
    return bytes;
  };
  // ENGINE r4: "first draw" is judged per D3D EXECUTABLE, not per material.
  // ANGLE builds a program's executables on its first draw with a given
  // vertex layout (and, for a caster, its depth program's), so a material
  // whose programs and layout were already drawn into an output is cheap to
  // draw again — r3 counted every material as new, which throttled the
  // stage to one or three objects per frame for nothing.
  const layoutKeys = new WeakMap<object, string>();
  const layoutKey = (object: Object3D): string => {
    const r = object as Renderable & ShadowCaster & { geometry?: Mesh['geometry']; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
    const geometry = r.geometry;
    const kind = r.isSkinnedMesh ? 's' : r.isInstancedMesh ? `i${r.instanceColor ? 'c' : ''}` : r.isBatchedMesh ? 'b' : r.isPoints ? 'p' : r.isLine ? 'l' : r.isSprite ? 'x' : 'm';
    if (!geometry) return kind;
    let key = layoutKeys.get(geometry);
    if (key === undefined) {
      const parts: string[] = [];
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const a = attribute as { array?: { constructor?: { name?: string } }; itemSize?: number; normalized?: boolean; isInterleavedBufferAttribute?: boolean };
        parts.push(`${name}:${a.array?.constructor?.name ?? '?'}:${a.itemSize ?? 0}:${a.normalized ? 1 : 0}${a.isInterleavedBufferAttribute ? 'x' : ''}`);
      }
      parts.sort();
      const index = geometry.index as { array?: { constructor?: { name?: string } } } | null;
      key = `${parts.join(',')}|${index?.array?.constructor?.name ?? '-'}|${Object.keys(geometry.morphAttributes).length}`;
      layoutKeys.set(geometry, key);
    }
    return `${kind}|${key}`;
  };
  const programSetKey = (material: Material): string => {
    const programs = (propertiesOf(gl).get(material) as { programs?: Map<string, { id?: number }> }).programs;
    if (!programs || programs.size === 0) return `m:${material.uuid}`;
    const ids: number[] = [];
    for (const program of programs.values()) ids.push(program.id ?? -1);
    return ids.sort((a, b) => a - b).join(',');
  };
  const drawKeys = (object: Object3D, output: number): string[] => {
    const layout = layoutKey(object);
    const keys: string[] = [];
    for (const material of materialsOf(object)) {
      keys.push(`${programSetKey(material)}|${layout}`);
      if (output === 0 && object.castShadow) keys.push(`d|${material.side}|${material.alphaTest > 0 ? 1 : 0}|${layout}`);
    }
    return keys;
  };
  const drawnKeys = new Map<number, Set<string>>();
  /** Executables of `object` not yet drawn into `output` (marks them drawn). */
  const newMaterials = (object: Object3D, output: number): number => {
    let seen = drawnKeys.get(output);
    if (seen === undefined) {
      seen = new Set<string>();
      drawnKeys.set(output, seen);
    }
    let fresh = 0;
    for (const key of drawKeys(object, output)) {
      if (seen.has(key)) continue;
      seen.add(key);
      fresh += 1;
    }
    return fresh;
  };
  /** Executables of `object` not yet drawn into `output` (read only). */
  const pendingFresh = (object: Object3D, output: number): number => {
    const seen = drawnKeys.get(output);
    let fresh = 0;
    for (const key of drawKeys(object, output)) if (seen === undefined || !seen.has(key)) fresh += 1;
    return fresh;
  };
  const bufferSlice = (): number => {
    if (bufferQueue === null) {
      // POKEMON-CORE C5 / A1 step 5: every latch actor is visible before the
      // first buffer slice (a hidden one is a warm stage error, R4).
      assertLatchVisible();
      const list: Object3D[] = [];
      scene.traverseVisible((object) => {
        if (isRenderable(object)) list.push(object);
      });
      // ENGINE r3: every output a real frame can draw into, the start rung's
      // first. A program's first draw into an output builds its D3D
      // executables for that vertex layout and render-target layout
      // synchronously in the ANGLE GPU process (a Chrome trace: nine
      // `D3DCompile` calls, 0.24 s, on the GPU main thread at the first
      // lower-rung pose — a 0.3 s compositor freeze). Here each is paid in
      // its own small chunk.
      bufferQueue = outputs().flatMap((_, output) => list.map((object) => ({ object, output })));
    }
    if (bufferQueue.length === 0) return 0;
    // ENGINE r4 (CAR r3 cadence): a slice is up to WARM_BUFFER_NEW_MATERIALS
    // DRAWS, each carrying at most WARM_BUFFER_DRAW_NEW_MATERIALS first-drawn
    // material(s) and flushed on its own, so the GPU process runs each as its
    // own task (a D3D executable build is 10-35 ms) and the compositor is
    // scheduled between them — r3 packed three into one 42-55 ms GPU task.
    const started = performance.now();
    let draws = 0;
    let freshDraws = 0;
    let stepBytes = 0;
    while (bufferQueue.length > 0 && draws < WARM_BUFFER_DRAWS_PER_STEP) {
      if (draws > 0 && (performance.now() - started >= WARM_COMPILE_BUDGET_MS || stepBytes >= WARM_BUFFER_BYTES_PER_FRAME)) break;
      // At most WARM_BUFFER_NEW_MATERIALS draws with a first-drawn material
      // per step (each builds D3D executables); draws of materials already
      // drawn there are cheap and fill the rest of the step.
      const head = bufferQueue[0];
      const stepFresh = deps.veiled?.() === true ? VEILED_WARM.freshDrawsPerStep : freshBudget;
      if (freshDraws >= stepFresh && pendingFresh(head.object, head.output) > 0) break;
      const drawn = bufferDraw(WARM_BUFFER_BYTES_PER_FRAME - stepBytes);
      stepBytes += drawn.bytes;
      if (drawn.count > 0) draws += 1;
      if (drawn.fresh > 0) freshDraws += 1;
    }
    deps.signal('buffers', buffersDone);
    signalPrograms();
    noteOrigins('buffers');
    return bufferQueue.length;
  };

  /** One buffer draw (see `bufferSlice`); returns the renderables it drew and its first-drawn materials. */
  const bufferDraw = (byteBudget: number): { count: number; fresh: number; bytes: number } => {
    if (bufferQueue === null || bufferQueue.length === 0) return { count: 0, fresh: 0, bytes: 0 };
    const output = bufferQueue[0].output;
    const chunk: Object3D[] = [];
    let bytes = 0;
    let fresh = 0;
    const veiled = deps.veiled?.() === true;
    const perDraw = veiled ? VEILED_WARM.freshPerDraw : WARM_BUFFER_DRAW_NEW_MATERIALS;
    while (
      bufferQueue.length > 0 &&
      bufferQueue[0].output === output &&
      (chunk.length === 0 || (bytes < byteBudget && fresh + pendingFresh(bufferQueue[0].object, output) <= perDraw))
    ) {
      const item = bufferQueue.shift();
      if (!item || item.object.parent === null) continue;
      const itemBytes = geometryBytes(item.object, output);
      const itemFresh = newMaterials(item.object, output);
      // ENGINE-FIX (D32): behind the theme veil an object with nothing new
      // for this output — its geometry uploaded and every executable it
      // draws with built (a palette swap re-uses the first load's) — is not
      // drawn again: a swap's buffers stage re-drew the whole world in one
      // 0.24-0.28 s draw for nothing.
      if (veiled && itemBytes === 0 && itemFresh === 0) {
        buffersDone += 1;
        continue;
      }
      bytes += itemBytes;
      fresh += itemFresh;
      chunk.push(item.object);
    }
    if (chunk.length === 0) return { count: 0, fresh: 0, bytes };
    const lights: Object3D[] = [];
    scene.traverse((object) => {
      if ((object as Light).isLight === true) lights.push(object);
    });
    const saved: { object: Object3D; mask: number; culled: boolean }[] = [];
    for (const object of [...chunk, ...lights]) saved.push({ object, mask: object.layers.mask, culled: object.frustumCulled });
    const source = camera as Camera & { near?: number; far?: number };
    bufferCamera.position.copy((camera as PerspectiveCamera).position);
    bufferCamera.quaternion.copy((camera as PerspectiveCamera).quaternion);
    if (typeof source.near === 'number') bufferCamera.near = source.near;
    if (typeof source.far === 'number') bufferCamera.far = source.far;
    bufferCamera.updateProjectionMatrix();
    bufferCamera.updateMatrixWorld(true);
    bufferCamera.layers.set(WARM_BUFFER_LAYER);
    const target = outputs()[output] ?? outputs()[0];
    let drawTarget = bufferTargets.get(output);
    if (drawTarget === undefined) {
      drawTarget = drawTargetFor(target, 16, 16);
      bufferTargets.set(output, drawTarget);
    }
    // ENGINE r3: the shadow pass draws the chunk too (its casters only: the
    // shadow pass tests the same camera layer). The first shadow draw of
    // every caster used to land in pose 1 as one whole-scene batch, and on
    // ANGLE / D3D11 a program's first draw with a new vertex layout builds
    // its D3D executable synchronously in the GPU process: a 0.3-0.39 s
    // compositor freeze at the start of the poses stage (r3 probes). The
    // map's contents are scratch here — pose 1 and every real frame redraw
    // the whole map.
    const shadowAuto = gl.shadowMap.autoUpdate;
    const shadowNeeds = gl.shadowMap.needsUpdate;
    gl.shadowMap.autoUpdate = false;
    // The shadow pass is the same for every output: the start rung's only.
    // ENGINE r4: and only when the draw carries a caster (each shadow draw
    // clears the whole map).
    gl.shadowMap.needsUpdate = gl.shadowMap.enabled && output === 0 && chunk.some((object) => object.castShadow);
    try {
      for (const object of chunk) {
        object.layers.enable(WARM_BUFFER_LAYER);
        object.frustumCulled = false;
      }
      for (const light of lights) light.layers.enable(WARM_BUFFER_LAYER);
      intoOutput(
        target,
        () => {
          gl.clear(true, true, false);
          deps.rawRender(scene, bufferCamera);
        },
        drawTarget,
      );
    } catch {
      // A lost context: the deadline resolves it.
    } finally {
      for (const entry of saved) {
        entry.object.layers.mask = entry.mask;
        entry.object.frustumCulled = entry.culled;
      }
      gl.shadowMap.autoUpdate = shadowAuto;
      gl.shadowMap.needsUpdate = shadowNeeds;
    }
    buffersDone += chunk.length;
    // ENGINE r4: its own GPU task (see `bufferSlice`).
    flushGpu();
    return { count: chunk.length, fresh, bytes };
  };

  /** Programs whose first-use work ran (`primeSlice`). */
  const primed = new WeakSet<object>();
  const primeSlice = (): number => {
    const started = performance.now();
    let remaining = 0;
    let done = 0;
    for (const program of programs() as (ProgramLike & { getUniforms?: () => unknown; getAttributes?: () => unknown })[]) {
      if (primed.has(program) || isStaleProgram(program)) continue;
      if (typeof program.isReady === 'function' && !program.isReady()) continue; // still linking: a later slice
      if (done > 0 && performance.now() - started >= WARM_PRIME_BUDGET_MS) {
        remaining += 1;
        continue;
      }
      primed.add(program);
      done += 1;
      try {
        program.getUniforms?.();
        program.getAttributes?.();
      } catch {
        // A lost context: the deadline resolves it.
      }
    }
    if (done > 0) {
      primedCount += done;
      deps.signal('primed', primedCount);
    }
    return remaining;
  };
  let primedCount = 0;

  /** ROLLOUT-PLAN E3: one banded step of a giant face (allocation through the un-deferred `initTexture`). */
  let bandSteps = 0;
  const uploadBandStep = (texture: Texture) => {
    bandSteps += 1;
    return stepBandedUpload(gl, texture, BAND_MAX_BYTES, (target) => uploadNow(gl, target));
  };

  /**
   * ROLLOUT-PLAN E3/E6: one banded step of a registered giant face on a frame
   * the warm spends WAITING for complete content (no compile open yet, so the
   * GPU main thread is idle between the ceremony's own frames). The faces
   * paint early (the paint queue), so their bands land here instead of
   * lengthening the textures stage. At most one step (≤ 2 MiB) per frame.
   */
  let earlyBandSteps = 0;
  const earlyBandSlice = (): void => {
    for (const texture of bandedCandidates()) {
      if (texture.image == null || texture.version === 0 || textureOnGpu(gl, texture)) continue;
      try {
        uploadBandStep(texture);
      } catch {
        uploadFailed.add(texture);
      }
      earlyBandSteps += 1;
      flushGpu();
      return;
    }
  };

  const textureSlice = (): number => {
    if (textures === null) {
      const all = new Set<Texture>();
      scene.traverse((object) => {
        const material = (object as Object3D & { material?: Material | Material[] }).material;
        if (!material) return;
        for (const entry of Array.isArray(material) ? material : [material]) materialTextures(entry, all);
      });
      const background = scene.background as unknown as Texture | null;
      if (background !== null && background.isTexture === true && background !== scene.environment) all.add(background);
      for (const texture of deferredUploads(gl)) all.add(texture);
      textures = [...all];
    }
    // ENGINE r4: an outside upload deferred AFTER the list was built (a
    // board's pages arriving mid-warm) joins it — the settle stage requires
    // this list empty, so nothing deferred can outlive the warm.
    for (const texture of deferredUploads(gl)) if (!textures.includes(texture)) textures.push(texture);
    const started = performance.now();
    let done = 0;
    let stepBytes = 0;
    const byteCap = deps.veiled?.() !== true && linksPending() ? WARM_TEXTURE_BYTES_WHILE_LINKING : WARM_TEXTURE_BYTES_PER_STEP;
    while (textures.length > 0) {
      const texture = textures[0];
      if (textureOnGpu(gl, texture)) {
        textures.shift();
        continue;
      }
      if (done > 0 && performance.now() - started >= GUARD_TEXTURE_BUDGET_MS) break;
      // ROLLOUT-PLAN E3: a giant painted face goes up in bands, at most
      // BAND_MAX_BYTES per step, and stays at the head of the list until its
      // last band has landed (the fence spaces the steps, one per frame).
      const banded = bandedUploadWanted(texture);
      // R6: the GPU side too — at least one texture, then no more than
      // WARM_TEXTURE_BYTES_PER_STEP behind it (the fence spaces the steps).
      const bytes = banded ? nextBandedStepBytes(texture) : textureUploadBytes(texture);
      if (done > 0 && stepBytes + bytes > byteCap) break;
      stepBytes += bytes;
      done += 1;
      if (banded) {
        let complete = true;
        try {
          complete = uploadBandStep(texture).done;
        } catch {
          uploadFailed.add(texture);
        }
        flushGpu();
        if (!complete) break;
        textures.shift();
        uploads += 1;
        continue;
      }
      textures.shift();
      try {
        uploadNow(gl, texture);
        uploads += 1;
        // ENGINE r4: each upload (and its mip build) its own GPU task.
        flushGpu();
      } catch {
        uploadFailed.add(texture);
      }
    }
    deps.signal('uploads', uploads);
    noteOrigins('textures');
    return textures.length;
  };

  let screenCompiled = false;
  let screenMaterialCount = -1;
  /** R6: texture steps run inside the compile stage (`uploadWhileLinking`; trace). */
  let earlyUploads = 0;
  const passSlice = (): number => {
    if (passQueue === null) {
      passQueue = deps.passes().map((entry) => ({ entry, compiled: false }));
      screenCompiled = false;
    }
    const head = passQueue[0];
    if (!head) {
      if (screenCompiled) return 0;
      // Last step: the screen variants of the terminal pass (see `screenMaterials`).
      screenCompiled = true;
      const materials = deps.screenMaterials?.() ?? [];
      screenMaterialCount = materials.length;
      if (materials.length === 0) return 0;
      const previous = gl.getRenderTarget();
      const face = gl.getActiveCubeFace();
      const mip = gl.getActiveMipmapLevel();
      try {
        gl.setRenderTarget(null);
        for (const material of materials) proxyScene.add(new Mesh(fullscreen, material));
        gl.compile(proxyScene, ortho, proxyScene);
      } catch {
        // The first real frame links it instead.
      } finally {
        proxyScene.clear();
        gl.setRenderTarget(previous, face, mip);
      }
      signalPrograms();
      noteOrigins('pass-screen');
      // One more frame so the machine waits for these links too.
      return 1;
    }
    if (!head.compiled) {
      // Step 1: link the pass's materials without a draw, a few per frame
      // under the same link cap as the scene compile.
      if (head.pending === undefined) {
        head.pending = [...head.entry.materials()];
        passSteps += 1;
        deps.signal('passSteps', passSteps);
      }
      const allowed = warmLinkBudget(frameIntervalMs, linksInFlight(), linkCap.cap);
      if (allowed <= 0) return passQueue.length;
      const before = programs().length;
      while (head.pending.length > 0 && programs().length - before < allowed) {
        const material = head.pending.shift();
        if (!material) break;
        try {
          intoScratch(() => {
            proxyScene.add(new Mesh(fullscreen, material));
            gl.compile(proxyScene, ortho, proxyScene);
          });
        } catch {
          // The render below (or the first frame) links it instead.
        } finally {
          proxyScene.clear();
        }
      }
      if (head.pending.length === 0) head.compiled = true;
      signalPrograms();
      noteOrigins(`pass-compile:${head.entry.key}`);
      return passQueue.length;
    }
    // Step 2, on a later frame once the links landed: render it once.
    if (linksPending()) return passQueue.length;
    passQueue.shift();
    try {
      head.entry.warm?.();
    } catch {
      // The first real frame draws (and links) it instead.
    }
    passesDone += 1;
    deps.signal('passes', passesDone);
    signalPrograms();
    noteOrigins(`pass-render:${head.entry.key}`);
    // The screen step (below, on the next call) is still owed.
    return passQueue.length + (screenCompiled ? 0 : 1);
  };

  const poseSlice = (): number => {
    if (poseQueue === null) {
      // ENGINE r3: the lower rungs' outputs too (a governor step's first
      // frames drew every program's first use there: a 0.4 s task at 1->2).
      const poses = deps.poses();
      poseQueue = outputs().flatMap((_, output) => poses.map((pose) => ({ pose, output })));
      posesDone = 0;
    }
    if (poseQueue.length === 0) return 0;
    // ENGINE-FIX (D32): behind the theme veil only the FIRST pose (the
    // start rung's output, station 0) is rendered. A swap's programs,
    // shadow variants, uploads, first-draw buffers (every output) and passes
    // are warmed by the stages before this; that first pose exercises the
    // shadow pass (its casters' maps: skipped, the first real frame after
    // the arm paid 0.14 s there), and the other poses only re-drew the world
    // the first load already drew from every station (0.1-0.3 s of the
    // opaque hold). The quiet probe's sweep / jump legs after a swap judge it.
    if (deps.veiled?.() === true && posesDone > 0) {
      poseQueue.length = 0;
      return 0;
    }
    // Paced (ENGINE r2): a pose is a whole-scene draw; on a frame that shows
    // the GPU still busy, wait a frame instead of queueing another behind it.
    // Not behind the theme veil (ENGINE-FIX, D32): nothing there to keep smooth.
    if (posesDone > 0 && frameIntervalMs >= WARM_FRAME_SLOW_MS && deps.veiled?.() !== true) return poseQueue.length;
    const next = poseQueue.shift();
    if (!next) return 0;
    const pose = next.pose;
    const canvasWidth = Math.max(1, gl.domElement.width);
    const canvasHeight = Math.max(1, gl.domElement.height);
    const width = Math.max(1, Math.round(canvasWidth * WARM_POSE_SCALE));
    const height = Math.max(1, Math.round(canvasHeight * WARM_POSE_SCALE));
    const output = outputs()[next.output] ?? outputs()[0];
    let drawTarget = poseTargets.get(next.output);
    if (drawTarget === undefined) {
      drawTarget = drawTargetFor(output, width, height);
      poseTargets.set(next.output, drawTarget);
    } else if (drawTarget.width !== width || drawTarget.height !== height) drawTarget.setSize(width, height);
    const source = camera as Camera & { near?: number; far?: number };
    poseCamera.position.set(pose.position.x, pose.position.y, pose.position.z);
    poseCamera.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    poseCamera.fov = pose.fov;
    poseCamera.aspect = canvasWidth / canvasHeight;
    if (typeof source.near === 'number') poseCamera.near = source.near;
    if (typeof source.far === 'number') poseCamera.far = source.far;
    poseCamera.layers.mask = camera.layers.mask;
    poseCamera.updateProjectionMatrix();
    poseCamera.updateMatrixWorld(true);
    // The shadow pass (its depth programs, casters' buffers, the map
    // itself) is exercised by the first pose; the later ones reuse the map,
    // so each pose is one main-pass draw of GPU work, not two.
    const shadowAuto = gl.shadowMap.autoUpdate;
    if (posesDone > 0) gl.shadowMap.autoUpdate = false;
    try {
      intoOutput(
        output,
        () => {
          // The composer parks `autoClear` off: clear so every pose depth-tests
          // against its own frame (a stale depth would cull what it must draw).
          gl.clear(true, true, false);
          deps.rawRender(scene, poseCamera);
        },
        drawTarget,
      );
    } catch {
      // A lost context: the deadline resolves it.
    } finally {
      gl.shadowMap.autoUpdate = shadowAuto;
    }
    posesDone += 1;
    deps.signal('poses', posesDone);
    signalPrograms();
    noteOrigins(`pose:${posesDone}`);
    return poseQueue.length;
  };

  // ENGINE r4: GPU backpressure (see `LoadWarmIO.gpuIdle`). WebGL2 fences
  // only; a WebGL1 context paces by the frame interval alone, as before.
  const context = (gl.getContext?.() ?? null) as WebGL2RenderingContext | null;
  const fences = context !== null && typeof context.fenceSync === 'function' && typeof context.getSyncParameter === 'function';
  let fence: WebGLSync | null = null;
  let fencedAt = 0;
  let fenceWaits = 0;
  /** ENGINE r4: no new GPU work before this time (the duty-cycle rest after a heavy step). */
  let restUntil = 0;
  let restFrames = 0;
  /** ENGINE r4: first-drawn materials the next `buffers` step may carry (adaptive, see `gpuIdle`). */
  let freshBudget = WARM_BUFFER_NEW_MATERIALS;
  let fencePolls = 0;
  const gpuIdle = (): boolean => {
    const now = performance.now();
    pollTimers();
    // ENGINE r4: the frame interval is the rAF interval, measured on EVERY
    // frame (a frame skipped for the fence is still a frame): measured
    // between warm steps it read every fenced step as a slow frame, and the
    // pose pacing then waited forever.
    tickFrame(now);
    // ENGINE-FIX (D32): behind the opaque veil the fence is not waited on.
    if (deps.veiled?.() === true) {
      if (fence !== null && context !== null) {
        try {
          context.deleteSync(fence);
        } catch {
          // A lost context: nothing to release.
        }
      }
      fence = null;
      fencePolls = 0;
      return true;
    }
    if (fence === null || context === null) {
      if (now < restUntil) {
        restFrames += 1;
        return false;
      }
      return true;
    }
    let signaled = false;
    try {
      signaled = context.getSyncParameter(fence, context.SYNC_STATUS) === context.SIGNALED;
    } catch {
      signaled = true;
    }
    if (!signaled && now - fencedAt < WARM_FENCE_MAX_MS) {
      fenceWaits += 1;
      fencePolls += 1;
      return false;
    }
    // Adaptive first-draw budget (additive increase, halving decrease): a
    // step whose GPU work finished by the next frame was light, one that
    // needed more frames was heavy (D42 N8: `nextFreshBudget`, cap 2).
    freshBudget = nextFreshBudget(freshBudget, fencePolls, now - fencedAt);
    fencePolls = 0;
    try {
      context.deleteSync(fence);
    } catch {
      // A lost context: nothing to release.
    }
    fence = null;
    // The step kept the GPU busy for about `busy` ms (to the poll's frame
    // granularity). A heavy one is followed by a rest of the same length, so
    // the warm never holds more than about half of the GPU main thread — the
    // thread the compositor draws the ceremony on (ANGLE / D3D11 builds a
    // program's first-draw executables there, 15-35 ms each).
    const busy = now - fencedAt;
    if (WARM_GPU_REST_FACTOR > 0 && busy >= WARM_GPU_HEAVY_MS) {
      restUntil = now + Math.min(WARM_FENCE_MAX_MS, busy * WARM_GPU_REST_FACTOR);
      restFrames += 1;
      return false;
    }
    return true;
  };
  // ENGINE r5: per-step GPU time (see `LoadWarmIO.gpuTimerBegin`).
  const timerExt = (() => {
    if (deps.gpuTiming !== true) return null;
    try {
      return context !== null ? (context.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
    } catch {
      return null;
    }
  })();
  let activeTimer: { query: WebGLQuery; sink: { gpuMs?: number } } | null = null;
  let lastTimer: { query: WebGLQuery; sink: { gpuMs?: number } } | null = null;
  const pendingTimers: { query: WebGLQuery; sink: { gpuMs?: number } }[] = [];
  let gpuMsTotal = 0;
  let gpuMsMax = 0;
  let gpuSteps = 0;
  /** The last resolved step's GPU time (ms), null before any (or without the extension). */
  let lastGpuMs: number | null = null;
  const gpuTimerBegin = (): void => {
    if (timerExt === null || context === null || activeTimer !== null) return;
    try {
      const query = context.createQuery();
      if (query === null) return;
      context.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
      activeTimer = { query, sink: {} };
    } catch {
      activeTimer = null;
    }
  };
  const gpuTimerEnd = (): void => {
    if (timerExt === null || context === null || activeTimer === null) return;
    try {
      context.endQuery(timerExt.TIME_ELAPSED_EXT);
      pendingTimers.push(activeTimer);
      lastTimer = activeTimer;
    } catch {
      // A lost context: the query is gone with it.
    }
    activeTimer = null;
  };
  const pollTimers = (): void => {
    if (timerExt === null || context === null || pendingTimers.length === 0) return;
    let disjoint = false;
    try {
      disjoint = Boolean(context.getParameter(timerExt.GPU_DISJOINT_EXT));
    } catch {
      disjoint = true;
    }
    while (pendingTimers.length > 0) {
      const head = pendingTimers[0];
      let available = false;
      try {
        available = Boolean(context.getQueryParameter(head.query, context.QUERY_RESULT_AVAILABLE));
      } catch {
        available = true;
      }
      if (!available) break;
      pendingTimers.shift();
      try {
        if (!disjoint) {
          const ms = Number(context.getQueryParameter(head.query, context.QUERY_RESULT)) / 1e6;
          head.sink.gpuMs = Math.round(ms * 10) / 10;
          lastGpuMs = ms;
          gpuMsTotal += ms;
          gpuMsMax = Math.max(gpuMsMax, ms);
          gpuSteps += 1;
        }
        context.deleteQuery(head.query);
      } catch {
        // A lost context: nothing to read.
      }
    }
  };

  const fenceGpu = (): void => {
    if (!fences || context === null || fence !== null) return;
    try {
      fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
      fencedAt = performance.now();
      context.flush();
    } catch {
      fence = null;
    }
  };

  // ENGINE r4: data faces (see `LoadWarmIO.facesSlice`).
  let faceUploads = 0;
  let facesReadyCount = -1;
  const facesSlice = (): number => {
    const list = deps.faces?.() ?? [];
    let notReady = 0;
    const started = performance.now();
    let uploadedNow = 0;
    let stepBytes = 0;
    for (const face of list) {
      if (!face.painted || !faceShown(face.object)) {
        notReady += 1;
        continue;
      }
      let missing = false;
      for (const texture of face.textures) {
        if (textureOnGpu(gl, texture)) continue;
        const banded = bandedUploadWanted(texture);
        const bytes = banded ? nextBandedStepBytes(texture) : textureUploadBytes(texture);
        if (uploadedNow > 0 && (performance.now() - started >= GUARD_TEXTURE_BUDGET_MS || stepBytes + bytes > WARM_TEXTURE_BYTES_PER_STEP)) {
          missing = true;
          continue;
        }
        stepBytes += bytes;
        try {
          // ROLLOUT-PLAN E3: a giant face lands one banded step at a time.
          if (banded) uploadBandStep(texture);
          else uploadNow(gl, texture);
          uploadedNow += 1;
          faceUploads += 1;
        } catch {
          // A lost context: the deadline resolves it.
        }
        if (!textureOnGpu(gl, texture)) missing = true;
      }
      if (missing) notReady += 1;
    }
    if (uploadedNow > 0) deps.signal('uploads', uploads + faceUploads);
    const ready = list.length - notReady;
    if (ready !== facesReadyCount) {
      facesReadyCount = ready;
      deps.signal('faces', ready);
    }
    return notReady;
  };

  // ENGINE r4: the post chain's targets (see `LoadWarmIO.targetSlice`).
  const clearedTargets = new WeakSet<object>();
  let targetsCleared = 0;
  const targetSlice = (): number => {
    const list = (deps.renderTargets?.() ?? []).filter((target) => !clearedTargets.has(target) && target.width > 1 && target.height > 1);
    const next = list[0];
    if (next === undefined) return 0;
    clearedTargets.add(next);
    const previous = gl.getRenderTarget();
    const face = gl.getActiveCubeFace();
    const mip = gl.getActiveMipmapLevel();
    try {
      gl.setRenderTarget(next);
      gl.clear(true, next.depthBuffer, next.stencilBuffer);
    } catch {
      // A lost context: the deadline resolves it.
    } finally {
      gl.setRenderTarget(previous, face, mip);
    }
    flushGpu();
    targetsCleared += 1;
    deps.signal('passes', passesDone + targetsCleared);
    return list.length - 1;
  };

  return {
    gpuIdle,
    fenceGpu,
    gpuTimerBegin,
    gpuTimerEnd,
    bindGpuSink: (sink: { gpuMs?: number }) => {
      if (lastTimer === null) return;
      // Carry a result that already landed; otherwise the poll fills it in.
      if (lastTimer.sink.gpuMs !== undefined) sink.gpuMs = lastTimer.sink.gpuMs;
      lastTimer.sink = sink;
      lastTimer = null;
    },
    facesSlice,
    targetSlice,
    prepare: () => {
      issuedThisFrame = false;
      const now = performance.now();
      // A caller without `gpuIdle` (tests, a WebGL1 context) measures here.
      if (lastPrepareAt === null || now - lastPrepareAt > 1) tickFrame(now);
      linkCap = stepLinkCap(linkCap, frameIntervalMs);
      runWarmPrepare(scene, camera, gl);
    },
    collect,
    compileSlice,
    laterSlice,
    linksPending,
    uploadWhileLinking: () => {
      // Only once the compile gate opened on complete content (a texture
      // listed before its image arrived must never be skipped by the warm),
      // and never on a frame that already put translations on the GPU.
      if (issuedThisFrame) return;
      // ROLLOUT-PLAN E6: still waiting for the content — band the giant faces.
      if (compileOpenedAt === null || !deps.contentComplete()) {
        earlyBandSlice();
        return;
      }
      earlyUploads += textureSlice() >= 0 ? 1 : 0;
    },
    contentComplete: deps.contentComplete,
    shadowSlice,
    verifySlice,
    textureSlice,
    primeSlice,
    bufferSlice,
    passSlice,
    poseSlice,
    requestFrame: deps.requestFrame,
    frameDrawn: deps.frameDrawn,
    programCount: () => {
      noteOrigins('frame');
      return programs().length;
    },
    programOrigins: () => [...origins].map(([key, origin]) => ({ ...origin, key })),
    compileOpenedAt: () => compileOpenedAt,
    compileGateOpen: () => lastGateOpen,
    frameStats: () => ({ frameMs: Math.round(frameIntervalMs * 10) / 10, cap: linkCap.cap }),
    dispose: () => {
      if (fence !== null && context !== null) {
        try {
          context.deleteSync(fence);
        } catch {
          // A lost context: nothing to release.
        }
        fence = null;
      }
      scratch.dispose();
      screenScratch.dispose();
      for (const target of poseTargets.values()) target.dispose();
      for (const target of bufferTargets.values()) target.dispose();
      fullscreen.dispose();
      proxyScene.clear();
    },
    report: () => ({
      variants: seenKeys.size,
      compiledVariants,
      uploads,
      poses: posesDone,
      passes: passesDone,
      verifyPasses,
      verifyCreated,
      buffers: buffersDone,
      evicted,
      screenMaterials: screenMaterialCount,
      signature,
      signatureLog: signatureLog.slice(),
      pmrem: pmrem === null ? null : pmrem.materials.length,
      fenceWaits,
      restFrames,
      freshBudget,
      targetsCleared,
      faceUploads,
      bandSteps,
      earlyBandSteps,
      facesReady: facesReadyCount,
      earlyUploadSteps: earlyUploads,
      gpu: timerExt === null ? null : { steps: gpuSteps, totalMs: Math.round(gpuMsTotal), maxMs: Math.round(gpuMsMax * 10) / 10, lastMs: lastGpuMs === null ? null : Math.round(lastGpuMs * 10) / 10 },
    }),
  };
}

// ── Theme-swap program retention (ENGINE-FIX, D32) ─────────────────────────
//
// A day/night swap of a live world re-renders the scene with the new palette,
// and every component that builds its material from the palette builds a NEW
// one and disposes the old. three deletes a program (and forgets a custom
// shader's source id) when its last user is disposed — and the old material
// is disposed in the swap's commit, BEFORE the warm compiles its successor.
// So a successor with the very same program key re-linked it from scratch
// (and a ShaderMaterial got a NEW source id, i.e. a new key: clouds, 8 per
// swap), and the veil held for seconds over links that changed nothing.
//
// The capture runs behind the opaque veil just before the swap commits: every
// material the scene draws with has its `dispose` deferred. Disposals the
// swap's commit asks for are recorded instead, so the old programs and shader
// ids stay alive while the new materials compile against them (three's
// program cache hands them over: no link). Once the new generation's warm
// settled — still behind the veil — `settleThemeSwap` keeps the replaced
// materials as the LEFT palette's set (its programs survive for the way
// back) and really disposes the set kept from the target palette's last
// visit (its programs are now held by the new live materials). At most one
// kept set per palette key: bounded, whatever the number of swaps.

interface SwapCapture {
  fromKey: string;
  /** Materials whose `dispose` is deferred (own-property shadow of the prototype method). */
  patched: Set<Material>;
  /** Of those, the ones a disposal was asked for during the swap. */
  asked: Set<Material>;
}

let swapCapture: SwapCapture | null = null;
const keptSets = new Map<string, Material[]>();

/** Drop the own-property `dispose` shadow (the prototype's method shows through again). */
function dropDisposeShadow(material: Material): void {
  Reflect.deleteProperty(material, 'dispose');
}

function realDispose(material: Material): void {
  dropDisposeShadow(material);
  try {
    material.dispose();
  } catch {
    // A lost context: nothing to release.
  }
}

function unpatch(capture: SwapCapture): void {
  for (const material of capture.patched) dropDisposeShadow(material);
}

/** Every material the scene's renderables draw with (Mesh, Points, Line, Sprite...). */
function sceneMaterials(scene: Object3D): Set<Material> {
  const out = new Set<Material>();
  scene.traverse((object) => {
    if (!isRenderable(object)) return;
    for (const material of materialsOf(object)) out.add(material);
  });
  return out;
}

/**
 * Behind the opaque veil, just before the swap commits (`fromKey` is the
 * palette being left, e.g. `plaza:day`): defer every scene material's
 * disposal. A capture still open (a second flip under the veil) keeps its
 * first `fromKey` and adds the materials of the in-between palette.
 */
export function captureThemeSwap(scene: Object3D, fromKey: string): void {
  const capture = swapCapture ?? { fromKey, patched: new Set<Material>(), asked: new Set<Material>() };
  for (const material of sceneMaterials(scene)) {
    if (capture.patched.has(material)) continue;
    capture.patched.add(material);
    const asked = capture.asked;
    (material as Material & { dispose: () => void }).dispose = () => {
      asked.add(material);
    };
  }
  swapCapture = capture;
}

/** Whether a swap capture is open (trace / tests). */
export function themeSwapCaptured(): boolean {
  return swapCapture !== null;
}

/**
 * The swap's generation is warm (every successor compiled against the kept
 * programs), still behind the veil: close the capture. Returns how many
 * materials were kept for the left palette and how many from an earlier
 * visit of `toKey` were really disposed.
 */
export function settleThemeSwap(scene: Object3D, toKey: string): { kept: number; released: number } {
  const capture = swapCapture;
  if (capture === null) return { kept: 0, released: 0 };
  swapCapture = null;
  unpatch(capture);
  const live = sceneMaterials(scene);
  const replaced: Material[] = [];
  // A disposal asked for a material the scene still draws with (the warm's
  // own variant eviction, or a component re-using it) is dropped: disposing
  // a live material would re-link it on its next draw — after the veil.
  for (const material of capture.asked) if (!live.has(material)) replaced.push(material);
  // The target palette's set from its last visit: its programs are held by
  // the new live materials now.
  let released = 0;
  const previous = keptSets.get(toKey);
  if (previous !== undefined) {
    keptSets.delete(toKey);
    for (const material of previous) {
      if (live.has(material)) continue;
      realDispose(material);
      released += 1;
    }
  }
  // The left palette's replaced materials: kept (undisposed) for the way
  // back; an older kept set of that palette is released (the same programs).
  const older = keptSets.get(capture.fromKey);
  keptSets.set(capture.fromKey, replaced);
  if (older !== undefined) {
    for (const material of older) {
      if (live.has(material)) continue;
      realDispose(material);
      released += 1;
    }
  }
  return { kept: replaced.length, released };
}

/**
 * The world is gone or went Lite: close any capture (honouring the disposals
 * it deferred) and release every kept set.
 */
export function releaseThemeSwapRetention(): void {
  const capture = swapCapture;
  swapCapture = null;
  if (capture !== null) {
    unpatch(capture);
    for (const material of capture.asked) realDispose(material);
  }
  for (const set of keptSets.values()) for (const material of set) realDispose(material);
  keptSets.clear();
}

/** Trace: the kept sets' sizes per palette key. */
export function themeSwapRetention(): { open: boolean; kept: Record<string, number> } {
  const kept: Record<string, number> = {};
  for (const [key, set] of keptSets) kept[key] = set.length;
  return { open: swapCapture !== null, kept };
}
