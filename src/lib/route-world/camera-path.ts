/**
 * Camera path — the station-to-station pose math the rig runs every frame
 * (bar W6 + W1 mid-crossing composition, decision D6).
 *
 * Between two adjacent frozen endpoints the eye position and the fov lerp on
 * a smoothstep of the local progress, and the orientation turns from one
 * precomputed look quaternion to the next by heading + pitch on the
 * rate-limited turn ease (W6 round 2, below). On viewports narrower than
 * the composed aspect the eye then dollies back along its view axis
 * (MAX_PULLBACK).
 *
 * The pullback axis is the INTERPOLATED orientation's backward (+Z) vector. It
 * used to be normalize(lerp(position) − lerp(target)); on the roster → teams
 * crossing (a 176° swing in every theme) that lerped axis passes through
 * vertical mid-way, lifting the camera ~8 m and dropping it back on every
 * aspect < 1.6 — a mid-gesture up/down reversal. The slerped axis stays
 * horizontal-ish and turns with the view, so the crossing reads as one turn.
 * At integer progress the legacy axis is used verbatim, so every frozen
 * endpoint (CONFIG `no-closer-camera`) is bit-identical to the old rig — the
 * two axes agree there to rounding anyway, since a look quaternion's +Z IS
 * the normalized eye − target.
 *
 * W6 round 2 (yaw whiplash): the orientation no longer slerps. The shortest
 * 3D arc between two look quaternions ~177° apart (roster → teams) tips
 * through a steep pitch mid-way, where the HEADING changes several times
 * faster than the segment average — measured peaks of 400–790°/s at 390.
 * The in-between orientation is now built from heading and pitch
 * interpolated separately (zero roll, exactly what `Camera.lookAt` with
 * world up produces) — pitch on the position's smoothstep, heading on
 * `crossingTurnEase`: C1 quadratic ramps with a
 * constant-rate middle, so |d(yaw)/d(progress)| never exceeds
 * 1 / (1 − TURN_EASE_FRACTION) = 1.25 × the segment's total yaw change
 * (tested ≤ 1.3×). The turn keeps the direction the slerp
 * took (the authored S-curve through the front, D6/EVIDENCE); position and
 * fov keep the legacy smoothstep, and integer progress still returns the
 * ledger quaternion verbatim, so every frozen endpoint is unchanged.
 *
 * Also here: the multi-station skip-through (a nav jump blends directly in
 * pose space instead of flying every intermediate crossing) and the station
 * crossfade weight the per-station lights share.
 *
 * `three` is used only as a math library (no renderer, no DOM), so this stays
 * node-testable. Every function writes into caller-owned outputs — the rig
 * calls these per frame and must not allocate.
 */

import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { endpointFor, type RouteStation } from './chapters';
import { plateauEase } from './scroll-map';

/** Aspect the endpoints were composed against. Narrower screens pull back. */
export const COMPOSED_ASPECT = 1.6;

/**
 * Maximum extra dolly on a tall screen, in world units. 768×1024 (aspect
 * 0.75) and 390×844 both clamp to the full pullback; 9.75 m holds the frozen
 * desktop endpoints' heroes in the 55–65 % band at 768 (C-031 measured:
 * pulse/schedule 63 %, roster 57 %, teams 56 %; rules lands ≈ 69 % — the
 * far gate cannot reach 65 % without pushing roster/teams under 55). The
 * 390 poses are re-authored against this value in the theme's station ledger
 * (`cameraMobile` + pullback = the landed pose).
 */
export const MAX_PULLBACK = 9.75;

/**
 * A programmatic jump must span MORE than this many stations — counted
 * between the nearest stations of the rendered (smooth) position and of the
 * target — to skip through. A single-station move (roster → teams, even when
 * its start-aligned landing sits 0.22 into the next crossing) keeps the
 * normal authored crossing.
 */
export const SKIP_MIN_SPAN = 1;

/**
 * Minimum change of `exact` within ONE scroll sample for the move to count as
 * programmatic (anchor / nav chip / hash / Home-End). A wheel or touch scroll
 * advances a few percent of a station per event, never half of one.
 */
export const SKIP_MIN_SAMPLE_STEP = 0.5;

export interface PoseLedger {
  positions: Vector3[];
  targets: Vector3[];
  /** Camera look quaternions (local −Z at the target), as `Camera.lookAt` builds them. */
  quaternions: Quaternion[];
  fovs: number[];
}

export interface CameraPose {
  position: Vector3;
  quaternion: Quaternion;
  fov: number;
}

export function createPose(): CameraPose {
  return { position: new Vector3(), quaternion: new Quaternion(), fov: 45 };
}

export function copyPose(from: CameraPose, to: CameraPose): CameraPose {
  to.position.copy(from.position);
  to.quaternion.copy(from.quaternion);
  to.fov = from.fov;
  return to;
}

const UP = new Vector3(0, 1, 0);
const _m = new Matrix4();
const _euler = new Euler(0, 0, 0, 'YXZ');
const _slerp = new Quaternion();
const _axis = new Vector3();
const _target = new Vector3();
const _forward = new Vector3();

/**
 * Precompute the endpoint poses of a station ledger. The look quaternion is
 * built exactly as `Camera.lookAt` builds it (Matrix4.lookAt with the world
 * up, then setFromRotationMatrix) — `Object3D.lookAt` would aim +Z and turn
 * the rig around to face the plaza / rules gate.
 */
export function buildPoseLedger(stations: readonly RouteStation[], mobile: boolean): PoseLedger {
  const positions = stations.map((station) => new Vector3(...endpointFor(station, mobile).position));
  const targets = stations.map((station) => new Vector3(...endpointFor(station, mobile).target));
  const quaternions = stations.map((_, index) =>
    new Quaternion().setFromRotationMatrix(_m.lookAt(positions[index], targets[index], UP)),
  );
  return {
    positions,
    targets,
    quaternions,
    fovs: stations.map((station) => endpointFor(station, mobile).fov),
  };
}

/** Dolly-back distance for a viewport aspect (0 at and above COMPOSED_ASPECT). */
export function pullbackForAspect(aspect: number): number {
  return MathUtils.clamp(COMPOSED_ASPECT / Math.max(aspect, 0.2) - 1, 0, 1) * MAX_PULLBACK;
}

/** The smoothstep every crossing uses on its local progress. */
export function crossingEase(local: number): number {
  return local * local * (3 - 2 * local);
}

/**
 * Share of a crossing over which the TURN rate ramps up (and down again).
 * The peak rate of `crossingTurnEase` is 1 / (1 − k) × the average: 1.25× at
 * k = 0.2 (the W6 round-2 bar is ≤ 1.3×; smoothstep peaks at 1.5×).
 */
export const TURN_EASE_FRACTION = 0.2;

/** The turn ease: C1, monotone, 0 → 1, peak slope 1 / (1 − TURN_EASE_FRACTION). */
export function crossingTurnEase(local: number): number {
  return plateauEase(local, true, true, TURN_EASE_FRACTION);
}

/** Heading (yaw, `yawOf` convention) and pitch of a look quaternion. */
function headingPitch(quaternion: Quaternion): { yaw: number; pitch: number } {
  _forward.set(0, 0, -1).applyQuaternion(quaternion);
  return {
    yaw: Math.atan2(-_forward.x, -_forward.z),
    pitch: Math.asin(MathUtils.clamp(_forward.y, -1, 1)),
  };
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** One crossing's turn: start heading/pitch and the signed changes. */
interface SegmentTurn {
  yaw: number;
  pitch: number;
  dYaw: number;
  dPitch: number;
}

const turnCache = new WeakMap<PoseLedger, SegmentTurn[]>();

/**
 * Per-segment turns, computed once per ledger. The yaw direction is the one
 * the legacy slerp turned (its mid-crossing heading picks between the two
 * ways round), so the authored S-curve keeps its side of the plaza.
 */
export function segmentTurns(ledger: PoseLedger): readonly SegmentTurn[] {
  const cached = turnCache.get(ledger);
  if (cached) return cached;
  const turns: SegmentTurn[] = [];
  for (let i = 0; i < ledger.quaternions.length - 1; i += 1) {
    const a = headingPitch(ledger.quaternions[i]);
    const b = headingPitch(ledger.quaternions[i + 1]);
    const short = wrapAngle(b.yaw - a.yaw);
    const other = short > 0 ? short - 2 * Math.PI : short + 2 * Math.PI;
    _slerp.slerpQuaternions(ledger.quaternions[i], ledger.quaternions[i + 1], 0.5);
    const mid = headingPitch(_slerp).yaw;
    const offShort = Math.abs(wrapAngle(a.yaw + short / 2 - mid));
    const offOther = Math.abs(wrapAngle(a.yaw + other / 2 - mid));
    turns.push({ yaw: a.yaw, pitch: a.pitch, dYaw: offOther < offShort ? other : short, dPitch: b.pitch - a.pitch });
  }
  turnCache.set(ledger, turns);
  return turns;
}

/**
 * The route pose at `station` (station units, clamped to the route) for a
 * viewport `aspect`, written into `out`.
 */
export function samplePath(ledger: PoseLedger, station: number, aspect: number, out: CameraPose): CameraPose {
  const count = ledger.positions.length;
  if (count === 0) return out;
  if (count === 1) {
    out.position.copy(ledger.positions[0]);
    out.quaternion.copy(ledger.quaternions[0]);
    out.fov = ledger.fovs[0];
    const pullback = pullbackForAspect(aspect);
    if (pullback > 0) {
      _axis.subVectors(ledger.positions[0], ledger.targets[0]).normalize();
      out.position.addScaledVector(_axis, pullback);
    }
    return out;
  }

  const last = count - 1;
  const s = MathUtils.clamp(station, 0, last);
  const lower = Math.min(Math.floor(s), last - 1);
  const local = s >= last ? 1 : s - Math.floor(s);
  const eased = crossingEase(local);
  const turn = crossingTurnEase(local);

  out.position.lerpVectors(ledger.positions[lower], ledger.positions[lower + 1], eased);
  if (eased === 0 || eased === 1) {
    // Endpoint: the legacy slerp call, operation for operation, so the
    // frozen poses stay bit-identical (sign included).
    out.quaternion.slerpQuaternions(ledger.quaternions[lower], ledger.quaternions[lower + 1], eased);
  } else {
    // Heading on the turn ease; pitch on the position's smoothstep, so the
    // pullback's vertical share tracks the eye height it rides on and the
    // crossing keeps its no-height-reversal guarantee.
    const t = segmentTurns(ledger)[lower];
    _euler.set(t.pitch + t.dPitch * eased, t.yaw + t.dYaw * turn, 0, 'YXZ');
    out.quaternion.setFromEuler(_euler);
  }

  // Tall or narrow viewports lose the sides of every composition, so dolly
  // back along the view axis rather than widening the lens further —
  // widening would distort the architecture that carries the art direction.
  const pullback = pullbackForAspect(aspect);
  if (pullback > 0) {
    if (eased === 0 || eased === 1) {
      // Endpoint: the legacy lerped axis, operation for operation, so the
      // frozen poses stay bit-identical.
      _target.lerpVectors(ledger.targets[lower], ledger.targets[lower + 1], eased);
      _axis.subVectors(out.position, _target).normalize();
    } else {
      _axis.set(0, 0, 1).applyQuaternion(out.quaternion);
    }
    out.position.addScaledVector(_axis, pullback);
  }

  out.fov = MathUtils.lerp(ledger.fovs[lower], ledger.fovs[lower + 1], eased);
  return out;
}

/** Position lerp, shortest-arc slerp, fov lerp — `t` in 0..1. */
export function blendPoses(a: CameraPose, b: CameraPose, t: number, out: CameraPose): CameraPose {
  out.position.lerpVectors(a.position, b.position, t);
  out.quaternion.slerpQuaternions(a.quaternion, b.quaternion, t);
  out.fov = MathUtils.lerp(a.fov, b.fov, t);
  return out;
}

/**
 * Heading of a camera orientation in radians: the angle of its view vector
 * (local −Z) around world +Y, measured from −Z toward −X (three's yaw sign).
 */
export function yawOf(quaternion: Quaternion): number {
  _forward.set(0, 0, -1).applyQuaternion(quaternion);
  return Math.atan2(-_forward.x, -_forward.z);
}

// ── Turn-rate limiter (the rig's rendered orientation) ──────────────────────

/**
 * What one limiter step did — published on the rig's debug probe
 * (`lastTurnDeltaRad` / `lastDt`, review r5) so the harness reads the
 * limiter's own turn rate instead of inferring it from rendered heading.
 * `deltaRad` is null on a snap frame (first frame, a deliberate conductor
 * settle, a live focus owning the camera): those are not rate-limited turns.
 */
export interface TurnStep {
  deltaRad: number | null;
  dt: number;
}

const _turnPrevious = new Quaternion();

/**
 * Move `limited` toward `target` by at most `maxRate × dt` radians on the
 * shortest arc (or copy it outright when `snap`), and report the step.
 */
export function stepTurnLimiter(
  limited: Quaternion,
  target: Quaternion,
  maxRate: number,
  dt: number,
  snap: boolean,
  out: TurnStep,
): TurnStep {
  out.dt = dt;
  if (snap) {
    limited.copy(target);
    out.deltaRad = null;
    return out;
  }
  _turnPrevious.copy(limited);
  limited.rotateTowards(target, maxRate * dt);
  out.deltaRad = _turnPrevious.angleTo(limited);
  return out;
}

// ── Multi-station skip-through ──────────────────────────────────────────────

/**
 * Whether a conductor sample is a programmatic multi-station jump: `exact`
 * moved at least SKIP_MIN_SAMPLE_STEP in one sample AND the rendered
 * position (`smooth`) is more than SKIP_MIN_SPAN stations from the target.
 */
export function isSkipJump(previousExact: number, exact: number, smooth: number): boolean {
  return (
    Math.abs(exact - previousExact) >= SKIP_MIN_SAMPLE_STEP &&
    Math.abs(Math.round(exact) - Math.round(smooth)) > SKIP_MIN_SPAN
  );
}

/**
 * Blend weight of a skip-through, driven by the conductor's own damped
 * channel rather than a second clock: the fraction of the jump `smooth` has
 * covered, smoothstepped so the blend leaves the start pose with zero
 * velocity. It lands exactly when the conductor lands, so the world-state
 * channels (fog, key light, particles), which also read `smooth`, arrive
 * together with the camera.
 */
export function skipWeight(from: number, to: number, smooth: number): number {
  const span = to - from;
  if (Math.abs(span) < 1e-9) return 1;
  return crossingEase(MathUtils.clamp((smooth - from) / span, 0, 1));
}

// ── Station crossfade ───────────────────────────────────────────────────────

export interface StationCrossfade {
  lower: number;
  upper: number;
  /** Weight of `upper`, 0..1. */
  weight: number;
}

/**
 * Crossfade between the two stations around `position`. Within `hold` of
 * either integer the weight is exactly 0 or 1 — a station's own values stand
 * unblended at and near its frozen pose — and between those it smoothsteps,
 * so a per-station value (a key light seat) glides across the crossing
 * instead of snapping at the midpoint.
 */
export function stationCrossfade(position: number, count: number, out: StationCrossfade, hold = 0.2): StationCrossfade {
  if (count <= 1 || !Number.isFinite(position)) {
    out.lower = 0;
    out.upper = 0;
    out.weight = 0;
    return out;
  }
  const last = count - 1;
  const s = MathUtils.clamp(position, 0, last);
  const lower = Math.min(Math.floor(s), last - 1);
  const local = s - lower;
  const span = Math.max(1e-6, 1 - 2 * hold);
  out.lower = lower;
  out.upper = lower + 1;
  out.weight = crossingEase(MathUtils.clamp((local - hold) / span, 0, 1));
  return out;
}
