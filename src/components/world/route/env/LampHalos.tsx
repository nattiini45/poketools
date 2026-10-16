'use client';

/**
 * Lamp and lantern fog halos (LOOK r6, L6.5), shared by every painted world
 * (ROLLOUT §2.2 f; the plaza's `LampHalos.tsx` is a wrapper over this): soft
 * night fog halos round a world's practicals, as ONE instanced billboard
 * program:
 *
 * - the vertex shader turns each quad to the eye from the view matrix's own
 *   basis (no per-frame CPU work, no `lookAt`);
 * - the fragment is two gaussian lobes (`exp(−r²·5)·0.35 + exp(−r²·40)·0.25`)
 *   plus a faint vertical rain smear below the head, × the calm mask, so a
 *   halo can never brighten a padded face rect;
 * - additive, depth-tested (a façade in front hides it), no depth write, no
 *   fog, never animated;
 * - ALWAYS MOUNTED, day and night: its one program links inside the Pokéball
 *   ceremony and a theme toggle compiles nothing — `uGain` is 0 by day;
 * - the seats are world data, culled ONCE by the caller:
 *   `clearLampHalos(worldSeats, themeKeepOut(WORLD_DATA_SURFACES).sphereClear)`;
 * - the flag is real (ROLLOUT §2.2 a): nothing renders unless
 *   `paintFeature(paint, 'lampHalos')` is on (a hook-free gate, so a world
 *   without the flag mounts no hook, material or program of the layer).
 *
 * The program key stays `plaza-lamp-halo-v1` for every world (renaming it
 * would relink the plaza); one world is mounted at a time.
 */

import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CALM_GLSL, PAINT_UNIFORMS } from '@/components/world/route/paint/paint-uniforms';
import { haloGain, type LampHalo } from '@/lib/route-world/lamp-halos';
import { paintFeature, type RouteThemePaint } from '@/lib/route-world/theme-types';

export const LAMP_HALO_PROGRAM_KEY = 'plaza-lamp-halo-v1';

export const HALO_VERTEX = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec3 aColor;
  attribute float aRadius;
  varying vec2 vHalo;
  varying vec3 vColor;
  void main() {
    // The view matrix's rows are the camera's right / up axes in world space.
    vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
    vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
    vec3 world = aCenter + ( right * position.x + up * position.y ) * aRadius;
    vHalo = position.xy;
    vColor = aColor;
    gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
  }
`;

export const HALO_FRAGMENT = /* glsl */ `
  uniform float uGain;
  ${CALM_GLSL}
  varying vec2 vHalo;
  varying vec3 vColor;
  void main() {
    float r2 = dot( vHalo, vHalo );
    float glow = exp( - r2 * 5.0 ) * 0.35 + exp( - r2 * 40.0 ) * 0.25;
    // A faint vertical rain smear below the head (static).
    float smear = exp( - vHalo.x * vHalo.x * 60.0 ) * smoothstep( - 1.0, - 0.5, vHalo.y ) * ( 1.0 - smoothstep( - 0.1, 0.2, vHalo.y ) ) * 0.06;
    float fade = 1.0 - smoothstep( 0.8, 1.0, sqrt( r2 ) );
    float a = ( glow + smear ) * fade * uGain * ( 1.0 - calmAt( gl_FragCoord.xy ) );
    gl_FragColor = vec4( vColor * a, 1.0 );
  }
`;

function noRaycast(): void {}

/**
 * The halos' gain uniform, module scope like the shafts' strength: a world
 * mounts one halo layer, and a plain module object is written per palette
 * without mutating a hook-owned value.
 */
const HALO_GAIN = { value: 0 };

export interface LampHalosProps {
  /** The world's paint block (`theme.paint`): the layer renders only when `features.lampHalos` is on. */
  paint: RouteThemePaint | null | undefined;
  /** The world's lawful halos (already culled by `clearLampHalos`); a stable array. */
  halos: readonly LampHalo[];
  night: boolean;
  /** One colour for every halo (sRGB hex); absent = each halo's own. */
  color?: string;
  /** Mesh name (the plaza keeps `plaza-lamp-halos`). */
  name?: string;
}

/** The gate: no flag → nothing (hook-free, so the early return never changes a hook order). */
export default function LampHalos({ paint, ...props }: LampHalosProps) {
  if (!paintFeature(paint, 'lampHalos')) return null;
  return <HaloLayer {...props} />;
}

function HaloLayer({ halos, night, color, name = 'lamp-halos' }: Omit<LampHalosProps, 'paint'>) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(2, 2);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    const n = Math.max(1, halos.length);
    const center = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const radius = new Float32Array(n);
    const c = new THREE.Color();
    halos.forEach((halo, i) => {
      center.set(halo.center, i * 3);
      c.set(color ?? halo.color);
      colors.set([c.r, c.g, c.b], i * 3);
      radius[i] = halo.radius;
    });
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
    g.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    g.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radius, 1));
    return g;
  }, [halos, color]);
  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uGain: HALO_GAIN,
        uCalmRects: PAINT_UNIFORMS.uCalmRects,
        uCalmCount: PAINT_UNIFORMS.uCalmCount,
        uCalmViewport: PAINT_UNIFORMS.uCalmViewport,
        uCalmFeather: PAINT_UNIFORMS.uCalmFeather,
      },
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
    });
    m.customProgramCacheKey = () => LAMP_HALO_PROGRAM_KEY;
    m.userData.paintExempt = true;
    return m;
  }, []);
  useLayoutEffect(() => {
    HALO_GAIN.value = haloGain(night);
  }, [night]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <instancedMesh
      args={[geometry, material, Math.max(1, halos.length)]}
      count={halos.length}
      frustumCulled={false}
      raycast={noRaycast}
      renderOrder={3}
      name={name}
      userData-fx="lamp-halos"
    />
  );
}
