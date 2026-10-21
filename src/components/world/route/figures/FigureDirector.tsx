'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  createAmbientBeatBus,
  parseBeatParams,
  type BeatSphere,
  type FaceSourceReason,
  type FaceSourceStatus,
} from '@/lib/route-world/ambient-beats';
import {
  createSettleState,
  paddedFaceRect,
  stepSettleLatch,
  type DataSurfaceTheme,
  type SettleState,
} from '@/lib/route-world/data-surfaces';
import {
  createFigureDirector,
  DEFAULT_DIRECTOR_SEED,
  focusSubjectOf,
  guardedFaceDistanceNdc,
  runDirectorFrame,
  type DirectorFrameInput,
  type DirectorLedger,
  type FigureDirector as FigureDirectorCore,
  type FrustumLike,
} from '@/lib/route-world/figure-director';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { focusStore } from '@/components/world/route/focus/focus-store';
import type { SubjectBounds } from '@/lib/route-world/focus';
import { applyLatchVisibility, dataFaceEntries, isResidencyComplete } from '@/components/world/route/residency-store';
import { getBallPhase, getRevealArmedAt } from '@/components/world/route/scene-progress';
import { currentSceneGeneration } from '@/components/world/route/world-readiness';
import {
  noteAppearance,
  noteDirectorMs,
  noteLateRegistration,
  noteStatsSettle,
  noteWaterline,
  warmStatsOn,
} from '@/components/world/route/perf/warm-stats';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { SAKURA_DATA_SURFACES } from '@/components/world/themes/sakura/furniture/data-faces';
import { MOUNTAIN_DATA_SURFACES } from '@/components/world/themes/mountain/furniture/data-faces';
import { CLOUDS_DATA_SURFACES } from '@/components/world/themes/clouds/furniture/data-faces';
import { moduleFigureSource } from './figure-registry';

/**
 * The figure director's React seat (POKEMON-CORE-PLAN §4 SEAT A1): the ONE
 * generation-safe `useFrame` that steps every registered figure and actor
 * through `figure-director.ts`, grants hero beats on the bus, applies the
 * push latch (`residency-store.ts`) and times itself into the warm-stats
 * ledger (`directorMs`, routeDebug only).
 *
 * Generation-safe: the core keys every allocation, settle mark and bus
 * ticket on `currentSceneGeneration()`, so a D32 veil swap re-allocates and
 * a stale generation's state never leaks into the next.
 *
 * Mounted once, inside the QualityGovernor (it reads `figureLife`), by
 * `RouteWorldCanvas.tsx`.
 *
 * Frame order (R27): the push latch is applied FIRST, then the director
 * steps (`runDirectorFrame`), so an actor the latch shows this frame is
 * sampled this frame.
 *
 * The bus's clarity precondition (A2, K4): `faceDistanceNdc` measures a
 * requester's sphere against the ACTIVE station's padded data faces
 * (`data-surfaces.ts` `paddedFaceRect`, the keep-out law's padding) at the
 * camera of the current frame. R34: the four worlds' data-surface modules
 * are imported STATICALLY (small data modules: no dynamic import, no chunk
 * fetch, so D23 holds by construction), and the source FAILS CLOSED: while
 * the active world's faces, the camera, the viewport or the station are
 * unavailable it reports 0 and the bus denies every hero grant (`ndc`), with
 * the reason in `__routeWorldBeats().faceSource`. The rects are rebuilt only
 * when the camera moved, the station changed, the canvas resized or the
 * world changed; a steady frame allocates nothing.
 */

/** R34: the data faces of each route theme (id → surfaces), imported statically. */
const ROUTE_SURFACES: Readonly<Record<string, DataSurfaceTheme>> = {
  plaza: PLAZA_DATA_SURFACES,
  sakura: SAKURA_DATA_SURFACES,
  mountain: MOUNTAIN_DATA_SURFACES,
  clouds: CLOUDS_DATA_SURFACES,
};

/** The surfaces of route theme `themeId`, null for an unknown or absent theme (the face source then fails closed). */
export function routeSurfacesFor(themeId: string | null | undefined): DataSurfaceTheme | null {
  if (typeof themeId !== 'string' || !Object.prototype.hasOwnProperty.call(ROUTE_SURFACES, themeId)) return null;
  return ROUTE_SURFACES[themeId];
}

/** Most padded faces one station carries (the teams plates included); extra faces are ignored. */
const MAX_ACTIVE_FACES = 16;

let activeDirector: FigureDirectorCore | null = null;

/** The mounted director (null outside a route canvas): the phase pin and the evidence bridges read it. */
export function getActiveFigureDirector(): FigureDirectorCore | null {
  return activeDirector;
}

/** R34: the face source's state for `__routeWorldBeats().faceSource` (null when no director is mounted). */
export function figureDirectorFaceSource(): FaceSourceStatus | null {
  if (!activeDirector) return null;
  return frameScratch().faceStatus();
}

/** A11: `director.pinPhase(t)` for the capture pin (`PhasePinBridge`). False when no director is mounted. */
export function pinFigureDirector(t: number): boolean {
  if (!activeDirector) return false;
  activeDirector.pinPhase(t);
  return true;
}

function routeDebugOn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('routeDebug') === '1';
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The ledger's clock (module function, never called during render). */
function perfNow(): number {
  return performance.now();
}

const LOADER_PHASES = new Set(['loading', 'opening', 'releasing']);

const LEDGER: DirectorLedger = {
  noteAppearance: (id, visible, inFrustum) => noteAppearance(id, visible, inFrustum),
  noteWaterline: (id, submerged) => noteWaterline(id, submerged),
};

/** The route seat's director: beat params from the URL, its own bus, the warm-stats ledger. */
function createRouteDirector(): FigureDirectorCore {
  const params = parseBeatParams(typeof window === 'undefined' ? '' : window.location.search, routeDebugOn());
  const seed = params.seed ?? DEFAULT_DIRECTOR_SEED;
  const bus = createAmbientBeatBus({ force: params.force, seed: params.seed });
  return createFigureDirector(moduleFigureSource, {
    seed,
    force: params.force,
    bus,
    ledger: LEDGER,
    clock: warmStatsOn() ? perfNow : undefined,
    onLateRegistration: (id) => {
      noteLateRegistration(id);
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[figure-director] "${id}" registered after the reveal (D23: nothing mounts after reveal)`);
      }
    },
  });
}

/**
 * The director's per-frame scratch (never reallocated; one route canvas at a
 * time, and `useFrame` runs synchronously, so a module singleton is safe).
 */
function createScratch() {
    const frustum = new THREE.Frustum();
    const viewProjection = new THREE.Matrix4();
    const sphere = new THREE.Sphere();
    const forward = new THREE.Vector3();
    const toFace = new THREE.Vector3();
    const box = new THREE.Box3();
    // R14: the planes packed for the director's inline sphere test (refilled per frame).
    const planes = new Float64Array(24);
    const frustumLike: FrustumLike = {
      planes,
      intersectsSphere(x, y, z, r) {
        sphere.center.set(x, y, z);
        sphere.radius = r;
        return frustum.intersectsSphere(sphere);
      },
    };
    const rootInFrustum = (root: THREE.Object3D): boolean => {
      box.setFromObject(root);
      if (box.isEmpty()) return false;
      box.getBoundingSphere(sphere);
      return frustum.intersectsSphere(sphere);
    };
    const input: DirectorFrameInput = {
      delta: 0,
      generation: 0,
      hidden: false,
      loader: false,
      focusOpen: false,
      focusSubjectId: null,
      live: false,
      residencyComplete: false,
      settled: false,
      station: 0,
      life: 'full',
      reducedMotion: prefersReducedMotion(),
      frustum: frustumLike,
      cameraPosition: { x: 0, y: 0, z: 0 },
      focusCenter: null,
      activeBoard: null,
      // R34: replaced below by the fail-closed source (never null).
      faceDistanceNdc: () => 0,
    };
    // R14: the frustum handed to the director while the camera is NOT still
    // (every figure samples), and the previous frame's camera and progress.
    const everywhere: FrustumLike = { intersectsSphere: () => true };
    const still = { camera: new Float64Array(16), smooth: Number.NaN };
    /**
     * A2: the active padded face source. `stamp` bumps on every frame the
     * camera moved; the NDC rects (`[x0, x1, y0, y1] × count`) are rebuilt
     * when the stamp, the station, the canvas size or the surfaces changed.
     */
    const face = {
      surfaces: null as DataSurfaceTheme | null,
      camera: null as THREE.Camera | null,
      station: 0,
      width: 0,
      height: 0,
      stamp: 0,
      built: { stamp: -1, station: -1, width: -1, height: -1, surfaces: null as DataSurfaceTheme | null },
      rects: new Float64Array(MAX_ACTIVE_FACES * 4),
      count: 0,
      projX: 1,
      projY: 1,
      /** R34: why the source cannot judge (null: available), set at each rebuild. */
      unavailable: 'no-surfaces' as FaceSourceReason | null,
    };
    const rebuildFaces = () => {
      const built = face.built;
      built.stamp = face.stamp;
      built.station = face.station;
      built.width = face.width;
      built.height = face.height;
      built.surfaces = face.surfaces;
      face.count = 0;
      const surfaces = face.surfaces;
      const camera = face.camera as THREE.PerspectiveCamera | null;
      // R34: fail closed: every missing input denies hero grants, with its reason.
      face.unavailable = !surfaces
        ? 'no-surfaces'
        : !camera || !camera.isPerspectiveCamera
          ? 'no-camera'
          : !(face.width > 0 && face.height > 0)
            ? 'no-viewport'
            : surfaces.stations[face.station]?.id === undefined
              ? 'no-station'
              : null;
      if (face.unavailable !== null || !surfaces || !camera) return;
      const stationId = surfaces.stations[face.station].id;
      // The rendered pose (read, never updated here): eye at the translation, looking down −Z.
      const m = camera.matrixWorld.elements;
      const length = Math.hypot(m[8], m[9], m[10]) || 1;
      const endpoint = {
        position: [m[12], m[13], m[14]] as [number, number, number],
        target: [m[12] - m[8] / length, m[13] - m[9] / length, m[14] - m[10] / length] as [number, number, number],
        fov: camera.fov,
      };
      const viewport = { width: face.width, height: face.height };
      for (const dataFace of surfaces.faces) {
        if (dataFace.station !== stationId || face.count >= MAX_ACTIVE_FACES) continue;
        const rect = paddedFaceRect(dataFace, endpoint, viewport);
        if (!rect) continue;
        const o = face.count * 4;
        face.rects[o] = (rect.x / face.width) * 2 - 1;
        face.rects[o + 1] = ((rect.x + rect.w) / face.width) * 2 - 1;
        face.rects[o + 2] = 1 - ((rect.y + rect.h) / face.height) * 2;
        face.rects[o + 3] = 1 - (rect.y / face.height) * 2;
        face.count += 1;
      }
    };
    const refreshFaces = () => {
      const built = face.built;
      if (built.stamp !== face.stamp || built.station !== face.station || built.width !== face.width || built.height !== face.height || built.surfaces !== face.surfaces) {
        rebuildFaces();
      }
    };
    /**
     * The bus's precondition input (R34, never null): 0 while the faces are
     * unavailable (denied), `FACE_NDC_FAR` while no active face is on screen.
     */
    const faceDistanceNdc = (sphere: BeatSphere): number => {
      refreshFaces();
      return guardedFaceDistanceNdc(face.unavailable, viewProjection.elements, face.projX, face.projY, sphere, face.rects, face.count);
    };
    input.faceDistanceNdc = faceDistanceNdc;
    /** R34: the evidence view of the source (routeDebug; allocates, never per frame). */
    const faceStatus = (): FaceSourceStatus => {
      refreshFaces();
      return { available: face.unavailable === null, reason: face.unavailable, faces: face.count };
    };
    return { frustum, planes, viewProjection, forward, toFace, input, rootInFrustum, board: { x: 0, z: 0 }, shadowDir: { x: 0, y: -1, z: 0 }, everywhere, frustumLike, still, face, faceStatus };
  }

let scratchSingleton: ReturnType<typeof createScratch> | null = null;

function frameScratch(): ReturnType<typeof createScratch> {
  if (scratchSingleton === null) scratchSingleton = createScratch();
  return scratchSingleton;
}

/**
 * Frames between key-light searches while none casts a shadow (a scene walk
 * is not free; a shadowless rung never gets one back: the governor only
 * descends after the reveal).
 */
const KEY_LIGHT_RETRY_FRAMES = 600;

/**
 * R14: the direction the key light casts shadows along (unit, light → target),
 * written into `out`; null when no visible shadow-casting directional light.
 * Searched only once live (the gate is off before the reveal, and every
 * world light has mounted by then), then cached until it leaves the scene.
 */
function keyShadowDir(
  scene: THREE.Object3D,
  cache: { light: THREE.DirectionalLight | null; generation: number; wait: number },
  generation: number,
  live: boolean,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } | null {
  if (!live) return null;
  if (cache.generation !== generation || (cache.light !== null && cache.light.parent === null)) {
    cache.generation = generation;
    cache.light = null;
    cache.wait = 0;
  }
  if (cache.light === null) {
    // A whole-scene walk: at most every KEY_LIGHT_RETRY_FRAMES while none is found.
    if (cache.wait > 0) {
      cache.wait -= 1;
      return null;
    }
    scene.traverse((object) => {
      const light = object as THREE.DirectionalLight;
      if (cache.light === null && light.isDirectionalLight && light.castShadow) cache.light = light;
    });
    // Not found (yet: lights mount with the world, or a world without one).
    if (cache.light === null) {
      cache.wait = KEY_LIGHT_RETRY_FRAMES;
      return null;
    }
  }
  const light = cache.light;
  if (!light.visible || !light.castShadow) return null;
  const a = light.matrixWorld.elements;
  const b = light.target.matrixWorld.elements;
  const x = b[12] - a[12];
  const y = b[13] - a[13];
  const z = b[14] - a[14];
  const length = Math.sqrt(x * x + y * y + z * z);
  if (!(length > 1e-6)) return null;
  out.x = x / length;
  out.y = y / length;
  out.z = z / length;
  return out;
}

export default function FigureDirector() {
  const { conductor, theme } = useWorldState();
  const themeId = theme?.id ?? null;
  const { figureLife } = useQuality();
  const life = useRef(figureLife);
  useEffect(() => {
    life.current = figureLife;
  }, [figureLife]);

  // The director this seat owns (created on first render, so it steps from the
  // first frame). Unmount disposes it: its roll-call listener would otherwise
  // outlive it on the bus. A StrictMode remount (the same instance mounted
  // again after its cleanup disposed the first director) builds a fresh one,
  // so the live seat never steps a disposed director.
  const owned = useRef<FigureDirectorCore | null>(null);
  if (owned.current === null) owned.current = createRouteDirector();

  useEffect(() => {
    const director = owned.current ?? createRouteDirector();
    owned.current = director;
    activeDirector = director;
    return () => {
      if (activeDirector === director) activeDirector = null;
      if (owned.current === director) owned.current = null;
      director.dispose();
    };
  }, []);

  const reducedMotion = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => {
      reducedMotion.current = query.matches;
    };
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);

  // R27: the push latch, applied before the director steps (a stable closure: no per-frame allocation).
  const applyLatch = useMemo(() => () => applyLatchVisibility(frameScratch().rootInFrustum, noteAppearance), []);

  const settle = useRef<SettleState>(createSettleState());
  const focusMap = useRef<{
    id: string | null;
    subject: string | null;
    bounds: SubjectBounds | null;
    center: { x: number; y: number; z: number } | null;
  }>({ id: null, subject: null, bounds: null, center: null });
  const boardStation = useRef<number | null>(null);
  const debug = useMemo(() => warmStatsOn(), []);

  // R14: the shadow-casting key light (re-found only when it leaves the scene
  // or the generation changes; a theme swap rebuilds the lights).
  const keyLight = useRef<{ light: THREE.DirectionalLight | null; generation: number; wait: number }>({ light: null, generation: -1, wait: 0 });

  useFrame(({ camera, scene, size }, delta) => {
    const director = owned.current;
    if (director === null) return;
    const started = debug ? performance.now() : 0;
    const scratch = frameScratch();
    const input = scratch.input;
    const progress = conductor.progress.current;
    const now = performance.now();
    if (progress) {
      const next = stepSettleLatch(settle.current, { smooth: progress.smooth, exact: progress.exact, nearest: progress.nearest, now });
      if (next.settled && !settle.current.settled) noteStatsSettle(now);
      settle.current = next;
    }
    const station = Math.max(0, settle.current.station);
    scratch.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    scratch.frustum.setFromProjectionMatrix(scratch.viewProjection);
    for (let p = 0; p < 6; p += 1) {
      const plane = scratch.frustum.planes[p];
      scratch.planes[p * 4] = plane.normal.x;
      scratch.planes[p * 4 + 1] = plane.normal.y;
      scratch.planes[p * 4 + 2] = plane.normal.z;
      scratch.planes[p * 4 + 3] = plane.constant;
    }
    const focus = focusStore.get();

    // The loiter glance target: the data face the camera looks at most
    // squarely, re-read once per settled station (not per frame).
    if (settle.current.settled && boardStation.current !== station) {
      boardStation.current = station;
      camera.getWorldDirection(scratch.forward);
      let best = -Infinity;
      let found = false;
      for (const face of dataFaceEntries()) {
        const object = face.read().object;
        if (!object) continue;
        object.getWorldPosition(scratch.toFace);
        const x = scratch.toFace.x;
        const z = scratch.toFace.z;
        scratch.toFace.sub(camera.position).normalize();
        const facing = scratch.toFace.dot(scratch.forward);
        if (facing > best) {
          best = facing;
          scratch.board.x = x;
          scratch.board.z = z;
          found = true;
        }
      }
      input.activeBoard = found ? scratch.board : null;
    }

    input.delta = delta;
    input.generation = currentSceneGeneration();
    input.hidden = typeof document !== 'undefined' && document.hidden;
    input.loader = LOADER_PHASES.has(getBallPhase());
    input.focusOpen = focus.subject !== null;
    // R18 (a): the bare participant id (`team:<id>` → `<id>`), the subjectId namespace.
    // Mapped only when the focus id changes (the slice would allocate a string every frame).
    const focusId = focus.subject?.id ?? null;
    if (focusId !== focusMap.current.id) {
      focusMap.current.id = focusId;
      focusMap.current.subject = focusSubjectOf(focusId);
    }
    // K1 fix: the focus subject's world bounds centre; quiet mode beats the focused participant's
    // figure nearest it. Keyed on the bounds object, not the id: FocusSubject re-measures once its
    // children load and the store re-emits the same id with new bounds. Copied only on change.
    const bounds = focus.subject?.bounds ?? null;
    if (bounds !== focusMap.current.bounds) {
      focusMap.current.bounds = bounds;
      focusMap.current.center = bounds
        ? { x: (bounds.min[0] + bounds.max[0]) / 2, y: (bounds.min[1] + bounds.max[1]) / 2, z: (bounds.min[2] + bounds.max[2]) / 2 }
        : null;
    }
    input.focusSubjectId = focusMap.current.subject;
    input.focusCenter = focusMap.current.center;
    input.live = getRevealArmedAt() !== null;
    input.residencyComplete = isResidencyComplete();
    input.settled = settle.current.settled;
    input.station = station;
    input.life = life.current;
    input.reducedMotion = reducedMotion.current;
    input.cameraPosition.x = camera.position.x;
    input.cameraPosition.y = camera.position.y;
    input.cameraPosition.z = camera.position.z;
    // R14: the director gates on the camera frustum only while the camera is
    // STILL. This frame loop runs before the camera rig moves the camera for
    // this frame, so the frustum above is the last rendered one; a figure the
    // move brings into view would render one frame on a stale pose. So: gate
    // only while settled, with no focus open, with the conductor's progress
    // unchanged since the last frame (it drives the rig) and with the last
    // two rendered camera poses equal. Otherwise every figure samples.
    const pose = camera.matrixWorld.elements;
    let moved = !(progress !== null && Math.abs(progress.smooth - scratch.still.smooth) < 1e-6);
    for (let k = 0; k < 16; k += 1) {
      if (Math.abs(pose[k] - scratch.still.camera[k]) > 1e-6) moved = true;
      scratch.still.camera[k] = pose[k];
    }
    scratch.still.smooth = progress !== null ? progress.smooth : Number.NaN;
    input.frustum = moved || !settle.current.settled || input.focusOpen ? scratch.everywhere : scratch.frustumLike;

    // A2: the active padded face source at this frame's camera (rebuilt lazily, only when something moved).
    const faces = scratch.face;
    if (moved) faces.stamp += 1;
    // R34: this world's statically imported faces (null for an unknown theme: the source fails closed).
    faces.surfaces = routeSurfacesFor(themeId);
    faces.camera = camera;
    faces.station = station;
    faces.width = size.width;
    faces.height = size.height;
    faces.projX = camera.projectionMatrix.elements[0];
    faces.projY = camera.projectionMatrix.elements[5];

    input.shadowDir = keyShadowDir(scene, keyLight.current, input.generation, input.live, scratch.shadowDir);
    // R27 / C5 / L7: the latch first (while live and unveiled, latch actors
    // show what they want; otherwise every one is shown), then the step, so
    // a root the latch shows this frame is sampled this frame.
    runDirectorFrame(director, input, applyLatch);
    if (debug) noteDirectorMs(performance.now() - started, director.mixerMs());
  });

  return null;
}
