import { describe, expect, it } from 'vitest';
import type { CameraEndpoint, RouteStation } from '../chapters';
import { stepStationLatch } from '../direction-latch';
import {
  CAPTION_COMPACT_PX,
  CAPTION_MIN_PX,
  DESKTOP_CAPTION,
  HUD_BAND_PX,
  LIFE_MIN_PX,
  SETTLE_HOLD_MS,
  VIEWPORTS,
  createKeepOut,
  createSettleState,
  dollyPoses,
  faceFocusPoses,
  faceInFrameFraction,
  faceRectAt,
  facesEye,
  keepOutWedge,
  paddedFaceRect,
  partialFaceTable,
  portraitBands,
  rootPlacement,
  screenPoint,
  stationPose,
  stepSettleLatch,
  themeWedges,
  wedgeHitsSphere,
  type DataFace,
  type DataSurfaceTheme,
  type KeepOutPose,
  type SettleState,
} from '../data-surfaces';
import { faceRectOf } from '../particle-discipline';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { SAKURA_DATA_SURFACES } from '@/components/world/themes/sakura/furniture/data-faces';
import { MOUNTAIN_DATA_SURFACES } from '@/components/world/themes/mountain/furniture/data-faces';
import { CLOUDS_DATA_SURFACES } from '@/components/world/themes/clouds/furniture/data-faces';

const WORLDS: readonly DataSurfaceTheme[] = [PLAZA_DATA_SURFACES, SAKURA_DATA_SURFACES, MOUNTAIN_DATA_SURFACES, CLOUDS_DATA_SURFACES];

/** A camera at the origin looking down −Z (three's default), 1440 × 900. */
const CAMERA: CameraEndpoint = { position: [0, 0, 0], target: [0, 0, -10], fov: 50 };
const POSE: KeepOutPose = { id: 'test', kind: 'desktop', camera: CAMERA, viewport: VIEWPORTS.desktop };
/** A 2 × 1 m board 10 m ahead, facing the camera. */
const BOARD: DataFace = { id: 'b', station: 's', center: [0, 0, -10], normal: [0, 0, 1], size: { w: 2, h: 1 }, kind: 'board' };

describe('faceRectAt', () => {
  it('projects a camera-facing face symmetric about the frame centre', () => {
    const r = faceRectAt(BOARD, CAMERA, VIEWPORTS.desktop);
    expect(r.rect).not.toBeNull();
    expect(r.onScreenFraction).toBe(1);
    const full = r.fullRect;
    if (!full) throw new Error('no rect');
    expect(full.x + full.w / 2).toBeCloseTo(720, 3);
    expect(full.y + full.h / 2).toBeCloseTo(450, 3);
    // Height: 1 m at 10 m with a 50° vertical fov → 1 / (2 · 10 · tan 25°) of 900 px.
    expect(full.h).toBeCloseTo(900 / (2 * 10 * Math.tan((25 * Math.PI) / 180)), 3);
    expect(full.w / full.h).toBeCloseTo(2, 3);
  });

  it('agrees with a direct corner projection for a yawed face (tighter than its AABB)', () => {
    const yawed: DataFace = { ...BOARD, normal: [Math.sin(0.6), 0, Math.cos(0.6)] };
    const r = faceRectAt(yawed, CAMERA, VIEWPORTS.desktop).fullRect;
    if (!r) throw new Error('no rect');
    const rx = Math.cos(0.6);
    const rz = -Math.sin(0.6);
    const xs = [-1, 1].map((s) => screenPoint([s * rx, 0, -10 + s * rz], CAMERA, VIEWPORTS.desktop)?.x ?? NaN);
    expect(r.x).toBeCloseTo(Math.min(...xs), 3);
    expect(r.x + r.w).toBeCloseTo(Math.max(...xs), 3);
  });

  it('clips a face straddling the rig near plane instead of blowing it up', () => {
    const beside: DataFace = { ...BOARD, center: [0.6, 0, -0.3], normal: [-1, 0, 0], size: { w: 2, h: 1 } };
    const r = faceRectAt(beside, CAMERA, VIEWPORTS.desktop);
    expect(r.fullRect).not.toBeNull();
    expect(r.onScreenFraction).toBeLessThan(0.5);
    expect(Math.abs(r.fullRect?.x ?? 0)).toBeLessThan(1e5);
  });

  it('pads by metres, then by 4 % of the viewport', () => {
    const plain = faceRectAt(BOARD, CAMERA, VIEWPORTS.desktop).fullRect;
    const padded = paddedFaceRect(BOARD, CAMERA, VIEWPORTS.desktop);
    if (!plain || !padded) throw new Error('no rect');
    const pxPerM = plain.h / 1;
    expect(padded.x).toBeCloseTo(plain.x - 0.3 * pxPerM - 0.04 * 1440, 3);
    expect(padded.h).toBeCloseTo(plain.h + 0.6 * pxPerM + 2 * 0.04 * 900, 3);
  });
});

describe('keepOutWedge + clearance tests', () => {
  const wedge = keepOutWedge(BOARD, POSE);
  if (!wedge) throw new Error('no wedge');
  const keepOut = createKeepOut([wedge]);

  it('holds the space between the eye and the face, not behind or beside it', () => {
    expect(keepOut.pointClear([0, 0, -5])).toBe(false);
    expect(keepOut.pointClear([0, 0, -12])).toBe(true); // behind the face plane
    expect(keepOut.pointClear([3, 0, -5])).toBe(true); // beside the wedge
    expect(keepOut.pointClear([0, 0, 1])).toBe(true); // behind the eye
    // Inside the pad: 0.2 m past the face's top edge at the face plane.
    expect(keepOut.pointClear([0, 0.7, -9.9])).toBe(false);
  });

  it('grows a sphere by its radius', () => {
    expect(keepOut.sphereClear([2, 0, -10.0 + 1], 0.1)).toBe(true);
    expect(keepOut.sphereClear([2, 0, -9], 1.2)).toBe(false);
    expect(wedgeHitsSphere(wedge, [0, 0, -10.5], 0.4)).toBe(false);
    expect(wedgeHitsSphere(wedge, [0, 0, -10.5], 0.6)).toBe(true);
  });

  it('sweeps a segment and a lane across the wedge', () => {
    expect(keepOut.segmentClear([-4, 0, -6], [4, 0, -6], 0)).toBe(false);
    expect(keepOut.segmentClear([-4, 3, -6], [4, 3, -6], 0.1)).toBe(true);
    expect(keepOut.laneClears({ id: 'l', points: [[-4, 0, -6], [4, 0, -6]], radius: 0 })).toBe(false);
    expect(keepOut.laneClears({ id: 'l', points: [[-4, 3, -6], [-3, 3, -6]], radius: 0.2 })).toBe(true);
    expect(keepOut.laneHits({ id: 'l', points: [[-4, 0, -6], [4, 0, -6]], radius: 0 }).map((w) => w.faceId)).toEqual(['b']);
  });

  it('samples a thin rope box spanning the wedge (no corner inside)', () => {
    expect(keepOut.boxClear({ id: 'rope', center: [0, 0, -6], half: [3, 0.02, 0.02] })).toBe(false);
    expect(keepOut.boxClear({ id: 'rope-yawed', center: [0, 0, -6], half: [3, 0.02, 0.02], yaw: Math.PI / 2 })).toBe(false);
    expect(keepOut.boxClear({ id: 'post', center: [3, 0, -6], half: [0.05, 1, 0.05] })).toBe(true);
  });

  it('reports altitude clamps: stay under `below`, fly over `above`', () => {
    const h = keepOut.headroomAt(0, -6, { floor: -5, ceiling: 5, stepM: 0.05 });
    expect(h.clear).toBe(false);
    // At 6 m the padded wedge spans roughly ±0.5 m vertically (face ±0.5 + pad, scaled by 0.6).
    expect(h.below).toBeLessThan(-0.3);
    expect(h.below).toBeGreaterThan(-1.5);
    expect(h.above).toBeGreaterThan(0.3);
    expect(h.above).toBeLessThan(1.5);
    expect(keepOut.headroomAt(5, -6, { floor: -5, ceiling: 5 }).clear).toBe(true);
  });

  it('has no wedge for a face entirely off frame', () => {
    const behind: DataFace = { ...BOARD, center: [0, 0, 10], normal: [0, 0, -1] };
    expect(keepOutWedge(behind, POSE)).toBeNull();
  });
});

describe('poses', () => {
  it('lands the station pose on the frozen endpoints (desktop, and the landed 390 pose)', () => {
    for (const world of WORLDS) {
      world.stations.forEach((station: RouteStation, i) => {
        const desktop = stationPose(world, i, 'desktop').camera;
        desktop.position.forEach((v, k) => expect(v).toBeCloseTo(station.camera.position[k], 6));
        expect(desktop.fov).toBeCloseTo(station.camera.fov, 6);
        // The look direction is the authored one.
        const d = station.camera.target.map((t, k) => t - station.camera.position[k]);
        const len = Math.hypot(d[0], d[1], d[2]);
        const got = desktop.target.map((t, k) => (t - desktop.position[k]) / 10);
        got.forEach((v, k) => expect(v).toBeCloseTo(d[k] / len, 5));
        // Landed 390: the mobile endpoint pulled back 9.75 m along its axis.
        const landed = stationPose(world, i, 'mobile').camera;
        const m = station.cameraMobile;
        const back = Math.hypot(...([0, 1, 2] as const).map((k) => landed.position[k] - m.position[k]));
        expect(back).toBeCloseTo(9.75, 3);
      });
    }
  });

  it('samples the dolly corridor between the endpoints', () => {
    const poses = dollyPoses(PLAZA_DATA_SURFACES, 0);
    expect(poses).toHaveLength(9);
    const a = PLAZA_DATA_SURFACES.stations[0].camera.position;
    const b = PLAZA_DATA_SURFACES.stations[1].camera.position;
    const mid = poses.find((p) => p.id === 'pulse>roster@0.5:desktop');
    expect(mid).toBeDefined();
    mid?.camera.position.forEach((v, k) => expect(v).toBeCloseTo((a[k] + b[k]) / 2, 5));
    expect(dollyPoses(PLAZA_DATA_SURFACES, 4)).toEqual([]);
  });

  it('stands every focus eye in front of its face, framing it (portrait lets a wide face overflow)', () => {
    for (const world of WORLDS) {
      for (const face of world.faces) {
        for (const pose of faceFocusPoses(world, face)) {
          const rel = pose.camera.position.map((v, k) => v - face.center[k]);
          expect(rel[0] * face.normal[0] + rel[2] * face.normal[2], pose.id).toBeGreaterThan(0);
          // focus.ts PORTRAIT_MAX_FILL_ACROSS: at 390 a wide subject may overflow the
          // frame width by design (the docked sheet carries the detail).
          const floor = pose.viewport.width <= 767 ? 0.75 : 0.95;
          expect(faceInFrameFraction(face, pose.camera, pose.viewport), pose.id).toBeGreaterThan(floor);
        }
      }
    }
  });

  it('builds wedges for every face of every world', () => {
    for (const world of WORLDS) {
      const wedges = themeWedges(world);
      for (const face of world.faces) {
        const kinds = new Set(wedges.filter((w) => w.faceId === face.id).map((w) => w.poseKind));
        expect([...kinds].sort(), `${world.id} ${face.id}`).toEqual(expect.arrayContaining(['desktop', 'focus', 'landed390', 'tablet']));
      }
    }
  });
});

describe('placement rules', () => {
  it('flags roots in the HUD band and the 3 % edge inset', () => {
    const v = VIEWPORTS.mobile;
    const cam: CameraEndpoint = { position: [0, 0, 0], target: [0, 0, -10], fov: 50 };
    expect(rootPlacement([0, 0, -10], cam, v)).toBe('ok');
    const tanHalf = Math.tan((25 * Math.PI) / 180);
    // A root 20 px above the bottom edge → inside the 56 px HUD band.
    const ndcY = 1 - (2 * (v.height - 20)) / v.height;
    expect(rootPlacement([0, ndcY * 10 * tanHalf, -10], cam, v)).toBe('hud-band');
    const ndcX = 1 - (2 * 5) / v.width; // 5 px from the right edge
    expect(rootPlacement([ndcX * 10 * tanHalf * (v.width / v.height), 0, -10], cam, v)).toBe('edge-inset');
    expect(rootPlacement([0, 0, 10], cam, v)).toBe('off-frame');
    expect(HUD_BAND_PX).toBe(56);
  });

  it('applies the ±100° facing rule', () => {
    const eye: [number, number, number] = [0, 1.5, 10];
    expect(facesEye([0, 0, 0], 0, eye)).toBe(true); // faces +Z, straight at the eye
    expect(facesEye([0, 0, 0], (95 * Math.PI) / 180, eye)).toBe(true);
    expect(facesEye([0, 0, 0], (105 * Math.PI) / 180, eye)).toBe(false);
    expect(facesEye([0, 0, 0], Math.PI, eye)).toBe(false);
  });

  it('feeds the particle corridors the same rectangle (faceRectOf)', () => {
    const r = faceRectOf({ ...BOARD, normal: [1, 0, 0] });
    expect(r.yaw).toBeCloseTo(Math.PI / 2);
    expect(r.halfWidth).toBe(1);
    expect(r.halfHeight).toBe(0.5);
  });
});

describe('partial-face table', () => {
  it('lists the cropped neighbour boards (the standby-dim set), never a fully framed face', () => {
    const plaza = partialFaceTable(PLAZA_DATA_SURFACES);
    expect(plaza.pulse.desktop).toContain('schedule:board');
    expect(plaza.schedule.desktop).toContain('pulse:board');
    for (const world of WORLDS) {
      const table = partialFaceTable(world);
      world.stations.forEach((station, i) => {
        for (const key of ['desktop', 'tablet', 'mobile'] as const) {
          const pose = stationPose(world, i, key);
          for (const id of table[station.id][key]) {
            const face = world.faces.find((f) => f.id === id);
            if (!face) throw new Error(id);
            const f = faceInFrameFraction(face, pose.camera, pose.viewport);
            expect(f).toBeGreaterThan(0);
            expect(f).toBeLessThan(0.8);
          }
        }
      });
    }
    expect(partialFaceTable(PLAZA_DATA_SURFACES)).toBe(plaza); // memoized constant
  });
});

describe('portraitBands', () => {
  it('orders caption, data, life and HUD disjointly at 390 × 844 for all 20 stations', () => {
    for (const world of WORLDS) {
      world.stations.forEach((station, i) => {
        const b = portraitBands(world, i, VIEWPORTS.mobile);
        const where = `${world.id}:${station.id}`;
        expect(b.layout, where).toBe('portrait');
        expect(b.data, where).not.toBeNull();
        if (!b.data) return;
        expect(b.caption.top, where).toBe(0);
        expect(b.caption.bottom, where).toBeLessThanOrEqual(b.data.top);
        expect(b.data.top, where).toBeLessThan(b.data.bottom);
        expect(b.data.bottom, where).toBeLessThanOrEqual(b.life.top);
        expect(b.life.bottom, where).toBe(b.hud.top);
        expect(b.hud.bottom - b.hud.top, where).toBe(HUD_BAND_PX);
        expect(b.life.bottom - b.life.top, where).toBeGreaterThanOrEqual(LIFE_MIN_PX);
        const captionH = b.caption.bottom - b.caption.top;
        expect(b.captionCompact, where).toBe(captionH < CAPTION_MIN_PX);
        expect(captionH, where).toBeGreaterThanOrEqual(CAPTION_COMPACT_PX);
        // The caption band clears every padded face on screen.
        for (const r of b.faceRects) expect(r.y, where).toBeGreaterThanOrEqual(b.caption.bottom - 1e-6);
      });
    }
  });

  it('places the ≥ 768 caption box top-left, or top-right when only the left meets a face', () => {
    for (const world of WORLDS) {
      world.stations.forEach((station, i) => {
        for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.tablet]) {
          const b = portraitBands(world, i, viewport);
          expect(b.layout).toBe('landscape');
          expect(b.captionRect.w).toBe(DESKTOP_CAPTION.w);
          expect(b.captionRect.h).toBe(DESKTOP_CAPTION.h);
          expect(b.captionRect.y).toBe(DESKTOP_CAPTION.inset);
          const meets = b.faceRects.some(
            (r) =>
              r.x < b.captionRect.x + b.captionRect.w &&
              b.captionRect.x < r.x + r.w &&
              r.y < b.captionRect.y + b.captionRect.h &&
              b.captionRect.y < r.y + r.h,
          );
          expect(b.captionConflict, `${world.id}:${station.id}@${viewport.width}`).toBe(meets);
          if (b.captionSide === 'right') {
            expect(b.captionRect.x).toBe(viewport.width - DESKTOP_CAPTION.inset - DESKTOP_CAPTION.w);
          }
        }
      });
    }
  });
});

describe('stepSettleLatch', () => {
  function run(samples: readonly { exact: number; smooth?: number; dt?: number }[], start = 1): { stations: number[]; settled: boolean[] } {
    let nearest = start;
    let now = 0;
    let state: SettleState = createSettleState();
    const stations: number[] = [];
    const settled: boolean[] = [];
    for (const s of samples) {
      now += s.dt ?? 16;
      nearest = stepStationLatch(nearest, s.exact, 5);
      state = stepSettleLatch(state, { exact: s.exact, smooth: s.smooth ?? s.exact, nearest, now });
      stations.push(state.station);
      settled.push(state.settled);
    }
    return { stations, settled };
  }

  it('settles only after the catch-up and a 150 ms hold, then latches', () => {
    const arrive = run([
      { exact: 1, smooth: 0.9 },
      { exact: 1, smooth: 0.99, dt: 60 },
      { exact: 1, smooth: 0.995, dt: 50 },
      { exact: 1, smooth: 1, dt: 40 },
      { exact: 1, smooth: 1, dt: 20 },
      // Catch-up noise at the station never releases it.
      { exact: 1.05, smooth: 1.0, dt: 16 },
      { exact: 1.0, smooth: 1.04, dt: 16 },
    ]);
    // The hold starts at the first sample: 60 + 50 + 40 = 150 ms by the fourth, caught up there.
    expect(arrive.settled).toEqual([false, false, false, true, true, true, true]);
    expect(SETTLE_HOLD_MS).toBe(150);
  });

  it('does not settle while parked mid-crossing, and releases when the visitor leaves', () => {
    const parked = run(Array.from({ length: 30 }, () => ({ exact: 1.4, dt: 50 })));
    expect(parked.settled.every((s) => !s)).toBe(true);
    const leave = run([...Array.from({ length: 12 }, () => ({ exact: 1 })), { exact: 1.2 }, { exact: 1.35 }]);
    expect(leave.settled.slice(10, 12)).toEqual([true, true]);
    expect(leave.settled[12]).toBe(true); // 0.2 < release 0.3
    expect(leave.settled[13]).toBe(false);
  });

  it('never flips on a ±0.1 jitter around x.5 (no flip before 1.65 up or 1.35 down)', () => {
    const jitter = (base: number) =>
      Array.from({ length: 60 }, (_, i) => ({ exact: base + (i % 2 === 0 ? 0.1 : -0.1) * ((i % 5) / 4), dt: 16 }));
    const up = run([{ exact: 1 }, ...jitter(1.5), { exact: 1.64 }], 1);
    expect(new Set(up.stations)).toEqual(new Set([1]));
    const upSettleFlips = up.settled.slice(1).filter((s, i, a) => i > 0 && s !== a[i - 1]).length;
    expect(upSettleFlips).toBeLessThanOrEqual(1);
    expect(run([{ exact: 1.66 }], 1).stations).toEqual([2]);

    const down = run([{ exact: 2 }, ...jitter(1.5), { exact: 1.36 }], 2);
    expect(new Set(down.stations)).toEqual(new Set([2]));
    expect(run([{ exact: 1.34 }], 2).stations).toEqual([1]);
  });

  it('returns the same object when nothing changes (a setter can bail out)', () => {
    const s0 = createSettleState();
    const s1 = stepSettleLatch(s0, { exact: 1, smooth: 1, nearest: 1, now: 0 });
    expect(stepSettleLatch(s1, { exact: 1, smooth: 0.5, nearest: 1, now: 10 })).toBe(s1);
    expect(stepSettleLatch(s1, { exact: Number.NaN, smooth: 1, nearest: 1, now: 10 })).toBe(s1);
  });
});
