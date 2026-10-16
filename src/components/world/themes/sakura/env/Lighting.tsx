'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useSakuraPalette } from '../use-sakura-palette';
import type { SakuraWorldPalette } from '../theme-palette';
import { sakuraTheme } from '../theme';
import type { Vec3Tuple } from '@/lib/route-world/focus';

/**
 * The park's light: one soft morning directional key from the
 * east-north-east (the sakura theme's `lights.keyDirection`), a hemisphere
 * fill borrowing the sky and lawn colors, and the HDRI environment
 * (`WorldEnvironment`) for PBR response. The key is gentler than the plaza's
 * golden hour (spring light through blossom haze), and it sinks toward the
 * gate the way an afternoon does — the route takes time, not five rooms at
 * one hour.
 */
const KEY_INTENSITY = 2.8;
const FILL_INTENSITY = 0.34;

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
      // Spring sun through blossom haze: a wide soft corona, no hot core.
      float core = exp(-r * r * 10.0);
      float halo = exp(-r * r * 3.0);
      float a = (core * 0.55 + halo * 0.42) * uGain;
      gl_FragColor = vec4(uColor * (0.35 + a * 0.6), clamp(a, 0.0, 1.0));
      return;
    }

    // Moon: a few-px core with a cool veil, weights kept below 1 so the
    // disc never flattens into a circular 255 plateau.
    float core = exp(-r * r * 720.0);
    float inner = exp(-r * r * 36.0);
    float halo = exp(-r * r * 6.4);
    float a = (core * 1.35 + inner * 0.16 + halo * 0.10) * uGain;
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
  palette: SakuraWorldPalette;
  position: Vec3Tuple;
}) {
  const color = night ? palette.moonColor : palette.sunColor;
  const haloSize = night ? 1.32 : 0.86;
  const haloRef = useRef<THREE.Mesh>(null);

  const haloMat = useMemo(() => {
    const body = night ? palette.moonColor : palette.sunColor;
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(body) },
        uGain: { value: night ? 1.18 : 0.86 },
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
      <pointLight color={color} intensity={night ? 3.2 : 2.0} distance={18} decay={2} />
    </group>
  );
}

export default function Lighting() {
  const { conductor, sampleWorldState, theme } = useWorldState();
  const palette = useSakuraPalette();
  const quality = useQuality();
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.HemisphereLight>(null);
  const night = palette.exposure < 0.75;
  // Belt and braces: the sakura root always provides the theme; this
  // definition is the fallback of record if this ever mounts without one.
  const lights = (theme ?? sakuraTheme).lights;

  useFrame(() => {
    const world = sampleWorldState(conductor.progress.current.smooth);
    if (keyRef.current) keyRef.current.intensity = KEY_INTENSITY * world.key * palette.exposure;
    if (fillRef.current) {
      fillRef.current.intensity = (FILL_INTENSITY + 0.12 * world.key) * palette.exposure;
    }
  });

  const shadows = quality.shadowedLights > 0 && quality.shadowMapSize > 0;

  return (
    <>
      <SkyBody night={night} palette={palette} position={lights.skyBodyPosition} />
      <hemisphereLight
        ref={fillRef}
        args={[palette.skyLight, palette.bounce, FILL_INTENSITY]}
        position={[0, 30, 0]}
      />
      <directionalLight
        ref={keyRef}
        position={[...lights.keyPosition]}
        intensity={KEY_INTENSITY}
        color={palette.keyLight}
        castShadow={shadows}
        shadow-mapSize-width={quality.shadowMapSize || 512}
        shadow-mapSize-height={quality.shadowMapSize || 512}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
        // One stabilized frustum over the park floor plus the shore ring —
        // following the camera would shimmer or cost a cascade.
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      >
        <object3D attach="target" position={[0, 0, 0]} />
      </directionalLight>
    </>
  );
}
