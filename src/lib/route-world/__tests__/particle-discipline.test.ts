import { describe, expect, it } from 'vitest';
import type { CameraEndpoint, RouteStation, Vec3 } from '../chapters';
import { landedEndpoint } from '../legibility';
import {
  activeCorridors,
  channelDensity,
  CHANNEL_FLOOR,
  corridorBasis,
  corridorKeep,
  corridorsKeep,
  CORRIDOR_SLOTS,
  densityKeep,
  maxStationParticles,
  nearFade,
  NEAR_FADE,
  PARTICLE_DISCIPLINE_GLSL,
  particleHash,
  pointSizePx,
  POINT_SIZE_MAX_CSS_PX,
  type ContentFace,
  type StationFaces,
} from '../particle-discipline';
import { SAKURA_STATIONS } from '@/components/world/themes/sakura/theme';
import { MOUNTAIN_STATIONS } from '@/components/world/themes/mountain/theme';
import { CLOUDS_STATIONS } from '@/components/world/themes/clouds/theme';
import { SAKURA_PARTICLE_FACES } from '@/components/world/themes/sakura/furniture/particle-faces';
import { MOUNTAIN_PARTICLE_FACES } from '@/components/world/themes/mountain/furniture/particle-faces';
import { CLOUDS_PARTICLE_FACES } from '@/components/world/themes/clouds/furniture/particle-faces';

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** NDC of a world point from a camera endpoint at an aspect (the rig's own look-at frame). */
function ndc(endpoint: CameraEndpoint, aspect: number, point: Vec3): { x: number; y: number; depth: number } {
  const [ex, ey, ez] = endpoint.position;
  const f = [endpoint.target[0] - ex, endpoint.target[1] - ey, endpoint.target[2] - ez];
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fw = [f[0] / fl, f[1] / fl, f[2] / fl];
  const r = [-fw[2], 0, fw[0]];
  const rl = Math.hypot(r[0], r[2]);
  const rw = [r[0] / rl, 0, r[2] / rl];
  const up = [rw[1] * fw[2] - rw[2] * fw[1], rw[2] * fw[0] - rw[0] * fw[2], rw[0] * fw[1] - rw[1] * fw[0]];
  const d = [point[0] - ex, point[1] - ey, point[2] - ez];
  const depth = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
  const t = Math.tan((endpoint.fov * Math.PI) / 360);
  return {
    x: (d[0] * rw[0] + d[1] * rw[1] + d[2] * rw[2]) / depth / (t * aspect),
    y: (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / depth / t,
    depth,
  };
}

describe('near-camera fade', () => {
  it('hides a particle at the lens and restores it past the band', () => {
    expect(nearFade(0)).toBe(0);
    expect(nearFade(NEAR_FADE.startM)).toBe(0);
    expect(nearFade(NEAR_FADE.endM)).toBe(1);
    expect(nearFade(12)).toBe(1);
    expect(nearFade(2.25)).toBeGreaterThan(0);
    expect(nearFade(2.25)).toBeLessThan(1);
  });
});

describe('point-size clamp', () => {
  it('caps the perspective size law at the CSS px ceiling × the pixel ratio', () => {
    // A 10-size petal 1 m from a DPR-2 lens used to paint 240 device px.
    expect(pointSizePx(10, 1, 2)).toBe(POINT_SIZE_MAX_CSS_PX * 2);
    // Far particles keep their perspective size untouched.
    expect(pointSizePx(6, 20, 1.5)).toBeCloseTo((6 * 1.5 * 12) / 20, 6);
  });
});

describe('station density channel', () => {
  it('maps the densest station to the whole field and the rest onto [floor, 1]', () => {
    expect(channelDensity(0.3, 0.3)).toBe(1);
    expect(channelDensity(0, 0.3)).toBe(CHANNEL_FLOOR);
    expect(channelDensity(0.15, 0.3)).toBeCloseTo(CHANNEL_FLOOR + (1 - CHANNEL_FLOOR) * 0.5, 6);
    // A theme without an authored channel keeps the field whole.
    expect(channelDensity(0.2, 0)).toBe(1);
  });

  it('reads the authored ledger (sakura densest = pulse 0.3)', () => {
    expect(maxStationParticles(SAKURA_STATIONS)).toBeCloseTo(0.3, 6);
  });

  it('keeps roughly `density` of the seeded particles, and every particle at density 1', () => {
    const seeds = Array.from({ length: 4000 }, (_, i) => (i * 0.61803398875) % 1);
    for (const density of [CHANNEL_FLOOR, 0.6, 0.85]) {
      const kept = seeds.reduce((sum, seed) => sum + densityKeep(particleHash(seed), density), 0) / seeds.length;
      expect(Math.abs(kept - density)).toBeLessThan(0.06);
    }
    expect(seeds.every((seed) => densityKeep(particleHash(seed), 1) >= 0.5)).toBe(true);
  });
});

describe('content corridor', () => {
  const face: ContentFace = { center: [0, 3, -20], halfWidth: 3, halfHeight: 2 };
  const eye: Vec3 = [0, 3, 0];
  const basis = corridorBasis(eye, face);

  it('clears the wedge between the eye and the face', () => {
    expect(corridorKeep([0, 3, -10], eye, basis, 1)).toBe(0);
    // Inside the rectangular wedge near its corner (x 1.4 of 1.5, y 0.9 of 1.0 at half depth).
    expect(corridorKeep([1.4, 3.9, -10], eye, basis, 1)).toBe(0);
  });

  it('leaves particles outside the wedge, behind the face and behind the eye alone', () => {
    expect(corridorKeep([6, 3, -10], eye, basis, 1)).toBe(1);
    expect(corridorKeep([0, 3, -24], eye, basis, 1)).toBe(1);
    expect(corridorKeep([0, 3, 4], eye, basis, 1)).toBe(1);
  });

  it('scales the clearing by the corridor weight', () => {
    expect(corridorKeep([0, 3, -10], eye, basis, 0.25)).toBeCloseTo(0.75, 6);
  });

  it('cross-fades between the two stations the conductor lies between', () => {
    const stations = SAKURA_STATIONS;
    const faces = SAKURA_PARTICLE_FACES;
    expect(activeCorridors(stations, faces, 1)).toEqual([{ face: faces.roster, weight: 1 }]);
    const mid = activeCorridors(stations, faces, 1.25);
    expect(mid).toHaveLength(2);
    expect(mid[0]).toEqual({ face: faces.roster, weight: 0.75 });
    expect(mid[1]).toEqual({ face: faces.teams, weight: 0.25 });
    // Clamped outside the route, never more than the shader's slots.
    expect(activeCorridors(stations, faces, -3)).toEqual([{ face: faces.pulse, weight: 1 }]);
    expect(activeCorridors(stations, faces, 99)).toEqual([{ face: faces.rules, weight: 1 }]);
    expect(activeCorridors(stations, faces, Number.NaN)).toEqual([]);
    for (let p = 0; p <= 4; p += 0.1) expect(activeCorridors(stations, faces, p).length).toBeLessThanOrEqual(CORRIDOR_SLOTS);
  });

  it('bakes the same constants into the shared GLSL', () => {
    expect(PARTICLE_DISCIPLINE_GLSL).toContain(`uCorCenter[${CORRIDOR_SLOTS}]`);
    expect(PARTICLE_DISCIPLINE_GLSL).toContain(NEAR_FADE.startM.toFixed(3));
    expect(PARTICLE_DISCIPLINE_GLSL).toContain(NEAR_FADE.endM.toFixed(3));
    expect(PARTICLE_DISCIPLINE_GLSL).toContain('cameraPosition');
  });
});

const THEMES: Array<{ name: string; stations: readonly RouteStation[]; faces: StationFaces }> = [
  { name: 'sakura', stations: SAKURA_STATIONS, faces: SAKURA_PARTICLE_FACES },
  { name: 'mountain', stations: MOUNTAIN_STATIONS, faces: MOUNTAIN_PARTICLE_FACES },
  { name: 'clouds', stations: CLOUDS_STATIONS, faces: CLOUDS_PARTICLE_FACES },
];

describe.each(THEMES)('$name particle faces', ({ stations, faces }) => {
  it('authors a data face for every station', () => {
    expect(Object.keys(faces).sort()).toEqual(stations.map((station) => station.id).sort());
  });

  it.each(stations.map((station) => [station.id, station] as const))(
    '%s face sits in frame at the 1440 and landed 390 poses (the composition it guards)',
    (_id, station) => {
      const face = faces[station.id];
      for (const [endpoint, aspect] of [
        [station.camera, 1440 / 900],
        [landedEndpoint(station.cameraMobile), 390 / 844],
      ] as const) {
        const p = ndc(endpoint, aspect, face.center);
        expect(p.depth).toBeGreaterThan(0);
        expect(Math.abs(p.x)).toBeLessThan(1);
        expect(Math.abs(p.y)).toBeLessThan(1);
      }
    },
  );

  it.each(stations.map((station) => [station.id, station] as const))(
    '%s: particles on every eye→face sight line are cleared at the station pose',
    (_id, station) => {
      const face = faces[station.id];
      const corridors = activeCorridors(stations, faces, stations.indexOf(station));
      for (const endpoint of [station.camera, landedEndpoint(station.cameraMobile)]) {
        const eye = endpoint.position;
        // The face centre and its four inset corners (in the wedge's own frame).
        const basis = corridorBasis(eye, face);
        const unit = (v: Vec3, k: number): Vec3 => {
          const l = Math.hypot(v[0], v[1], v[2]);
          return [(v[0] / l) * k, (v[1] / l) * k, (v[2] / l) * k];
        };
        const right = unit(basis.right, face.halfWidth * 0.9);
        const up = unit(basis.up, face.halfHeight * 0.9);
        const targets: Vec3[] = [face.center];
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            targets.push([
              face.center[0] + sx * right[0] + sy * up[0],
              face.center[1] + sx * right[1] + sy * up[1],
              face.center[2] + sx * right[2] + sy * up[2],
            ]);
          }
        }
        for (const target of targets) {
          for (const t of [0.3, 0.6, 0.95]) {
            expect(corridorsKeep(lerp(eye, target, t), eye, corridors)).toBeLessThan(0.02);
          }
        }
      }
    },
  );

  it.each(stations.map((station) => [station.id, station] as const))(
    '%s: the air outside the wedge keeps its particles (the world still breathes)',
    (_id, station) => {
      const corridors = activeCorridors(stations, faces, stations.indexOf(station));
      const endpoint = station.camera;
      const eye = endpoint.position;
      const f = [endpoint.target[0] - eye[0], endpoint.target[1] - eye[1], endpoint.target[2] - eye[2]];
      const fl = Math.hypot(f[0], f[1], f[2]);
      const fw = [f[0] / fl, f[1] / fl, f[2] / fl];
      const rl = Math.hypot(fw[0], fw[2]);
      const rw = [-fw[2] / rl, 0, fw[0] / rl];
      const uw = [rw[1] * fw[2] - rw[2] * fw[1], rw[2] * fw[0] - rw[0] * fw[2], rw[0] * fw[1] - rw[1] * fw[0]];
      const tan = Math.tan((endpoint.fov * Math.PI) / 360);
      // A 9×9 grid over the 1440 frame, 6 m out (mid-air between the lens
      // and every face): a wide face may fill the frame's width, but the
      // wedge is a face-sized box, so the sky band above and the ground
      // band below it keep their particles.
      const depth = 6;
      let clear = 0;
      let total = 0;
      for (let gx = -4; gx <= 4; gx += 1) {
        for (let gy = -4; gy <= 4; gy += 1) {
          const sx = (gx / 4.5) * tan * 1.6 * depth;
          const sy = (gy / 4.5) * tan * depth;
          const point: Vec3 = [
            eye[0] + fw[0] * depth + rw[0] * sx + uw[0] * sy,
            eye[1] + fw[1] * depth + rw[1] * sx + uw[1] * sy,
            eye[2] + fw[2] * depth + rw[2] * sx + uw[2] * sy,
          ];
          total += 1;
          if (corridorsKeep(point, eye, corridors) > 0.98) clear += 1;
        }
      }
      expect(clear / total).toBeGreaterThanOrEqual(0.2);
    },
  );
});
