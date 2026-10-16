import { describe, expect, it } from 'vitest';
import type { CameraEndpoint, Vec3 } from '@/lib/route-world/chapters';
import { landedEndpoint } from '@/lib/route-world/legibility';
import {
  activeCorridors,
  corridorBasis,
  corridorsKeep,
  rectCorners,
  type FaceRect,
} from '@/lib/route-world/particle-discipline';
import { CLOUDS_STATIONS } from '@/components/world/themes/clouds/theme';
import {
  CLOUDS_FACE_RECTS,
  CLOUDS_PARTICLE_FACES,
  airshipSailRect,
} from '@/components/world/themes/clouds/furniture/particle-faces';
import { FLAGSHIP } from '@/components/world/themes/clouds/furniture/layout';

/**
 * Fidelity W1 r3 — the clouds pulse-face streak veto, second pass. The r2
 * per-fragment clip was right in form, but the corridor was centred on the
 * layout ANCHOR while the sail renders `hullLift` higher on the hull, so
 * streaks crossed the kicker / masthead / LIVE pill with hard cut-offs.
 *
 * These are the harness-side assertions the verdict asked for, run in the
 * pure model at every station's desktop (1440×900) and landed-mobile
 * (390×844) pose: the corridor's projected rim quad CONTAINS every rendered
 * face corner (bezel included), and particles anywhere on the sight lines
 * to the rendered face are cleared. The same containment is readable live
 * from `window.__routeWorldParticles()` in `?routeDebug=1` sessions.
 */

type Pt = [number, number];

function projector(endpoint: CameraEndpoint, aspect: number) {
  const [ex, ey, ez] = endpoint.position;
  const f = [endpoint.target[0] - ex, endpoint.target[1] - ey, endpoint.target[2] - ez];
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fw = [f[0] / fl, f[1] / fl, f[2] / fl];
  const rl = Math.hypot(fw[0], fw[2]);
  const rw = [-fw[2] / rl, 0, fw[0] / rl];
  const up = [rw[1] * fw[2] - rw[2] * fw[1], rw[2] * fw[0] - rw[0] * fw[2], rw[0] * fw[1] - rw[1] * fw[0]];
  const tan = Math.tan((endpoint.fov * Math.PI) / 360);
  return (p: Vec3): Pt => {
    const d = [p[0] - ex, p[1] - ey, p[2] - ez];
    const depth = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    return [
      (d[0] * rw[0] + d[1] * rw[1] + d[2] * rw[2]) / depth / (tan * aspect),
      (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / depth / tan,
    ];
  };
}

function insideQuad(quad: readonly Pt[], [x, y]: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % quad.length];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const s = Math.sign(c);
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function rectGrid(rect: FaceRect): Vec3[] {
  const [a, b, c, d] = rectCorners(rect); // (-,-) (-,+) (+,-) (+,+)
  const out: Vec3[] = [];
  for (let i = 0; i <= 6; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      const u = i / 6;
      const v = j / 4;
      const bottom: Vec3 = [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u];
      const top: Vec3 = [b[0] + (d[0] - b[0]) * u, b[1] + (d[1] - b[1]) * u, b[2] + (d[2] - b[2]) * u];
      out.push([bottom[0] + (top[0] - bottom[0]) * v, bottom[1] + (top[1] - bottom[1]) * v, bottom[2] + (top[2] - bottom[2]) * v]);
    }
  }
  return out;
}

const POSES = CLOUDS_STATIONS.flatMap((station) => [
  { id: station.id, label: '1440', endpoint: station.camera, aspect: 1440 / 900, index: CLOUDS_STATIONS.indexOf(station) },
  {
    id: station.id,
    label: '390',
    endpoint: landedEndpoint(station.cameraMobile),
    aspect: 390 / 844,
    index: CLOUDS_STATIONS.indexOf(station),
  },
]);

describe('clouds corridors cover the RENDERED faces (W1 r3)', () => {
  it('the flagship sail renders hullLift above its layout anchor — the r2 drift this fixes', () => {
    const rect = airshipSailRect(FLAGSHIP);
    expect(rect.center[1]).toBeCloseTo(FLAGSHIP.hull.y, 6);
    expect(rect.center[1] - FLAGSHIP.face.y).toBeGreaterThan(0.8);
    // The corridor's own centre now sits on the rendered sail's height band.
    const face = CLOUDS_PARTICLE_FACES.pulse;
    expect(Math.abs(face.center[1] - rect.center[1])).toBeLessThan(rect.halfHeight);
  });

  it.each(POSES.map((pose) => [`${pose.id} @${pose.label}`, pose] as const))(
    '%s: the corridor rim quad contains every rendered face corner on screen',
    (_label, pose) => {
      const face = CLOUDS_PARTICLE_FACES[pose.id];
      const eye = pose.endpoint.position;
      const basis = corridorBasis(eye, face);
      const toScreen = projector(pose.endpoint, pose.aspect);
      const k = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
      const r = k(basis.right, face.halfWidth * face.halfWidth);
      const u = k(basis.up, face.halfHeight * face.halfHeight);
      const quad = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) =>
        toScreen([
          face.center[0] + sx * r[0] + sy * u[0],
          face.center[1] + sx * r[1] + sy * u[1],
          face.center[2] + sx * r[2] + sy * u[2],
        ]),
      );
      for (const rect of CLOUDS_FACE_RECTS[pose.id]) {
        for (const corner of rectCorners(rect)) expect(insideQuad(quad, toScreen(corner))).toBe(true);
      }
    },
  );

  it.each(POSES.map((pose) => [`${pose.id} @${pose.label}`, pose] as const))(
    '%s: every sight line to the rendered face (grid incl. bezel corners) is cleared',
    (_label, pose) => {
      const corridors = activeCorridors(CLOUDS_STATIONS, CLOUDS_PARTICLE_FACES, pose.index);
      const eye = pose.endpoint.position;
      for (const rect of CLOUDS_FACE_RECTS[pose.id]) {
        for (const target of rectGrid(rect)) {
          for (const t of [0.25, 0.5, 0.75, 0.9, 0.99]) {
            const p: Vec3 = [
              eye[0] + (target[0] - eye[0]) * t,
              eye[1] + (target[1] - eye[1]) * t,
              eye[2] + (target[2] - eye[2]) * t,
            ];
            expect(corridorsKeep(p, eye, corridors)).toBeLessThan(0.02);
          }
        }
      }
    },
  );
});
