'use client';

/**
 * Contact blobs (LOOK-PLAN §2 SEAT L item 5): the soft dark footprint that
 * stops a figure floating. ONE InstancedMesh of `CONTACT_BLOB_CAPACITY`
 * instances, mounted at load (so its single program links in the ceremony)
 * and on at every rung; `count` follows the live figures each frame.
 *
 * - Analytic `(1 − r²)^1.5` falloff, stretched 1.4× down-sun (away from the
 *   key, on the ground plane), colour `#2c2548`, opacity 0.52 day / 0.30
 *   night (LOOK r5).
 * - Positions come from the figure registry (`figure-registry.ts`), read in
 *   the same frame the figures move. A figure opts out by role
 *   (`floating`, `perched`, `swimmer`) or `contactBlob: false` on its
 *   registration; an `airborne` figure keeps a ground blob faded by height.
 * - Pure decoration: unlit, fog-free, no depth write, no raycast, never a
 *   shadow caster — and a ShaderMaterial, so the paint sweep never touches it.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { listFigures, type FigureRegistration } from './figure-registry';
import type { Vec3Tuple } from '@/lib/route-world/focus';

/** Fixed instance capacity — the buffer is allocated once, never regrown. */
export const CONTACT_BLOB_CAPACITY = 32;
/** Down-sun stretch of the blob's long axis. */
export const CONTACT_BLOB_STRETCH = 1.4;
export const CONTACT_BLOB_COLOR = '#2c2548';
export const CONTACT_BLOB_OPACITY = { day: 0.52, night: 0.3 } as const;
/** Height (m above the ground plane) at which an airborne figure's blob has faded out. */
export const CONTACT_BLOB_FADE_HEIGHT = 2.5;
/** Lift off the surface the blob lies on (m) — above the setts, under any foot. */
const BLOB_LIFT = 0.02;
/** Blob radius as a share of the figure's footprint radius, and its floor/ceiling (m). */
const BLOB_RADIUS_SCALE = 1.0;
const BLOB_RADIUS_MIN = 0.18;
const BLOB_RADIUS_MAX = 1.6;

/** Roles that never get a blob (nothing under them is ground). */
const OPT_OUT_ROLES = new Set(['floating', 'perched', 'swimmer', 'waterline']);
/** Roles whose blob stays on the ground plane and fades with height. */
const FLIER_ROLES = new Set(['airborne', 'flier', 'flying']);

/** Optional registry fields a figure may carry for its blob (read structurally). */
interface BlobHints {
  /** `false` opts the figure out explicitly. */
  contactBlob?: boolean;
  /** Footprint radius in metres, if the figure knows it (skips the one-off bounds pass). */
  footprint?: number;
}

/** One blob, in world space. */
export interface BlobPlacement {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** 0..1 opacity multiplier (height fade for fliers). */
  fade: number;
}

/** What the layout needs to know about one figure this frame. */
export interface BlobFigure {
  role: string | null;
  optOut: boolean;
  /** Root world position (feet). */
  position: Vec3Tuple;
  /** Footprint radius (m). */
  footprint: number;
  /** Ground height under the figure (m); the plaza floor is 0. */
  ground?: number;
}

/**
 * Pure layout: which figures get a blob and where, capped at `capacity`
 * (registration order wins, so the set is stable frame to frame).
 */
export function layoutContactBlobs(
  figures: readonly BlobFigure[],
  capacity: number = CONTACT_BLOB_CAPACITY,
): BlobPlacement[] {
  const out: BlobPlacement[] = [];
  for (const figure of figures) {
    if (out.length >= capacity) break;
    if (figure.optOut || (figure.role !== null && OPT_OUT_ROLES.has(figure.role))) continue;
    const [x, y, z] = figure.position;
    const radius = Math.min(BLOB_RADIUS_MAX, Math.max(BLOB_RADIUS_MIN, figure.footprint * BLOB_RADIUS_SCALE));
    if (figure.role !== null && FLIER_ROLES.has(figure.role)) {
      const ground = figure.ground ?? 0;
      const height = Math.max(0, y - ground);
      const fade = 1 - Math.min(1, height / CONTACT_BLOB_FADE_HEIGHT);
      if (fade <= 0) continue;
      out.push({ x, y: ground + BLOB_LIFT, z, radius, fade: fade * fade });
      continue;
    }
    out.push({ x, y: y + BLOB_LIFT, z, radius, fade: 1 });
  }
  return out;
}

export const BLOB_VERTEX = /* glsl */ `
  attribute float aFade;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    vUv = uv * 2.0 - 1.0;
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

export const BLOB_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vFade;
  void main() {
    float r2 = dot(vUv, vUv);
    float a = 1.0 - min(r2, 1.0);
    // LOOK r5: a firmer core ((1 − r²)^1.5) so the figure sits on the setts.
    a = a * sqrt(a) * uOpacity * vFade;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _world = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** Footprint radius per figure root, measured once (a Box3 pass over a skinned clone is not free). */
const footprints = new WeakMap<THREE.Object3D, number>();

function footprintOf(object: THREE.Object3D, hint: number | undefined): number {
  if (typeof hint === 'number' && hint > 0) return hint;
  const cached = footprints.get(object);
  if (cached !== undefined) return cached;
  _box.setFromObject(object);
  let radius = 0.4;
  if (!_box.isEmpty()) {
    _box.getSize(_size);
    radius = Math.max(0.1, Math.min(_size.x, _size.z) * 0.5);
  }
  footprints.set(object, radius);
  return radius;
}

/** Visible itself and through every ancestor (a hidden station group hides its blobs too). */
function shownInScene(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

/** Ground height (m) under a world point (x, z); the plaza floor is the y = 0 plane. */
export type GroundHeightFn = (x: number, z: number) => number;

function blobFigureOf(registration: FigureRegistration, groundHeight?: GroundHeightFn): BlobFigure | null {
  const object = registration.object.current;
  if (!object || !shownInScene(object)) return null;
  const hints = registration as FigureRegistration & BlobHints;
  object.getWorldPosition(_world);
  return {
    role: registration.getRole?.() ?? registration.role ?? null,
    optOut: hints.contactBlob === false,
    position: [_world.x, _world.y, _world.z],
    footprint: footprintOf(object, hints.footprint),
    ground: groundHeight ? groundHeight(_world.x, _world.z) : undefined,
  };
}

/**
 * LOOK r3 ("no contact blobs are visible"): nothing in the scene calls
 * `registerFigure`, so the registry is empty and the layer drew 0 blobs.
 * The blobs now also find the figure roots in the scene by the group names
 * `Figure` is mounted with — `figure-*` (theme figures), `ambient-*`
 * (walkers), `ace-*` (the teams statues) and `nurse`.
 */
export const FIGURE_ROOT_NAME = /^(figure-|ambient-|ace-|nurse$)/;

/** Scene figure roots by name (registry entries win; a root is listed once). */
export function findFigureRoots(root: THREE.Object3D, known: ReadonlySet<THREE.Object3D> = new Set()): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (known.has(object) || !FIGURE_ROOT_NAME.test(object.name)) return;
    out.push(object);
  });
  return out;
}

/** Frames between scene rescans (figures mount inside the ceremony; after reveal the set is fixed). */
const RESCAN_FRAMES = 30;

export interface ContactBlobsProps {
  /** Unit-free direction TOWARD the key (theme `lights.keyDirection`). */
  keyDirection: Vec3Tuple;
  night: boolean;
  /**
   * ROLLOUT §2.2 (i): the ground under a figure (mountain: `knollHeight`) —
   * an airborne figure's blob lies there and fades with its height above it.
   * Default: the y = 0 plane (the plaza's behaviour).
   */
  groundHeight?: GroundHeightFn;
}

/** The instanced blob layer. Mount once per world, at load. */
export default function ContactBlobs({ keyDirection, night, groundHeight }: ContactBlobsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const scene = useThree((state) => state.scene);
  const scanned = useRef<{ frame: number; roots: THREE.Object3D[] }>({ frame: -RESCAN_FRAMES, roots: [] });
  const frameRef = useRef(0);

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, 2);
    g.rotateX(-Math.PI / 2);
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(CONTACT_BLOB_CAPACITY), 1);
    fade.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFade', fade);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(CONTACT_BLOB_COLOR) },
          uOpacity: { value: CONTACT_BLOB_OPACITY.day },
        },
        vertexShader: BLOB_VERTEX,
        fragmentShader: BLOB_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // Down-sun yaw: the blob's long (local X) axis along the key's ground travel.
  const downSun = useMemo(() => {
    const v = new THREE.Vector3(-keyDirection[0], 0, -keyDirection[2]);
    if (v.lengthSq() < 1e-8) v.set(1, 0, 0);
    return v.normalize();
  }, [keyDirection]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    // Uniform write only — the palette flip never rebuilds the material.
    const blobMaterial = mesh.material as THREE.ShaderMaterial;
    blobMaterial.uniforms.uOpacity.value = night ? CONTACT_BLOB_OPACITY.night : CONTACT_BLOB_OPACITY.day;
    const figures: BlobFigure[] = [];
    const known = new Set<THREE.Object3D>();
    for (const registration of listFigures()) {
      const figure = blobFigureOf(registration, groundHeight);
      if (registration.object.current) known.add(registration.object.current);
      if (figure) figures.push(figure);
    }
    frameRef.current += 1;
    if (frameRef.current - scanned.current.frame >= RESCAN_FRAMES) {
      scanned.current = { frame: frameRef.current, roots: findFigureRoots(scene, known) };
    }
    for (const root of scanned.current.roots) {
      if (known.has(root) || !root.parent) continue;
      const figure = blobFigureOf({ id: root.name, object: { current: root } }, groundHeight);
      if (figure) figures.push(figure);
    }
    const blobs = layoutContactBlobs(figures);
    const fade = geometry.getAttribute('aFade') as THREE.InstancedBufferAttribute;
    _q.setFromUnitVectors(X_AXIS, downSun);
    for (let i = 0; i < blobs.length; i += 1) {
      const b = blobs[i];
      // Centre nudged a fifth of a radius down-sun, where the cast shadow falls.
      _p.set(b.x + downSun.x * b.radius * 0.2, b.y, b.z + downSun.z * b.radius * 0.2);
      _s.set(b.radius * CONTACT_BLOB_STRETCH, 1, b.radius);
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      fade.setX(i, b.fade);
    }
    mesh.count = blobs.length;
    if (blobs.length > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      fade.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, CONTACT_BLOB_CAPACITY]}
      frustumCulled={false}
      renderOrder={1}
      raycast={() => null}
      userData={{ paintExempt: true, contactBlobs: true }}
    />
  );
}
