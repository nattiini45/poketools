'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useCloudsPalette } from '../use-clouds-palette';
import { SEA_Y } from './layout';

/**
 * The cloud sea: one shader-driven plane far below the isle chain. Animated,
 * never a static texture: two domain-warped fbm fields scroll on the wind
 * (uWind × uTime — the phase-pinnable uniform family, so a capture freeze
 * holds the sea with everything else), the warp's finite-difference gradient
 * shades crest tops against trough shadow (volume, not a flat gradient), a
 * vertex swell breathes under it, and an aerial-perspective term dissolves
 * the plane's rim into the horizon haze. By night the moonlight swaps the
 * crest tone and dims the body — the sea reads luminous dusk, still below
 * the bloom threshold (the light-bridges carry the glow).
 */

const SEA_SIZE = 260;
const SEA_SEGMENTS = 96;

const SEA_VERTEX = `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform vec2 uWind;
  varying vec3 vWorldPos;

  void main() {
    vec3 pos = position;
    // Gentle swell under the noise: two crossing trains, metres-scale.
    float swell =
      sin(pos.x * 0.11 + uTime * 0.22) * 0.16 +
      sin((pos.x * 0.06 - pos.y * 0.09) - uTime * 0.16) * 0.12;
    pos.z += swell;
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SEA_FRAGMENT = `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec3 uTop;
  uniform vec3 uBase;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform float uGain;
  uniform float uSat;
  varying vec3 vWorldPos;

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

  // Four octave fbm — cumulus bank structure, rotated between octaves.
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += amp * vnoise(p);
      p = rot * p * 2.13 + vec2(1.9, 7.3);
      amp *= 0.5;
    }
    return v;
  }

  // The drifting cloud height field: a big slow bank plus a smaller fast
  // wind streak, domain-warped so the cells billow instead of tile.
  float cloudField(vec2 p, float t) {
    vec2 warp = vec2(
      fbm(p * 0.5 + vec2(t * 0.02, 0.0)),
      fbm(p * 0.5 + vec2(0.0, t * 0.017) + 4.7)
    ) - 0.5;
    float slow = fbm(p * 0.42 + warp * 1.4 + uWind * t * 0.010);
    float fast = fbm(p * 1.15 + warp * 2.2 - uWind * t * 0.028);
    return slow * 0.72 + fast * 0.28;
  }

  void main() {
    vec2 p = vWorldPos.xz;

    float h = cloudField(p, uTime);

    // Finite-difference gradient of the same field — the shading normal,
    // so crests catch the sun and troughs fall to shadow (the volume read).
    float e = 0.9;
    float hx = cloudField(p + vec2(e, 0.0), uTime);
    float hz = cloudField(p + vec2(0.0, e), uTime);
    vec3 nrm = normalize(vec3(-(hx - h) / e, 1.4, -(hz - h) / e));

    float sun = clamp(dot(nrm, normalize(uSunDir)), 0.0, 1.0);
    float body = smoothstep(0.18, 0.82, h);

    // Troughs stay deep and crests catch the sun — the tonal spread is what
    // makes the sea read as billows instead of flat water (first capture
    // read: the washed draft had ~none).
    vec3 col = mix(uBase * 0.72, uBase, body);
    col = mix(col, uTop, body * (0.3 + 0.7 * sun));
    // Bright rims where the field crests — the billow highlight.
    col += uTop * smoothstep(0.62, 0.88, h) * mix(0.3, 0.5, sun) * (1.0 - uNight * 0.6);

    // Aerial perspective: dissolve the plane's rim into the horizon band so
    // the sea reads as a bank, never as a textured rectangle. Held off past
    // the station depths so the near sea keeps its contrast.
    float dist = length(vWorldPos - cameraPosition);
    col = mix(col, uHorizon, smoothstep(52.0, 138.0, dist));

    // AgX compensation mirrors the siblings' law: pre-saturate and lift so
    // the authored token colours land where the no-post path lands them.
    // Identity with post off.
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uSat) * uGain;

    gl_FragColor = vec4(col, 1.0);
    // Output chunks (fidelity W1 r1 — the BoundedWater fix pattern): the sea
    // used to write raw linear colour, so on the no-post path (screen
    // target) it skipped the renderer's tone mapping and sRGB encode that
    // every lit sibling gets, and read darker/greyer than its isles. The
    // chunks are no-ops into the composer's render target (three applies
    // tone mapping + output colour space only on the screen pass), so the
    // post rungs are unchanged. Fog: the chain's FogExp2 mixes every lit
    // surface toward the horizon token; the sea now takes the same term on
    // top of its own far-rim dissolve, so near-sea and isles fog together.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export default function CloudSea() {
  const palette = useCloudsPalette();
  const night = palette.exposure < 0.75;
  const post = useQuality().post;

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(1.0, 0.42) },
        uTop: { value: new THREE.Color(palette.cloudTop) },
        uBase: { value: new THREE.Color(palette.cloudBase) },
        uHorizon: { value: new THREE.Color(palette.skyHorizon) },
        uSunDir: { value: new THREE.Vector3(18, 16, 8).normalize() },
        uNight: { value: night ? 1 : 0 },
        uGain: { value: post ? (night ? 1.18 : 1.3) : 1 },
        uSat: { value: post ? 1.32 : 1 },
      },
      vertexShader: SEA_VERTEX,
      fragmentShader: SEA_FRAGMENT,
      side: THREE.DoubleSide,
      fog: true,
    });
  }, [palette, night, post]);

  const uniformsRef = useRef(material.uniforms);
  useEffect(() => {
    uniformsRef.current = material.uniforms;
  }, [material]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    uniformsRef.current.uTime.value += delta;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, SEA_Y, -2]} material={material}>
      <planeGeometry args={[SEA_SIZE, SEA_SIZE, SEA_SEGMENTS, SEA_SEGMENTS]} />
    </mesh>
  );
}
