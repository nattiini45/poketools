'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { usePlazaPalette } from '@/components/world/themes/plaza/use-plaza-palette';
import type { PlazaWorldPalette } from '@/components/world/themes/plaza/theme-palette';
import { plazaTheme } from '@/components/world/themes/plaza/theme';
import type { Vec3Tuple } from '@/lib/route-world/focus';
import { PaintRigMounts, usePaintRig } from '@/components/world/route/paint/PaintRig';
import { PLAZA_DATA_SURFACES } from '../plaza/data-faces';

// ROLLOUT §2.2 (b): the rig's constants and maths moved to the shared
// `route/paint/paint-rig.ts`; re-exported here so every import path of record holds.
export {
  CONTRE_JOUR,
  POST_OFF_KEY_NEUTRAL,
  POST_OFF_SATURATION,
  POST_OFF_SHADE_SHIFT,
  contreJourFactor,
  keyColorFor,
  paintSetForRung,
} from '@/components/world/route/paint/paint-rig';

/**
 * The route's light (LOOK-PLAN §1.2, D19): one low golden directional key
 * from the west-south-west (the plaza theme's `lights.keyDirection`), a
 * hemisphere fill and the HDRI environment (`WorldEnvironment`) — now with
 * the art-directed painterly light set (`plazaTheme.paint`) instead of the
 * token-derived illuminants. The painted light model itself lives in the
 * materials (`route/paint/*`). ROLLOUT §2.2 (b): the rig is the shared
 * `usePaintRig` + `<PaintRigMounts/>` over `plazaTheme` (all skin flags on):
 * it holds the paint scope, sweeps the plaza's lit materials before their
 * first compile, writes the shared light uniforms per palette, publishes the
 * calm rects and the contact blobs, and fits the key's shadow to the
 * station. The SkyBody and the scene lights below are the plaza's own.
 *
 * The key sinks from full at the gate to a third inside the hall, which is
 * what makes the route feel like it takes time rather than like five rooms at
 * the same hour.
 */
const HALO_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uGain;
  uniform float uNight;
  varying vec2 vUv;

  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;

    if (uNight < 0.5) {
      float core = exp(-r * r * 18.0);
      float halo = exp(-r * r * 4.4);
      float a = (core * 1.15 + halo * 0.38) * uGain;
      gl_FragColor = vec4(uColor * (0.35 + a), clamp(a, 0.0, 1.0));
      return;
    }

    // Few-px hot core. Inner/halo weights stay below 1 so they cannot
    // flatten into a circular 255 plateau (r2 failure).
    float core = exp(-r * r * 720.0);
    float inner = exp(-r * r * 36.0);
    float halo = exp(-r * r * 6.4);
    float veil = exp(-r * r * 5.2);
    float a = (core * 1.35 + inner * 0.16 + halo * 0.10 + veil * 0.045) * uGain;
    vec3 col = mix(uColor, vec3(1.0), core);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

function SkyBody({
  night,
  palette,
  position,
}: {
  night: boolean;
  palette: PlazaWorldPalette;
  position: Vec3Tuple;
}) {
  const color = night ? palette.moonColor : palette.sunColor;
  const haloSize = night ? 1.32 : 0.62;
  const haloRef = useRef<THREE.Mesh>(null);

  const haloMat = useMemo(() => {
    const body = night ? palette.moonColor : palette.sunColor;
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(body) },
        uGain: { value: night ? 1.18 : 0.72 },
        uNight: { value: night ? 1 : 0 },
      },
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      side: THREE.DoubleSide,
    });
  }, [night, palette]);

  useEffect(
    () => () => {
      haloMat.dispose();
    },
    [haloMat],
  );

  useFrame(({ camera }) => {
    haloRef.current?.lookAt(camera.position);
  });

  return (
    <group position={position}>
      {!night && (
        <mesh renderOrder={3}>
          <sphereGeometry args={[0.11, 16, 16]} />
          <meshBasicMaterial color={color} toneMapped={false} fog={false} />
        </mesh>
      )}
      <mesh ref={haloRef} renderOrder={2} material={haloMat}>
        <planeGeometry args={[haloSize, haloSize]} />
      </mesh>
      <pointLight color={color} intensity={night ? 3.2 : 2.4} distance={18} decay={2} />
    </group>
  );
}

/**
 * The scene's own lights — exactly what the plaza shipped with (LOOK r3,
 * data-face purity by construction): key `palette.keyLight` × 3.4 and the
 * `palette.skyLight` / `palette.bounce` hemisphere at 0.22 (+ 0.1 × key),
 * both × the station key and the exposure. Every UNPAINTED material (data
 * faces, plaques, the ledger, standby faces) therefore renders exactly as
 * before; painted materials transform them into the art-directed set in the
 * shader (`uKeyScale`, `uHemi*`, `uIblSpec`).
 */
export const SCENE_KEY_INTENSITY = 3.4;
export const SCENE_FILL_INTENSITY = 0.22;
export const SCENE_FILL_KEY_GAIN = 0.1;

export default function Lighting() {
  const { conductor, sampleWorldState, theme } = useWorldState();
  const palette = usePlazaPalette();
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.HemisphereLight>(null);
  const night = palette.exposure < 0.75;
  // Belt and braces: RouteScene guarantees a theme; the plaza definition is
  // the fallback of record if this ever mounts without one (and the plaza's
  // paint block when a theme arrives without one).
  const activeTheme = theme?.paint ? theme : plazaTheme;
  const lights = activeTheme.lights;
  const paint = activeTheme.paint ?? plazaTheme.paint;
  const shadow = paint?.shadow ?? { mapSize: 1024, box: 32, radius: 3, bias: -0.0005, normalBias: 0.03 };
  const half = shadow.box / 2;

  // The scene key stays the shipped one; the painted key is a per-channel
  // multiple of it (station key and exposure cancel in the ratio).
  const sceneKey = useMemo(() => ({ color: palette.keyLight, intensity: SCENE_KEY_INTENSITY }), [palette.keyLight]);
  usePaintRig({ theme: activeTheme, night, exposure: palette.exposure, sceneKey, keyLight: keyRef });

  useFrame(() => {
    const world = sampleWorldState(conductor.progress.current.smooth);
    if (fillRef.current) {
      fillRef.current.intensity = (SCENE_FILL_INTENSITY + SCENE_FILL_KEY_GAIN * world.key) * palette.exposure;
    }
  });

  return (
    <>
      <PaintRigMounts theme={activeTheme} surfaces={PLAZA_DATA_SURFACES} night={night} />
      <SkyBody night={night} palette={palette} position={lights.skyBodyPosition} />
      <hemisphereLight
        ref={fillRef}
        color={palette.skyLight}
        groundColor={palette.bounce}
        intensity={SCENE_FILL_INTENSITY}
        position={[0, 30, 0]}
      />
      <directionalLight
        ref={keyRef}
        position={[...lights.keyPosition]}
        intensity={SCENE_KEY_INTENSITY}
        color={palette.keyLight}
        // Constant from load at every rung (LOOK-PLAN §0): the caster set and
        // the 1024 map never change, so a governor step never relinks a
        // program or reallocates the shadow target.
        castShadow
        shadow-mapSize-width={shadow.mapSize}
        shadow-mapSize-height={shadow.mapSize}
        shadow-bias={shadow.bias}
        shadow-normalBias={shadow.normalBias}
        shadow-radius={shadow.radius}
        // A fixed 32 × 32 m light-space box that FOLLOWS the station
        // (texel-snapped, never resized) instead of one 60 m frustum over
        // the whole plaza — 3.1 cm/texel instead of 5.9.
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
      >
        <object3D attach="target" position={[0, 0, 0]} />
      </directionalLight>
    </>
  );
}
