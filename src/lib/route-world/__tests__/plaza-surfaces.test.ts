/**
 * LOOK-PLAN §2 SEAT S — the plaza surfaces' pure law:
 *
 * 1. `calmBoxesFor` covers every pose: every face's padded rect, cast onto
 *    the façade backdrops from every calm pose (desktop, 768, landed 390,
 *    focus, and every dolly sample the face shows at — the mid-dolly check),
 *    lands inside a calm box. Denser rays than the builder's, so coverage is
 *    judged independently of its own sampling. ≤ 8 boxes (the shader slots).
 * 2. Window-light keep-out: no lit pane's world sphere reaches a keep-out
 *    wedge or a calm box; upper storeys light an irregular ~22 %.
 * 3. Kerb corridor clearance: every kerb stone clears the hero capsules, the
 *    dolly corridors, every walker route and loiter spot, the gate / gantry /
 *    Center exclusions and every keep-out wedge.
 */

import { describe, expect, it } from 'vitest';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { PLAZA_CALM_BACKDROPS, plazaCalmBoxes, plazaWindowClear } from '@/components/world/themes/plaza/paint-ashlar';
import { AMBIENT_PATHS, DOLLY_CORRIDORS, HERO_SEGMENTS, LOITER_SPOTS, distanceToSegment } from '../ambient';
import {
  CALM_BOX_MAX,
  CALM_DOLLY_MIN_ON_SCREEN,
  calmBoxesFor,
  dollyPoses,
  faceRectAt,
  KEEP_OUT_PAD,
  calmPoses,
  castFaceOnBackdrops,
  pointInCalmBoxes,
  themeKeepOut,
} from '../data-surfaces';
import {
  blockToWorld,
  compileFacade,
  floorOfVolume,
  KERB,
  KERB_WALKER_CLEARANCE_M,
  kitBayPlacements,
  PLAZA_KERB_EXCLUSIONS,
  plazaBlockPlans,
  plazaKerb,
  UPPER_WINDOW_LIGHT_SHARE,
  type BlockPlan,
} from '../haussmann';
import { PLAZA } from '../layout';

const PLANS: BlockPlan[] = plazaBlockPlans(PLAZA.half).map((plan) => ({ ...plan, windowClear: plazaWindowClear }));

describe('calmBoxesFor (plaza)', () => {
  const boxes = plazaCalmBoxes();

  it('fits the shader slots and is deterministic', () => {
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.length).toBeLessThanOrEqual(CALM_BOX_MAX);
    expect(calmBoxesFor(PLAZA_DATA_SURFACES, PLAZA_CALM_BACKDROPS)).toEqual(boxes);
  });

  it('sweeps desktop, 768, landed 390, focus and every dolly sample the face shows at', () => {
    let withDolly = 0;
    for (const face of PLAZA_DATA_SURFACES.faces) {
      const poses = calmPoses(PLAZA_DATA_SURFACES, face);
      const kinds = new Set(poses.map((pose) => pose.kind));
      for (const kind of ['desktop', 'tablet', 'landed390', 'focus'] as const) {
        expect(kinds.has(kind), `${face.id} lacks a ${kind} pose`).toBe(true);
      }
      const ids = new Set(poses.map((pose) => pose.id));
      for (let crossing = 0; crossing < PLAZA_DATA_SURFACES.stations.length - 1; crossing += 1) {
        for (const pose of dollyPoses(PLAZA_DATA_SURFACES, crossing)) {
          const shown = faceRectAt(face, pose.camera, pose.viewport, KEEP_OUT_PAD.metres).onScreenFraction;
          if (shown >= CALM_DOLLY_MIN_ON_SCREEN) expect(ids.has(pose.id), `${face.id} misses ${pose.id}`).toBe(true);
        }
      }
      if (kinds.has('dolly')) withDolly += 1;
    }
    expect(withDolly).toBeGreaterThanOrEqual(4);
  });

  it('covers every face rect cast on the façades at every pose (13 × 13 rays)', () => {
    let cast = 0;
    const misses: string[] = [];
    for (const face of PLAZA_DATA_SURFACES.faces) {
      for (const pose of calmPoses(PLAZA_DATA_SURFACES, face)) {
        for (const hit of castFaceOnBackdrops(face, pose, PLAZA_CALM_BACKDROPS, 13)) {
          cast += 1;
          if (!pointInCalmBoxes(boxes, hit.p, 1e-6)) misses.push(`${face.id} @ ${pose.id} → ${hit.backdrop.id}`);
        }
      }
    }
    expect(cast).toBeGreaterThan(1000);
    expect(misses.slice(0, 10)).toEqual([]);
  });

  it('keeps the calm local: most of the façade area keeps its painted detail', () => {
    let facadeArea = 0;
    let calmArea = 0;
    for (const b of PLAZA_CALM_BACKDROPS) {
      if (b.id === 'teams-terrace') continue;
      facadeArea += (b.span[1] - b.span[0]) * (b.y[1] - b.y[0]);
    }
    for (const box of boxes) {
      const dx = box.max[0] - box.min[0];
      const dz = box.max[2] - box.min[2];
      calmArea += Math.max(dx, dz) * (box.max[1] - box.min[1]);
    }
    expect(calmArea / facadeArea).toBeLessThan(0.4);
  });
});

describe('window-light keep-out (plaza)', () => {
  const keepOut = themeKeepOut(PLAZA_DATA_SURFACES);
  const boxes = plazaCalmBoxes();

  it('lights no pane whose sphere reaches a keep-out wedge or a calm box', () => {
    let lit = 0;
    for (const plan of PLANS) {
      for (const w of compileFacade(plan).windows) {
        if (!w.lit) continue;
        lit += 1;
        const local: [number, number, number] = w.face === 'void' ? [w.x, w.y, 0] : [w.x, w.y, plan.depth / 2];
        const c = blockToWorld(plan, local[0], local[1], local[2]);
        const r = Math.hypot(w.w, w.h) / 2;
        expect(keepOut.sphereClear(c, r), `${plan.id} window ${w.x},${w.y} in a wedge`).toBe(true);
        expect(pointInCalmBoxes(boxes, c, r), `${plan.id} window ${w.x},${w.y} in a calm box`).toBe(false);
      }
    }
    expect(lit).toBeGreaterThan(10);
  });

  it('lights an irregular ~22 % of upper-storey windows (static hash, same answer every run)', () => {
    let upper = 0;
    let upperLit = 0;
    const raw = plazaBlockPlans(PLAZA.half);
    for (const plan of raw) {
      for (const w of compileFacade(plan).windows) {
        if (w.face === 'void' || floorOfVolume(w) === 0) continue;
        upper += 1;
        if (w.lit) upperLit += 1;
      }
    }
    const share = upperLit / upper;
    expect(share).toBeGreaterThan(UPPER_WINDOW_LIGHT_SHARE - 0.1);
    expect(share).toBeLessThan(UPPER_WINDOW_LIGHT_SHARE + 0.1);
    // Deterministic: a second compile answers identically.
    expect(raw.map((p) => compileFacade(p).windows.map((w) => w.lit))).toEqual(
      raw.map((p) => compileFacade(p).windows.map((w) => w.lit)),
    );
  });

  it('keeps the façade kit on the same lit answer as the writer', () => {
    for (const plan of PLANS) {
      const writer = compileFacade(plan).windows.filter((w) => w.face !== 'void').map((w) => w.lit);
      const kit = kitBayPlacements(plan)
        .filter((p) => p.bay !== 'dormer')
        .map((p) => p.lit);
      expect(kit).toEqual(writer);
    }
  });
});

describe('kerb corridor clearance (plaza)', () => {
  const seats = plazaKerb();
  const reach = Math.hypot(KERB.length, KERB.depth) / 2;

  it('lays a real band on the façade runs', () => {
    expect(seats.length).toBeGreaterThan(40);
    for (const seat of seats) {
      const onRing = Math.abs(Math.abs(seat.x) - KERB.offset) < 1e-6 || Math.abs(Math.abs(seat.z) - KERB.offset) < 1e-6;
      expect(onRing).toBe(true);
      expect(Math.max(Math.abs(seat.x), Math.abs(seat.z))).toBeLessThan(PLAZA.half);
    }
  });

  it('never overlaps another stone', () => {
    for (let i = 0; i < seats.length; i += 1) {
      for (let j = i + 1; j < seats.length; j += 1) {
        const a = seats[i];
        const b = seats[j];
        const ahx = a.yaw === 0 ? KERB.length / 2 : KERB.depth / 2;
        const ahz = a.yaw === 0 ? KERB.depth / 2 : KERB.length / 2;
        const bhx = b.yaw === 0 ? KERB.length / 2 : KERB.depth / 2;
        const bhz = b.yaw === 0 ? KERB.depth / 2 : KERB.length / 2;
        const overlap = Math.abs(a.x - b.x) < ahx + bhx - 1e-6 && Math.abs(a.z - b.z) < ahz + bhz - 1e-6;
        expect(overlap, `kerb ${i} overlaps ${j}`).toBe(false);
      }
    }
  });

  it('clears hero capsules, dolly corridors, walker routes, loiter spots and exclusions', () => {
    for (const seat of seats) {
      for (const seg of HERO_SEGMENTS) expect(distanceToSegment(seat.x, seat.z, seg.a, seg.b)).toBeGreaterThanOrEqual(seg.radius);
      for (const d of DOLLY_CORRIDORS) expect(distanceToSegment(seat.x, seat.z, d.a, d.b)).toBeGreaterThanOrEqual(d.halfWidth);
      for (const path of AMBIENT_PATHS) {
        const n = path.closed ? path.points.length : path.points.length - 1;
        for (let i = 0; i < n; i += 1) {
          const d = distanceToSegment(seat.x, seat.z, path.points[i], path.points[(i + 1) % path.points.length]);
          expect(d, `kerb at ${seat.x},${seat.z} on ${path.id}`).toBeGreaterThanOrEqual(KERB_WALKER_CLEARANCE_M + reach);
        }
      }
      for (const spot of LOITER_SPOTS) {
        expect(Math.hypot(seat.x - spot.at[0], seat.z - spot.at[1])).toBeGreaterThanOrEqual(KERB_WALKER_CLEARANCE_M + reach);
      }
      for (const e of PLAZA_KERB_EXCLUSIONS) {
        const inside = Math.abs(seat.x - e.center[0]) < e.half[0] && Math.abs(seat.z - e.center[1]) < e.half[1];
        expect(inside, `kerb at ${seat.x},${seat.z} inside ${e.id}`).toBe(false);
      }
    }
  });

  it('stays out of every keep-out wedge', () => {
    const keepOut = themeKeepOut(PLAZA_DATA_SURFACES);
    for (const seat of seats) {
      const half: [number, number, number] =
        seat.yaw === 0 ? [KERB.length / 2, KERB.height / 2, KERB.depth / 2] : [KERB.depth / 2, KERB.height / 2, KERB.length / 2];
      expect(keepOut.boxClear({ id: 'kerb', center: [seat.x, KERB.height / 2, seat.z], half })).toBe(true);
    }
  });
});
