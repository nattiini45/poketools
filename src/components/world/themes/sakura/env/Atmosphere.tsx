'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldState } from '@/components/world/route/WorldStateProvider';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useSakuraPalette } from '../use-sakura-palette';
import { sakuraTheme } from '../theme';

/**
 * Authored spring sky + aerial perspective for the park. One material graph:
 * a spring-blue zenith, a blossom-tinted horizon haze, and the Mie glow
 * toward the sun/moon practical, with one octave of soft drifting cirrus —
 * spring skies are quieter than the plaza's cumulus stacks. Fog density
 * follows the station channel (0.006 → 0.012); fog color is the horizon
 * token, so the far shore dissolves into blossom haze.
 */

const SKY_RADIUS = 160;

/**
 * Day fog density scale — the same law the plaza shipped (C-044):
 * `FogExp2` mixes every lit surface toward the bright horizon token by
 * depth, an albedo-insensitive additive. The sakura horizon is a light
 * blossom haze, so day density is scaled down to a whisper of aerial
 * perspective over the far shore while dark surfaces keep their albedo.
 */
const DAY_FOG_SCALE = 0.25;

const SKY_VERTEX = `
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uSunPos;
  uniform float uNight;
  uniform float uGain;
  uniform float uSat;
  varying vec3 vWorldPos;

  float hash13(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }

  float hash12(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Two octaves — spring cirrus, not cumulus towers.
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 2; i++) {
      v += amp * vnoise(p);
      p = rot * p * 2.11 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldPos - cameraPosition);
    float elev = dir.y;

    float zenithMix = smoothstep(
      mix(-0.18, 0.12, uNight),
      mix(0.42, 0.52, uNight),
      elev
    );
    vec3 col = mix(uHorizon, uZenith, zenithMix);
    float haze = exp(-max(elev, 0.0) * mix(3.2, 3.6, uNight));
    col = mix(col, uHorizon, haze * mix(0.42, 0.28, uNight));

    vec3 sunDir = normalize(uSunPos - cameraPosition);
    float mu = max(dot(dir, sunDir), 0.0);
    float mie = pow(mu, 36.0);
    float disc = pow(mu, 140.0);
    col += uGlow * (mie * 0.18 + disc * 0.26) * (1.0 - uNight);

    // Tight night corona only — a wide pow() would wash the plum sky.
    float corona = pow(mu, 42.0);
    col += mix(uHorizon, uGlow, 0.18) * corona * 0.12 * uNight;

    // Soft cirrus: one quiet field high in the sky. Night keeps a faint
    // veil, lit from the horizon token, so the plum sky keeps its depth.
    if (elev > 0.04) {
      vec2 cloudUv = dir.xz / (elev + 0.2) * 1.8 + vec2(5.3, 2.8);
      float field = fbm(cloudUv);
      float cover = smoothstep(0.52, 0.72, field);
      float thick = smoothstep(0.60, 0.84, field);
      float fade = smoothstep(0.04, 0.2, elev);
      vec3 dayCloud = mix(vec3(0.92, 0.94, 0.98), vec3(1.0, 0.99, 0.98), thick);
      dayCloud -= vec3(0.06, 0.05, 0.05) * (1.0 - thick) * cover;
      vec3 nightCloud = mix(uZenith, uHorizon, 0.5) * 1.25;
      vec3 cloud = mix(dayCloud, nightCloud, uNight);
      float amount = cover * fade * mix(0.55, 0.22, uNight);
      col = mix(col, cloud, amount);
    }

    // Point stars, one jittered disc per azimuth/elevation cell (~1.5 px at
    // 1440) — lighting whole hash cells reads as squares.
    vec2 suv = vec2(atan(dir.z, dir.x) * 28.0, dir.y * 60.0);
    vec2 cell = floor(suv);
    vec2 jitter = vec2(hash13(vec3(cell, 1.0)), hash13(vec3(cell, 2.0))) - 0.5;
    float seed = hash13(vec3(cell, 3.0));
    float d = length(fract(suv) - 0.5 - jitter * 0.6);
    float stars = step(0.93, seed) * (1.0 - smoothstep(0.0, 0.09 + 0.07 * seed, d))
      * smoothstep(0.18, 0.62, elev) * uNight;
    col += vec3(0.78, 0.74, 0.92) * stars * (0.12 + 0.22 * seed);
    col += (hash13(dir * 220.0) - 0.5) * mix(0.006, 0.012, uNight);

    // AgX compensation mirrors the plaza law: pre-saturate and lift so the
    // authored token colours land where the no-post path lands them.
    // Identity with post off.
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uSat) * uGain;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export default function Atmosphere() {
  const { conductor, sampleWorldState, theme } = useWorldState();
  const palette = useSakuraPalette();
  const quality = useQuality();
  const fogRef = useRef<THREE.FogExp2>(null);
  const night = palette.exposure < 0.75;
  const post = quality.post;
  const skyBodyPosition = (theme ?? sakuraTheme).lights.skyBodyPosition;

  const sky = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(palette.sky) },
        uHorizon: { value: new THREE.Color(palette.skyHorizon) },
        uGlow: { value: new THREE.Color(night ? palette.moonColor : palette.sunColor) },
        uSunPos: { value: new THREE.Vector3(...skyBodyPosition) },
        uNight: { value: night ? 1 : 0 },
        uGain: { value: post ? (night ? 1.15 : 1.3) : 1 },
        uSat: { value: post ? 1.35 : 1 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: !night,
    });
  }, [night, palette, post, skyBodyPosition]);

  useEffect(
    () => () => {
      sky.dispose();
    },
    [sky],
  );

  useFrame(() => {
    const fog = fogRef.current;
    if (!fog) return;
    fog.density =
      sampleWorldState(conductor.progress.current.smooth).fog * (night ? 1 : DAY_FOG_SCALE);
    fog.color.set(palette.skyHorizon);
  });

  return (
    <>
      <fogExp2 ref={fogRef} attach="fog" args={[palette.skyHorizon, 0.006]} />
      <mesh renderOrder={-10} frustumCulled={false} material={sky}>
        <sphereGeometry args={[SKY_RADIUS, 48, 32]} />
      </mesh>
    </>
  );
}
