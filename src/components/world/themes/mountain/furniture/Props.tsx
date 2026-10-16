'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useMountainPalette } from '../use-mountain-palette';

/**
 * The valley's small prop kit — the shared vocabulary the station passes
 * dress their scenes with: stepping-stone paving, scrub shrubs, snow
 * patches, the timber fence line, the trail-marker pennant cluster, the
 * rope railing, the direction signpost, the rescue cache box and the hiker
 * bench. Repeated elements are InstancedMeshes over seeded (never
 * Math.random) positions so stills stay reproducible; every mesh disposes
 * its GPU resources on unmount.
 */

/** Stable pseudo-random in [0,1) from an integer seed — no Math.random. */
export function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Instanced flattened stone discs — forecourt and apron paving. */
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
  const palette = useMountainPalette();
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
    mesh.name = 'mountain-stepping-stones';
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

/** One alpine scrub — two small wind-cut blobs on the meadow line. */
export function Scrub({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  const palette = useMountainPalette();
  const matRef = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true }),
    [],
  );
  useEffect(
    () => () => {
      matRef.dispose();
    },
    [matRef],
  );
  useEffect(() => {
    const c = new THREE.Color(palette.pineColorB);
    c.lerp(new THREE.Color(palette.meadowColor), 0.4);
    matRef.color.copy(c);
  }, [matRef, palette.pineColorB, palette.meadowColor]);
  return (
    <group name="mountain-scrub" position={[x, 0, z]}>
      <mesh name="mountain-scrub-blob" position={[0, 0.26 * s, 0]} scale={[0.4 * s, 0.3 * s, 0.38 * s]} material={matRef} castShadow>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>
      <mesh name="mountain-scrub-blob" position={[0.15 * s, 0.44 * s, 0.07 * s]} scale={[0.26 * s, 0.22 * s, 0.24 * s]} material={matRef} castShadow>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}

/** One snow patch — a flattened cold-white lozenge hugging the ground. */
export function SnowPatch({
  x,
  z,
  s = 1,
  y = 0.02,
}: {
  x: number;
  z: number;
  s?: number;
  y?: number;
}) {
  const palette = useMountainPalette();
  const matRef = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, flatShading: true }),
    [],
  );
  useEffect(
    () => () => {
      matRef.dispose();
    },
    [matRef],
  );
  useEffect(() => {
    matRef.color.set(palette.snowColor);
  }, [matRef, palette.snowColor]);
  return (
    <mesh
      position={[x, y, z]}
      rotation={[0, seeded(Math.round(x * 13 + z * 7)) * Math.PI, 0]}
      scale={[1 * s, 0.09 * s, 0.72 * s]}
      material={matRef}
      receiveShadow
    >
      <icosahedronGeometry args={[0.5, 1]} />
    </mesh>
  );
}

/**
 * A storm lantern: a post-mounted hexagonal lantern, procedural from
 * primitives — post, collar, glazed light box, pitched cap and finial. The
 * box carries a warm glow emission (the valley's practical; brighter under
 * the moon), and children mount at the cap's standing height.
 */
export interface StormLanternProps {
  /** Overall scale (1 ≈ 1.5 m to the finial). */
  scale?: number;
  night: boolean;
  /**
   * Mount a real point light. The valley keeps the count of practicals
   * small (the box emission reads on every lantern); a chosen few pool
   * light on the ground.
   */
  practical?: boolean;
  children?: ReactNode;
}

/** Finial top height of the default lantern, local metres. */
export const LANTERN_H = 1.5;

export function StormLantern({
  scale = 1,
  night,
  practical = false,
  children,
}: StormLanternProps) {
  const palette = useMountainPalette();
  const s = scale;
  const stone = palette.lanternStone;
  return (
    <group>
      {/* Foundation block. */}
      <mesh position={[0, 0.08 * s, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.3 * s, 0.16 * s, 0.3 * s]} />
        <meshStandardMaterial color={stone} roughness={0.9} metalness={0.02} />
      </mesh>
      {/* Timber post. */}
      <mesh position={[0, (0.16 + 0.52) * s, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.05 * s, 0.065 * s, 1.04 * s, 7]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.78} metalness={0.05} />
      </mesh>
      {/* Collar under the box. */}
      <mesh position={[0, 0.74 * s, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.14 * s, 0.1 * s, 0.06 * s, 6]} />
        <meshStandardMaterial color={stone} roughness={0.88} metalness={0.02} />
      </mesh>
      {/* Glazed light box with the warm glow. */}
      <mesh position={[0, 0.98 * s, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.15 * s, 0.13 * s, 0.32 * s, 6]} />
        <meshStandardMaterial
          color={stone}
          emissive={palette.lanternGlow}
          emissiveIntensity={night ? 1.7 : 0.35}
          roughness={0.6}
          metalness={0}
        />
      </mesh>
      {/* Pitched cap. */}
      <mesh position={[0, 1.24 * s, 0]} rotation={[0, Math.PI / 6, 0]} castShadow receiveShadow>
        <coneGeometry args={[0.24 * s, 0.24 * s, 6]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.8} metalness={0.04} />
      </mesh>
      {/* Finial. */}
      <mesh position={[0, 1.42 * s, 0]} castShadow>
        <sphereGeometry args={[0.045 * s, 10, 8]} />
        <meshStandardMaterial color={stone} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* A chosen few lanterns pool light on the ground; the rest read by
          their box emission alone. */}
      {practical ? (
        <pointLight
          position={[0, 0.98 * s, 0]}
          color={palette.lanternGlow}
          intensity={night ? 7 * s : 0.9 * s}
          distance={9 * s}
          decay={2}
          castShadow={false}
        />
      ) : null}
      {/* Children stand at the cap. */}
      <group position={[0, 1.36 * s, 0]}>{children}</group>
    </group>
  );
}

/** The timber fence line: posts with two rails — the pulse shore edge. */
export function TimberFence({
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
  const palette = useMountainPalette();
  const postXs = useMemo(
    () => Array.from({ length: posts }, (_, i) => x0 + ((x1 - x0) * i) / (posts - 1)),
    [x0, x1, posts],
  );
  return (
    <group position={[0, 0, z]}>
      {postXs.map((px, i) => (
        <group key={i} position={[px, 0, 0]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <boxGeometry args={[0.1, 1.1, 0.1]} />
            <meshStandardMaterial color={palette.timberColor} roughness={0.74} metalness={0.06} />
          </mesh>
          {/* Cap bead. */}
          <mesh position={[0, 1.13, 0]} castShadow>
            <boxGeometry args={[0.14, 0.05, 0.14]} />
            <meshStandardMaterial color={palette.lanternStone} roughness={0.85} metalness={0.02} />
          </mesh>
        </group>
      ))}
      {railY.map((y) => (
        <mesh key={y} position={[(x0 + x1) / 2, y, 0.05]} castShadow>
          <boxGeometry args={[x1 - x0, 0.06, 0.045]} />
          <meshStandardMaterial color={palette.timberColor} roughness={0.76} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

/** One trail-marker pennant pole: mast, finial and a small triangle flag. */
function Pennant({
  h,
  cloth,
  palette,
}: {
  h: number;
  cloth: string;
  palette: ReturnType<typeof useMountainPalette>;
}) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.042, h, 7]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.68} metalness={0.1} />
      </mesh>
      <mesh position={[0, h + 0.05, 0]}>
        <sphereGeometry args={[0.055, 8, 6]} />
        <meshStandardMaterial color={palette.boardAccent} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* Triangular marker, doubled so it reads from both sides. */}
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

/** The trail-marker cluster (three masts) dressing a station shoulder. */
export function PennantCluster({
  poles,
}: {
  poles: readonly { x: number; z: number; h: number }[];
}) {
  const palette = useMountainPalette();
  return (
    <group>
      {poles.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <Pennant
            h={p.h}
            cloth={i % 2 === 0 ? palette.boardAccent : palette.snowColor}
            palette={palette}
          />
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
}: {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}) {
  const rope = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const t = i / 6;
      points.push(
        new THREE.Vector3(
          x0 + (x1 - x0) * t,
          // C-103 r1: hangs from the post caps (0.92) — at the old 0.78 the
          // sag dipped into the widened teams plaques' sight band at the
          // railing plane (the C-102 r2 measured fix; same geometry).
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
      <meshStandardMaterial color="#6b5a44" roughness={0.85} metalness={0} />
    </mesh>
  );
}

/** The rope railing: posts and sagging rope along one edge (viewing gaps). */
export function RopeRailing({ x, posts }: { x: number; posts: readonly number[] }) {
  const palette = useMountainPalette();
  const timber = palette.timberColor;
  return (
    <group>
      {posts.map((z) => (
        <group key={z} position={[x, 0, z]}>
          <mesh position={[0, 0.44, 0]} castShadow>
            <cylinderGeometry args={[0.045, 0.055, 0.88, 7]} />
            <meshStandardMaterial color={timber} roughness={0.74} metalness={0.06} />
          </mesh>
          <mesh position={[0, 0.92, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.06, 0.09, 7]} />
            <meshStandardMaterial color={palette.lanternStone} roughness={0.85} metalness={0.02} />
          </mesh>
        </group>
      ))}
      {posts.slice(0, -1).map((z, i) => (
        <RopeSpan key={z} x0={x} x1={x} z0={z} z1={posts[i + 1]} />
      ))}
    </group>
  );
}

/** The direction signpost: a mast with two pointed boards. */
export function SignPost({ x, z, yaw = 0 }: { x: number; z: number; yaw?: number }) {
  const palette = useMountainPalette();
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.065, 1.9, 7]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.72} metalness={0.08} />
      </mesh>
      {/* Pointed boards, opposed. */}
      <mesh position={[0.02, 1.42, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.03, 0.2, 0.78]} />
        <meshStandardMaterial color="#d9c9a8" roughness={0.78} metalness={0} />
      </mesh>
      <mesh position={[-0.02, 1.12, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.03, 0.17, 0.62]} />
        <meshStandardMaterial color="#d9c9a8" roughness={0.78} metalness={0} />
      </mesh>
      {/* Routed strokes on the boards. */}
      <mesh position={[0.042, 1.44, 0.12]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.004, 0.035, 0.3]} />
        <meshStandardMaterial color="#4a3a28" roughness={0.7} metalness={0} />
      </mesh>
      <mesh position={[-0.042, 1.14, -0.08]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[0.004, 0.03, 0.24]} />
        <meshStandardMaterial color="#4a3a28" roughness={0.7} metalness={0} />
      </mesh>
    </group>
  );
}

/** The rescue cache box: a red-latched timber chest on a stone plinth. */
export function CacheBox({ x, z, yaw = 0 }: { x: number; z: number; yaw?: number }) {
  const palette = useMountainPalette();
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {/* Stone plinth. */}
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.24, 0.6]} />
        <meshStandardMaterial color={palette.lanternStone} roughness={0.9} metalness={0.02} />
      </mesh>
      {/* Chest body. */}
      <mesh position={[0, 0.52, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.82, 0.44, 0.52]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.72} metalness={0.05} />
      </mesh>
      {/* Lid + red latch. */}
      <mesh position={[0, 0.76, 0]} castShadow>
        <boxGeometry args={[0.86, 0.08, 0.56]} />
        <meshStandardMaterial color="#8a3a28" roughness={0.6} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.7, 0.28]} castShadow>
        <boxGeometry args={[0.1, 0.14, 0.04]} />
        <meshStandardMaterial color={palette.boardAccent} roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  );
}

/** The hiker bench: two timber slats on log legs, dressing the sign meadow. */
export function Bench({ x, z, yaw = 0 }: { x: number; z: number; yaw?: number }) {
  const palette = useMountainPalette();
  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>      {([-0.55, 0.55] as const).map((dx) => (
        <mesh key={dx} position={[dx, 0.22, 0]} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
          <cylinderGeometry args={[0.06, 0.07, 0.44, 7]} />
          <meshStandardMaterial color="#5d4a38" roughness={0.8} metalness={0.04} />
        </mesh>
      ))}
      <mesh position={[0, 0.46, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.06, 0.44]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.76} metalness={0.04} />
      </mesh>
      <mesh position={[0, 0.72, -0.2]} rotation={[0.16, 0, 0]} castShadow>
        <boxGeometry args={[1.6, 0.34, 0.05]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.76} metalness={0.04} />
      </mesh>
    </group>
  );
}

/** The storm lantern is the kit's default export (the park-lantern idiom). */
export default StormLantern;
