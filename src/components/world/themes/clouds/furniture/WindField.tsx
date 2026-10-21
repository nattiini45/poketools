'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useQuality } from '@/components/world/route/QualityGovernor';
import { useParticleDiscipline } from '@/components/world/route/particles/useParticleDiscipline';
import { useCloudsPalette } from '../use-clouds-palette';
import { CLOUDS_PARTICLE_FACES } from './particle-faces';
import { seeded } from './Props';
import { WIND_FIELD_SPAN, WIND_FRAGMENT, WIND_VERTEX } from './wind-field-shaders';

/**
 * The wind field: streaking gusts that run across the isle chain — the
 * route's ambient "air" read (wind is what a sky world breathes). QUALITY-
 * GATED: the count multiplies the ladder's `particleDensity`, and the field
 * is ABSENT at the rung where the channel is zero (QUALITY_LADDER rung 4,
 * `particleDensity: 0`) — the same descend-only mechanism that gates the
 * valley's snowfall. All motion is computed in the vertex shader from
 * `uTime` (the phase-pinnable uniform family), so a capture freeze holds
 * the streaks with the cloud sea and the boards.
 *
 * W1 particle discipline (`particle-discipline.ts`): per vertex, a streak
 * fades out inside 1.5–3 m of the lens and the per-station
 * `world.particles` channel thins the field; PER FRAGMENT (review r2 —
 * `wind-field-shaders.ts`), every pixel inside the view wedge from the eye
 * to the active station's data face (CLOUDS_PARTICLE_FACES) is cleared.
 * The round-1 header claimed a per-vertex corridor faded a straddling
 * streak "along its length"; it did not — a streak whose two ends both lay
 * outside the wedge drew full strength across the face (the pulse-board
 * crops). Lines rasterise at 1 px, so the point-size clamp has nothing to
 * cap here.
 */

const FIELD_SPAN = WIND_FIELD_SPAN;

export default function WindField() {
  const palette = useCloudsPalette();
  const { particleDensity } = useQuality();

  const field = useMemo(() => {
    const total = Math.max(1, Math.floor(340 * particleDensity));
    const positions = new Float32Array(total * 2 * 3);
    const offsets = new Float32Array(total * 2 * 3);
    const seeds = new Float32Array(total * 2);
    for (let i = 0; i < total; i += 1) {
      const seed = seeded(i * 5 + 901);
      const y = 0.6 + seeded(i * 5 + 902) * 7.5;
      const z = -16 + seeded(i * 5 + 903) * 36;
      const driftZ = (seeded(i * 5 + 904) - 0.5) * 0.5;
      const length = 1.1 + seed * 1.4;
      for (let half = 0; half < 2; half += 1) {
        const v = i * 2 + half;
        positions[v * 3] = half * length;
        positions[v * 3 + 1] = 0;
        positions[v * 3 + 2] = driftZ * half * length;
        offsets[v * 3] = seeded(i * 5 + 905) * FIELD_SPAN;
        offsets[v * 3 + 1] = y;
        offsets[v * 3 + 2] = z;
        seeds[v] = seed;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    return geometry;
  }, [particleDensity]);

  // One stable discipline record shared by every material this field builds.
  const discipline = useParticleDiscipline(CLOUDS_PARTICLE_FACES);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(palette.windStreak) },
        ...discipline,
      },
      vertexShader: WIND_VERTEX,
      fragmentShader: WIND_FRAGMENT,
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
  });

  // The low rung paints no wind at all — the descend-only ladder's word.
  if (particleDensity <= 0) return null;

  return (
    <lineSegments geometry={field} material={material} frustumCulled={false} name="clouds-wind-field" />
  );
}
