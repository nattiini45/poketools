'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useCloudsPalette } from '../use-clouds-palette';

/**
 * The isles' small prop kit — the shared vocabulary the station isles dress
 * their scenes with: dock railings, supply crates, mooring lantern posts,
 * pennant clusters, sky-shard crystals and meadow scrubs. Repeated elements
 * are seeded (never Math.random) so stills stay reproducible; every mesh
 * disposes its GPU resources on unmount. (The round-crown blob SkyTree that
 * used to live here retired in C-104 — real trees mount through Trees.tsx
 * on the shared tree system.)
 */

/** Stable pseudo-random in [0,1) from an integer seed — no Math.random. */
export function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * One dock railing run along +Z at a fixed x: posts with a top rail and a
 * mid rail, island-dock timber.
 */
export function DockRailing({
  x,
  z0,
  z1,
  y = 0,
}: {
  x: number;
  z0: number;
  z1: number;
  y?: number;
}) {
  const palette = useCloudsPalette();
  const length = z1 - z0;
  const posts = useMemo(() => {
    const count = Math.max(2, Math.round(length / 1.1) + 1);
    return Array.from({ length: count }, (_, i) => z0 + (length * i) / (count - 1));
  }, [length, z0]);

  return (
    <group position={[x, y, 0]}>
      {posts.map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh position={[0, 0.42, 0]} castShadow>
            <boxGeometry args={[0.09, 0.84, 0.09]} />
            <meshStandardMaterial color={palette.timberColor} roughness={0.76} metalness={0.05} />
          </mesh>
          <mesh position={[0, 0.88, 0]} castShadow>
            <boxGeometry args={[0.13, 0.05, 0.13]} />
            <meshStandardMaterial color={palette.stoneColor} roughness={0.85} metalness={0.02} />
          </mesh>
        </group>
      ))}
      {([0.78, 0.42] as const).map((railY) => (
        <mesh key={railY} position={[0, railY, (z0 + z1) / 2]} castShadow>
          <boxGeometry args={[0.05, 0.06, length]} />
          <meshStandardMaterial color={palette.timberColor} roughness={0.78} metalness={0.05} />
        </mesh>
      ))}
    </group>
  );
}

/** One supply crate — banded timber, the isles' cargo vocabulary. */
export function Crate({ x, z, y = 0, s = 1 }: { x: number; z: number; y?: number; s?: number }) {
  const palette = useCloudsPalette();
  return (
    <group position={[x, y, z]} rotation={[0, seeded(Math.round(x * 13 + z * 7)) * Math.PI, 0]}>
      <mesh position={[0, 0.28 * s, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.56 * s, 0.56 * s, 0.56 * s]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.8} metalness={0.04} />
      </mesh>
      {/* Brass band. */}
      <mesh position={[0, 0.28 * s, 0.29 * s]} castShadow>
        <boxGeometry args={[0.6 * s, 0.08 * s, 0.02 * s]} />
        <meshStandardMaterial color={palette.boardAccent} roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  );
}

/**
 * A mooring lantern post: timber mast, cross arm, glazed light box and cap.
 * The box carries a warm glow emission (the isles' practical; brighter under
 * the moon), and children mount at the cap's standing height.
 */
export function LanternPost({
  x,
  z,
  y = 0,
  s = 1,
  night,
  practical = false,
  children,
}: {
  x: number;
  z: number;
  y?: number;
  s?: number;
  night: boolean;
  practical?: boolean;
  children?: ReactNode;
}) {
  const palette = useCloudsPalette();
  return (
    <group position={[x, y, z]}>
      {/* Mast. */}
      <mesh position={[0, 0.85 * s, 0]} castShadow>
        <cylinderGeometry args={[0.05 * s, 0.07 * s, 1.7 * s, 7]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.75} metalness={0.06} />
      </mesh>
      {/* Cross arm. */}
      <mesh position={[0.14 * s, 1.52 * s, 0]} rotation={[0, 0, 0.5]} castShadow>
        <cylinderGeometry args={[0.035 * s, 0.035 * s, 0.62 * s, 6]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.78} metalness={0.05} />
      </mesh>
      {/* Glazed light box with the warm glow. */}
      <mesh position={[0.36 * s, 1.44 * s, 0]} castShadow>
        <cylinderGeometry args={[0.13 * s, 0.11 * s, 0.3 * s, 6]} />
        <meshStandardMaterial
          color={palette.stoneColor}
          emissive={palette.lanternGlow}
          emissiveIntensity={night ? 2.1 : 0.4}
          roughness={0.6}
          metalness={0}
        />
      </mesh>
      {/* Cap. */}
      <mesh position={[0.36 * s, 1.64 * s, 0]} castShadow>
        <coneGeometry args={[0.2 * s, 0.2 * s, 6]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.8} metalness={0.04} />
      </mesh>
      {practical ? (
        <pointLight
          position={[0.36 * s, 1.44 * s, 0]}
          color={palette.lanternGlow}
          intensity={night ? 6 * s : 0.8 * s}
          distance={8 * s}
          decay={2}
          castShadow={false}
        />
      ) : null}
      <group position={[0, 1.6 * s, 0]}>{children}</group>
    </group>
  );
}

/** One pennant pole: mast, finial and a small triangle marker, doubled. */
export function Pennant({
  x,
  z,
  y = 0,
  h,
}: {
  x: number;
  z: number;
  y?: number;
  h: number;
}) {
  const palette = useCloudsPalette();
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.04, h, 6]} />
        <meshStandardMaterial color={palette.timberColor} roughness={0.7} metalness={0.08} />
      </mesh>
      <mesh position={[0, h + 0.05, 0]}>
        <sphereGeometry args={[0.05, 8, 6]} />
        <meshStandardMaterial color={palette.boardAccent} roughness={0.4} metalness={0.4} />
      </mesh>
      <mesh position={[0.17, h - 0.22, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]} castShadow>
        <coneGeometry args={[0.15, 0.46, 3]} />
        <meshStandardMaterial
          color={palette.sailTrim}
          roughness={0.8}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** One sky-shard crystal: a floating octahedron with a faint inner glow. */
export function Shard({
  x,
  y,
  z,
  s = 1,
  night,
}: {
  x: number;
  y: number;
  z: number;
  s?: number;
  night: boolean;
}) {
  const palette = useCloudsPalette();
  const phase = seeded(Math.round(x * 31 + z * 17 + y * 7));
  return (
    <group position={[x, y, z]} rotation={[0, phase * Math.PI, 0.12 + phase * 0.2]}>
      <mesh castShadow>
        <octahedronGeometry args={[0.34 * s, 0]} />
        <meshStandardMaterial
          color={palette.shardColor}
          emissive={palette.bridgeGlow}
          emissiveIntensity={night ? 1.4 : 0.25}
          roughness={0.15}
          metalness={0.1}
          flatShading
        />
      </mesh>
    </group>
  );
}

/** One meadow scrub — two wind-cut blobs on the isle's turf line. */
export function Scrub({ x, z, y = 0, s = 1 }: { x: number; z: number; y?: number; s?: number }) {
  const palette = useCloudsPalette();
  const matRef = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true }),
    [],
  );
  useEffect(
    () => () => {
      matRef.dispose();
    },
    [matRef],
  );
  useEffect(() => {
    const c = new THREE.Color(palette.meadowColor);
    c.lerp(new THREE.Color(palette.rockColor), 0.25);
    matRef.color.copy(c);
  }, [matRef, palette.meadowColor, palette.rockColor]);
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0.24 * s, 0]} scale={[0.38 * s, 0.28 * s, 0.36 * s]} material={matRef} castShadow>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>
      <mesh position={[0.14 * s, 0.4 * s, 0.06 * s]} scale={[0.24 * s, 0.2 * s, 0.22 * s]} material={matRef} castShadow>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
