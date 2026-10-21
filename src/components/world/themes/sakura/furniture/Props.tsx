'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useSakuraPalette } from '../use-sakura-palette';
import { seeded } from './Ground';

/**
 * The park's small prop kit (C-093 r3 density pass) — the shared vocabulary
 * the station passes dress their scenes with: stepping-stone paving, moss
 * patches, shrubs, blossom planting beds, the wood fence line, the ema
 * board, the pennant cluster, the rope railing and the direction signpost.
 * Repeated elements are InstancedMeshes over seeded (never Math.random)
 * positions so stills stay reproducible; every mesh disposes its GPU
 * resources on unmount (the Ground ConeField idiom).
 */

/** Instanced flattened stone discs — the forecourt and apron paving. */
export function SteppingStones({
  x0,
  x1,
  z0,
  z1,
  count,
  seed = 0,
  radius = 0.42,
}: {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  count: number;
  seed?: number;
  radius?: number;
}) {
  const palette = useSakuraPalette();
  const meshRef = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(radius, radius * 1.08, 0.055, 8);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.02 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      const x = x0 + seeded(i * 3 + seed + 1) * (x1 - x0);
      const z = z0 + seeded(i * 3 + seed + 2) * (z1 - z0);
      const s = 0.78 + seeded(i * 3 + seed + 3) * 0.5;
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), seeded(i + seed + 41) * Math.PI);
      scale.set(s, 1, s * (0.82 + seeded(i + seed + 43) * 0.3));
      pos.set(x, 0.024, z);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = 'sakura-stepping-stones';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }, [x0, x1, z0, z1, count, seed, radius]);

  useEffect(
    () => () => {
      meshRef.geometry.dispose();
      (meshRef.material as THREE.Material).dispose();
      meshRef.dispose();
    },
    [meshRef],
  );

  useEffect(() => {
    (meshRef.material as THREE.MeshStandardMaterial).color.set(palette.lanternStone);
  }, [meshRef, palette.lanternStone]);

  return <primitive object={meshRef} />;
}

/** One moss patch — a flattened turf disc, a step darker than the lawn. */
export function MossPatch({
  x,
  z,
  s = 1,
  seed = 0,
}: {
  x: number;
  z: number;
  s?: number;
  seed?: number;
}) {
  const palette = useSakuraPalette();
  const matRef = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0 }),
    [],
  );
  useEffect(
    () => () => {
      matRef.dispose();
    },
    [matRef],
  );
  useEffect(() => {
    const c = new THREE.Color(palette.lawnColor);
    c.multiplyScalar(0.82);
    matRef.color.copy(c);
  }, [matRef, palette.lawnColor]);
  return (
    <mesh
      position={[x, 0.015, z]}
      rotation={[0, seeded(seed + 7) * Math.PI, 0]}
      scale={[1, 0.07, 0.86]}
      material={matRef}
    >
      <icosahedronGeometry args={[0.55 * s, 1]} />
    </mesh>
  );
}

/** One shrub — two small blossom-adjacent blobs on the lawn line. */
export function Shrub({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  const palette = useSakuraPalette();
  const matRef = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true }),
    [],
  );
  useEffect(
    () => () => {
      matRef.dispose();
    },
    [matRef],
  );
  useEffect(() => {
    const c = new THREE.Color(palette.blossomColorB);
    c.lerp(new THREE.Color(palette.lawnColor), 0.35);
    matRef.color.copy(c);
  }, [matRef, palette.blossomColorB, palette.lawnColor]);
  return (
    <group name="sakura-shrub" position={[x, 0, z]}>
      <mesh name="sakura-shrub-blob" position={[0, 0.3 * s, 0]} scale={[0.42 * s, 0.34 * s, 0.4 * s]} material={matRef} castShadow>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>
      <mesh name="sakura-shrub-blob" position={[0.16 * s, 0.5 * s, 0.08 * s]} scale={[0.28 * s, 0.24 * s, 0.26 * s]} material={matRef} castShadow>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

/**
 * One blossom planting bed: a dark soil dish and a loose cluster of blossom
 * pom-poms — the shore's flower dressing (pulse surround, r3).
 */
export function BlossomBed({ x, z, seed = 0 }: { x: number; z: number; seed?: number }) {
  const palette = useSakuraPalette();
  const puffs = 6;
  const meshRef = useMemo(() => {
    const geometry = new THREE.IcosahedronGeometry(0.11, 0);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0, flatShading: true });
    const mesh = new THREE.InstancedMesh(geometry, material, puffs);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < puffs; i += 1) {
      const a = seeded(i * 2 + seed + 61) * Math.PI * 2;
      const r = 0.14 + seeded(i * 2 + seed + 62) * 0.34;
      const s = 0.7 + seeded(i + seed + 63) * 0.7;
      matrix.makeScale(s, s * 0.85, s);
      matrix.setPosition(x + Math.cos(a) * r, 0.16 + seeded(i + seed + 64) * 0.1, z + Math.sin(a) * r);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = 'sakura-blossom-bed';
    mesh.castShadow = true;
    return mesh;
  }, [x, z, seed]);
  useEffect(
    () => () => {
      meshRef.geometry.dispose();
      (meshRef.material as THREE.Material).dispose();
      meshRef.dispose();
    },
    [meshRef],
  );
  useEffect(() => {
    (meshRef.material as THREE.MeshStandardMaterial).color.set(palette.blossomColorA);
  }, [meshRef, palette.blossomColorA]);
  return (
    <group>
      {/* Soil dish. */}
      <mesh position={[x, 0.03, z]} receiveShadow>
        <cylinderGeometry args={[0.52, 0.6, 0.07, 10]} />
        <meshStandardMaterial color="#4a3a2c" roughness={0.96} metalness={0} />
      </mesh>
      <primitive object={meshRef} />
    </group>
  );
}

/**
 * The wood fence line: posts with two rails — the shore edge in front of the
 * jumbotron rock (pulse surround, r3). Aged-cedar posts, vermilion-touched
 * rails like the bridge.
 */
export function WoodFence({
  x0,
  x1,
  z,
  posts,
  railY = [0.5, 0.92],
}: {
  x0: number;
  x1: number;
  z: number;
  posts: number;
  railY?: readonly [number, number] | number[];
}) {
  const palette = useSakuraPalette();
  const wood = '#4a3b33';
  const postXs = useMemo(
    () => Array.from({ length: posts }, (_, i) => x0 + ((x1 - x0) * i) / (posts - 1)),
    [x0, x1, posts],
  );
  return (
    <group position={[0, 0, z]}>
      {postXs.map((px, i) => (
        <group key={i} position={[px, 0, 0]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[0.09, 1.1, 0.09]} />
            <meshStandardMaterial color={wood} roughness={0.7} metalness={0.1} />
          </mesh>
          {/* Cap bead. */}
          <mesh position={[0, 1.13, 0]} castShadow>
            <boxGeometry args={[0.13, 0.05, 0.13]} />
            <meshStandardMaterial color={palette.toriiRed} roughness={0.5} metalness={0.15} />
          </mesh>
        </group>
      ))}
      {railY.map((y) => (
        <mesh key={y} position={[(x0 + x1) / 2, y, 0.05]} castShadow>
          <boxGeometry args={[x1 - x0, 0.055, 0.04]} />
          <meshStandardMaterial color={wood} roughness={0.72} metalness={0.08} />
        </mesh>
      ))}
    </group>
  );
}

/** One hanging ema plaque (wooden voting tablet) on the rack's crossbar. */
function EmaPlaque({
  x,
  drop,
  palette,
}: {
  x: number;
  drop: number;
  palette: ReturnType<typeof useSakuraPalette>;
}) {
  return (
    <group position={[x, -drop, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.22, 0.28, 0.025]} />
        <meshStandardMaterial color={palette.bannerCloth} roughness={0.8} metalness={0} />
      </mesh>
      {/* Inked wish-stroke. */}
      <mesh position={[0, 0.02, 0.014]}>
        <boxGeometry args={[0.13, 0.03, 0.004]} />
        <meshStandardMaterial color={palette.bannerInk} roughness={0.7} metalness={0} />
      </mesh>
      <mesh position={[0, -0.06, 0.014]}>
        <boxGeometry args={[0.09, 0.02, 0.004]} />
        <meshStandardMaterial color={palette.toriiRed} roughness={0.7} metalness={0} />
      </mesh>
    </group>
  );
}

/**
 * The ema board: a Shinto-vocabulary rack of hanging wish tablets — the
 * teams approach's supporting prop (r3), turned to face the station eye.
 */
export function EmaBoard({ x, z, yaw }: { x: number; z: number; yaw: number }) {
  const palette = useSakuraPalette();
  const wood = '#5d4a3a';
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {/* Two legs + crossbar. */}
      <mesh position={[-0.62, 0.62, 0]} rotation={[0, 0, 0.12]} castShadow>
        <boxGeometry args={[0.07, 1.24, 0.07]} />
        <meshStandardMaterial color={wood} roughness={0.72} metalness={0.08} />
      </mesh>
      <mesh position={[0.62, 0.62, 0]} rotation={[0, 0, -0.12]} castShadow>
        <boxGeometry args={[0.07, 1.24, 0.07]} />
        <meshStandardMaterial color={wood} roughness={0.72} metalness={0.08} />
      </mesh>
      <mesh position={[0, 1.32, 0]} castShadow>
        <boxGeometry args={[1.5, 0.09, 0.07]} />
        <meshStandardMaterial color={wood} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* Roof slat. */}
      <mesh position={[0, 1.46, 0]} rotation={[0, 0, 0]} castShadow>
        <boxGeometry args={[1.66, 0.05, 0.26]} />
        <meshStandardMaterial color={palette.lanternStone} roughness={0.85} metalness={0.02} />
      </mesh>
      {/* Five hanging tablets at seeded drops. */}
      {[-0.56, -0.28, 0, 0.28, 0.56].map((px, i) => (
        <EmaPlaque key={px} x={px} drop={0.28 + seeded(i + 91) * 0.16} palette={palette} />
      ))}
    </group>
  );
}

/** One pennant pole: mast, finial and a small triangular cloth flag. */
function Pennant({
  h,
  cloth,
  palette,
}: {
  h: number;
  cloth: string;
  palette: ReturnType<typeof useSakuraPalette>;
}) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.042, h, 7]} />
        <meshStandardMaterial color="#4a3b33" roughness={0.65} metalness={0.15} />
      </mesh>
      <mesh position={[0, h + 0.05, 0]}>
        <sphereGeometry args={[0.055, 8, 6]} />
        <meshStandardMaterial color={palette.toriiRed} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* Triangular pennant, doubled so it reads from both sides. */}
      <mesh position={[0.19, h - 0.24, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} castShadow>
        <coneGeometry args={[0.16, 0.5, 3]} />
        <meshStandardMaterial
          color={cloth}
          roughness={0.8}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** The pennant cluster (three masts) at the row's north-west shoulder. */
export function PennantCluster({
  poles,
}: {
  poles: readonly { x: number; z: number; h: number }[];
}) {
  const palette = useSakuraPalette();
  return (
    <group>
      {poles.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <Pennant h={p.h} cloth={i % 2 === 0 ? palette.toriiRed : palette.bannerCloth} palette={palette} />
        </group>
      ))}
    </group>
  );
}

/** Rope-railing segment: a slight catenary between two posts at equal height. */
function RopeSpan({
  x0,
  x1,
  z0,
  z1,
  palette,
}: {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  palette: ReturnType<typeof useSakuraPalette>;
}) {
  const rope = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const t = i / 6;
      points.push(
        new THREE.Vector3(
          x0 + (x1 - x0) * t,
          // C-102 r2: hangs from the post caps (0.92) — at the old 0.78 the
          // sag crossed the front nameplates' sight band at x 12.4.
          0.92 - Math.sin(t * Math.PI) * 0.09,
          z0 + (z1 - z0) * t,
        ),
      );
    }
    const curve = new THREE.CatmullRomCurve3(points);
    return { geometry: new THREE.TubeGeometry(curve, 12, 0.022, 5, false) };
  }, [x0, x1, z0, z1]);
  useEffect(() => () => rope.geometry.dispose(), [rope]);
  return (
    <mesh geometry={rope.geometry} castShadow>
      <meshStandardMaterial color={palette.bridgeWood} roughness={0.8} metalness={0} />
    </mesh>
  );
}

/** The rope railing: shimenawa-style posts and sagging rope along one edge. */
export function RopeRailing({ x, posts }: { x: number; posts: readonly number[] }) {
  const palette = useSakuraPalette();
  const wood = '#5d4a3a';
  return (
    <group>
      {posts.map((z) => (
        <group key={z} position={[x, 0, z]}>
          <mesh position={[0, 0.44, 0]} castShadow>
            <cylinderGeometry args={[0.045, 0.055, 0.88, 7]} />
            <meshStandardMaterial color={wood} roughness={0.72} metalness={0.08} />
          </mesh>
          <mesh position={[0, 0.92, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.06, 0.09, 7]} />
            <meshStandardMaterial color={palette.toriiRed} roughness={0.5} metalness={0.15} />
          </mesh>
        </group>
      ))}
      {posts.slice(0, -1).map((z, i) => (
        <RopeSpan key={z} x0={x} x1={x} z0={z} z1={posts[i + 1]} palette={palette} />
      ))}
    </group>
  );
}

/** The direction signpost: a mast with two pointed boards (pulse surround). */
export function SignPost({ x, z, yaw = 0 }: { x: number; z: number; yaw?: number }) {
  const palette = useSakuraPalette();
  const wood = '#5d4a3a';
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.065, 1.9, 7]} />
        <meshStandardMaterial color={wood} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* Pointed boards, opposed. */}
      <mesh position={[0.02, 1.42, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.03, 0.2, 0.78]} />
        <meshStandardMaterial color={palette.bannerCloth} roughness={0.78} metalness={0} />
      </mesh>
      <mesh position={[-0.02, 1.12, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.03, 0.17, 0.62]} />
        <meshStandardMaterial color={palette.bannerCloth} roughness={0.78} metalness={0} />
      </mesh>
      {/* Ink strokes on the boards. */}
      <mesh position={[0.042, 1.44, 0.12]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.004, 0.035, 0.3]} />
        <meshStandardMaterial color={palette.bannerInk} roughness={0.7} metalness={0} />
      </mesh>
      <mesh position={[-0.042, 1.14, -0.08]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.004, 0.03, 0.24]} />
        <meshStandardMaterial color={palette.bannerInk} roughness={0.7} metalness={0} />
      </mesh>
    </group>
  );
}
