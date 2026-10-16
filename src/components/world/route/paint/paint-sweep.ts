/**
 * Paint sweep — the plaza-scoped application of the painted light
 * (LOOK-PLAN §2 SEAT L, replacing P1's global `Material.prototype` hook).
 *
 * `paintSweep(scene)` patches every lit `MeshStandardMaterial` /
 * `MeshPhysicalMaterial` (material arrays included) under the scene exactly
 * once, BEFORE its first compile, except:
 * - materials tagged `userData.dataFace` or `userData.paintExempt`;
 * - every material of an object tagged the same way (a tagged mesh wins even
 *   when its material is shared with an untagged one);
 * - standby-patched data-face materials (`STANDBY_PROGRAM_KEY`) — the
 *   keep-out law: data faces are never painted, graded or rimmed.
 *
 * The sweep is a no-op on a scene that does not carry the paint marker
 * (`scene.userData.paintScope`), so the engine may call it for every world
 * (GATE's warm pass does) and only a world whose `<PaintSweep/>` sets the
 * marker is ever touched: a world is patched only when its theme sets
 * `paint.features.sweep` (ROLLOUT §2.2 c; `PaintRigMounts` mounts the sweep
 * with `scope = theme.id`). There is no default scope.
 *
 * `<PaintSweep scope/>` (mounted from a world's light rig) holds the paint scope,
 * marks the R3F scene, and sweeps in a priority-0 `useFrame` (before R3F's
 * render) on every frame until `routeSceneLive`, so suspended subtrees are
 * painted before they first compile too. After live it never patches (a
 * patch would be a program link after reveal — D23); in dev and debug it
 * audits once per second and `console.error`s any unpatched material.
 */

import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { useWorldHandoff, useWorldState } from '@/components/world/route/WorldStateProvider';
import { STANDBY_PROGRAM_KEY } from '@/components/world/route/useStandbyDim';
import { registerWarmPrepare } from '@/components/world/route/useStationWarmup';
import { acquirePaintScope, applyPaintedLight, isPainted, PAINT_PROGRAM_KEY, refreshPaintRole } from './painted-light';

/** Counts of one sweep or audit over a scene. */
export interface PaintCounts {
  /** Lit Standard/Physical materials that carry the painted hook. */
  patched: number;
  /** Lit materials skipped on purpose (data faces, standby, explicit exempt). */
  exempt: number;
  /** Lit, non-exempt materials without the painted hook (or compiled without it). */
  unpatched: number;
}

/** Materials exempted through an object tag — sticky, so a later shared sighting cannot paint them. */
const objectExempt = new WeakSet<THREE.Material>();

interface MaybeLitMaterial extends THREE.Material {
  isMeshStandardMaterial?: boolean;
}

function isLit(material: THREE.Material): boolean {
  return (material as MaybeLitMaterial).isMeshStandardMaterial === true;
}

function taggedExempt(userData: Record<string, unknown> | undefined): boolean {
  return userData?.dataFace === true || userData?.paintExempt === true;
}

/**
 * LOOK r3 (CLARITY: "the teams ledger slab went from warm beige to blue-grey
 * lilac"): lit objects that ARE part of a data face's read and are owned
 * outside the paint seat. Named here so they render with the scene's shipped
 * lights, exactly as before — never painted, tinted or rimmed.
 */
export const PAINT_EXEMPT_OBJECT_NAMES: ReadonlySet<string> = new Set(['teams-ledger-slab', 'teams-ledger-face']);

function objectExemptTag(object: THREE.Object3D): boolean {
  return taggedExempt(object.userData) || PAINT_EXEMPT_OBJECT_NAMES.has(object.name);
}

/** Is this a standby-patched data-face material (checked on its ORIGINAL key only)? */
function isStandbyFace(material: THREE.Material): boolean {
  if (isPainted(material)) return false;
  try {
    return material.customProgramCacheKey().includes(STANDBY_PROGRAM_KEY);
  } catch {
    return false;
  }
}

/**
 * LOOK r3 ("every frame must render as in the before stills"): the bezels,
 * cabinets and brass around data faces (role `frame`) are never painted —
 * they take the scene's shipped lights, exactly as before.
 */
function isFrame(material: THREE.Material): boolean {
  return material.userData?.paintRole === 'frame';
}

/**
 * LOOK r4 (CLARITY: "exFigures rose at teams — not only the figures"): a lit
 * material whose emissive map IS its colour map is a self-lit display (the
 * façade crest LED with the trainer's name, kiosk screens). It carries the
 * scene's shipped light, never the painted key, rim or chroma.
 */
function isSelfLitDisplay(material: THREE.Material): boolean {
  const m = material as THREE.Material & { map?: THREE.Texture | null; emissiveMap?: THREE.Texture | null };
  return m.emissiveMap != null && m.emissiveMap === m.map;
}

/** Whether the sweep must leave this lit material alone. */
export function isPaintExempt(material: THREE.Material): boolean {
  return (
    taggedExempt(material.userData) ||
    objectExempt.has(material) ||
    isStandbyFace(material) ||
    isFrame(material) ||
    isSelfLitDisplay(material)
  );
}

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

/** Whether a root carries the paint marker (the plaza scene). */
export function isPaintScene(root: THREE.Object3D): boolean {
  return typeof root.userData?.paintScope === 'string';
}

/** Mark a root as a painted scene (what `<PaintSweep/>` does to the R3F scene); `scope` is the world's theme id. */
export function markPaintScene(root: THREE.Object3D, scope: string): () => void {
  root.userData.paintScope = scope;
  return () => {
    if (root.userData.paintScope === scope) delete root.userData.paintScope;
  };
}

/**
 * Patch every eligible lit material under `root` once. No-op (all zero)
 * unless the root carries the paint marker. Returns the counts after the
 * sweep; `unpatched` is 0 by construction unless a patch threw.
 */
export function paintSweep(root: THREE.Object3D): PaintCounts {
  const counts: PaintCounts = { patched: 0, exempt: 0, unpatched: 0 };
  if (!isPaintScene(root)) return counts;
  const scope = String(root.userData.paintScope);

  // Pass 1: object-level tags exempt their materials, whatever else shares them.
  root.traverse((object) => {
    if (!objectExemptTag(object)) return;
    for (const material of materialsOf(object)) {
      if (isLit(material) && !isPainted(material)) objectExempt.add(material);
    }
  });

  // Pass 2: paint (or count) each lit material once per sweep.
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    for (const material of materialsOf(object)) {
      if (seen.has(material) || !isLit(material)) continue;
      seen.add(material);
      if (isPaintExempt(material)) {
        counts.exempt += 1;
        continue;
      }
      if (isPainted(material)) {
        refreshPaintRole(material);
        counts.patched += 1;
        continue;
      }
      try {
        applyPaintedLight(material, scope);
        counts.patched += 1;
      } catch (error) {
        counts.unpatched += 1;
        console.error('[paint] could not patch material', material.name || material.uuid, error);
      }
    }
  });
  return counts;
}

/** Minimal renderer surface the audit reads (three's `WebGLRenderer.properties`). */
export interface PaintAuditRenderer {
  properties: { get: (object: object) => { currentProgram?: { cacheKey?: string } } | undefined };
}

/**
 * Read-only audit: like the sweep's counts, but a painted material whose
 * CURRENT program was linked without `paint-v1` (compiled before it was
 * patched and never rebuilt) also counts as unpatched. Never mutates.
 */
export function auditPaint(root: THREE.Object3D, renderer?: PaintAuditRenderer): PaintCounts {
  const counts: PaintCounts = { patched: 0, exempt: 0, unpatched: 0 };
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const objectTagged = objectExemptTag(object);
    for (const material of materialsOf(object)) {
      if (seen.has(material) || !isLit(material)) continue;
      seen.add(material);
      if (objectTagged || isPaintExempt(material)) {
        counts.exempt += 1;
        continue;
      }
      if (!isPainted(material)) {
        counts.unpatched += 1;
        continue;
      }
      const key = renderer?.properties.get(material)?.currentProgram?.cacheKey;
      if (typeof key === 'string' && !key.includes(PAINT_PROGRAM_KEY)) counts.unpatched += 1;
      else counts.patched += 1;
    }
  });
  return counts;
}

/**
 * Scope leaks (ROLLOUT §2.2 c): materials whose `paintScope` marker differs
 * from the scene's scope, in an UNPAINTED scene. A module-cached material
 * (a drei GLTF shared by a figure) painted in one world and shown in an
 * unpainted world is a hit: it still compiles unpainted there — no scope is
 * held, see `acquirePaintScope` — but the audit must know
 * (`paintScopeLeaks()` counts the compiles). In a PAINTED scene a material
 * carrying another world's marker is harmless — the uniforms are global and
 * one world is mounted at a time — so a painted scene reports none.
 */
export function findPaintScopeLeaks(root: THREE.Object3D): THREE.Material[] {
  if (isPaintScene(root)) return [];
  const hits = new Set<THREE.Material>();
  root.traverse((object) => {
    for (const material of materialsOf(object)) {
      if (typeof material.userData?.paintScope === 'string') hits.add(material);
    }
  });
  return [...hits];
}

const AUDIT_INTERVAL_MS = 1000;

function auditEnabled(debug: boolean): boolean {
  return debug || process.env.NODE_ENV !== 'production';
}

/**
 * A painted world's sweep driver. Mount once inside the canvas (from
 * `PaintRigMounts`, `scope = theme.id`). Renders nothing.
 */
export function PaintSweep({ scope }: { scope: string }): null {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const { debug } = useWorldState();
  const { routeSceneLive } = useWorldHandoff();
  const liveRef = useRef(routeSceneLive);
  const lastAudit = useRef(0);

  useLayoutEffect(() => {
    liveRef.current = routeSceneLive;
  }, [routeSceneLive]);

  // Before the first frame: hold the scope, mark the scene, sweep once.
  useLayoutEffect(() => {
    const release = acquirePaintScope(scope);
    const unmark = markPaintScene(scene, scope);
    paintSweep(scene);
    // GATE contract: the load warm runs its prepare hooks right before each
    // compile slice, so a material that mounts in the same frame is painted
    // before its first link, whatever the useFrame order. Pre-live only.
    const unprepare = registerWarmPrepare((root) => {
      if (!liveRef.current) paintSweep(root);
    });
    return () => {
      unprepare();
      unmark();
      release();
    };
  }, [scene, scope]);

  useFrame(() => {
    if (!liveRef.current) {
      paintSweep(scene);
      return;
    }
    if (!auditEnabled(debug)) return;
    const now = performance.now();
    if (now - lastAudit.current < AUDIT_INTERVAL_MS) return;
    lastAudit.current = now;
    const counts = auditPaint(scene, gl as unknown as PaintAuditRenderer);
    if (counts.unpatched > 0) {
      console.error(
        `[paint] ${counts.unpatched} lit material(s) unpatched after world-route-live — something mounted or compiled after reveal (D23)`,
      );
    }
  });

  return null;
}
