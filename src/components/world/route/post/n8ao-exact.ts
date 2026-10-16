import * as THREE from 'three';
import { DepthType, N8AOPostPass } from 'n8ao';
import { onFigureSetChanged } from '@/lib/route-world/figure-director';
import { onRevealReady } from '../residency-store';
import { currentSceneGeneration } from '../world-readiness';
import { N3_TAG_BITS, N3_TAG_DW_OFF, N3_TAG_DW_ON } from './n3-tags';
import { onN3RetagRequested } from './n3-retag';

/**
 * D42 N3 (option B, exact): N8AO's transparency awareness without its
 * per-frame cost.
 *
 * Stock `N8AOPostPass` (n8ao 2.0.1, pinned by test) does, every frame:
 *  - `detectTransparency()`: a full scene traversal while auto-detect is on
 *    (it is never switched off by the r3f wrapper, which cannot forward
 *    `transparencyAware`), flipping `transparencyAware` on — and allocating
 *    the two transparency targets — the first frame a transparent material
 *    appears (a late allocation, after the reveal if the material is late);
 *  - `renderTransparency()`: a `new Map` of every object's `visible`, two
 *    `new Color`s, four whole-scene traversals that rewrite `visible`, and two
 *    scene renders (transparent without depth write, transparent with depth
 *    write), each behind a full-screen depth copy, the second one empty in
 *    every route world (glTF BLEND materials load with `depthWrite: false`).
 *
 * This subclass draws exactly the same objects:
 *  - **Tags.** Two camera layer bits (`N3_TAG_DW_OFF`, `N3_TAG_DW_ON`,
 *    `n3-tags.ts`) mark the objects each stock render would leave visible.
 *    ONE traversal applies them, when residency is complete and the reveal
 *    arms for the scene generation (`onRevealReady`), after the figure set
 *    changes (`onFigureSetChanged`) and when a transparent object mounts late
 *    outside residency and the director (`requestN3Retag`, `n3-retag.ts`: the
 *    no-model ace sprite cards); never per frame. The stock predicates are
 *    replicated byte for byte, including their subtree rule (stock hides a
 *    rejected object's whole subtree, so a node is tagged only if every
 *    material-bearing ancestor passes too) and the camera's own layer test
 *    (a node the camera would not draw is never tagged). Lights and groups
 *    are tagged like any node without a material, so the transparent draws
 *    see the same light set (no new program) and the same group order.
 *  - **The render.** `camera.layers.mask` is swapped to one tag for each
 *    render and restored; the clear colour is saved in a scratch `Color`. No
 *    Map, no traversal, no allocation per frame.
 *  - **The empty renders.** When nothing carries `N3_TAG_DW_ON`, its depth
 *    copy and render are skipped; the target is cleared once (at
 *    construction, on every resize, after a stock frame and when the set
 *    empties) so its contents are defined: no colour (alpha 0, as an empty
 *    stock render leaves it) and the cleared depth. The DW-off render is
 *    skipped the same way when nothing material-bearing carries
 *    `N3_TAG_DW_OFF`: the compositor reads only that target's alpha (0 after
 *    an empty render or a clear alike), never its depth, so a transparency-
 *    free scene (the gallery's opaque figure) pays no depth copy and no
 *    scene render for either target.
 *  - **Held objects.** The warm's compile hold parks a mask at 0 (no camera
 *    sees it). A held object is never tagged (drawing it here would link its
 *    program, which the hold exists to defer); it waits in a short pending
 *    list and takes its tags the frame it is released (no traversal). A tag
 *    applied before a hold survives the release (X15, `useStationWarmup`).
 *  - **Order (X10).** `autoDetectTransparency = false` is written FIRST, then
 *    `transparencyAware`, so `detectTransparency` can never flip it back and
 *    the targets exist from construction (D23: complete at reveal).
 *
 * Until the tags are fresh for the current scene generation (the load and a
 * D32 veil swap, before `onRevealReady`) the pass renders the stock way, so
 * every object mounted during the load is drawn exactly as before.
 *
 * Dev only, under `?routeDebug=1`:
 *  - the readout, published on `window.__routeN8ao`;
 *  - `n8aoListDrift`, only with `&routeN8aoDrift=1` as well (set by the run
 *    that measures the drift gate alone, so the D23, busy and per-draw timing
 *    runs never carry it): once per second a full traversal recomputes the
 *    tags and counts the objects whose tag bits differ (the N3 block gates it
 *    at 0);
 *  - `?routeAoTransparency=exact|stock|off`: `stock` is the library's own
 *    pass (auto-detect, Map, traversals), `off` turns transparency awareness
 *    off (AD diagnosis). Production always runs `exact`.
 */

/** Which transparency path the AO pass runs (`?routeAoTransparency`, dev + routeDebug only). */
export type AoTransparencyMode = 'exact' | 'stock' | 'off';

/** Pure: the mode a page search selects (`production` ignores the switch). */
export function parseAoTransparencyMode(search: string, production: boolean): AoTransparencyMode {
  if (production) return 'exact';
  try {
    const params = new URLSearchParams(search);
    if (params.get('routeDebug') !== '1') return 'exact';
    const raw = params.get('routeAoTransparency');
    return raw === 'stock' || raw === 'off' ? raw : 'exact';
  } catch {
    return 'exact';
  }
}

function pageSearch(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.location.search;
  } catch {
    return null;
  }
}

/** The page's mode (SSR and production: `exact`). */
export function aoTransparencyModeFromPage(): AoTransparencyMode {
  const search = pageSearch();
  if (search === null) return 'exact';
  return parseAoTransparencyMode(search, process.env.NODE_ENV === 'production');
}

/** Pure: dev + `routeDebug=1`, and `key=1` too when another key is asked for. */
export function routeDebugParam(search: string, production: boolean, key: 'routeDebug' | 'routeN8aoDrift'): boolean {
  if (production) return false;
  try {
    const params = new URLSearchParams(search);
    return params.get('routeDebug') === '1' && params.get(key) === '1';
  } catch {
    return false;
  }
}

function pageParam(key: 'routeDebug' | 'routeN8aoDrift'): boolean {
  const search = pageSearch();
  if (search === null) return false;
  return routeDebugParam(search, process.env.NODE_ENV === 'production', key);
}

/** A material-bearing node as the stock predicates read it (an array material reads `undefined`). */
type StockReadable = { material?: { transparent?: unknown; depthWrite?: unknown } | null };

/**
 * The stock DW-off predicate (`N8AO.js` renderTransparency), evaluated with
 * the same JS expression: the value stock writes to `visible`, then three's
 * own test (`projectObject` skips a node only when `visible === false`).
 */
export function stockShowsWithoutDepthWrite(object: THREE.Object3D): boolean {
  const material = (object as THREE.Object3D & StockReadable).material ?? {};
  const userData = object.userData ?? {};
  const visible: unknown = (material.transparent && !material.depthWrite && !userData.treatAsOpaque) || !!userData.cannotReceiveAO;
  return visible !== false;
}

/**
 * The stock DW-on predicate, the same way. NOTE the stock quirk this keeps:
 * a node whose `material.transparent` is not a boolean (a multi-material
 * mesh: an array has no `transparent`) gets `visible = undefined`, which
 * three DRAWS (only `false` hides) — so stock renders multi-material meshes
 * into the DW-on target, and so does the exact pass.
 */
export function stockShowsWithDepthWrite(object: THREE.Object3D): boolean {
  const material = (object as THREE.Object3D & StockReadable).material ?? {};
  const userData = object.userData ?? {};
  const visible: unknown = material.transparent && material.depthWrite && !userData.treatAsOpaque;
  return visible !== false;
}

function hasMaterial(object: THREE.Object3D): boolean {
  return !!(object as THREE.Object3D & { material?: unknown }).material;
}

/**
 * Pure: the tag bits `object` should carry, given whether its ancestors
 * admit each render (`offOk`, `onOk`) and the camera's base mask. Returns the
 * bits for this node and, through `out`, what its children inherit.
 */
export function tagBitsFor(
  object: THREE.Object3D,
  offOk: boolean,
  onOk: boolean,
  out: { off: boolean; on: boolean },
): number {
  let off = offOk;
  let on = onOk;
  if (hasMaterial(object)) {
    off = off && stockShowsWithoutDepthWrite(object);
    on = on && stockShowsWithDepthWrite(object);
  }
  out.off = off;
  out.on = on;
  return (off ? N3_TAG_DW_OFF : 0) | (on ? N3_TAG_DW_ON : 0);
}

/** Triggers the pass subscribes to (injectable for tests). */
export interface ExactAoTriggers {
  onRevealReady: (cb: () => void) => () => void;
  onFigureSetChanged: (cb: () => void) => () => void;
  /** A late, non-figure transparent mount (`requestN3Retag`); optional for test doubles. */
  onRetagRequested?: (cb: () => void) => () => void;
  generation: () => number;
}

const DEFAULT_TRIGGERS: ExactAoTriggers = {
  onRevealReady,
  onFigureSetChanged,
  onRetagRequested: onN3RetagRequested,
  generation: currentSceneGeneration,
};

/** Dev readout (`window.__routeN8ao`), mutated in place. */
export interface ExactAoStats {
  mode: AoTransparencyMode;
  /** Tags valid for the current generation (the exact path draws). */
  fresh: boolean;
  retags: number;
  taggedOff: number;
  taggedOn: number;
  pending: number;
  /** Exact-path frames that skipped the empty DW-on render and its copy. */
  skippedDwOn: number;
  /** Exact-path frames that skipped the empty DW-off render and its copy. */
  skippedDwOff: number;
  /** Frames drawn the stock way (before the tags were fresh, or `stock` mode). */
  stockFrames: number;
  /** The last drift check (objects whose tags differ from a full recompute). */
  n8aoListDrift: number;
  /** The largest drift seen. */
  n8aoListDriftMax: number;
  driftChecks: number;
}

type DriftHost = Window & { __routeN8ao?: ExactAoStats };

const DRIFT_INTERVAL_MS = 1000;

interface ExactState {
  mode: AoTransparencyMode;
  triggers: ExactAoTriggers;
  /** The generation the reveal armed for (tags may be applied for it). */
  armedGeneration: number | null;
  /** The generation the current tags were applied for. */
  taggedGeneration: number | null;
  dirty: boolean;
  dwOffCount: number;
  dwOnCount: number;
  dwOnNeedsClear: boolean;
  dwOffNeedsClear: boolean;
  pendingObjects: THREE.Object3D[];
  pendingBits: number[];
  cameraBase: number;
  savedClear: THREE.Color;
  black: THREE.Color;
  scratchOut: { off: boolean; on: boolean };
  subscribed: boolean;
  unsubscribe: Array<() => void>;
  stats: ExactAoStats;
  /** The dev drift check runs (`routeDebug=1&routeN8aoDrift=1`). */
  driftCheck: boolean;
  nextDriftAt: number;
}

/** Both targets' contents are undefined (new, resized, or a stock frame filled them): each clears once when skipped. */
function markTargetsUndefined(state: ExactState): void {
  state.dwOnNeedsClear = true;
  state.dwOffNeedsClear = true;
}

/**
 * The route's N8AO post pass (D42 N3): identical draws to the stock pass,
 * without its per-frame Map, traversals and empty renders. See the module note.
 */
export class ExactN8AOPostPass extends N8AOPostPass {
  // `declare`: no field initialiser may run after `super()` (the base
  // constructor already calls the overridden methods below).
  declare private n3: ExactState | undefined;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width?: number,
    height?: number,
    options: { mode?: AoTransparencyMode; triggers?: ExactAoTriggers; debug?: boolean; driftCheck?: boolean } = {},
  ) {
    super(scene, camera, width, height);
    const mode = options.mode ?? aoTransparencyModeFromPage();
    const debug = options.debug ?? pageParam('routeDebug');
    const driftCheck = debug && (options.driftCheck ?? pageParam('routeN8aoDrift'));
    const stats: ExactAoStats = {
      mode,
      fresh: false,
      retags: 0,
      taggedOff: 0,
      taggedOn: 0,
      pending: 0,
      skippedDwOn: 0,
      skippedDwOff: 0,
      stockFrames: 0,
      n8aoListDrift: 0,
      n8aoListDriftMax: 0,
      driftChecks: 0,
    };
    const state: ExactState = {
      mode,
      triggers: options.triggers ?? DEFAULT_TRIGGERS,
      armedGeneration: null,
      taggedGeneration: null,
      dirty: true,
      dwOffCount: 0,
      dwOnCount: 0,
      dwOnNeedsClear: true,
      dwOffNeedsClear: true,
      pendingObjects: [],
      pendingBits: [],
      cameraBase: 1,
      savedClear: new THREE.Color(),
      black: new THREE.Color(0, 0, 0),
      scratchOut: { off: false, on: false },
      subscribed: false,
      unsubscribe: [],
      stats,
      driftCheck,
      nextDriftAt: 0,
    };
    // Non-enumerable: the warm's `passMaterials` walks a pass's own enumerable
    // properties (and postprocessing's `dispose` its keys) — the state holds
    // scene objects (the pending list), which must never read as pass materials.
    Object.defineProperty(this, 'n3', { value: state, enumerable: false, writable: true, configurable: true });
    if (debug && typeof window !== 'undefined') (window as DriftHost).__routeN8ao = stats;
    if (mode === 'stock') {
      // The library's own pass: its construction-time detection, verbatim.
      super.detectTransparency();
      return;
    }
    // X10: auto-detect off FIRST, then the value (the targets allocate now).
    this.setTransparencyAware(mode === 'exact');
  }

  /**
   * Subscribe the tag triggers — lazily, on the first transparency render, so
   * an instance React builds and discards (a render-phase `useMemo`) never
   * holds a subscription; `dispose` drops them.
   */
  private subscribeTriggers(state: ExactState): void {
    if (state.subscribed) return;
    state.subscribed = true;
    state.unsubscribe.push(
      state.triggers.onRevealReady(() => {
        state.armedGeneration = state.triggers.generation();
        state.dirty = true;
      }),
      state.triggers.onFigureSetChanged(() => {
        state.dirty = true;
      }),
    );
    const onRetag = state.triggers.onRetagRequested;
    if (onRetag) {
      state.unsubscribe.push(
        onRetag(() => {
          state.dirty = true;
        }),
      );
    }
  }

  /** X10: `autoDetectTransparency = false` first, then `transparencyAware`. */
  setTransparencyAware(value: boolean): void {
    this.autoDetectTransparency = false;
    this.configuration.transparencyAware = value;
  }

  /** The dev readout (tests, probes). */
  get exactStats(): ExactAoStats | null {
    return this.n3?.stats ?? null;
  }

  override detectTransparency(): void {
    // Called by the base constructor before `n3` exists: only `stock` mode
    // detects (it does so itself, right after `super()`).
    const state = this.n3;
    if (state === undefined || state.mode !== 'stock') return;
    super.detectTransparency();
  }

  override configureTransparencyTarget(): void {
    super.configureTransparencyTarget();
    if (this.n3) markTargetsUndefined(this.n3);
  }

  override setSize(width: number, height: number): void {
    super.setSize(width, height);
    if (this.n3) markTargetsUndefined(this.n3);
  }

  override dispose(): void {
    const state = this.n3;
    if (state) {
      for (const off of state.unsubscribe) off();
      state.unsubscribe.length = 0;
      // A kept instance (Fast Refresh, a StrictMode effect replay keeping the
      // memo) subscribes again on its next render and re-arms from the reveal
      // it then hears (`onRevealReady` fires at once when already ready).
      state.subscribed = false;
      state.armedGeneration = null;
      state.pendingObjects.length = 0;
      state.pendingBits.length = 0;
    }
    super.dispose();
  }

  /** Whether the exact path draws this frame (tags fresh for the current generation). */
  private exactReady(): boolean {
    const state = this.n3;
    if (state === undefined || state.mode !== 'exact') return false;
    this.subscribeTriggers(state);
    const generation = state.triggers.generation();
    if (state.armedGeneration !== generation) return false;
    if (state.dirty || state.taggedGeneration !== generation) {
      this.retag();
      state.taggedGeneration = generation;
      state.dirty = false;
    }
    return true;
  }

  /** ONE traversal: tag every node the stock renders would leave visible. */
  retag(): void {
    const state = this.n3;
    if (state === undefined) return;
    state.cameraBase = this.camera.layers.mask & ~N3_TAG_BITS;
    state.pendingObjects.length = 0;
    state.pendingBits.length = 0;
    state.dwOffCount = 0;
    state.dwOnCount = 0;
    this.tagNode(this.scene, true, true);
    state.stats.retags += 1;
    this.publishCounts();
  }

  private tagNode(object: THREE.Object3D, offOk: boolean, onOk: boolean): void {
    const state = this.n3 as ExactState;
    const out = state.scratchOut;
    let bits = tagBitsFor(object, offOk, onOk, out);
    const childOff = out.off;
    const childOn = out.on;
    // A camera in the graph is never drawn, and its own mask stays its own.
    if ((object as THREE.Camera).isCamera !== true) {
      const base = object.layers.mask & ~N3_TAG_BITS;
      if (base === 0) {
        // Held (the compile guard's mask 0): its tags are written on release
        // (even none: the release restores the mask saved at the hold, whose
        // tags may be stale by now).
        state.pendingObjects.push(object);
        state.pendingBits.push(bits);
        bits = 0;
      } else if ((base & state.cameraBase) === 0) {
        bits = 0; // the camera never draws it; neither did the stock pass
      }
      object.layers.mask = base | bits;
      if (bits !== 0 && hasMaterial(object)) {
        if (bits & N3_TAG_DW_OFF) state.dwOffCount += 1;
        if (bits & N3_TAG_DW_ON) state.dwOnCount += 1;
      }
    }
    const children = object.children;
    for (let i = 0; i < children.length; i += 1) this.tagNode(children[i], childOff, childOn);
  }

  /** Held objects released since the tagging take their tags (no traversal, no allocation). */
  private flushPending(): void {
    const state = this.n3 as ExactState;
    const objects = state.pendingObjects;
    if (objects.length === 0) return;
    const bitsList = state.pendingBits;
    let changed = false;
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const object = objects[i];
      const base = object.layers.mask & ~N3_TAG_BITS;
      const gone = object.parent === null;
      if (!gone && base === 0) continue; // still held
      if (!gone) {
        // The camera never draws it on these layers: no tags (stock never drew it).
        const bits = (base & state.cameraBase) !== 0 ? bitsList[i] : 0;
        object.layers.mask = base | bits;
        if (hasMaterial(object)) {
          if (bits & N3_TAG_DW_OFF) state.dwOffCount += 1;
          if (bits & N3_TAG_DW_ON) state.dwOnCount += 1;
        }
      }
      const last = objects.length - 1;
      objects[i] = objects[last];
      bitsList[i] = bitsList[last];
      objects.length = last;
      bitsList.length = last;
      changed = true;
    }
    if (changed) this.publishCounts();
  }

  private publishCounts(): void {
    const state = this.n3 as ExactState;
    state.stats.taggedOff = state.dwOffCount;
    state.stats.taggedOn = state.dwOnCount;
    state.stats.pending = state.pendingObjects.length;
  }

  override renderTransparency(renderer: THREE.WebGLRenderer): void {
    const state = this.n3;
    if (!this.exactReady() || state === undefined) {
      if (state) {
        state.stats.fresh = false;
        state.stats.stockFrames += 1;
        markTargetsUndefined(state); // the stock renders fill both
      }
      super.renderTransparency(renderer);
      return;
    }
    state.stats.fresh = true;
    this.flushPending();
    const dwFalse = this.transparencyRenderTargetDWFalse;
    const dwTrue = this.transparencyRenderTargetDWTrue;
    const depthCopy = this.depthCopyPass;
    if (!dwFalse || !dwTrue || !depthCopy) return;
    const scene = this.scene;
    const camera = this.camera;
    const oldBackground = scene.background;
    renderer.getClearColor(state.savedClear);
    const oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClearDepth = renderer.autoClearDepth;
    const oldMask = camera.layers.mask;
    scene.background = null;
    renderer.autoClearDepth = false;
    renderer.setClearColor(state.black, 0);
    const uniforms = depthCopy.material.uniforms;
    uniforms.depthTexture.value = this.depthTexture;
    uniforms.reverseDepthBuffer.value = this.configuration.depthBufferType === DepthType.Reverse;
    try {
      // Transparent objects WITHOUT depth write (and `cannotReceiveAO`):
      // skipped when nothing material-bearing carries the tag (the
      // compositor reads only this target's alpha: 0 either way).
      if (state.dwOffCount > 0) {
        renderer.setRenderTarget(dwFalse);
        renderer.clear(true, true, true);
        depthCopy.render(renderer);
        camera.layers.mask = N3_TAG_DW_OFF;
        renderer.render(scene, camera);
        camera.layers.mask = oldMask;
        state.dwOffNeedsClear = true; // its contents are a render now; an empty set clears once
      } else {
        state.stats.skippedDwOff += 1;
        if (state.dwOffNeedsClear) {
          renderer.setRenderTarget(dwFalse);
          renderer.clear(true, true, true);
          state.dwOffNeedsClear = false;
        }
      }
      // Transparent objects WITH depth write: skipped when there are none.
      if (state.dwOnCount > 0) {
        renderer.setRenderTarget(dwTrue);
        renderer.clear(true, true, true);
        depthCopy.render(renderer);
        camera.layers.mask = N3_TAG_DW_ON;
        renderer.render(scene, camera);
        state.dwOnNeedsClear = true; // its contents are a render now; an empty set clears once
      } else {
        state.stats.skippedDwOn += 1;
        if (state.dwOnNeedsClear) {
          renderer.setRenderTarget(dwTrue);
          renderer.clear(true, true, true);
          state.dwOnNeedsClear = false;
        }
      }
    } finally {
      camera.layers.mask = oldMask;
      renderer.setClearColor(state.savedClear, oldClearAlpha);
      scene.background = oldBackground;
      renderer.autoClearDepth = oldAutoClearDepth;
    }
    if (state.driftCheck) this.maybeCheckDrift();
  }

  /**
   * Dev only: recompute the tags with a full traversal and count the nodes
   * whose bits differ (`n8aoListDrift`). Pending (held) nodes are expected
   * untagged. Once per second at most.
   */
  private maybeCheckDrift(): void {
    const state = this.n3 as ExactState;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now < state.nextDriftAt) return;
    state.nextDriftAt = now + DRIFT_INTERVAL_MS;
    const drift = this.listDrift();
    state.stats.n8aoListDrift = drift;
    state.stats.n8aoListDriftMax = Math.max(state.stats.n8aoListDriftMax, drift);
    state.stats.driftChecks += 1;
  }

  /** The number of nodes whose tag bits differ from a full recompute (dev check; allocates). */
  listDrift(): number {
    const state = this.n3;
    if (state === undefined) return 0;
    const cameraBase = this.camera.layers.mask & ~N3_TAG_BITS;
    const out = { off: false, on: false };
    let drift = 0;
    const visit = (object: THREE.Object3D, offOk: boolean, onOk: boolean): void => {
      let expected = tagBitsFor(object, offOk, onOk, out);
      const childOff = out.off;
      const childOn = out.on;
      const base = object.layers.mask & ~N3_TAG_BITS;
      if (base === 0 || (base & cameraBase) === 0) expected = 0;
      const camera = (object as THREE.Camera).isCamera === true;
      if (!camera && (object.layers.mask & N3_TAG_BITS) !== expected) drift += 1;
      for (const child of object.children) visit(child, childOff, childOn);
    };
    visit(this.scene, true, true);
    return drift;
  }
}
