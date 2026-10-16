'use client';

/**
 * Contre-jour shafts, shared by every painted world (ROLLOUT §2.2 g; the
 * plaza's `evoliga/route/env/SunShafts.tsx` is a wrapper over this).
 *
 * Soft beams of the golden key slant down onto the ground as the eye looks
 * into the low sun. WHERE they stand is law, not taste: the seats come from a
 * solver (`solveShaftSeats` in `light-shafts.ts`) against every keep-out wedge
 * of the world, and each world's seat table (`lib/route-world/<world>-shafts.ts`)
 * is re-solved by its test. This component only draws what it is given.
 *
 * - ONE InstancedMesh (`capacity`: the ground seats plus the gap beams),
 *   mounted at load at every rung, so its single program links inside the
 *   ceremony; `count` follows `quality.lightShafts` (`instanceCount`) — a
 *   governor step never compiles, uploads or mounts anything.
 * - LOOK r6 (L4a): each beam is wide at its pool and tapers toward the sun,
 *   keeps its strength to near its top (only the last 18 % fades) and fades
 *   out when the eye looks down its own axis (never a slab).
 * - Axial billboards: each quad turns about its own axis to face the eye.
 * - Additive, depth-tested (a façade or a crown in front hides the beam),
 *   no depth write, fog off, never raycast. The brightest a pixel can gain
 *   is `SHAFT_MAX_LINEAR` × `world.key`, × (1 − night), × (1 − calm): the
 *   shared calm rects (`paint-uniforms.ts`) flatten a beam to nothing behind
 *   any visible data face.
 * - Static: the dust streaks are fixed in the beam's own frame (no time
 *   uniform), so a capture at t = 0 and a visitor at any t see the same
 *   beam, and nothing moves inside a face rect.
 * - The flag is real (ROLLOUT §2.2 a): nothing renders unless
 *   `paintFeature(paint, 'sunShafts')` is on (a hook-free gate, so a world
 *   without the flag mounts no hook, material or program of the layer).
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { CALM_GLSL, PAINT_UNIFORMS } from '@/components/world/route/paint/paint-uniforms';
import {
  SHAFT_COLOR,
  SHAFT_MAX,
  SHAFT_MAX_LINEAR,
  SHAFT_TAPER,
  plazaShaftSeats,
  type ShaftSeat,
} from '@/lib/route-world/light-shafts';
import { paintFeature, type RouteThemePaint } from '@/lib/route-world/theme-types';

/** LOOK r5: the gap beams (`gap`), drawn from rung `lightShafts` ≥ 2. */
export const GAP_SHAFT_MIN_RUNG_SHAFTS = 2;

/** Default instance capacity: the solved ground seats plus three gap beams (the plaza's). */
export const SHAFT_CAPACITY = SHAFT_MAX + 3;

export const SHAFT_VERTEX = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aWidth;
  attribute float aSeed;
  varying vec2 vShaft;
  varying float vLen;
  varying float vSeed;
  varying float vEye;
  varying float vAxial;
  void main() {
    vec3 start = ( modelMatrix * vec4( aStart, 1.0 ) ).xyz;
    vec3 end = ( modelMatrix * vec4( aEnd, 1.0 ) ).xyz;
    vec3 axis = end - start;
    float len = max( length( axis ), 1e-4 );
    vec3 dir = axis / len;
    vec3 p = start + axis * position.y;
    vec3 side = cross( dir, cameraPosition - p );
    float sideLen = length( side );
    side = sideLen > 1e-4 ? side / sideLen : vec3( 1.0, 0.0, 0.0 );
    // LOOK r6 (L4a): wide at the pool, tapering as it climbs toward the sun.
    float width = aWidth * mix( ${SHAFT_TAPER.pool.toFixed(2)}, ${SHAFT_TAPER.top.toFixed(2)}, position.y );
    vec3 world = p + side * position.x * width;
    vShaft = vec2( position.x * 2.0, position.y );
    vLen = len;
    vSeed = aSeed;
    vEye = length( cameraPosition - world );
    // How nearly the eye looks down the beam's own axis (1 = along it).
    vAxial = abs( dot( dir, normalize( cameraPosition - p ) ) );
    gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
  }
`;

export const SHAFT_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  ${CALM_GLSL}
  varying vec2 vShaft;
  varying float vLen;
  varying float vSeed;
  varying float vEye;
  varying float vAxial;
  void main() {
    float a = 1.0 - min( abs( vShaft.x ), 1.0 );
    // LOOK r6 (L4a): a flatter core with a defined edge — a beam, not a haze.
    float across = smoothstep( 0.0, 0.45, a );
    // LOOK r6 (L4a): soft where the beam starts, full strength almost to its
    // top — only the last 18 % fades (r5 killed the upper 65 %).
    float along = smoothstep( 0.0, 0.08, vShaft.y ) * ( 1.0 - smoothstep( 0.82, 1.0, vShaft.y ) );
    // Static dust streaks in the beam's own frame (no time term).
    float m = vShaft.y * vLen;
    float streak = 0.5 + 0.5 * sin( vShaft.x * 7.0 + vSeed * 6.2831 + sin( m * 0.9 + vSeed * 3.0 ) * 1.3 );
    // LOOK r6 (L4a): stronger striation, so a wide beam reads as rays, not fog.
    float dust = 0.45 + 0.55 * streak * streak;
    // Never a slab across the lens when an eye passes close to a beam, nor
    // when it looks down a beam's own axis (the billboard turns edge-on).
    float nearFade = smoothstep( 1.5, 5.0, vEye );
    float axialFade = 1.0 - smoothstep( 0.75, 0.97, vAxial );
    float calm = calmAt( gl_FragCoord.xy );
    float k = across * along * dust * nearFade * axialFade * ( 1.0 - calm );
    gl_FragColor = vec4( uColor * ( uStrength * k ), 1.0 );
  }
`;

/** A shaft colour (sRGB hex, default `SHAFT_COLOR`) in linear light, normalised so its brightest channel is 1 (the cap then holds per channel). */
export function shaftColorLinear(out: THREE.Color = new THREE.Color(), color: string = SHAFT_COLOR): THREE.Color {
  out.set(color);
  const peak = Math.max(out.r, out.g, out.b, 1e-6);
  return out.multiplyScalar(1 / peak);
}

/** The additive strength for a frame: capped, × the station key, off at night. */
export function shaftStrength(worldKey: number, night: boolean): number {
  if (night) return 0;
  return SHAFT_MAX_LINEAR * Math.min(1, Math.max(0, worldKey));
}

/** Instances drawn at a rung's `lightShafts` (never above the seated table). */
export function shaftCount(lightShafts: number, seats: readonly ShaftSeat[] = plazaShaftSeats()): number {
  return Math.max(0, Math.min(SHAFT_MAX, seats.length, Math.floor(lightShafts)));
}

/**
 * Instances a rung draws (a prefix of the instance buffer, which holds the gap
 * beams FIRST, hero first, then the ground seats best-first): from
 * `GAP_SHAFT_MIN_RUNG_SHAFTS` every gap beam plus that many ground seats;
 * LOOK r6 (L4a, E9): a rung with ONE shaft (rung 2) keeps the hero gap beam.
 */
export function instanceCount(lightShafts: number, seats: readonly ShaftSeat[], gap: readonly ShaftSeat[]): number {
  const n = Math.max(0, Math.floor(lightShafts));
  if (n === 0) return 0;
  if (n < GAP_SHAFT_MIN_RUNG_SHAFTS) return Math.min(n, gap.length) || shaftCount(n, seats);
  return gap.length + shaftCount(n, seats);
}

function noRaycast(): void {}

/**
 * The shafts' strength uniform, module scope like the tree wind clock: a
 * world mounts one shaft layer, and a plain module object is written per
 * frame without mutating a hook-owned value.
 */
const SHAFT_STRENGTH = { value: 0 };

const NO_GAP: readonly ShaftSeat[] = [];

export interface SunShaftsProps {
  /** The world's paint block (`theme.paint`): the layer renders only when `features.sunShafts` is on. */
  paint: RouteThemePaint | null | undefined;
  /** The solved ground seats, best first (a stable array). */
  seats: readonly ShaftSeat[];
  /** The gap beams, hero first (a stable array; default none). */
  gap?: readonly ShaftSeat[];
  night: boolean;
  /** Beam colour (sRGB hex; default `SHAFT_COLOR`). */
  color?: string;
  /** Instance capacity (default `SHAFT_CAPACITY`). */
  capacity?: number;
}

/** The gate: no flag → nothing (hook-free, so the early return never changes a hook order). */
export default function SunShafts({ paint, ...props }: SunShaftsProps) {
  if (!paintFeature(paint, 'sunShafts')) return null;
  return <ShaftLayer {...props} />;
}

function ShaftLayer({ seats, gap = NO_GAP, night, color = SHAFT_COLOR, capacity = SHAFT_CAPACITY }: Omit<SunShaftsProps, 'paint'>) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { conductor, sampleWorldState } = useWorldState();
  const quality = useQuality();

  const geometry = useMemo(() => {
    // A unit quad: x across the beam (−0.5..0.5), y along it (0 at the pool).
    const g = new THREE.PlaneGeometry(1, 1, 1, 4);
    g.translate(0, 0.5, 0);
    const start = new Float32Array(capacity * 3);
    const end = new Float32Array(capacity * 3);
    const width = new Float32Array(capacity);
    const seed = new Float32Array(capacity);
    [...gap, ...seats.slice(0, SHAFT_MAX)].slice(0, capacity).forEach((seat, i) => {
      start.set(seat.pool, i * 3);
      end.set(seat.top, i * 3);
      width[i] = seat.width;
      seed[i] = (i + 1) * 0.618;
    });
    g.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 3));
    g.setAttribute('aEnd', new THREE.InstancedBufferAttribute(end, 3));
    g.setAttribute('aWidth', new THREE.InstancedBufferAttribute(width, 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    return g;
  }, [seats, gap, capacity]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: shaftColorLinear() },
          uStrength: SHAFT_STRENGTH,
          // The shared calm slots, bound by reference (never copied).
          uCalmRects: PAINT_UNIFORMS.uCalmRects,
          uCalmCount: PAINT_UNIFORMS.uCalmCount,
          uCalmViewport: PAINT_UNIFORMS.uCalmViewport,
          uCalmFeather: PAINT_UNIFORMS.uCalmFeather,
        },
        vertexShader: SHAFT_VERTEX,
        fragmentShader: SHAFT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      }),
    [],
  );

  // The beam colour: a uniform write (the plaza's is `SHAFT_COLOR`, as created).
  useLayoutEffect(() => {
    shaftColorLinear(material.uniforms.uColor.value as THREE.Color, color);
  }, [material, color]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // Rung → instance count: a draw-count change only.
  const count = Math.min(capacity, instanceCount(quality.lightShafts, seats, gap));
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (mesh) mesh.count = count;
  }, [count]);

  useFrame(() => {
    const world = sampleWorldState(conductor.progress.current.smooth);
    SHAFT_STRENGTH.value = shaftStrength(world.key, night);
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, capacity]}
      count={count}
      frustumCulled={false}
      raycast={noRaycast}
      renderOrder={2}
      userData-fx="sun-shafts"
    />
  );
}
