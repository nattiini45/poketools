'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useParticleDiscipline } from '@/components/world/route/particles/useParticleDiscipline';
import { PARTICLE_DISCIPLINE_GLSL, POINT_SIZE_MAX_CSS_PX } from '@/lib/route-world/particle-discipline';
import { useMountainPalette } from '../use-mountain-palette';
import { MOUNTAIN_PARTICLE_FACES } from './particle-faces';
import { seeded } from './Props';

/**
 * The snowfall: one Points field of flakes drifting down the valley.
 * QUALITY-GATED: the count multiplies the ladder's `particleDensity`, and
 * the field is ABSENT at the rung where the channel is zero (QUALITY_LADDER
 * rung 4, `particleDensity: 0`) — the same descend-only mechanism that dims
 * every other suspended particle system in the engine. All motion is
 * computed in the vertex shader from `uTime` (the phase-pinnable uniform
 * family), so a capture freeze holds the flakes with the tarn and boards.
 *
 * W1 particle discipline (`particle-discipline.ts`): flakes fade out inside
 * 1.5–3 m of the lens, point sprites are capped at 18 CSS px, the view wedge
 * from the eye to the active station's data face (MOUNTAIN_PARTICLE_FACES)
 * is kept clear, and the per-station `world.particles` channel thins the
 * field. Snow may fall around a board — never across its text.
 */

const SNOW_VERTEX = `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vSeed;
  varying float vFade;
  ${PARTICLE_DISCIPLINE_GLSL}

  void main() {
    vSeed = aSeed;
    float fall = 5.0 + aSeed * 5.0;
    float t = uTime * (0.12 + aSeed * 0.09);
    // Loop the fall inside the field volume; drift sideways on the way down.
    float cycle = 13.0;
    float y = 9.5 - mod(t * fall, cycle);
    float drift = sin(t * (0.7 + aSeed) + aSeed * 6.28) * (1.1 + aSeed * 0.8);
    vec3 pos = vec3(position.x + drift, y, position.z + drift * 0.6);

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    // W1 discipline: near-lens fade × content corridor × station density.
    float keep = pdNearFade(length(world.xyz - cameraPosition))
      * pdCorridorKeep(world.xyz)
      * pdDensityKeep(aSeed);
    // Perspective size law, capped so no flake becomes a lens-sized blur;
    // a fully discarded flake rasterises nothing at all.
    gl_PointSize = keep < 0.01
      ? 0.0
      : min(aSize * uPixelRatio * (12.0 / -mv.z), ${POINT_SIZE_MAX_CSS_PX.toFixed(1)} * uPixelRatio);
    // Fade near the ground and at the top of the loop.
    vFade = smoothstep(0.0, 1.2, y) * smoothstep(9.4, 7.8, y) * keep;
  }
`;

const SNOW_FRAGMENT = `
  uniform vec3 uColor;
  varying float vSeed;
  varying float vFade;

  void main() {
    // One flake per point: a soft round grain, slightly uneven per seed.
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * (1.0 + (vSeed - 0.5) * 0.3);
    float flake = smoothstep(0.5, 0.22, d);
    if (flake < 0.05) discard;
    vec3 col = mix(uColor, uColor * 1.12, vSeed);
    gl_FragColor = vec4(col, flake * vFade * 0.9);
  }
`;

export default function Snowfall() {
  const palette = useMountainPalette();
  const { particleDensity } = useQuality();

  const field = useMemo(() => {
    const total = Math.max(1, Math.floor(640 * particleDensity));
    const positions = new Float32Array(total * 3);
    const seeds = new Float32Array(total);
    const sizes = new Float32Array(total);
    for (let i = 0; i < total; i += 1) {
      const a = seeded(i * 3 + 201) * Math.PI * 2;
      const r = Math.sqrt(seeded(i * 3 + 202)) * 24;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = -2 + Math.sin(a) * r * 0.9;
      seeds[i] = seeded(i * 3 + 203);
      sizes[i] = 4.2 + seeds[i] * 3.6;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return geometry;
  }, [particleDensity]);

  // One stable discipline record shared by every material this field builds.
  const discipline = useParticleDiscipline(MOUNTAIN_PARTICLE_FACES);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(palette.snowfallColor) },
        uPixelRatio: { value: 1.5 },
        ...discipline,
      },
      vertexShader: SNOW_VERTEX,
      fragmentShader: SNOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
  }, [palette, discipline]);

  const uniformsRef = useRef(material.uniforms);
  useEffect(() => {
    uniformsRef.current = material.uniforms;
  }, [material]);

  useEffect(
    () => () => {
      field.dispose();
      material.dispose();
    },
    [field, material],
  );

  useFrame((_, delta) => {
    uniformsRef.current.uTime.value += delta;
    uniformsRef.current.uPixelRatio.value = Math.min(
      2,
      typeof window === 'undefined' ? 1.5 : window.devicePixelRatio,
    );
  });

  // The low rung paints no snowfall at all — the descend-only ladder's word.
  if (particleDensity <= 0) return null;

  return <points geometry={field} material={material} frustumCulled={false} name="mountain-snowfall" />;
}
