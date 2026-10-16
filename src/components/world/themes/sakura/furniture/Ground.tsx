'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { mixHex, scaleHex } from '@/lib/route-world/water';
import { useSakuraPalette } from '../use-sakura-palette';
import { LAKE } from './layout';

/**
 * The park floor: one lawn disc, a sand shore ring around the lake, a path
 * strip to the torii, and instanced grass tufts + shore reeds. The tuft and
 * reed counts multiply by the quality ladder's `grassDensity` (descend-only)
 * — the rungs thin the field, they never regrow it.
 */

/** Stable pseudo-random in [0,1) — the preview fixtures' law: no Math.random. */
export function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Is a point on the lawn (outside the lake ellipse and off the path strips)? */
function onLawn(x: number, z: number): boolean {
  const nx = (x - LAKE.x) / (LAKE.rx + 0.7);
  const nz = (z - LAKE.z) / (LAKE.rz + 0.7);
  if (nx * nx + nz * nz < 1) return false; // in or at the lake
  if (Math.abs(x) < 1.3 && z > -4 && z < 13.5) return false; // south path
  if (Math.abs(z) < 1.1 && x > -13 && x < 13) return false; // east-west path
  return true;
}

/** Seeded grass tuft positions across the lawn. */
function tuftPositions(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  let placed = 0;
  for (let i = 0; placed < count; i += 1) {
    const a = seeded(i * 2 + 1) * Math.PI * 2;
    const r = Math.sqrt(seeded(i * 2 + 2)) * 26;
    const x = Math.cos(a) * r;
    const z = -2 + Math.sin(a) * r * 0.95;
    if (!onLawn(x, z)) continue;
    out[placed * 3] = x;
    out[placed * 3 + 1] = 0;
    out[placed * 3 + 2] = z;
    placed += 1;
  }
  return out;
}

/**
 * Seeded reed positions hugging the lake's shore band. W3 r3: a METRIC band
 * 0.15–0.95 m outside the rim along the ellipse normal (the old ×radius
 * jitter spread them up to 4.5 m out on the long axis, where a field of pale
 * cones read as a milky veil over the east shore at 390).
 */
function reedPositions(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + seeded(i + 7) * 0.14;
    const out01 = seeded(i + 31);
    const rimX = Math.cos(a) * LAKE.rx;
    const rimZ = Math.sin(a) * LAKE.rz;
    const nx = Math.cos(a) / LAKE.rx;
    const nz = Math.sin(a) / LAKE.rz;
    const nLen = Math.hypot(nx, nz);
    const offset = 0.15 + out01 * out01 * 0.8;
    const x = LAKE.x + rimX + (nx / nLen) * offset;
    const z = LAKE.z + rimZ + (nz / nLen) * offset;
    out[i * 3] = x;
    out[i * 3 + 1] = 0;
    out[i * 3 + 2] = z;
  }
  return out;
}

/** One instanced field of small cones — grass tufts or shore reeds. */
function ConeField({
  positions,
  density,
  scale,
  color,
  name,
}: {
  positions: Float32Array;
  density: number;
  scale: [number, number, number];
  color: string;
  name: string;
}) {
  const meshRef = useMemo(() => {
    const total = positions.length / 3;
    const live = Math.max(0, Math.floor(total * density));
    const geometry = new THREE.ConeGeometry(scale[0], scale[1], 4);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.94,
      metalness: 0,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, live);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < live; i += 1) {
      const s = 0.7 + seeded(i + 911) * 0.6;
      matrix.makeScale(s, s * (0.8 + seeded(i + 71) * 0.6), s);
      matrix.setPosition(positions[i * 3], (scale[1] * s) / 2, positions[i * 3 + 2]);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }, [positions, density, scale, color, name]);

  useEffect(
    () => () => {
      meshRef.geometry.dispose();
      (meshRef.material as THREE.Material).dispose();
      meshRef.dispose();
    },
    [meshRef],
  );

  return <primitive object={meshRef} />;
}

export default function Ground() {
  const palette = useSakuraPalette();
  const { grassDensity } = useQuality();

  const tufts = useMemo(() => tuftPositions(1400), []);
  const reeds = useMemo(() => reedPositions(240), []);
  // W3 r3: wet sand at the waterline (darker, desaturated path tone — the
  // same wet-rim law the water's shore band blends toward) and muted reeds
  // (the pale lakeShallow cones read as haze, not plants).
  const wetSand = useMemo(
    () => scaleHex(mixHex(palette.pathColor, '#808080', 0.3), 0.72),
    [palette.pathColor],
  );
  const reedColor = useMemo(
    () => scaleHex(mixHex(palette.lawnColor, palette.lakeShallow, 0.3), 0.82),
    [palette.lawnColor, palette.lakeShallow],
  );

  return (
    <group>
      {/* Lawn disc. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2]} receiveShadow>
        <circleGeometry args={[34, 64]} />
        <meshStandardMaterial color={palette.lawnColor} roughness={0.96} metalness={0} />
      </mesh>
      {/* Sand shore ring around the lake (an elliptical ring: the lake is an
          ellipse, so the ring scales the same way and the band breathes a
          little — read as a shoreline, not a machine-drawn band). The inner
          edge tucks 0.1 m under the water's rim (the water sits at LAKE.y,
          above the sand), so the bounded water's wet band and foam lip meet
          sand directly — no lawn sliver between water and shore. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[LAKE.x, 0.012, LAKE.z]}
        scale={[1, LAKE.rz / LAKE.rx, 1]}
        receiveShadow
      >
        <ringGeometry args={[LAKE.rx - 0.1, LAKE.rx + 1.75, 64]} />
        <meshStandardMaterial color={palette.pathColor} roughness={0.95} metalness={0} />
      </mesh>
      {/* Wet-sand rim (W3 r3): a narrow darker band from under the water's
          edge to ~0.45 m out on the long axis (the ellipse scale narrows it
          toward the short axis), so the shoreline reads as wet sand meeting
          water rather than a pale veil. Above the dry ring, below the rim. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[LAKE.x, 0.016, LAKE.z]}
        scale={[1, LAKE.rz / LAKE.rx, 1]}
        receiveShadow
      >
        <ringGeometry args={[LAKE.rx - 0.1, LAKE.rx + 0.45, 96]} />
        <meshStandardMaterial color={wetSand} roughness={0.7} metalness={0} />
      </mesh>
      {/* South path to the torii + east-west crossing path. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 4.6]} receiveShadow>
        <planeGeometry args={[2.4, 18.4]} />
        <meshStandardMaterial color={palette.pathColor} roughness={0.95} metalness={0} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, -0.4]} receiveShadow>
        <planeGeometry args={[25, 2.2]} />
        <meshStandardMaterial color={palette.pathColor} roughness={0.95} metalness={0} />
      </mesh>
      <ConeField
        positions={tufts}
        density={grassDensity}
        scale={[0.05, 0.34, 0.05]}
        color={palette.lawnColor}
        name="sakura-grass-tufts"
      />
      <ConeField
        positions={reeds}
        density={grassDensity}
        scale={[0.035, 0.62, 0.035]}
        color={reedColor}
        name="sakura-shore-reeds"
      />
    </group>
  );
}
