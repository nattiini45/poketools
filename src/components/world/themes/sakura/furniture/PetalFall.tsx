'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useParticleDiscipline } from '@/components/world/route/particles/useParticleDiscipline';
import { PARTICLE_DISCIPLINE_GLSL, POINT_SIZE_MAX_CSS_PX } from '@/lib/route-world/particle-discipline';
import { useSakuraPalette } from '../use-sakura-palette';
import { seeded } from './Ground';
import { SAKURA_PARTICLE_FACES } from './particle-faces';

/**
 * The petal fall: one Points field of blossom petals drifting down over the
 * park. QUALITY-GATED (criterion 4): the count multiplies the ladder's
 * `particleDensity`, and the field is ABSENT at the rung where the channel
 * is zero (QUALITY_LADDER rung 4, `particleDensity: 0`) — the same
 * descend-only mechanism that dims every other suspended particle system in
 * the engine. All motion is computed in the vertex shader from `uTime` (the
 * phase-pinnable uniform family), so a capture freeze holds the petals with
 * the water and the boards.
 *
 * W1 particle discipline (`particle-discipline.ts`): petals fade out inside
 * 1.5–3 m of the lens, point sprites are capped at 18 CSS px, the view wedge
 * from the eye to the active station's data face (SAKURA_PARTICLE_FACES) is
 * kept clear, and the per-station `world.particles` channel thins the field.
 * A petal can dress the air around a board — never drift across its text.
 */

const PETAL_VERTEX = `
  attribute float aSeed;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vSeed;
  varying float vFade;
  ${PARTICLE_DISCIPLINE_GLSL}

  void main() {
    vSeed = aSeed;
    float fall = 8.0 + aSeed * 9.0;
    float t = uTime * (0.16 + aSeed * 0.12);
    // Loop the fall inside the field volume; sway sideways on the way down.
    float cycle = 17.0;
    float y = 10.5 - mod(t * fall, cycle);
    float sway = sin(t * (1.1 + aSeed) + aSeed * 6.28) * (0.9 + aSeed * 0.7);
    vec3 pos = vec3(position.x + sway, y, position.z + sway * 0.5);

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    // W1 discipline: near-lens fade × content corridor × station density.
    float keep = pdNearFade(length(world.xyz - cameraPosition))
      * pdCorridorKeep(world.xyz)
      * pdDensityKeep(aSeed);
    // Perspective size law, capped so no petal becomes a lens-sized blur;
    // a fully discarded petal rasterises nothing at all.
    gl_PointSize = keep < 0.01
      ? 0.0
      : min(aSize * uPixelRatio * (12.0 / -mv.z), ${POINT_SIZE_MAX_CSS_PX.toFixed(1)} * uPixelRatio);
    // Fade near the ground and at the top of the loop.
    vFade = smoothstep(0.0, 1.2, y) * smoothstep(10.4, 8.6, y) * keep;
  }
`;

const PETAL_FRAGMENT = `
  uniform vec3 uColor;
  varying float vSeed;
  varying float vFade;

  void main() {
    // One petal per point: an ellipse, rotated per-point by its seed.
    vec2 c = gl_PointCoord - 0.5;
    float rot = vSeed * 6.28;
    vec2 p = vec2(
      c.x * cos(rot) + c.y * sin(rot),
      -c.x * sin(rot) + c.y * cos(rot)
    );
    float petal = smoothstep(0.5, 0.28, length(p * vec2(1.0, 0.62)));
    if (petal < 0.05) discard;
    vec3 col = mix(uColor, uColor * 1.22, vSeed);
    gl_FragColor = vec4(col, petal * vFade);
  }
`;

export default function PetalFall() {
  const palette = useSakuraPalette();
  const { particleDensity } = useQuality();

  const field = useMemo(() => {
    const total = Math.max(1, Math.floor(760 * particleDensity));
    const positions = new Float32Array(total * 3);
    const seeds = new Float32Array(total);
    const sizes = new Float32Array(total);
    for (let i = 0; i < total; i += 1) {
      const a = seeded(i * 3 + 101) * Math.PI * 2;
      const r = Math.sqrt(seeded(i * 3 + 102)) * 22;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = -4 + Math.sin(a) * r * 0.8;
      seeds[i] = seeded(i * 3 + 103);
      sizes[i] = 5.5 + seeds[i] * 4.5;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    return geometry;
  }, [particleDensity]);

  // One stable discipline record shared by every material this field builds.
  const discipline = useParticleDiscipline(SAKURA_PARTICLE_FACES);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(palette.petalColor) },
        uPixelRatio: { value: 1.5 },
        ...discipline,
      },
      vertexShader: PETAL_VERTEX,
      fragmentShader: PETAL_FRAGMENT,
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

  // The low rung paints no petals at all — the descend-only ladder's word.
  if (particleDensity <= 0) return null;

  return (
    <points geometry={field} material={material} frustumCulled={false} name="sakura-petals" />
  );
}
