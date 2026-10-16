'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  clipPhase01,
  gridSamples,
  occlusionVerdict,
  projectAabbToRect,
  type AabbLike,
  type OccluderCount,
  type RaySample,
  type ScreenRect,
  type Vec3,
} from '@/lib/route-world/evidence-probe';
import { focusStore } from './focus/focus-store';
import { listFigures } from './figures/figure-registry';
import { figureDirectorFaceSource, getActiveFigureDirector } from './figures/FigureDirector';
import type { ActionLike } from '@/lib/route-world/figure-director';
import type { BeatsReport } from '@/lib/route-world/ambient-beats';

/**
 * Fidelity-review evidence bridges (proposal S9) — `?routeDebug=1` only,
 * mounted beside `DebugSceneAudit` and deleted on unmount, the same contract
 * as every other debug bridge: pure inspection, nothing in the scene is
 * mutated, never present outside debug sessions.
 *
 *  - `window.__routeWorldOcclusion({ nx, ny, include })` projects every focus
 *    subject's world AABB and every figure's world box through the LIVE
 *    camera, casts an `nx × ny` ray grid into each projected rect, and marks
 *    a ray blocked when the first real hit sits closer than the ray's entry
 *    into the subject's box. Rows: id, kind, rect (viewport CSS px),
 *    onScreen, occludedFraction, topOccluders.
 *  - `window.__routeWorldFigures()` rows the figure registry (clip, loop
 *    phase, pose, role/state). Until `Figure.tsx` registers, it falls back to
 *    a scene-graph scan for figure roots and says so in every row — the
 *    AnimationMixer is not reachable from the scene graph, so scan rows carry
 *    no clip or phase.
 *  - `window.__routeWorldCamera()` progress / direction / yaw for the W6
 *    sweep recorder: progress and (when the rig publishes them) direction and
 *    yaw come from the CameraRig probe as-is; `yaw` / `pitch` here are always
 *    measured from the live camera's world direction.
 *  - `window.__routeWorldBeats()` (POKEMON-CORE A2): the ambient beat bus's
 *    snapshot (`BeatsReport`) plus the director's `directorMs` percentiles.
 *
 *  - `window.__routeWorldRenderLog` (review round 3, W6 yaw proof): while
 *    started, a `gl.render` wrapper stamps the MAIN camera's heading / pitch
 *    once per R3F frame at the moment it is drawn, with the frame's own R3F
 *    delta — the per-render turn rate, independent of rAF sampling. The
 *    wrapper is installed on start() and removed on stop(); nothing is
 *    wrapped otherwise.
 *  - `window.__routeWorldSubjects()` (round 3, W1/W6 subject presence): per
 *    registered focus subject — is its raycast proxy in the scene, are the
 *    proxy's ancestors visible, how many visible renderables its content
 *    group holds (or, for a bounds-only subject, how many visible renderables
 *    sit inside its bounds), and its projected on-screen rect.
 *  - `window.__routeWorldContent()` (round 3): visible renderables and drawn
 *    instances inside the live camera frustum — the station content count.
 *  - Wave 2 (2H): `__routeWorldCamera()` also passes through the conductor's
 *    `activeIndex` and 2A's latched `settled` (null until published);
 *    `__routeWorldGlDebug()` adds `autoReset` (the --audit arm's whole-frame
 *    proof); occluder labels name the nearest named ancestors, and a static
 *    batch hit resolves to the hidden member under the hit point.
 *
 * The round-3 reads refresh world matrices and let three cache missing
 * geometry bounds (what the renderer's own culling does anyway); the render
 * log wraps `gl.render` only while started. Scene content is never changed.
 *
 * Honesty notes: raycasts cannot see Points / sprites / lines (their hit
 * thresholds are not surfaces, so they are skipped), shader-displaced
 * vertices, or post effects. Nearly transparent materials (opacity < 0.05)
 * are skipped as non-occluding. Figure boxes use three's cached mesh bounds —
 * a skinned mesh's box is computed once, not per animated frame. On-demand
 * only: nothing here runs per frame.
 */

/** A hit must sit at least this far in front of the subject's box entry to block it (m). */
const SURFACE_EPS = 0.05;
/** Materials fainter than this do not occlude. */
const MIN_OCCLUDER_OPACITY = 0.05;
const DEFAULT_GRID = { nx: 6, ny: 4 } as const;
/** Group-name prefixes the scene-scan fallback treats as figure roots. */
const FIGURE_ROOT_PREFIXES = ['figure-', 'ambient-'];

type Include = 'all' | 'subjects' | 'figures';

export interface OcclusionOptions {
  nx?: number;
  ny?: number;
  include?: Include;
}

export interface OcclusionRow {
  id: string;
  kind: string;
  source: 'focus' | 'figure';
  rect: ScreenRect | null;
  onScreen: boolean;
  onScreenFraction: number;
  samples: number;
  considered: number;
  occludedFraction: number | null;
  topOccluders: OccluderCount[];
}

export interface OcclusionReport {
  viewport: { width: number; height: number };
  grid: { nx: number; ny: number };
  camPos: Vec3;
  figureSource: FigureSource;
  rows: OcclusionRow[];
  notes: string[];
}

type FigureSource = 'registry' | 'scene-scan' | 'none';

export interface FigureRow {
  id: string;
  model: string | null;
  source: 'registry' | 'scene-scan';
  clip: string | null;
  phase01: number | null;
  time: number | null;
  duration: number | null;
  timeScale: number | null;
  weight: number | null;
  running: boolean | null;
  worldPos: Vec3;
  /** Radians, 0 = facing +Z, positive toward +X. */
  yaw: number;
  /** Effectively visible (no hidden ancestor) AND at least partly on screen. */
  visible: boolean;
  effectiveVisible: boolean;
  onScreenFraction: number;
  rect: ScreenRect | null;
  role: string | null;
  state: string | null;
  lowMotion: boolean | null;
  note: string | null;
  // ── POKEMON-CORE A1 step 8 (registry rows only; null on scene-scan rows) ──
  /** `file|clip` of the clip playing now (the W2 same-clipKey key). */
  clipKey: string | null;
  /** Participant id (aces). */
  subjectId: string | null;
  dormant: boolean | null;
  /** A path / drift mover, and whether it holds a mover slot now. */
  mover: boolean | null;
  moverGranted: boolean | null;
  /** Cumulative fidget passes since load (P12), and per clip. */
  fidgets: number | null;
  fidgetsByClip: Record<string, number> | null;
  /** The allocated base phase in [0, 1). */
  basePhase: number | null;
  breathing: boolean | null;
  /** R14: the mixer was not sampled last frame (out of view or hidden). */
  gated: boolean | null;
}

export interface FiguresReport {
  source: FigureSource;
  count: number;
  rows: FigureRow[];
  note: string | null;
  /**
   * A1 fix-2 (R16): the figure director's awake clock (s) at this read, so a
   * trace can state how many awake seconds its frames cover (null without a director).
   */
  awakeS: number | null;
}

export interface CameraReport {
  smooth: number | null;
  exact: number | null;
  index: number | null;
  pin: number | null;
  /** From the CameraRig probe when it publishes one; null otherwise. */
  direction: number | null;
  velocity: number | null;
  probeYaw: number | null;
  /** Measured from the live camera: radians, 0 = looking down -Z, positive toward +X. */
  yaw: number;
  pitch: number;
  camPos: Vec3;
  fov: number | null;
  focusPhase: string;
  // ── Review round 2 (additive; W6 sweep/jump/panel/dither recorder) ──
  /** The rig's hysteretic nearest station (`progress.nearest`); null when the probe lacks it. */
  nearest: number | null;
  /** The rig's heading before pointer parallax — the authored path alone. */
  pathYaw: number | null;
  /** Multi-station skip-through state from the rig probe; null when absent. */
  skip: { active: boolean; influence: number; from: number; to: number } | null;
  /** Focus blend 0..1 from the rig probe (null without a focused subject). */
  focusBlend: number | null;
  /**
   * The key light: the brightest visible directional light (id = name, else
   * uuid prefix) and its intensity, plus a hash of every visible directional
   * / spot / hemisphere light's intensity (3 dp) so a consumer flipping any
   * light shows up as a hash change. Null when the scene has none.
   */
  keyLight: { id: string; intensity: number; hash: string } | null;
  // ── Round 3 (additive; null until the rig publishes them) ──
  /** Radians the turn limiter moved the camera on the rig's last frame. */
  lastTurnDeltaRad: number | null;
  /** The rig's last clamped frame dt, seconds. */
  lastDt: number | null;
  // ── Wave 2 (2H, additive; read-only consumers of the rig probe) ──
  /** The conductor's active station index (`conductor.activeIndex`); null when unpublished. */
  activeIndex: number | null;
  /**
   * The latched station-settle signal (2A `useStationSettle`) when the probe
   * publishes it (`settled`, or `stationSettle.settled`); null = not
   * published — the harness records that as unmeasured, never as settled.
   */
  settled: boolean | null;
}

/** One main-camera draw, stamped inside the `gl.render` wrapper. */
export interface RenderYawSample {
  /** performance.now() at the draw call (ms). */
  t: number;
  /** Local R3F frame counter (one sample per frame at most). */
  frame: number;
  /** The frame's own R3F delta in ms (the clock the rig's limiter uses). */
  clockDtMs: number | null;
  /** atan2(forward.x, −forward.z), radians. */
  yaw: number;
  pitch: number;
  /** Full orientation change since the previous logged draw, radians. */
  angleFromPrevRad: number | null;
}

export interface RenderLogDump {
  samples: RenderYawSample[];
  dropped: number;
  installed: boolean;
}

export interface SubjectPresenceRow {
  id: string;
  kind: string;
  proxyFound: boolean;
  /** Every ancestor of the raycast proxy is visible (null without a proxy). */
  ancestorsVisible: boolean | null;
  contentSource: 'group' | 'bounds' | 'none';
  renderables: number;
  visibleRenderables: number;
  /** Visible draws counted per instance (an InstancedMesh counts its `count`). */
  visibleInstances: number;
  /** Visible meshes whose material map has a loaded image (painted surfaces). */
  textured: number;
  rect: ScreenRect | null;
  onScreenFraction: number;
  rectArea: number;
  present: boolean;
  reasons: string[];
}

export interface ContentReport {
  renderables: number;
  instances: number;
  byType: Record<string, number>;
}

/** How long the light list is cached between scene traversals (ms). */
const LIGHT_CACHE_MS = 1000;

type EvidenceHost = Window & {
  __routeWorldOcclusion?: (options?: OcclusionOptions) => OcclusionReport;
  __routeWorldFigures?: () => FiguresReport;
  __routeWorldCamera?: () => CameraReport;
  __routeWorldProbe?: () => Record<string, unknown>;
  __routeWorldSubjects?: () => { viewport: { width: number; height: number }; rows: SubjectPresenceRow[] };
  __routeWorldContent?: () => ContentReport;
  __routeWorldRenderLog?: {
    start: (maxSamples?: number) => void;
    stop: () => RenderLogDump;
    active: () => boolean;
  };
  /**
   * Review round 5 (W7 judge: every loader trace runs with ?routeDebug=1,
   * so three's per-program shader check may be on): the renderer's live
   * `debug.checkShaderErrors`, so a trace records whether its hitch
   * magnitudes include that cost (e.g. with `--param routeShaderCheck=0`).
   */
  __routeWorldGlDebug?: () => { checkShaderErrors: boolean; programs: number | null; autoReset: boolean };
  /**
   * POKEMON-CORE A2 (step 4): the beat bus — grants (each with the requester's
   * face NDC distance, K4), denials per reason, the suppression reason, the
   * reading window, roll-call hits per `subjectId` (K3), quiet mode and the
   * figure beats (K1), plus the director's per-frame cost from the warm-stats
   * ledger's `directorMs` ring. Null while no director is mounted.
   */
  __routeWorldBeats?: () => BeatsReport | null;
};

/** Default bound of the render log (≈ 5 min at 60 fps). */
const RENDER_LOG_MAX = 18_000;
/** A material fainter than this is not "visible content". */
const MIN_CONTENT_OPACITY = 0.01;

type Renderable = THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;

function isRenderable(object: THREE.Object3D): object is Renderable {
  const o = object as THREE.Mesh & THREE.Points & THREE.Line & THREE.Sprite;
  return Boolean(o.isMesh || o.isPoints || o.isLine || o.isSprite) && !object.userData?.focusSubject;
}

function materialsOf(object: Renderable): THREE.Material[] {
  const material = object.material as THREE.Material | THREE.Material[] | undefined;
  return Array.isArray(material) ? material : material ? [material] : [];
}

function materialShows(object: Renderable): boolean {
  const list = materialsOf(object);
  if (list.length === 0) return true;
  return list.some((m) => m.visible && !(m.transparent && m.opacity < MIN_CONTENT_OPACITY));
}

function isTextured(object: Renderable): boolean {
  return materialsOf(object).some((m) => {
    const map = (m as THREE.MeshBasicMaterial).map;
    const image = map?.image as { width?: unknown } | null | undefined;
    return Boolean(image && typeof image.width === 'number' && image.width > 0);
  });
}

function instancesOf(object: Renderable): number {
  const instanced = object as THREE.InstancedMesh;
  return instanced.isInstancedMesh ? Math.max(0, instanced.count) : 1;
}

/** World box of ONE renderable (not its children); null when it has none. */
function worldBoxOf(object: Renderable, out: THREE.Box3): THREE.Box3 | null {
  const instanced = object as THREE.InstancedMesh;
  if (instanced.isInstancedMesh) {
    if (instanced.boundingBox === null) instanced.computeBoundingBox();
    if (!instanced.boundingBox) return null;
    return out.copy(instanced.boundingBox).applyMatrix4(object.matrixWorld);
  }
  const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if (!geometry) return null;
  if (geometry.boundingBox === null) geometry.computeBoundingBox();
  if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return null;
  return out.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
}

interface ResolvedFigure {
  id: string;
  model: string | null;
  object: THREE.Object3D;
  action: ActionLike | null;
  role: string | null;
  state: string | null;
  lowMotion: boolean | null;
  source: 'registry' | 'scene-scan';
}

const SCAN_NOTE =
  'scene-scan fallback: no figure has registered; the AnimationMixer is not reachable from the scene graph, so clip and phase are unknown';

function effectivelyVisible(object: THREE.Object3D, cache: Map<THREE.Object3D, boolean>): boolean {
  const cached = cache.get(object);
  if (cached !== undefined) return cached;
  const result = object.visible && (object.parent ? effectivelyVisible(object.parent, cache) : true);
  cache.set(object, result);
  return result;
}

function isDescendantOf(object: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === root) return true;
  return false;
}

function materialOccludes(object: THREE.Object3D): boolean {
  const material = (object as THREE.Mesh).material;
  const list = Array.isArray(material) ? material : material ? [material] : [];
  if (list.length === 0) return true;
  return list.some(
    (m) => m.visible && !(m.transparent && m.opacity < MIN_OCCLUDER_OPACITY) && m.colorWrite !== false,
  );
}

/**
 * The nearest named ancestors of `object` (itself included), outermost
 * first, at most `max` of them — e.g. "plaza-facade/window-frame". Walks to
 * the scene root (round 5 stopped after 5 levels and fell back to a uuid).
 */
function namedChain(object: THREE.Object3D, max = 2): string | null {
  const names: string[] = [];
  for (let node: THREE.Object3D | null = object; node && names.length < max; node = node.parent) {
    if (node.name && node.type !== 'Scene') names.unshift(node.name);
  }
  return names.length > 0 ? names.join('/') : null;
}

/** A readable description of an unnamed renderable: geometry and material. */
function describeUnnamed(object: THREE.Object3D): string {
  const mesh = object as THREE.Mesh;
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
    | (THREE.Material & { color?: THREE.Color })
    | undefined;
  const geometry = mesh.geometry?.type ?? object.type;
  const mat = material ? `${material.name || material.type}${material.color ? `#${material.color.getHexString()}` : ''}` : 'no-material';
  return `unnamed ${geometry}·${mat}`;
}

/**
 * Wave 2 (2H, residual 4): a static batch is merged at the scene root with
 * no name, so round 5 reported occluders as batch hashes. Its members stay
 * in the scene, hidden, at their authored place in the named hierarchy; the
 * label resolves the HIT POINT to the hidden member whose world box contains
 * it (smallest box wins; merged InstancedMesh batches share their members'
 * geometry, so those resolve per member instance). Read-only: world boxes
 * from cached geometry bounds and the members' last matrixWorld (static by
 * construction — the batcher only folds meshes whose matrices held still).
 */
interface BatchMember {
  object: THREE.Object3D;
  box: THREE.Box3;
}

function batchMembersOf(batch: THREE.Mesh, scene: THREE.Scene, cache: Map<THREE.Object3D, BatchMember[]>): BatchMember[] {
  const cached = cache.get(batch);
  if (cached) return cached;
  const members: BatchMember[] = [];
  const batchMaterial = (Array.isArray(batch.material) ? batch.material[0] : batch.material) as THREE.Material & {
    color?: THREE.Color;
    map?: THREE.Texture | null;
  };
  const sameLook = (m: THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null }) =>
    m === batchMaterial ||
    (m.type === batchMaterial.type &&
      (m.color?.getHex() ?? -1) === (batchMaterial.color?.getHex() ?? -1) &&
      (m.map?.uuid ?? null) === (batchMaterial.map?.uuid ?? null));
  const instancedBatch = (batch as THREE.InstancedMesh).isInstancedMesh === true;
  const local = new THREE.Box3();
  const instance = new THREE.Matrix4();
  scene.traverse((object) => {
    if (object.visible || object === batch || object.userData?.staticBatch) return;
    const mesh = object as THREE.Mesh & THREE.InstancedMesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material & {
      color?: THREE.Color;
      map?: THREE.Texture | null;
    };
    if (!material || !sameLook(material)) return;
    if (instancedBatch) {
      if (!mesh.isInstancedMesh || mesh.geometry !== batch.geometry) return;
      if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
      const geometryBox = mesh.geometry.boundingBox;
      if (!geometryBox) return;
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, instance);
        instance.premultiply(mesh.matrixWorld);
        members.push({ object: mesh, box: local.copy(geometryBox).applyMatrix4(instance).clone() });
      }
      return;
    }
    if (mesh.isInstancedMesh) return;
    if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (!box || box.isEmpty()) return;
    members.push({ object: mesh, box: box.clone().applyMatrix4(mesh.matrixWorld) });
  });
  cache.set(batch, members);
  return members;
}

function labelOf(
  object: THREE.Object3D,
  hit?: { point: THREE.Vector3 },
  scene?: THREE.Scene,
  batchCache?: Map<THREE.Object3D, BatchMember[]>,
): string {
  if (object.userData?.staticBatch) {
    let member: THREE.Object3D | null = null;
    if (hit && scene && batchCache) {
      let best = Infinity;
      const size = new THREE.Vector3();
      for (const candidate of batchMembersOf(object as THREE.Mesh, scene, batchCache)) {
        if (!candidate.box.clone().expandByScalar(0.05).containsPoint(hit.point)) continue;
        candidate.box.getSize(size);
        const volume = size.x * size.y * size.z;
        if (volume < best) {
          best = volume;
          member = candidate.object;
        }
      }
    }
    const name = member ? namedChain(member) ?? describeUnnamed(member) : describeUnnamed(object);
    return `batch ${name} (${object.type})`;
  }
  return `${namedChain(object) ?? describeUnnamed(object)} (${object.type})`;
}

function resolveFigures(scene: THREE.Scene): { source: FigureSource; figures: ResolvedFigure[] } {
  const registered: ResolvedFigure[] = [];
  for (const entry of listFigures()) {
    // Figure.tsx registers its THREE.Group (the frozen type is structural).
    const object = entry.object.current as THREE.Object3D | null;
    if (!object) continue;
    registered.push({
      id: entry.id,
      model: entry.model ?? null,
      object,
      action: entry.getAction?.() ?? null,
      role: entry.getRole?.() ?? entry.role ?? null,
      state: entry.getState?.() ?? null,
      lowMotion: entry.lowMotion ?? null,
      source: 'registry',
    });
  }
  if (registered.length > 0) return { source: 'registry', figures: registered };

  // Fallback: named figure roots first (traverse is parent-first), then any
  // skinned mesh not already inside one, rooted at its nearest named ancestor.
  const roots = new Set<THREE.Object3D>();
  const inRoot = (object: THREE.Object3D) => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (roots.has(node)) return true;
    return false;
  };
  scene.traverse((object) => {
    if (FIGURE_ROOT_PREFIXES.some((prefix) => object.name.startsWith(prefix)) && !inRoot(object)) {
      roots.add(object);
      return;
    }
    if (!(object as THREE.SkinnedMesh).isSkinnedMesh || inRoot(object)) return;
    let root: THREE.Object3D = object;
    for (let node = object.parent; node && node !== scene; node = node.parent) {
      if (node.name) {
        root = node;
        break;
      }
    }
    roots.add(root);
  });
  const figures = [...roots].map<ResolvedFigure>((object) => ({
    id: object.name || object.uuid.slice(0, 8),
    model: null,
    object,
    action: null,
    role: null,
    state: null,
    lowMotion: null,
    source: 'scene-scan',
  }));
  return { source: figures.length > 0 ? 'scene-scan' : 'none', figures };
}

/** POKEMON-CORE A1 step 8: the director's per-figure row (null fields on scene-scan rows). */
function directorFields(id: string | null): Pick<
  FigureRow,
  'clipKey' | 'subjectId' | 'dormant' | 'mover' | 'moverGranted' | 'fidgets' | 'fidgetsByClip' | 'basePhase' | 'breathing' | 'gated'
> {
  const row = id !== null ? (getActiveFigureDirector()?.row(id) ?? null) : null;
  return {
    clipKey: row?.clipKey ?? null,
    subjectId: row?.subjectId ?? null,
    dormant: row ? row.dormant : null,
    mover: row ? row.mover : null,
    moverGranted: row ? row.moverGranted : null,
    fidgets: row ? row.fidgets : null,
    fidgetsByClip: row ? { ...row.fidgetsByClip } : null,
    basePhase: row?.phase ?? null,
    breathing: row ? row.breathing : null,
    gated: row ? row.gated === true : null,
  };
}

function boxOf(object: THREE.Object3D): AabbLike | null {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return null;
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

function worldPosOf(object: THREE.Object3D): Vec3 {
  const p = object.getWorldPosition(new THREE.Vector3());
  return [p.x, p.y, p.z];
}

function numberField(body: Record<string, unknown> | null, key: string): number | null {
  const value = body?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The probe's latched settle flag: `settled`, or `stationSettle.settled` / `settle.settled`. */
function settledField(body: Record<string, unknown> | null): boolean | null {
  if (!body) return null;
  if (typeof body.settled === 'boolean') return body.settled;
  for (const key of ['stationSettle', 'settle']) {
    const nested = body[key];
    if (nested && typeof nested === 'object' && typeof (nested as { settled?: unknown }).settled === 'boolean') {
      return (nested as { settled: boolean }).settled;
    }
  }
  return null;
}

export default function EvidenceBridges() {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  // Round 3: the R3F frame counter + delta the render log stamps (priority 0,
  // so it runs before a composer's priority-1 render and never takes over).
  const frameClock = useRef({ frame: 0, deltaMs: null as number | null });
  useFrame((_, delta) => {
    frameClock.current.frame += 1;
    frameClock.current.deltaMs = delta * 1000;
  });

  useEffect(() => {
    const host = window as EvidenceHost;

    /** Live camera, its view-projection, and the canvas box in viewport CSS px. */
    const view = () => {
      const camera = get().camera;
      camera.updateMatrixWorld(true);
      const viewProj = new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .toArray();
      const canvasBox = gl.domElement.getBoundingClientRect();
      return { camera, viewProj, canvasBox, width: canvasBox.width, height: canvasBox.height };
    };

    const toViewport = (rect: ScreenRect | null, box: DOMRect): ScreenRect | null =>
      rect ? { x: rect.x + box.left, y: rect.y + box.top, w: rect.w, h: rect.h } : null;

    host.__routeWorldOcclusion = (options = {}) => {
      const nx = options.nx ?? DEFAULT_GRID.nx;
      const ny = options.ny ?? DEFAULT_GRID.ny;
      const include = options.include ?? 'all';
      const { camera, viewProj, canvasBox, width, height } = view();
      const raycaster = new THREE.Raycaster();
      raycaster.layers.mask = camera.layers.mask;
      const visibility = new Map<THREE.Object3D, boolean>();
      // Wave 2 (2H): per-call cache of each static batch's hidden members
      // (readable occluder names instead of batch hashes).
      const batchMembers = new Map<THREE.Object3D, BatchMember[]>();
      const ndc = new THREE.Vector2();
      const entryPoint = new THREE.Vector3();
      const rows: OcclusionRow[] = [];

      const probeSubject = (
        id: string,
        kind: string,
        source: OcclusionRow['source'],
        bounds: AabbLike,
        own: THREE.Object3D | null,
      ) => {
        const projected = projectAabbToRect(bounds, viewProj, width, height);
        const box = new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
        const rays: RaySample[] = [];
        if (projected.rect) {
          for (const point of gridSamples(projected.rect, nx, ny, width, height)) {
            ndc.set(point.ndcX, point.ndcY);
            raycaster.setFromCamera(ndc, camera);
            raycaster.near = 0;
            raycaster.far = Infinity;
            const inside = box.containsPoint(raycaster.ray.origin);
            const entry = inside ? raycaster.ray.origin : raycaster.ray.intersectBox(box, entryPoint);
            if (!entry) {
              rays.push({ onSubject: false, blocked: false, occluder: null });
              continue;
            }
            const entryDistance = inside ? 0 : entry.distanceTo(raycaster.ray.origin);
            const far = entryDistance - SURFACE_EPS;
            if (far <= 0) {
              rays.push({ onSubject: true, blocked: false, occluder: null });
              continue;
            }
            raycaster.far = far;
            const hits = raycaster.intersectObjects(scene.children, true);
            const blocker = hits.find((hit) => {
              const object = hit.object;
              if (object.userData?.focusSubject) return false; // invisible focus proxies
              const kindOf = object as THREE.Points & THREE.Line & THREE.Sprite;
              if (kindOf.isPoints || kindOf.isLine || kindOf.isSprite) return false;
              if (!effectivelyVisible(object, visibility)) return false;
              if (own && isDescendantOf(object, own)) return false;
              return materialOccludes(object);
            });
            rays.push({
              onSubject: true,
              blocked: Boolean(blocker),
              occluder: blocker ? labelOf(blocker.object, blocker, scene, batchMembers) : null,
            });
          }
        }
        const verdict = occlusionVerdict(rays);
        rows.push({
          id,
          kind,
          source,
          rect: toViewport(projected.rect, canvasBox),
          onScreen: projected.rect !== null,
          onScreenFraction: projected.onScreenFraction,
          samples: verdict.samples,
          considered: verdict.considered,
          occludedFraction: verdict.occludedFraction,
          topOccluders: verdict.topOccluders,
        });
      };

      if (include !== 'figures') {
        for (const subject of focusStore.subjects()) {
          probeSubject(subject.id, subject.kind, 'focus', subject.bounds, null);
        }
      }
      const { source: figureSource, figures } = include === 'subjects' ? { source: 'none' as const, figures: [] } : resolveFigures(scene);
      for (const figure of figures) {
        if (!effectivelyVisible(figure.object, visibility)) continue;
        const bounds = boxOf(figure.object);
        if (bounds) probeSubject(figure.id, 'figure', 'figure', bounds, figure.object);
      }

      const notes = [
        'rays skip Points/Line/Sprite, focus proxies, hidden objects and materials with opacity < 0.05; post effects and shader displacement are invisible to them',
      ];
      if (figureSource === 'scene-scan') notes.push(SCAN_NOTE);
      return {
        viewport: { width, height },
        grid: { nx, ny },
        camPos: worldPosOf(camera),
        figureSource,
        rows,
        notes,
      };
    };

    host.__routeWorldFigures = () => {
      const { viewProj, canvasBox, width, height } = view();
      const { source, figures } = resolveFigures(scene);
      const visibility = new Map<THREE.Object3D, boolean>();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const facing = new THREE.Vector3();
      const rows = figures.map<FigureRow>((figure) => {
        figure.object.getWorldPosition(position);
        figure.object.getWorldQuaternion(quaternion);
        facing.set(0, 0, 1).applyQuaternion(quaternion);
        const effectiveVisible = effectivelyVisible(figure.object, visibility);
        const bounds = boxOf(figure.object);
        const projected = bounds ? projectAabbToRect(bounds, viewProj, width, height) : null;
        const action = figure.action;
        const clip = action?.getClip() ?? null;
        return {
          id: figure.id,
          model: figure.model,
          source: figure.source,
          clip: clip?.name ?? null,
          phase01: action && clip ? clipPhase01(action.time, clip.duration) : null,
          time: action ? action.time : null,
          duration: clip ? clip.duration : null,
          timeScale: action ? action.timeScale : null,
          weight: action ? action.getEffectiveWeight() : null,
          running: action ? action.isRunning() : null,
          worldPos: [position.x, position.y, position.z],
          yaw: Math.atan2(facing.x, facing.z),
          visible: effectiveVisible && (projected?.onScreenFraction ?? 0) > 0,
          effectiveVisible,
          onScreenFraction: projected?.onScreenFraction ?? 0,
          rect: toViewport(projected?.rect ?? null, canvasBox),
          role: figure.role,
          state: figure.state,
          lowMotion: figure.lowMotion,
          note: figure.source === 'scene-scan' ? SCAN_NOTE : null,
          ...directorFields(figure.source === 'registry' ? figure.id : null),
        };
      });
      return { source, count: rows.length, rows, note: source === 'scene-scan' ? SCAN_NOTE : null, awakeS: getActiveFigureDirector()?.awakeS() ?? null };
    };

    // ── Round 3: subject presence (W1 "occlusion PASS on a subject that was
    // never drawn") ────────────────────────────────────────────────────────
    host.__routeWorldSubjects = () => {
      const { viewProj, canvasBox, width, height } = view();
      scene.updateMatrixWorld();
      const visibility = new Map<THREE.Object3D, boolean>();
      const proxies = new Map<string, THREE.Object3D>();
      scene.traverse((object) => {
        const id = object.userData?.focusSubject;
        if (typeof id === 'string' && !proxies.has(id)) proxies.set(id, object);
      });
      // Every renderable with its world box, built once per call and only
      // when a bounds-only subject needs it.
      let placed: { object: Renderable; center: THREE.Vector3 }[] | null = null;
      const allPlaced = () => {
        if (placed) return placed;
        const list: { object: Renderable; center: THREE.Vector3 }[] = [];
        const box = new THREE.Box3();
        scene.traverse((object) => {
          if (!isRenderable(object)) return;
          const world = worldBoxOf(object, box);
          if (world) list.push({ object, center: world.getCenter(new THREE.Vector3()) });
        });
        placed = list;
        return list;
      };
      const rows = focusStore.subjects().map<SubjectPresenceRow>((subject) => {
        const proxy = proxies.get(subject.id) ?? null;
        const ancestorsVisible = proxy ? (proxy.parent ? effectivelyVisible(proxy.parent, visibility) : true) : null;
        // FocusSubject renders <group>{children}</group> then the proxy, so
        // the content group is the proxy's previous sibling.
        let group: THREE.Object3D | null = null;
        if (proxy?.parent) {
          const siblings = proxy.parent.children;
          const index = siblings.indexOf(proxy);
          const previous = index > 0 ? siblings[index - 1] : null;
          if (previous && (previous as THREE.Group).isGroup && !previous.userData?.focusSubject) group = previous;
        }
        let renderables = 0;
        let visibleRenderables = 0;
        let visibleInstances = 0;
        let textured = 0;
        const count = (object: Renderable) => {
          renderables += 1;
          if (!effectivelyVisible(object, visibility) || !materialShows(object)) return;
          visibleRenderables += 1;
          visibleInstances += instancesOf(object);
          if (isTextured(object)) textured += 1;
        };
        let contentSource: SubjectPresenceRow['contentSource'] = 'none';
        if (group) {
          group.traverse((object) => {
            if (isRenderable(object)) count(object);
          });
          if (renderables > 0) contentSource = 'group';
        }
        if (renderables === 0) {
          // Bounds-only subject (content declared elsewhere): renderables whose
          // world-box centre lies inside the subject's bounds (+10 %).
          const bounds = new THREE.Box3(new THREE.Vector3(...subject.bounds.min), new THREE.Vector3(...subject.bounds.max));
          bounds.expandByVector(bounds.getSize(new THREE.Vector3()).multiplyScalar(0.05));
          for (const entry of allPlaced()) if (bounds.containsPoint(entry.center)) count(entry.object);
          if (renderables > 0) contentSource = 'bounds';
        }
        const projected = projectAabbToRect(subject.bounds, viewProj, width, height);
        const rect = toViewport(projected.rect, canvasBox);
        const rectArea = rect ? rect.w * rect.h : 0;
        const reasons: string[] = [];
        if (!proxy) reasons.push('no-proxy');
        if (ancestorsVisible === false) reasons.push('hidden-ancestor');
        if (visibleRenderables === 0) reasons.push(renderables === 0 ? 'no-content' : 'content-hidden');
        if (projected.onScreenFraction <= 0) reasons.push('off-screen');
        else if (rectArea < 1) reasons.push('zero-area');
        const present =
          ancestorsVisible !== false && visibleRenderables > 0 && projected.onScreenFraction > 0 && rectArea >= 1;
        return {
          id: subject.id,
          kind: subject.kind,
          proxyFound: proxy !== null,
          ancestorsVisible,
          contentSource,
          renderables,
          visibleRenderables,
          visibleInstances,
          textured,
          rect,
          onScreenFraction: projected.onScreenFraction,
          rectArea,
          present,
          reasons,
        };
      });
      return { viewport: { width, height }, rows };
    };

    // ── Round 3: station content count (visible renderables in the frustum) ─
    host.__routeWorldContent = () => {
      const { viewProj } = view();
      scene.updateMatrixWorld();
      const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().fromArray(viewProj));
      const visibility = new Map<THREE.Object3D, boolean>();
      const byType: Record<string, number> = {};
      let renderables = 0;
      let instances = 0;
      scene.traverse((object) => {
        if (!isRenderable(object) || !effectivelyVisible(object, visibility) || !materialShows(object)) return;
        let inView = true;
        try {
          inView = (object as THREE.Sprite).isSprite ? frustum.intersectsSprite(object as THREE.Sprite) : frustum.intersectsObject(object);
        } catch {
          inView = true; // no bounds to test — count it rather than hide it
        }
        if (!inView) return;
        renderables += 1;
        instances += instancesOf(object);
        byType[object.type] = (byType[object.type] ?? 0) + 1;
      });
      return { renderables, instances, byType };
    };

    // ── Round 3: per-render yaw log (W6: rendered turn rate) ───────────────
    const log = {
      active: false,
      max: RENDER_LOG_MAX,
      samples: [] as RenderYawSample[],
      dropped: 0,
      loggedFrame: -1,
      prev: new THREE.Quaternion(),
      hasPrev: false,
    };
    let baseRender: THREE.WebGLRenderer['render'] | null = null;
    const quat = new THREE.Quaternion();
    const forwardScratch = new THREE.Vector3();
    const uninstall = () => {
      if (baseRender) {
        gl.render = baseRender;
        baseRender = null;
      }
    };
    host.__routeWorldRenderLog = {
      start: (maxSamples) => {
        log.samples = [];
        log.dropped = 0;
        log.loggedFrame = -1;
        log.hasPrev = false;
        log.max = typeof maxSamples === 'number' && maxSamples > 0 ? Math.min(maxSamples, RENDER_LOG_MAX) : RENDER_LOG_MAX;
        log.active = true;
        if (baseRender) return;
        const base = gl.render;
        baseRender = base;
        gl.render = (target: THREE.Object3D, camera: THREE.Camera) => {
          const clock = frameClock.current;
          if (log.active && camera === get().camera && log.loggedFrame !== clock.frame) {
            log.loggedFrame = clock.frame;
            if (log.samples.length >= log.max) log.dropped += 1;
            else {
              camera.updateMatrixWorld();
              camera.getWorldQuaternion(quat);
              forwardScratch.set(0, 0, -1).applyQuaternion(quat);
              log.samples.push({
                t: performance.now(),
                frame: clock.frame,
                clockDtMs: clock.deltaMs,
                yaw: Math.atan2(forwardScratch.x, -forwardScratch.z),
                pitch: Math.asin(THREE.MathUtils.clamp(forwardScratch.y, -1, 1)),
                angleFromPrevRad: log.hasPrev ? log.prev.angleTo(quat) : null,
              });
              log.prev.copy(quat);
              log.hasPrev = true;
            }
          }
          base.call(gl, target, camera);
        };
      },
      stop: () => {
        const installed = baseRender !== null;
        log.active = false;
        uninstall();
        return { samples: log.samples.slice(), dropped: log.dropped, installed };
      },
      active: () => log.active,
    };

    // Light list for the key-light read, refreshed at most once per
    // LIGHT_CACHE_MS (the sweep recorder calls the camera bridge every rAF).
    let lights: THREE.Light[] = [];
    let lightsAt = -Infinity;
    const keyLight = (): CameraReport['keyLight'] => {
      const now = performance.now();
      if (now - lightsAt > LIGHT_CACHE_MS) {
        lights = [];
        scene.traverse((object) => {
          const light = object as THREE.Light;
          if (
            light.isLight &&
            ((light as THREE.DirectionalLight).isDirectionalLight ||
              (light as THREE.SpotLight).isSpotLight ||
              (light as THREE.HemisphereLight).isHemisphereLight)
          ) {
            lights.push(light);
          }
        });
        lightsAt = now;
      }
      const visibility = new Map<THREE.Object3D, boolean>();
      let key: THREE.Light | null = null;
      const parts: string[] = [];
      for (const light of lights) {
        if (!effectivelyVisible(light, visibility)) continue;
        parts.push(light.intensity.toFixed(3));
        if ((light as THREE.DirectionalLight).isDirectionalLight && (!key || light.intensity > key.intensity)) key = light;
      }
      if (parts.length === 0) return null;
      return {
        id: key ? key.name || key.uuid.slice(0, 8) : 'none',
        intensity: key ? key.intensity : 0,
        hash: parts.join('|'),
      };
    };

    host.__routeWorldCamera = () => {
      const camera = get().camera;
      camera.updateMatrixWorld(true);
      const forward = camera.getWorldDirection(new THREE.Vector3());
      const read = host.__routeWorldProbe;
      const probe = typeof read === 'function' ? read() : null;
      const perspective = camera as THREE.PerspectiveCamera;
      const skipRaw = probe?.skip;
      const skip =
        skipRaw && typeof skipRaw === 'object'
          ? (skipRaw as { active?: unknown; influence?: unknown; from?: unknown; to?: unknown })
          : null;
      const focusRaw = probe?.focus;
      const focusBlend =
        focusRaw && typeof focusRaw === 'object' && typeof (focusRaw as { blend?: unknown }).blend === 'number'
          ? (focusRaw as { blend: number }).blend
          : null;
      return {
        nearest: numberField(probe, 'nearest'),
        pathYaw: numberField(probe, 'pathYaw'),
        skip: skip
          ? {
              active: skip.active === true,
              influence: typeof skip.influence === 'number' ? skip.influence : 0,
              from: typeof skip.from === 'number' ? skip.from : 0,
              to: typeof skip.to === 'number' ? skip.to : 0,
            }
          : null,
        focusBlend,
        keyLight: keyLight(),
        smooth: numberField(probe, 'smooth'),
        exact: numberField(probe, 'exact'),
        index: numberField(probe, 'index'),
        pin: numberField(probe, 'pin'),
        direction: numberField(probe, 'direction'),
        velocity: numberField(probe, 'velocity'),
        probeYaw: numberField(probe, 'yaw'),
        yaw: Math.atan2(forward.x, -forward.z),
        pitch: Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)),
        camPos: worldPosOf(camera),
        fov: perspective.isPerspectiveCamera ? perspective.fov : null,
        focusPhase: focusStore.get().phase,
        lastTurnDeltaRad: numberField(probe, 'lastTurnDeltaRad'),
        lastDt: numberField(probe, 'lastDt'),
        activeIndex: numberField(probe, 'activeIndex'),
        settled: settledField(probe),
      };
    };

    host.__routeWorldBeats = () => {
      const director = getActiveFigureDirector();
      if (!director) return null;
      // The whole ledger ring (routeDebug keeps up to WARM_STATS_FRAMES frames).
      const stats = window.__routeWarmStats?.window(0, performance.now()) ?? null;
      const has = stats !== null && stats.frames > 0;
      return {
        ...director.bus.snapshot(),
        directorMs: {
          p50: has ? stats.directorP50 : null,
          p95: has ? stats.directorP95 : null,
          ownP50: has ? stats.directorOwnP50 : null,
          ownP95: has ? stats.directorOwnP95 : null,
        },
        // R34: the face source (fail closed: unavailable → every hero grant denied 'ndc', with the reason).
        faceSource: figureDirectorFaceSource() ?? undefined,
      };
    };

    host.__routeWorldGlDebug = () => ({
      checkShaderErrors: gl.debug.checkShaderErrors === true,
      programs: Array.isArray(gl.info.programs) ? gl.info.programs.length : null,
      // Wave 2 (2H --audit): false while the debug TelemetrySampler owns the
      // counters (whole-frame draw calls); true = the count is the last pass.
      autoReset: gl.info.autoReset,
    });

    return () => {
      log.active = false;
      uninstall();
      delete host.__routeWorldOcclusion;
      delete host.__routeWorldFigures;
      delete host.__routeWorldCamera;
      delete host.__routeWorldSubjects;
      delete host.__routeWorldContent;
      delete host.__routeWorldRenderLog;
      delete host.__routeWorldGlDebug;
      delete host.__routeWorldBeats;
    };
  }, [scene, gl, get]);

  return null;
}
