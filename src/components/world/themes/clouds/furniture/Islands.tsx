'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useCloudsPalette } from '../use-clouds-palette';
import { seeded } from './Props';
import {
  ISLES,
  SATELLITE,
  SCATTER_ISLES,
  ISLE_DRESSING,
  MOORINGS,
  TUFT_COUNT_PER_ISLE,
  type Isle,
} from './layout';

/**
 * The floating isles: each station isle is an organic-tipped disc — a
 * sky-meadow cap, a limestone rim band, and the inverted soil cone every
 * sky-island owes the eye — plus hanging rock chunks under the cone, a
 * mooring spire and a planked dock. Vertex jitter (seeded, never
 * Math.random) keeps every isle's silhouette distinct; scatter isles far
 * out over the sea dress the wide poses. All geometry disposes on unmount.
 */

/** Jitter a cylinder's rim vertices with a seeded, per-isle pattern. */
function jitterRim(geometry: THREE.BufferGeometry, seed: number, amount: number): void {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    v.fromBufferAttribute(position, i);
    const radial = Math.hypot(v.x, v.z);
    if (radial < 0.2) continue;
    const angle = Math.atan2(v.z, v.x);
    const wobble =
      (seeded(seed + Math.round(angle * 12.3)) - 0.5) * amount +
      (seeded(seed * 7 + Math.round(v.y * 8.1)) - 0.5) * amount * 0.4;
    const k = 1 + wobble / Math.max(radial, 1);
    position.setX(i, v.x * k);
    position.setZ(i, v.z * k);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function IsleMesh({ isle, seed, grass }: { isle: Isle; seed: number; grass?: boolean }) {
  const palette = useCloudsPalette();

  const cap = useMemo(() => {
    const g = new THREE.CylinderGeometry(isle.r, isle.r * 0.965, 0.55, 14, 1);
    jitterRim(g, seed, 0.9);
    return g;
  }, [isle.r, seed]);
  const rim = useMemo(() => {
    const g = new THREE.CylinderGeometry(isle.r * 0.985, isle.r * 0.86, 1.15, 14, 1);
    jitterRim(g, seed + 11, 1.1);
    return g;
  }, [isle.r, seed]);
  const cone = useMemo(() => {
    const g = new THREE.CylinderGeometry(isle.r * 0.88, isle.r * 0.16, isle.depth, 14, 3);
    jitterRim(g, seed + 23, 1.4);
    return g;
  }, [isle.r, isle.depth, seed]);

  useEffect(
    () => () => {
      cap.dispose();
      rim.dispose();
      cone.dispose();
    },
    [cap, rim, cone],
  );

  const capMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.94,
        metalness: 0,
        flatShading: true,
      }),
    [],
  );
  const rockMat = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.01, flatShading: true }),
    [],
  );
  const soilMat = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0, flatShading: true }),
    [],
  );
  useEffect(() => {
    capMat.color.set(grass ? palette.meadowColor : palette.rockColor);
    rockMat.color.set(palette.rockColor);
    soilMat.color.set(palette.soilColor);
  }, [capMat, rockMat, soilMat, palette, grass]);

  useEffect(
    () => () => {
      capMat.dispose();
      rockMat.dispose();
      soilMat.dispose();
    },
    [capMat, rockMat, soilMat],
  );

  /** Hanging chunks under the cone tip — seeded per isle. */
  const chunks = useMemo(() => {
    const count = isle.r > 4 ? 4 : 2;
    return Array.from({ length: count }, (_, i) => ({
      y: -isle.depth - 0.4 - seeded(seed + 41 + i) * 0.9,
      x: (seeded(seed + 47 + i) - 0.5) * isle.r * 0.4,
      z: (seeded(seed + 53 + i) - 0.5) * isle.r * 0.4,
      s: 0.3 + seeded(seed + 59 + i) * 0.35,
    }));
  }, [isle.depth, isle.r, seed]);

  return (
    <group position={[isle.x, 0, isle.z]}>
      {/* Meadow cap. */}
      <mesh geometry={cap} material={capMat} position={[0, isle.top - 0.26, 0]} castShadow receiveShadow />
      {/* Limestone rim band. */}
      <mesh geometry={rim} material={rockMat} position={[0, isle.top - 1.05, 0]} receiveShadow castShadow />
      {/* Inverted soil cone. */}
      <mesh
        geometry={cone}
        material={soilMat}
        position={[0, isle.top - 1.5 - isle.depth / 2, 0]}
        castShadow
      />
      {/* Hanging chunks. */}
      {chunks.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]} scale={[c.s, c.s * 0.8, c.s]} material={rockMat} castShadow>
          <icosahedronGeometry args={[1, 0]} />
        </mesh>
      ))}
    </group>
  );
}

/** A mooring spire: stone foot, timber mast, rigging ring and cap bead. */
function MooringSpire({ x, z, h }: { x: number; z: number; h: number }) {
  const palette = useCloudsPalette();
  const isle = Object.values(ISLES).find((i) => Math.hypot(i.x - x, i.z - z) < i.r);
  const seat = isle ? isle.top : 0;
  return (
    <group position={[x, seat, z]}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.52, 0.68, 0.6, 8]} />
        <meshStandardMaterial color={palette.stoneColor} roughness={0.9} metalness={0.02} />
      </mesh>
      <mesh position={[0, h / 2 + 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.14, h, 7]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.76} metalness={0.06} />
      </mesh>
      <mesh position={[0, h + 0.42, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.22, 0.05, 6, 14]} />
        <meshStandardMaterial color={palette.boardAccent} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, h + 0.62, 0]} castShadow>
        <sphereGeometry args={[0.09, 8, 6]} />
        <meshStandardMaterial color={palette.stoneColor} roughness={0.7} metalness={0.1} />
      </mesh>
    </group>
  );
}

/** A planked dock platform seated on an isle's top surface. */
function Dock({
  x,
  z,
  w,
  d,
  isle,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  isle?: Isle;
}) {
  const palette = useCloudsPalette();
  const seat = isle ? isle.top : 0;
  const planks = useMemo(
    () => Array.from({ length: Math.max(3, Math.round(d / 0.45)) }, (_, i) => -d / 2 + (d * i) / Math.max(3, Math.round(d / 0.45) - 1)),
    [d],
  );
  return (
    <group position={[x, seat, z]}>
      {/* Bearers. */}
      {([-w / 2 + 0.25, w / 2 - 0.25] as const).map((bx) => (
        <mesh key={bx} position={[bx, 0.09, 0]} castShadow>
          <boxGeometry args={[0.22, 0.18, d]} />
          <meshStandardMaterial color={palette.soilColor} roughness={0.9} metalness={0.02} />
        </mesh>
      ))}
      {/* Deck planks. */}
      {planks.map((pz) => (
        <mesh key={pz} position={[0, 0.21, pz]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.07, 0.34]} />
          <meshStandardMaterial color={palette.timberColor} roughness={0.8} metalness={0.04} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The instanced sky-meadow tuft field: ONE InstancedMesh across all five
 * station isles (seeded positions inside each rim, seated on the top disc) —
 * the archipelago's kit-module instancing, the same discipline as the
 * siblings' instanced pines/tufts/scree.
 */
function MeadowTufts() {
  const palette = useCloudsPalette();
  const meshRef = useMemo(() => {
    const entries = Object.values(ISLES);
    const count = entries.length * TUFT_COUNT_PER_ISLE;
    // Soft meadow mounds, not spikes: a squashed icosahedron reads as turf
    // hummocks at station distance (the first draft's cones read as nails).
    const geometry = new THREE.IcosahedronGeometry(0.16, 0);
    geometry.scale(1, 0.55, 1);
    geometry.translate(0, 0.08, 0);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let placed = 0;
    entries.forEach((isle, isleIndex) => {
      for (let i = 0; i < TUFT_COUNT_PER_ISLE; i += 1) {
        const s = isleIndex * 977 + i * 7;
        const a = seeded(s + 1) * Math.PI * 2;
        const r = Math.sqrt(seeded(s + 2)) * (isle.r - 0.7);
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seeded(s + 3) * Math.PI);
        const k = 0.75 + seeded(s + 4) * 0.7;
        scale.set(k, k, k);
        pos.set(isle.x + Math.cos(a) * r, isle.top + 0.02, isle.z + Math.sin(a) * r);
        matrix.compose(pos, quat, scale);
        mesh.setMatrixAt(placed, matrix);
        placed += 1;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = placed;
    mesh.name = 'clouds-tufts';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }, []);

  useEffect(
    () => () => {
      meshRef.geometry.dispose();
      (meshRef.material as THREE.Material).dispose();
      meshRef.dispose();
    },
    [meshRef],
  );

  useEffect(() => {
    (meshRef.material as THREE.MeshStandardMaterial).color.set(palette.meadowColor);
  }, [meshRef, palette.meadowColor]);

  return <primitive object={meshRef} />;
}

/**
 * The archipelago's ground layer: five station isles with their mooring
 * spires and docks, the instanced tuft field, the satellite islet, and the
 * far scatter isles.
 */
export default function Islands() {
  return (
    <group>
      {Object.entries(ISLES).map(([id, isle], i) => (
        <group key={id}>
          <IsleMesh isle={isle} seed={101 + i * 17} grass />
          <Dock {...ISLE_DRESSING[id].dock} isle={isle} />
        </group>
      ))}
      {Object.entries(MOORINGS).map(([id, m]) => (
        <MooringSpire key={id} x={m.x} z={m.z} h={m.h} />
      ))}
      <MeadowTufts />
      <IsleMesh isle={SATELLITE} seed={289} />
      {SCATTER_ISLES.map((isle, i) => (
        <IsleMesh key={isle.x} isle={isle} seed={331 + i * 29} />
      ))}
    </group>
  );
}
