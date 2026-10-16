import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@/lib/route-world/chapters';
import { landedEndpoint } from '@/lib/route-world/legibility';
import { corridorBasis, corridorsKeep, type WeightedFace } from '@/lib/route-world/particle-discipline';
import { CLOUDS_STATIONS } from '@/components/world/themes/clouds/theme';
import { CLOUDS_PARTICLE_FACES } from '@/components/world/themes/clouds/furniture/particle-faces';
import { WIND_FRAGMENT, WIND_VERTEX } from '@/components/world/themes/clouds/furniture/wind-field-shaders';

/**
 * Review r2 (W1 veto: wind streaks across the clouds pulse board). A line
 * segment's varyings interpolate linearly, so a corridor term sampled only
 * at the two ENDS can never clear a streak whose ends both sit outside the
 * wedge while its middle crosses the face. The shader must sample per
 * fragment; this pins both the geometry and the shader text.
 */

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

describe('wind field content corridor is per fragment', () => {
  const pulse = CLOUDS_STATIONS.find((station) => station.id === 'pulse');
  const face = CLOUDS_PARTICLE_FACES.pulse;

  it('the fixtures exist', () => {
    expect(pulse).toBeDefined();
    expect(face).toBeDefined();
  });

  for (const [label, pick] of [
    ['desktop', () => pulse!.camera.position],
    ['landed mobile', () => landedEndpoint(pulse!.cameraMobile).position],
  ] as const) {
    it(`${label}: a streak with both ends outside the wedge but its midpoint on the face is rejected mid-span`, () => {
      const eye: Vec3 = pick();
      const corridors: WeightedFace[] = [{ face, weight: 1 }];
      const basis = corridorBasis(eye, face);
      // A point 60 % of the way from the eye to the face centre, on axis.
      const mid = lerp(eye, face.center, 0.6);
      // The wedge's half width at that depth is 0.6 / |right|; step 1.6×
      // that to each side along the horizontal `right` axis — well past the
      // soft rim, so both ends are clear of the corridor.
      const rightLen = Math.hypot(...basis.right);
      const unitRight: Vec3 = [basis.right[0] / rightLen, basis.right[1] / rightLen, basis.right[2] / rightLen];
      const halfAtDepth = 0.6 / rightLen;
      const a = add(mid, unitRight, -1.6 * halfAtDepth);
      const b = add(mid, unitRight, 1.6 * halfAtDepth);

      expect(corridorsKeep(a, eye, corridors)).toBeCloseTo(1, 6);
      expect(corridorsKeep(b, eye, corridors)).toBeCloseTo(1, 6);
      // The old per-vertex varying: the interpolated keep at the midpoint
      // is the mean of the endpoint keeps — full strength over the face.
      const interpolated = (corridorsKeep(a, eye, corridors) + corridorsKeep(b, eye, corridors)) / 2;
      expect(interpolated).toBeGreaterThan(0.99);
      // Sampled at the midpoint itself (what the per-fragment shader does):
      // fully cleared.
      expect(corridorsKeep(lerp(a, b, 0.5), eye, corridors)).toBeLessThan(0.01);
    });
  }

  it('the corridor term runs in the fragment stage on the interpolated world position', () => {
    expect(WIND_VERTEX).toContain('varying vec3 vWorld');
    expect(WIND_VERTEX).toContain('vWorld = world.xyz');
    expect(WIND_FRAGMENT).toContain('varying vec3 vWorld');
    expect(WIND_FRAGMENT).toContain('pdCorridorKeep(vWorld)');
    // The discipline uniforms are declared in the fragment stage too.
    expect(WIND_FRAGMENT).toContain('uniform vec3 uCorCenter');
    // …and no longer baked into the per-vertex fade.
    const vertexMain = WIND_VERTEX.slice(WIND_VERTEX.indexOf('void main()'));
    expect(vertexMain).not.toContain('pdCorridorKeep(');
  });
});
