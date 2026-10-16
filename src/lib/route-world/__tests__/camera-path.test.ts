import { describe, expect, it } from 'vitest';
import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import {
  blendPoses,
  buildPoseLedger,
  createPose,
  isSkipJump,
  pullbackForAspect,
  samplePath,
  skipWeight,
  stationCrossfade,
  stepTurnLimiter,
  yawOf,
  type CameraPose,
  type TurnStep,
  type PoseLedger,
} from '../camera-path';
import type { RouteStation } from '../chapters';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import { SAKURA_STATIONS } from '@/components/world/themes/sakura/theme';
import { MOUNTAIN_STATIONS } from '@/components/world/themes/mountain/theme';
import { CLOUDS_STATIONS } from '@/components/world/themes/clouds/theme';

const THEMES: Record<string, readonly RouteStation[]> = {
  plaza: PLAZA_STATIONS,
  sakura: SAKURA_STATIONS,
  mountain: MOUNTAIN_STATIONS,
  clouds: CLOUDS_STATIONS,
};
const ASPECTS = [2.0, 1.6, 1.0, 0.46] as const;
const LEDGERS = [false, true] as const; // desktop, mobile endpoints

/**
 * The pre-W6 CameraRig pose math, verbatim (CameraRig.tsx before the
 * camera-path extraction): lerped pullback axis, Camera.lookAt quaternions.
 */
function legacyPose(stations: readonly RouteStation[], mobile: boolean, station: number, aspect: number) {
  const ep = (s: RouteStation) => (mobile ? s.cameraMobile : s.camera);
  const positions = stations.map((s) => new Vector3(...ep(s).position));
  const targets = stations.map((s) => new Vector3(...ep(s).target));
  const look = new PerspectiveCamera();
  const quaternions = stations.map((_, i) => {
    look.position.copy(positions[i]);
    look.lookAt(targets[i]);
    return look.quaternion.clone();
  });
  const fovs = stations.map((s) => ep(s).fov);
  const last = stations.length - 1;
  const st = MathUtils.clamp(station, 0, last);
  const lower = Math.min(Math.floor(st), last - 1);
  const local = st >= last ? 1 : st - Math.floor(st);
  const eased = local * local * (3 - 2 * local);
  const position = new Vector3().lerpVectors(positions[lower], positions[lower + 1], eased);
  const target = new Vector3().lerpVectors(targets[lower], targets[lower + 1], eased);
  const pullback = MathUtils.clamp(1.6 / Math.max(aspect, 0.2) - 1, 0, 1) * 9.75;
  if (pullback > 0) {
    const forward = new Vector3().subVectors(position, target).normalize();
    position.addScaledVector(forward, pullback);
  }
  const quat = new Quaternion().slerpQuaternions(quaternions[lower], quaternions[lower + 1], eased);
  const fov = MathUtils.lerp(fovs[lower], fovs[lower + 1], eased);
  return { position, quat, fov };
}

const SAMPLES = 480;
/** Allowed height reversal inside one crossing (m). */
const HEIGHT_EPS = 0.05;

interface CrossingTrace {
  y: number[];
  yaw: number[];
  pos: Vector3[];
  quat: Quaternion[];
}

function traceCrossing(ledger: PoseLedger, from: number, aspect: number): CrossingTrace {
  const pose = createPose();
  const trace: CrossingTrace = { y: [], yaw: [], pos: [], quat: [] };
  for (let i = 0; i <= SAMPLES; i += 1) {
    samplePath(ledger, from + i / SAMPLES, aspect, pose);
    trace.y.push(pose.position.y);
    trace.yaw.push(yawOf(pose.quaternion));
    trace.pos.push(pose.position.clone());
    trace.quat.push(pose.quaternion.clone());
  }
  return trace;
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Largest retreat from the running extreme in the crossing's net direction. */
function heightReversal(y: readonly number[]): number {
  const dir = y[y.length - 1] >= y[0] ? 1 : -1;
  let extreme = y[0];
  let worst = 0;
  for (const v of y) {
    if ((v - extreme) * dir > 0) extreme = v;
    worst = Math.max(worst, (extreme - v) * dir);
  }
  // A bulge past the far endpoint also reads as up-then-down.
  const far = y[y.length - 1];
  const peak = dir > 0 ? Math.max(...y) : Math.min(...y);
  return Math.max(worst, (peak - far) * dir);
}

describe('camera path endpoints (frozen — no-closer-camera)', () => {
  it.each(Object.keys(THEMES))('%s: every integer station is bit-identical to the legacy rig', (theme) => {
    const stations = THEMES[theme];
    for (const mobile of LEDGERS) {
      const ledger = buildPoseLedger(stations, mobile);
      const pose = createPose();
      for (const aspect of ASPECTS) {
        for (let station = 0; station < stations.length; station += 1) {
          const legacy = legacyPose(stations, mobile, station, aspect);
          samplePath(ledger, station, aspect, pose);
          expect(pose.position.toArray()).toEqual(legacy.position.toArray());
          expect(pose.quaternion.toArray()).toEqual(legacy.quat.toArray());
          expect(pose.fov).toBe(legacy.fov);
          // Exact bitwise equality, not closeness.
          pose.position.toArray().forEach((v, k) => expect(Object.is(v, legacy.position.toArray()[k])).toBe(true));
        }
      }
    }
  });

  it('keeps the legacy eye path and lens everywhere on the composed aspect (no pullback)', () => {
    // W6 round 2 re-shaped only the in-between ORIENTATION (heading on the
    // rate-limited turn ease); position and fov still ride the legacy path.
    const ledger = buildPoseLedger(PLAZA_STATIONS, false);
    const pose = createPose();
    for (let s = 0; s <= 4; s += 0.037) {
      const legacy = legacyPose(PLAZA_STATIONS, false, s, 1.6);
      samplePath(ledger, s, 1.6, pose);
      expect(pose.position.distanceTo(legacy.position)).toBeLessThan(1e-12);
      expect(pose.fov).toBeCloseTo(legacy.fov, 12);
    }
  });

  it('pullback is 0 at and above the composed aspect, full on phones', () => {
    expect(pullbackForAspect(2)).toBe(0);
    expect(pullbackForAspect(1.6)).toBe(0);
    expect(pullbackForAspect(0.46)).toBe(9.75);
  });
});

describe('camera crossing harness (bar W6) — 4 themes × 2 ledgers × 4 aspects', () => {
  for (const theme of Object.keys(THEMES)) {
    const stations = THEMES[theme];
    for (const mobile of LEDGERS) {
      const ledger = buildPoseLedger(stations, mobile);
      for (const aspect of ASPECTS) {
        const label = `${theme} ${mobile ? 'mobile' : 'desktop'} @${aspect}`;
        it(`${label}: yaw never reverses, height never reverses, pose continuous`, () => {
          for (let from = 0; from < stations.length - 1; from += 1) {
            const trace = traceCrossing(ledger, from, aspect);
            const where = `${label} ${stations[from].id}→${stations[from + 1].id}`;

            // Yaw derivative keeps one sign through the crossing.
            let sign = 0;
            for (let i = 1; i <= SAMPLES; i += 1) {
              const d = wrap(trace.yaw[i] - trace.yaw[i - 1]);
              if (Math.abs(d) < 1e-9) continue;
              const s = Math.sign(d);
              if (sign === 0) sign = s;
              expect(s, `${where} yaw reverses at sample ${i}`).toBe(sign);
            }

            // Height: no up-then-down (or down-then-up) beyond HEIGHT_EPS.
            expect(heightReversal(trace.y), `${where} height reversal`).toBeLessThan(HEIGHT_EPS);

            // Continuity: no sample step larger than a few times the mean.
            let total = 0;
            let maxStep = 0;
            let maxTurn = 0;
            for (let i = 1; i <= SAMPLES; i += 1) {
              const step = trace.pos[i].distanceTo(trace.pos[i - 1]);
              total += step;
              maxStep = Math.max(maxStep, step);
              maxTurn = Math.max(maxTurn, trace.quat[i].angleTo(trace.quat[i - 1]));
            }
            expect(maxStep, `${where} position jump`).toBeLessThan((total / SAMPLES) * 4 + 1e-6);
            expect(maxTurn, `${where} orientation jump`).toBeLessThan(0.02);
          }
        });
      }
    }
  }

  it('the legacy lerped axis DID hop on roster→teams (regression guard for the harness itself)', () => {
    let worst = 0;
    for (let i = 0; i <= SAMPLES; i += 1) {
      worst = Math.max(worst, legacyPose(PLAZA_STATIONS, false, 1 + i / SAMPLES, 0.46).position.y);
    }
    const ends = Math.max(
      legacyPose(PLAZA_STATIONS, false, 1, 0.46).position.y,
      legacyPose(PLAZA_STATIONS, false, 2, 0.46).position.y,
    );
    expect(worst - ends).toBeGreaterThan(5);
  });
});

describe('crossing yaw rate (W6 round 2 — no whiplash on the big authored swings)', () => {
  /** Bar: max |dYaw/dProgress| ≤ 1.3 × |Δyaw of the segment|. */
  const RATE_BAR = 1.3;

  for (const theme of Object.keys(THEMES)) {
    const stations = THEMES[theme];
    for (const mobile of LEDGERS) {
      const ledger = buildPoseLedger(stations, mobile);
      for (const aspect of [0.46, 1.6] as const) {
        const label = `${theme} ${mobile ? 'mobile' : 'desktop'} @${aspect}`;
        it(`${label}: every crossing's peak yaw rate stays within ${RATE_BAR}× its average`, () => {
          for (let from = 0; from < stations.length - 1; from += 1) {
            const trace = traceCrossing(ledger, from, aspect);
            const where = `${label} ${stations[from].id}→${stations[from + 1].id}`;
            let total = 0;
            let peak = 0;
            for (let i = 1; i <= SAMPLES; i += 1) {
              const d = wrap(trace.yaw[i] - trace.yaw[i - 1]);
              total += d;
              peak = Math.max(peak, Math.abs(d) * SAMPLES);
            }
            // A crossing with no net turn has nothing to spread.
            if (Math.abs(total) < 1e-6) continue;
            expect(peak, `${where} peak dYaw/dProgress`).toBeLessThanOrEqual(RATE_BAR * Math.abs(total) + 1e-6);
          }
        });
      }
    }
  }

  it('the legacy slerp exceeded the bar on roster→teams (regression guard for the measure itself)', () => {
    let worst = 0;
    for (const theme of Object.keys(THEMES)) {
      const stations = THEMES[theme];
      let total = 0;
      let peak = 0;
      let last = yawOf(legacyPose(stations, false, 1, 0.46).quat);
      for (let i = 1; i <= SAMPLES; i += 1) {
        const yaw = yawOf(legacyPose(stations, false, 1 + i / SAMPLES, 0.46).quat);
        const d = wrap(yaw - last);
        total += d;
        peak = Math.max(peak, Math.abs(d) * SAMPLES);
        last = yaw;
      }
      worst = Math.max(worst, peak / Math.abs(total));
    }
    expect(worst).toBeGreaterThan(1.3);
  });
});

describe('skip-through helpers', () => {
  it('detects only programmatic multi-station jumps', () => {
    expect(isSkipJump(0.1, 4, 0.1)).toBe(true); // nav chip pulse → rules
    expect(isSkipJump(1, 3, 1)).toBe(true);
    expect(isSkipJump(1, 2, 1)).toBe(false); // single station: normal path
    expect(isSkipJump(1, 2.22, 1)).toBe(false); // teams chip lands 0.22 past teams
    expect(isSkipJump(0.993, 3, 0.993)).toBe(true); // roster → schedule
    expect(isSkipJump(1.0, 1.03, 0.2)).toBe(false); // wheel step while lagging
    expect(isSkipJump(3, 0, 3)).toBe(true); // Home
  });

  it('skipWeight rises monotonically from 0 to 1 with zero start velocity', () => {
    let prev = 0;
    for (let s = 0; s <= 4; s += 0.01) {
      const w = skipWeight(0, 4, s);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(skipWeight(0, 4, 0)).toBe(0);
    expect(skipWeight(0, 4, 4)).toBe(1);
    expect(skipWeight(4, 0, 0)).toBe(1);
    expect(skipWeight(4, 0, 2)).toBeCloseTo(0.5, 12);
    expect(skipWeight(0, 4, 1e-3)).toBeLessThan(1e-6);
  });

  it('a skip blend from pulse to rules turns one way and never reverses height', () => {
    for (const theme of Object.keys(THEMES)) {
      const ledger = buildPoseLedger(THEMES[theme], false);
      const from = samplePath(ledger, 0, 1.0, createPose());
      const to = samplePath(ledger, 4, 1.0, createPose());
      const out: CameraPose = createPose();
      let sign = 0;
      let lastYaw = yawOf(from.quaternion);
      const ys: number[] = [];
      for (let i = 1; i <= 200; i += 1) {
        blendPoses(from, to, skipWeight(0, 4, (4 * i) / 200), out);
        const yaw = yawOf(out.quaternion);
        const d = wrap(yaw - lastYaw);
        if (Math.abs(d) > 1e-9) {
          if (sign === 0) sign = Math.sign(d);
          expect(Math.sign(d)).toBe(sign);
        }
        lastYaw = yaw;
        ys.push(out.position.y);
      }
      expect(heightReversal(ys)).toBeLessThan(1e-9);
      expect(out.position.distanceTo(to.position)).toBeLessThan(1e-9);
    }
  });
});

describe('stationCrossfade', () => {
  it('holds each station unblended near its integer and glides between', () => {
    const out = { lower: 0, upper: 0, weight: 0 };
    expect(stationCrossfade(1, 5, out)).toEqual({ lower: 1, upper: 2, weight: 0 });
    expect(stationCrossfade(1.15, 5, out).weight).toBe(0);
    expect(stationCrossfade(1.85, 5, out).weight).toBe(1);
    expect(stationCrossfade(1.5, 5, out).weight).toBeCloseTo(0.5, 12);
    expect(stationCrossfade(4, 5, out)).toEqual({ lower: 3, upper: 4, weight: 1 });
    expect(stationCrossfade(0.993, 5, out)).toEqual({ lower: 0, upper: 1, weight: 1 });
    let prev = -1;
    for (let s = 0; s <= 4; s += 0.001) {
      const { lower, weight } = stationCrossfade(s, 5, out);
      const value = lower + weight;
      expect(value).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = value;
    }
  });
});

describe('turn-rate limiter step (review r5 — probe lastTurnDeltaRad / lastDt)', () => {
  const rate = MathUtils.degToRad(200);

  it('reports the angle it actually turned and the dt it used, every limited frame', () => {
    const limited = new Quaternion();
    const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(177));
    const step: TurnStep = { deltaRad: null, dt: 0 };
    const deltas: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const dt = i % 2 === 0 ? 1 / 60 : 1 / 30;
      stepTurnLimiter(limited, target, rate, dt, false, step);
      expect(step.dt).toBe(dt);
      expect(step.deltaRad).not.toBeNull();
      deltas.push(step.deltaRad ?? 0);
      // Never faster than the ceiling.
      expect((step.deltaRad ?? 0) / dt).toBeLessThanOrEqual(rate * 1.0001);
      // While far from the target the step is exactly the ceiling.
      expect((step.deltaRad ?? 0) / dt).toBeCloseTo(rate, 3);
    }
    // The fields change frame to frame (the probe is live, not a constant).
    expect(new Set(deltas.map((d) => d.toFixed(6))).size).toBeGreaterThan(1);
  });

  it('stops at the target and reports a zero turn once there', () => {
    const limited = new Quaternion();
    const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(2));
    const step: TurnStep = { deltaRad: null, dt: 0 };
    stepTurnLimiter(limited, target, rate, 1 / 60, false, step);
    expect(limited.angleTo(target)).toBeLessThan(1e-6);
    expect(step.deltaRad).toBeCloseTo(MathUtils.degToRad(2), 5);
    stepTurnLimiter(limited, target, rate, 1 / 60, false, step);
    expect(step.deltaRad).toBeCloseTo(0, 6);
  });

  it('a snap frame copies the target and publishes a null turn (not a rate-limited step)', () => {
    const limited = new Quaternion();
    const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2);
    const step: TurnStep = { deltaRad: 0.1, dt: 0 };
    stepTurnLimiter(limited, target, rate, 1 / 60, true, step);
    expect(limited.angleTo(target)).toBeLessThan(1e-6);
    expect(step.deltaRad).toBeNull();
    expect(step.dt).toBeCloseTo(1 / 60, 9);
  });
});
