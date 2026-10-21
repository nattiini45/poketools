/**
 * LOOK r6 (CLARITY) test fixtures for the plaza #teams station: the rosters
 * the placement / crest / lamp laws are judged on, the ace focus-subject
 * bounds StatueRow registers, a corner projection, and the r5 capture's own
 * measured ace rects. Numbers only — no species, types or stats.
 */
import type { CameraEndpoint, Vec3 } from '../chapters';
import { screenPoint, type Viewport } from '../data-surfaces';
import type { ScreenRect } from '../evidence-probe';
import { PLAZA_TEAMS_PLAN, type TeamsAce, type TeamsFormation } from '../teams-formation';

/**
 * The r5 league roster's shape: statures and plan extents (height, footprint,
 * across-width in m) as the manifest reports them — the same cast
 * `teams-formation.test.ts` calls the r1 live cast. Four colossal aces
 * (> 1.5 m, on the back line), a 0.9 m rank 8.
 */
export const R5_ROSTER: readonly TeamsAce[] = (
  [
    [1.0, 1.3, 1.3],
    [1.7, 1.82, 1.8],
    [1.4, 2.22, 2.22],
    [1.8, 1.83, 1.83],
    [1.7, 4.68, 3.46],
    [2.0, 3.35, 3.35],
    [1.2, 1.27, 1.27],
    [0.9, 0.94, 0.94],
  ] as const
).map(([heightM, footprintM, widthM], i) => ({ id: `r5-${i + 1}`, heightM, footprintM, widthM }));

/** `teams-formation.test.ts`'s nominal roster (non-colossal statures ≤ 1.5 m). */
export function nominalRoster(n: number): TeamsAce[] {
  const heights = [1.2, 0.5, 1.0, 0.8, 1.5, 0.4, 0.9, 1.1, 0.7, 1.3, 0.6, 1.0];
  const feet = [0.9, 0.6, 1.1, 0.7, 1.2, 0.5, 0.8, 1.0, 0.7, 1.1, 0.6, 0.9];
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, heightM: heights[i % 12], footprintM: feet[i % 12] }));
}

export const ROSTER_COUNTS = [4, 6, 8, 10, 12] as const;

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/**
 * StatueRow.tsx `statueBounds`, restated for an ace not yet measured: the
 * plinth footing (PLAZA_TEAMS_PLAN.pedestal.half) united with the figure's
 * plan square (half = max(0.12, footprint / 2)) from the pedestal's foot to
 * the higher of the plinth cap and the crown. This is the `team:<id>` focus
 * subject the harness projects for `caption-over-face`.
 */
export function statueBounds(f: TeamsFormation, aces: readonly TeamsAce[], i: number): Aabb {
  const slot = f.slots[i];
  const ace = aces[i];
  const half = Math.max(0.12, ace.footprintM / 2);
  const ph = PLAZA_TEAMS_PLAN.pedestal.half;
  const p = slot.pedestal;
  const g = slot.figure;
  const lift = ace.liftM ?? 0;
  return {
    min: [Math.min(p[0] - ph, g[0] - half), p[1], Math.min(p[2] - ph, g[2] - half)],
    max: [Math.max(p[0] + ph, g[0] + half), Math.max(p[1] + slot.pedestalH + lift, g[1] + ace.heightM), Math.max(p[2] + ph, g[2] + half)],
  };
}

export function aabbCorners(box: Aabb): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) out.push([x, y, z]);
  return out;
}

/**
 * Screen rect (viewport CSS px) of world points, clipped to the viewport,
 * with the share of the unclipped rect on screen. Null when any point is
 * behind the rig's near plane or nothing is on screen.
 */
export function projectPoints(
  points: readonly Vec3[],
  camera: CameraEndpoint,
  viewport: Viewport,
): { rect: ScreenRect; full: ScreenRect; onScreenFraction: number } | null {
  const ps = points.map((p) => screenPoint(p, camera, viewport));
  if (ps.some((p) => p === null)) return null;
  const xs = ps.map((p) => p!.x);
  const ys = ps.map((p) => p!.y);
  const full = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const x0 = Math.max(0, full.x);
  const y0 = Math.max(0, full.y);
  const x1 = Math.min(viewport.width, full.x + full.w);
  const y1 = Math.min(viewport.height, full.y + full.h);
  if (x1 <= x0 || y1 <= y0) return null;
  const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  return { rect, full, onScreenFraction: (rect.w * rect.h) / Math.max(full.w * full.h, 1e-9) };
}

export function rectsMeet(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Share of `b` covered by `a` — the harness's `rectOverlapShare` (caption-over-face). */
export function overlapShare(a: ScreenRect, b: ScreenRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(b.w * b.h, 1e-9) : 0;
}

/**
 * The r5 capture's measured `team:<id>` rects at #teams (light, rung 0):
 * `look-after-r5-r0-light-1440-teams-1440.json` and `…-390-teams-390.json`
 * occlusion rows, rounded to 0.1 px. The 1440 still failed
 * `caption-over-face (team:player-0005: 0.07)` with the card at
 * (24, 24, 360, 168.5) — the negative control below reproduces it.
 */
export const R5_MEASURED_ACE_RECTS: Readonly<Record<'desktop' | 'mobile', readonly { id: string; rect: ScreenRect }[]>> = {
  desktop: [
    { id: 'team:player-0006', rect: { x: 1118.1, y: 155.1, w: 195.4, h: 252.0 } },
    { id: 'team:player-0001', rect: { x: 72.2, y: 399.6, w: 288.8, h: 323.9 } },
    { id: 'team:player-0005', rect: { x: 173.2, y: 169.9, w: 281.8, h: 229.8 } },
    { id: 'team:player-0008', rect: { x: 281.0, y: 345.3, w: 401.9, h: 403.9 } },
    { id: 'team:player-0004', rect: { x: 495.4, y: 159.1, w: 212.1, h: 240.1 } },
    { id: 'team:player-0007', rect: { x: 440.2, y: 142.9, w: 646.4, h: 268.3 } },
    { id: 'team:player-0003', rect: { x: 855.4, y: 137.5, w: 195.3, h: 260.9 } },
    { id: 'team:player-0002', rect: { x: 878.0, y: 371.2, w: 385.1, h: 371.9 } },
  ],
  mobile: [
    { id: 'team:player-0006', rect: { x: 328.9, y: 317.7, w: 52.4, h: 80.6 } },
    { id: 'team:player-0001', rect: { x: 13.6, y: 397.3, w: 69.6, h: 95.3 } },
    { id: 'team:player-0005', rect: { x: 11.8, y: 314.1, w: 85.4, h: 79.1 } },
    { id: 'team:player-0008', rect: { x: 77.2, y: 378.6, w: 105.7, h: 118.9 } },
    { id: 'team:player-0004', rect: { x: 119.3, y: 310.6, w: 70.5, h: 82.3 } },
    { id: 'team:player-0007', rect: { x: 108.9, y: 312.1, w: 197.7, h: 88.8 } },
    { id: 'team:player-0003', rect: { x: 243.7, y: 303.4, w: 62.2, h: 88.8 } },
    { id: 'team:player-0002', rect: { x: 245.2, y: 387.1, w: 96.7, h: 109.1 } },
  ],
};
