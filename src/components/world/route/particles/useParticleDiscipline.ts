'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import type { Vec3 } from '@/lib/route-world/chapters';
import {
  activeCorridors,
  channelDensity,
  corridorBasis,
  CORRIDOR_SLOTS,
  maxStationParticles,
  rectCorners,
  type ContentFace,
  type StationFaces,
} from '@/lib/route-world/particle-discipline';

/**
 * The discipline uniforms every particle material carries (see
 * `PARTICLE_DISCIPLINE_GLSL`). Arrays are sized to `CORRIDOR_SLOTS` once;
 * the per-frame driver writes into them in place.
 */
export interface ParticleDisciplineUniforms {
  uCorCenter: { value: THREE.Vector3[] };
  uCorRight: { value: THREE.Vector3[] };
  uCorUp: { value: THREE.Vector3[] };
  uCorWeight: { value: number[] };
  uDensity: { value: number };
}

export function createParticleDisciplineUniforms(): ParticleDisciplineUniforms {
  const vecs = () => Array.from({ length: CORRIDOR_SLOTS }, () => new THREE.Vector3());
  return {
    uCorCenter: { value: vecs() },
    uCorRight: { value: vecs() },
    uCorUp: { value: vecs() },
    uCorWeight: { value: Array.from({ length: CORRIDOR_SLOTS }, () => 0) },
    uDensity: { value: 1 },
  };
}

/**
 * Owns one particle field's discipline uniforms and drives them every frame
 * from the live camera and the conductor: the station density channel
 * (`world.particles`, sampled at `progress.smooth`) and the content
 * corridors toward the faces of the two stations the conductor lies
 * between. Pure inputs only — camera pose, conductor position, the frozen
 * station ledger — so a phase-pinned capture (which forces one synchronous
 * advance) lands the same uniforms every time.
 *
 * Returns ONE stable record: spread it into every material the component
 * builds (three reads `.value` at draw time, so materials re-created on a
 * palette change share the same live entries).
 */
export function useParticleDiscipline(faces: StationFaces): ParticleDisciplineUniforms {
  const { conductor, sampleWorldState, theme, debug } = useWorldState();
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const stations = theme?.stations;
  const maxParticles = useMemo(() => (stations ? maxStationParticles(stations) : 0), [stations]);
  const uniforms = useMemo(() => createParticleDisciplineUniforms(), []);
  // Per-frame writes go through a ref (the engine's uniform-driving pattern).
  const uniformsRef = useRef(uniforms);
  useEffect(() => {
    uniformsRef.current = uniforms;
  }, [uniforms]);
  const eyeRef = useRef(new THREE.Vector3());

  useFrame(() => {
    const u = uniformsRef.current;
    const position = conductor.progress.current.smooth;
    u.uDensity.value = stations ? channelDensity(sampleWorldState(position).particles, maxParticles) : 1;

    camera.getWorldPosition(eyeRef.current);
    const eye: Vec3 = [eyeRef.current.x, eyeRef.current.y, eyeRef.current.z];
    const live = stations ? activeCorridors(stations, faces, position) : [];
    for (let i = 0; i < CORRIDOR_SLOTS; i += 1) {
      const slot = live[i];
      if (!slot) {
        u.uCorWeight.value[i] = 0;
        continue;
      }
      const basis = corridorBasis(eye, slot.face);
      u.uCorCenter.value[i].set(basis.center[0], basis.center[1], basis.center[2]);
      u.uCorRight.value[i].set(basis.right[0], basis.right[1], basis.right[2]);
      u.uCorUp.value[i].set(basis.up[0], basis.up[1], basis.up[2]);
      u.uCorWeight.value[i] = slot.weight;
    }
  });

  // Fidelity W1 r3 debug readout (`?routeDebug=1` only, on demand, pure
  // inspection): the live corridors' screen rects vs the rendered faces'.
  useEffect(() => {
    if (!debug || typeof window === 'undefined') return undefined;
    const host = window as ParticleReadoutHost;
    const read = (): ParticleCorridorRow[] => {
      const u = uniformsRef.current;
      const eye = camera.getWorldPosition(new THREE.Vector3());
      const rows: ParticleCorridorRow[] = [];
      for (let i = 0; i < CORRIDOR_SLOTS; i += 1) {
        const weight = u.uCorWeight.value[i];
        if (!(weight > 0)) continue;
        const center = u.uCorCenter.value[i];
        const entry = Object.entries(faces).find(
          ([, face]) => face.center[0] === center.x && face.center[1] === center.y && face.center[2] === center.z,
        );
        if (!entry) continue;
        const [station, face] = entry;
        rows.push(corridorRow(station, face, weight, eye, camera, size.width, size.height));
      }
      return rows;
    };
    host.__routeWorldParticles = read;
    return () => {
      if (host.__routeWorldParticles === read) delete host.__routeWorldParticles;
    };
  }, [debug, camera, size, faces]);

  return uniforms;
}

/** A screen rect in viewport CSS px. */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One live corridor vs the rendered faces it must keep clear. */
export interface ParticleCorridorRow {
  station: string;
  weight: number;
  /** The wedge rim (r = 1) at the face depth, projected — a convex quad. */
  corridorQuad: Array<[number, number]>;
  corridorRect: ScreenRect;
  faceRects: ScreenRect[];
  /** Every rendered face corner lies inside the corridor quad. */
  contains: boolean;
}

interface ParticleReadoutHost extends Window {
  __routeWorldParticles?: () => ParticleCorridorRow[];
}

function project(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number): [number, number] {
  const p = point.clone().project(camera);
  return [((p.x + 1) / 2) * width, ((1 - p.y) / 2) * height];
}

function bbox(points: ReadonlyArray<[number, number]>): ScreenRect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Point inside a convex quad given in winding order (either orientation). */
function insideQuad(quad: ReadonlyArray<[number, number]>, [x, y]: [number, number]): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % quad.length];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(c) < 1e-6) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function corridorRow(
  station: string,
  face: ContentFace,
  weight: number,
  eye: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): ParticleCorridorRow {
  const eyeV: Vec3 = [eye.x, eye.y, eye.z];
  const basis = corridorBasis(eyeV, face);
  const c = new THREE.Vector3(...face.center);
  // `right` / `up` arrive pre-divided by the half extents: × halfExtent² → unit × halfExtent.
  const r = new THREE.Vector3(...basis.right).multiplyScalar(face.halfWidth * face.halfWidth);
  const up = new THREE.Vector3(...basis.up).multiplyScalar(face.halfHeight * face.halfHeight);
  const quad = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) =>
    project(c.clone().addScaledVector(r, sx).addScaledVector(up, sy), camera, width, height),
  );
  const faceCorners = (face.rects ?? []).map((rect) =>
    rectCorners(rect).map((corner) => project(new THREE.Vector3(...corner), camera, width, height)),
  );
  return {
    station,
    weight,
    corridorQuad: quad,
    corridorRect: bbox(quad),
    faceRects: faceCorners.map(bbox),
    contains: faceCorners.every((corners) => corners.every((corner) => insideQuad(quad, corner))),
  };
}
