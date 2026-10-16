import { describe, expect, it } from 'vitest';
import {
  boundsCenter,
  clampFocusStep,
  clampOrbit,
  dampToward,
  FOCUS_DAMPING,
  FOCUS_LIMITS,
  FOCUS_MAX_STEP_M,
  focusBlendCurve,
  focusBlendRate,
  focusStepLimit,
  frameSubject,
  framingOptionsFor,
  orbitPose,
  panelFrameOffset,
  type FocusSubject,
} from '../focus';
import { FURNITURE, JUMBOTRON } from '../layout';

const pulseBoard: FocusSubject = {
  id: 'board:pulse',
  kind: 'board',
  label: 'Puls-Board',
  bounds: {
    min: [FURNITURE.pulseBoard.x - JUMBOTRON.width / 2, FURNITURE.pulseBoard.y - JUMBOTRON.height / 2, -16.4],
    max: [FURNITURE.pulseBoard.x + JUMBOTRON.width / 2, FURNITURE.pulseBoard.y + JUMBOTRON.height / 2, -16.0],
  },
  facing: [0, 0, 1],
};

function ace(heightm: number, x = 13.5): FocusSubject {
  const half = heightm * 0.35;
  return {
    id: `ace:${heightm}`,
    kind: 'ace',
    label: 'Ass',
    bounds: { min: [x - half, 0.62, -half], max: [x + half, 0.62 + heightm, half] },
    facing: [-1, 0, 0],
  };
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('frameSubject', () => {
  it('stands in front of a board along its facing direction', () => {
    const framing = frameSubject(pulseBoard, 42, 1.6);
    const pose = orbitPose(framing);
    expect(pose.position[2]).toBeGreaterThan(pulseBoard.bounds.max[2]);
    expect(pose.position[1]).toBeCloseTo(boundsCenter(pulseBoard.bounds)[1], 1);
    // ≈ 78 % of frame width for a 7.6 m board at fov 42 / aspect 1.6.
    const frameWidth = 2 * framing.distance * Math.tan((42 * Math.PI) / 360) * 1.6;
    expect(JUMBOTRON.width / frameWidth).toBeGreaterThan(0.7);
    expect(JUMBOTRON.width / frameWidth).toBeLessThan(0.85);
  });

  it('scales the distance with the real height of the subject', () => {
    const charmander = frameSubject(ace(0.6), 42, 1.6);
    const gyarados = frameSubject(ace(6.5), 42, 1.6);
    expect(gyarados.distance).toBeGreaterThan(charmander.distance * 5);
  });

  it('never stands closer than the near-plane guard, even for tiny subjects', () => {
    const joltik = frameSubject(ace(0.1), 42, 1.6);
    expect(joltik.distance).toBeGreaterThanOrEqual(FOCUS_LIMITS.minDistance);
  });

  it('backs off on a portrait viewport so the subject still fits across', () => {
    const wide = frameSubject(pulseBoard, 42, 1.6);
    const tall = frameSubject(pulseBoard, 52, 390 / 844);
    expect(tall.distance).toBeGreaterThan(wide.distance);
  });

  it('shifts the look target sideways to leave room for a docked panel', () => {
    const centered = frameSubject(pulseBoard, 42, 1.6);
    const docked = frameSubject(
      pulseBoard,
      42,
      1.6,
      framingOptionsFor('board', panelFrameOffset(true, false)),
    );
    expect(docked.distance).toBeCloseTo(centered.distance, 6);
    expect(docked.target[0]).not.toBeCloseTo(centered.target[0], 3);
    expect(docked.target[1]).toBeCloseTo(centered.target[1], 6);
  });

  it('lifts the subject clear of a bottom sheet on mobile', () => {
    const centered = frameSubject(pulseBoard, 52, 0.46);
    const sheet = framingOptionsFor('board', panelFrameOffset(true, true));
    const docked = frameSubject(pulseBoard, 52, 0.46, sheet);
    // The look target drops so the subject rises above the sheet (C-031: the
    // old -0.14 offset lowered the target and pushed subjects into the sheet).
    expect(docked.target[1]).toBeLessThan(centered.target[1]);
    expect(sheet.frameOffset.sheet).toBeGreaterThan(0.3);
    // The subject's projected center lands in the visible band above the
    // sheet: NDC y > 0 means above the frame center, where the sheet is not.
    const halfV = Math.tan((52 * Math.PI) / 360);
    const center = boundsCenter(pulseBoard.bounds);
    const dy = (center[1] - docked.target[1]) / (docked.distance * halfV);
    expect(dy).toBeGreaterThan(0.25);
    expect(dy).toBeLessThan(0.6);
    // A height-bound subject must also back off: the sheet halves the frame
    // it may fill, so the vertical fit carries the extra distance.
    const aceCentered = frameSubject(ace(1.7), 52, 0.46);
    const aceSheet = frameSubject(ace(1.7), 52, 0.46, sheet);
    expect(aceSheet.distance).toBeGreaterThan(aceCentered.distance);
  });
});

describe('orbitPose', () => {
  it('keeps the camera at the framing distance for the idle orbit', () => {
    const framing = frameSubject(ace(1.7), 42, 1.6);
    const pose = orbitPose(framing);
    expect(distance(pose.position, pose.target)).toBeCloseTo(framing.distance, 6);
  });

  it('clamps yaw, pitch and dolly to the ADR-0003 bounds', () => {
    const framing = frameSubject(ace(1.7), 42, 1.6);
    const wild = orbitPose(framing, { yaw: 9, pitch: -9, dolly: 50 });
    const edge = orbitPose(framing, {
      yaw: FOCUS_LIMITS.yaw,
      pitch: -FOCUS_LIMITS.pitch,
      dolly: FOCUS_LIMITS.dollyMax,
    });
    expect(wild.position).toEqual(edge.position);
    expect(clampOrbit({ yaw: 0, pitch: 0, dolly: 0.1 }).dolly).toBe(FOCUS_LIMITS.dollyMin);
  });

  it('dollies along the view axis without moving the target', () => {
    const framing = frameSubject(ace(1.7), 42, 1.6);
    const near = orbitPose(framing, { yaw: 0, pitch: 0, dolly: 0.6 });
    const far = orbitPose(framing, { yaw: 0, pitch: 0, dolly: 1.8 });
    expect(near.target).toEqual(far.target);
    expect(distance(far.position, far.target)).toBeCloseTo(distance(near.position, near.target) * 3, 5);
  });
});

describe('focus blend curve (ADR-0003 — dolly-out is the exact inverse of dolly-in)', () => {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  it('the out path retraces the in path point for point', () => {
    // Station at 0, subject at 10: record the positions visited going in,
    // then going out, at the same frame clock.
    const dt = 1 / 60;
    const inPath: number[] = [];
    let blend = 0;
    for (let i = 0; i < 240; i += 1) {
      blend = dampToward(blend, 1, FOCUS_DAMPING, dt);
      inPath.push(lerp(0, 10, focusBlendCurve(blend)));
    }
    const outPath: number[] = [];
    for (let i = 0; i < 240; i += 1) {
      blend = dampToward(blend, 0, FOCUS_DAMPING, dt);
      outPath.push(lerp(0, 10, focusBlendCurve(blend)));
    }
    // Same curve: every out sample lies on the in path (monotone, same range).
    const onInPath = (x: number) => {
      const i = inPath.findIndex((v) => v >= x);
      if (i <= 0) return true;
      return x >= inPath[i - 1] - 1e-9 && x <= inPath[i] + 1e-9;
    };
    expect(outPath.every(onInPath)).toBe(true);
    // Symmetric blend weight: f(1 - b) = 1 - f(b).
    for (let b = 0; b <= 1; b += 0.01) {
      expect(focusBlendCurve(1 - b)).toBeCloseTo(1 - focusBlendCurve(b), 12);
    }
    // Monotone in both directions: no overshoot either way.
    for (let i = 1; i < inPath.length; i += 1) expect(inPath[i]).toBeGreaterThanOrEqual(inPath[i - 1]);
    for (let i = 1; i < outPath.length; i += 1) expect(outPath[i]).toBeLessThanOrEqual(outPath[i - 1]);
  });

  it('damping is frame-rate independent and never overshoots', () => {
    let a = 0;
    for (let i = 0; i < 30; i += 1) a = dampToward(a, 1, FOCUS_DAMPING, 1 / 30);
    let b = 0;
    for (let i = 0; i < 120; i += 1) b = dampToward(b, 1, FOCUS_DAMPING, 1 / 120);
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeLessThan(1);
    expect(focusBlendCurve(-1)).toBe(0);
    expect(focusBlendCurve(2)).toBe(1);
  });
});

describe('portrait focus (W6 round 3: no whip, no dive under the floor)', () => {
  const PHONE = { fov: 52, aspect: 390 / 844 };
  const FLOOR = 0;
  // A wide schedule board standing on the floor (the plaza/sakura boards are
  // 6–8 m across), the pulse jumbotron, and the teams aces on their plinths.
  const scheduleBoard: FocusSubject = {
    id: 'board:schedule',
    kind: 'board',
    label: 'Spielplan',
    bounds: { min: [-4, FLOOR, 11.8], max: [4, 4.2, 12.2] },
    facing: [0, 0, -1],
  };
  const subjects: FocusSubject[] = [pulseBoard, scheduleBoard, ace(0.6), ace(1.7), ace(3.2)];
  const sheet = (subject: FocusSubject) => framingOptionsFor(subject.kind, panelFrameOffset(true, true));

  it('keeps the focus eye at least 1.2 m above the floor for every board and team subject at 390', () => {
    for (const subject of subjects) {
      for (const orbit of [undefined, { yaw: 0, pitch: -FOCUS_LIMITS.pitch, dolly: FOCUS_LIMITS.dollyMax }]) {
        const pose = orbitPose(frameSubject(subject, PHONE.fov, PHONE.aspect, sheet(subject)), orbit);
        expect(pose.position[1]).toBeGreaterThanOrEqual(FLOOR + 1.2 - 1e-9);
        expect(pose.position[1]).toBeGreaterThanOrEqual(subject.bounds.min[1]);
      }
    }
  });

  it('still lifts the subject center above the sheet (tilt, not pan)', () => {
    for (const subject of subjects) {
      const framing = frameSubject(subject, PHONE.fov, PHONE.aspect, sheet(subject));
      const pose = orbitPose(framing);
      const center = boundsCenter(subject.bounds);
      // Project the center into the camera: NDC y relative to the view axis.
      const f = [pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]];
      const len = Math.hypot(f[0], f[1], f[2]);
      const fwd = f.map((v) => v / len);
      const right = [-fwd[2], 0, fwd[0]];
      const rl = Math.hypot(right[0], right[2]);
      const r = [right[0] / rl, 0, right[2] / rl];
      const up = [r[1] * fwd[2] - r[2] * fwd[1], r[2] * fwd[0] - r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]];
      const c = [center[0] - pose.position[0], center[1] - pose.position[1], center[2] - pose.position[2]];
      const z = c[0] * fwd[0] + c[1] * fwd[1] + c[2] * fwd[2];
      const y = c[0] * up[0] + c[1] * up[1] + c[2] * up[2];
      const ndcY = y / z / Math.tan((PHONE.fov * Math.PI) / 360);
      expect(Math.abs(up[1])).toBeGreaterThan(0.5); // upright camera
      expect(ndcY).toBeGreaterThan(0.2); // above the frame center, clear of the sheet
      expect(ndcY).toBeLessThan(0.75);
    }
  });

  it('caps the portrait fit distance (a wide board may overflow sideways)', () => {
    const landscape = frameSubject(scheduleBoard, 42, 1.6);
    const phone = frameSubject(scheduleBoard, PHONE.fov, PHONE.aspect, sheet(scheduleBoard));
    // Round 2 fitted 8 m across a 0.46 frame: ≈ 22.8 m back. Now bounded.
    expect(phone.distance).toBeLessThan(17);
    expect(phone.distance).toBeGreaterThan(landscape.distance);
    // Landscape framing is unchanged by the portrait cap.
    const across = 8 / (2 * landscape.distance * Math.tan((42 * Math.PI) / 360) * 1.6);
    expect(across).toBeGreaterThan(0.7);
    expect(across).toBeLessThan(0.85);
  });

  it('steps at most 0.75 m per 60 fps frame, in and out, for any travel', () => {
    const dt = 1 / 60;
    for (const travel of [2, 6, 12, 18, 25, 40]) {
      for (const [from, to] of [[0, 1], [1, 0]] as const) {
        let blend: number = from;
        let previous = focusBlendCurve(blend) * travel;
        let worst = 0;
        for (let frame = 0; frame < 60 * 10; frame += 1) {
          blend = dampToward(blend, to, focusBlendRate(travel), dt);
          const position = focusBlendCurve(blend) * travel;
          worst = Math.max(worst, Math.abs(position - previous));
          previous = position;
        }
        expect(worst).toBeLessThanOrEqual(0.75);
        expect(worst).toBeLessThanOrEqual(FOCUS_MAX_STEP_M + 0.05);
        // And it still arrives: within 2 % of the travel after 10 s.
        expect(Math.abs(focusBlendCurve(blend) - to)).toBeLessThan(0.02);
      }
    }
    // Short blends keep the original damping.
    expect(focusBlendRate(3)).toBe(FOCUS_DAMPING);
  });
  it('clamps every composed focus step to 0.6 m, with a concurrent cross-blend (r4)', () => {
    // The rig's composition, reduced to positions: station S, subject A at
    // `travel` metres, subject B tapped mid-approach (cross-blend from the
    // pose on screen), then released back to the station. Every rendered
    // step must stay ≤ FOCUS_MAX_STEP_M at 60 Hz — the r3 panel sweeps
    // measured 0.76–0.87 m without the clamp.
    type V = { x: number; y: number; z: number };
    const lerp = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const dt of [1 / 60, 1 / 30]) {
      const cap = FOCUS_MAX_STEP_M * Math.min(1, dt * 60) + 1e-9;
      for (const travel of [10, 14, 20]) {
        const station: V = { x: 0, y: 3, z: 0 };
        const a: V = { x: travel, y: 2, z: -3 };
        const b: V = { x: -travel * 0.8, y: 2.5, z: -travel * 0.5 };
        let blend = 0;
        let cross = 1;
        let crossFrom: V = station;
        let subject = a;
        let rendered: V = { ...station };
        let lagging = false;
        let worst = 0;
        for (let frame = 0; frame < 60 * 20; frame += 1) {
          const t = frame * dt;
          if (t >= 0.35 && subject === a) {
            subject = b;
            crossFrom = { ...rendered };
            cross = 0;
          }
          const want = t < 8 ? 1 : 0;
          blend = dampToward(blend, want, focusBlendRate(dist(station, subject)), dt);
          const blended = lerp(station, subject, focusBlendCurve(blend));
          let out = blended;
          if (cross < 1) {
            cross = dampToward(cross, 1, focusBlendRate(dist(crossFrom, blended)), dt);
            if (cross > 1 - 0.004) cross = 1;
            out = lerp(crossFrom, blended, focusBlendCurve(cross));
          }
          const next = { ...out };
          if (blend > 0.004 || cross < 1 || lagging) lagging = clampFocusStep(rendered, out, dt, next);
          else lagging = false;
          worst = Math.max(worst, dist(rendered, next));
          rendered = next;
        }
        expect(worst).toBeLessThanOrEqual(cap);
        // It still arrives back at the station after the release.
        expect(dist(rendered, station)).toBeLessThan(0.05);
      }
    }
  });

  it('clampFocusStep passes short steps through and aliases safely', () => {
    const target = { x: 0.3, y: 0, z: 0 };
    expect(clampFocusStep({ x: 0, y: 0, z: 0 }, target, 1 / 60, target)).toBe(false);
    expect(target.x).toBeCloseTo(0.3);
    const far = { x: 3, y: 4, z: 0 };
    expect(clampFocusStep({ x: 0, y: 0, z: 0 }, far, 1 / 60, far)).toBe(true);
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(FOCUS_MAX_STEP_M, 9);
    expect(far.x / far.y).toBeCloseTo(0.75, 9);
  });

  it('a frame with no time (dt 0, negative or NaN) holds the rendered position, never snaps to the target (PR #65 review)', () => {
    // dt 0 is a real frame: the frame-cap driver's first frame after an unpark, the capture pin's advance.
    for (const dt of [0, -1 / 60, Number.NaN]) {
      expect(focusStepLimit(dt), String(dt)).toBe(0);
      const far = { x: 3, y: 4, z: 0 };
      expect(clampFocusStep({ x: 1, y: 2, z: 3 }, far, dt, far), String(dt)).toBe(true);
      expect(far, String(dt)).toEqual({ x: 1, y: 2, z: 3 });
      // Already there: nothing held back, not lagging.
      const here = { x: 1, y: 2, z: 3 };
      expect(clampFocusStep({ x: 1, y: 2, z: 3 }, here, dt, here), String(dt)).toBe(false);
    }
    // A normal frame is unchanged: 0.6 m per 1/60 s, at most 0.6 m per frame.
    expect(focusStepLimit(1 / 60)).toBeCloseTo(FOCUS_MAX_STEP_M, 12);
    expect(focusStepLimit(1 / 120)).toBeCloseTo(FOCUS_MAX_STEP_M / 2, 12);
    expect(focusStepLimit(0.5)).toBe(FOCUS_MAX_STEP_M);
  });
});
