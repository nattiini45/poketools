/**
 * Figure behavior contract (spec 2026-09-24 §5.1; W2 living figures, W3 water
 * figures; fidelity decisions D7, D8, D10, D11).
 *
 * Pure, serializable, theme-agnostic. A theme declares a `BehaviorSpec` per
 * slot; a scene-level controller calls `stepBehavior` once per frame with the
 * R3F delta and applies the returned pose, clip and events. The state is a
 * plain object of numbers and strings (JSON round-trips), so a capture pin can
 * snapshot and replay it.
 *
 * Roles:
 *  - `stationary` — hero/statue/display subject; never moves, idle + fidgets.
 *  - `loiter`     — fixed spot, AUTHORED yaw kept, bounded seeded look arcs
 *                   (±25° by default) with idle playing. An honest look-around,
 *                   not a gait.
 *  - `patrol`     — path movement with heading that converges to the path
 *                   tangent at a max turn rate, grounded turn-in-place at
 *                   vertices (no pivot snaps) and seeded pauses.
 *  - `waterline`  — walks from its shore anchor to a water-edge point, pauses,
 *                   emits exactly ONE contact event per arrival, then retreats
 *                   (and rests) or remains, per profile.
 *  - `floating`   — buoyed bob plus slow drift inside a bounded region; emits
 *                   wake/contact events and seeded play events (breach, dive,
 *                   spin). No fabricated walking gait.
 *  - `airborne`   — hover track with a small vertical/lateral response; never
 *                   claims ground contact (`grounded: false`, no events).
 *
 * Laws this module enforces (and the old uncommitted worktree broke, D10):
 *  1. A degenerate path (one point, or shorter than `MIN_PATROL_LENGTH_M`)
 *     never patrols — it resolves to `loiter`. The old contract walked such
 *     figures in place on a treadmill forever.
 *  2. The authored yaw survives: loiter/stationary figures face `anchor.yaw`
 *     (look arcs are bounded offsets from it), including figures downgraded
 *     from patrol.
 *  3. Seeds are per SLOT (`slotSeed(species, x, z)`), never per species, so
 *     two slots of one species never share a schedule.
 *  4. `idle2` (any non-locomotion fidget clip) is reachable: stopped figures
 *     run the `idleFidgetSchedule` from `clip-phase.ts`.
 *
 * Time: every transition keys off ACCUMULATED clamped seconds (`dt` clamped to
 * `MAX_STEP_S`), never frame counts or wall-clock, so a parked
 * `frameloop="demand"` canvas resumes without bursts.
 *
 * Clip selection is EXACTLY the spec order (`selectClip`). One interpretation
 * is recorded there: at step 5 ("first available clip") a STOPPED figure skips
 * locomotion clips, because a walk/run played in place is the W2 treadmill
 * veto; with nothing left it drops to step 6, the low-motion fallback.
 *
 * Pure data — no client-only imports.
 */

import {
  createFidgetFrame,
  createFidgetPlan,
  fidgetAt,
  hash01,
  hashText,
  idleFidgetSchedule,
  isLocomotionClip,
  mix32,
  type FidgetPlan,
} from './clip-phase';
import type { FigureLifeLevel } from './quality';

export type BehaviorRole = 'stationary' | 'loiter' | 'patrol' | 'waterline' | 'floating' | 'airborne';
export type Vec2 = readonly [number, number];
export type Range = readonly [number, number];
export type PlayKind = 'breach' | 'dive' | 'spin';

/* ------------------------------------------------------------------------ */
/* Tunables                                                                 */
/* ------------------------------------------------------------------------ */

/** Largest delta one step integrates (a resumed tab never teleports). */
export const MAX_STEP_S = 0.1;
/** Grounded yaw rate (rad/s) — turning in place at a vertex. */
export const GROUND_TURN_RATE = 2.4;
/** Look-arc yaw rate (rad/s) — a head-and-shoulders glance, slower. */
export const LOOK_TURN_RATE = 0.9;
/** Swimming / hovering yaw rate (rad/s). */
export const DRIFT_TURN_RATE = 0.8;
/** Heading error below which a turn counts as done (rad). */
export const TURN_ALIGNED_RAD = 0.06;
/** Stop → idle settle window; equals Figure's clip crossfade (0.35 s). */
export const SETTLE_S = 0.35;
/** Default look-arc half-width (±25°). */
export const LOOK_ARC_RAD = (25 * Math.PI) / 180;
/** Seconds a loiterer holds one look direction. */
export const LOOK_HOLD_S: Range = [3, 7];
/** A path shorter than this is degenerate and never patrols. */
export const MIN_PATROL_LENGTH_M = 0.5;
/** Default vertex pause range for patrol / waterline (seconds). */
export const PATROL_PAUSE_S: Range = [1.5, 5];
/** Chance a patroller pauses at an INTERIOR vertex (ends always pause). */
export const INTERIOR_PAUSE_CHANCE = 0.55;
/** Default rest at the shore anchor between waterline visits (seconds). */
export const WATERLINE_REST_S: Range = [8, 16];
/** Floating/airborne drift: arrival radius and seeded hold at a goal. */
export const DRIFT_ARRIVE_M = 0.25;
export const DRIFT_HOLD_S: Range = [1, 4];
/**
 * A wake ripple every this many seconds of drifting (POKEMON-CORE C10: 1.2 s,
 * so one floater stays under the <= 1 wake per 1.2 s bar on its own; the
 * per-body token bucket is D's `createWakeLimiter`).
 */
export const WAKE_INTERVAL_S = 1.2;
/** Default seconds between floating play events. */
export const PLAY_EVERY_S: Range = [25, 60];
/** Play pass lengths (seconds). */
export const PLAY_DURATION_S: Record<PlayKind, number> = { breach: 1.6, dive: 2.4, spin: 1.4 };
/** Open-ended mode length (kept finite so the state stays JSON-safe). */
export const OPEN_ENDED_S = 1e9;

/* ------------------------------------------------------------------------ */
/* Specs                                                                    */
/* ------------------------------------------------------------------------ */

export interface BehaviorAnchor {
  x: number;
  z: number;
  /** Stand surface y (0 on the ground plane). */
  y?: number;
  /** Authored facing yaw (radians, +Z forward — `headingYaw`). */
  yaw: number;
}

interface BehaviorCommon {
  anchor: BehaviorAnchor;
  /** Clip names the model actually carries (manifest `clips`). */
  clips: readonly string[];
  /** Baked loop durations (manifest v3 `clipMeta`), when known. */
  clipDurations?: Readonly<Record<string, number>>;
  /**
   * Profile-requested clip: a locomotion clip while moving (e.g. `run` for a
   * faster gait), or a non-locomotion signature idle while stopped.
   */
  requestedClip?: string;
}

export interface StationarySpec extends BehaviorCommon {
  role: 'stationary';
}

export interface LoiterSpec extends BehaviorCommon {
  role: 'loiter';
  /** Look-arc half-width (radians); clamped to ±LOOK_ARC_RAD·1.2. */
  lookArcRad?: number;
}

export interface PatrolSpec extends BehaviorCommon {
  role: 'patrol';
  path: readonly Vec2[];
  /** Closed loops wrap; open paths ping-pong. */
  closed?: boolean;
  /** Root speed (m/s) — pick it with `walk-gait.ts matchGait`. */
  speedMps: number;
  /** Clip playback rate that matches `speedMps` (from `matchGait`). */
  locomotionTimeScale?: number;
  /** `run` asks for the faster gait (used only when the clip exists). */
  gait?: 'walk' | 'run';
  pauseS?: Range;
}

export interface WaterlineSpec extends BehaviorCommon {
  role: 'waterline';
  /** The water-edge point the figure walks to (the anchor is its shore spot). */
  edge: Vec2;
  /** After the contact: walk back and rest, or remain at the edge. */
  after: 'retreat' | 'remain';
  speedMps: number;
  locomotionTimeScale?: number;
  gait?: 'walk' | 'run';
  pauseS?: Range;
  restS?: Range;
}

export interface FloatingSpec extends BehaviorCommon {
  role: 'floating';
  /** Drift region radius around the anchor (m). */
  radiusM: number;
  /** Water surface height the figure floats at. */
  surfaceY: number;
  /** Bob amplitude (m). */
  bobM: number;
  /** Drift speed (m/s). */
  driftMps: number;
  playEveryS?: Range;
  playKinds?: readonly PlayKind[];
  /** Breach lift (m). */
  playLiftM?: number;
  /** Dive depth (m). */
  diveDepthM?: number;
  /**
   * POKEMON-CORE C10: `field` = the water field carries the float (D's
   * `buoyancyStep` on the live handle), so the synthetic bob is zeroed while
   * the handle is live (`BehaviorInput.water`); it is kept only while the
   * handle is null. `synthetic` (default) = the analytic bob.
   */
  buoyancy?: 'synthetic' | 'field';
}

export interface AirborneSpec extends BehaviorCommon {
  role: 'airborne';
  radiusM: number;
  hoverY: number;
  bobM: number;
  driftMps: number;
}

export type BehaviorSpec = StationarySpec | LoiterSpec | PatrolSpec | WaterlineSpec | FloatingSpec | AirborneSpec;

/* ------------------------------------------------------------------------ */
/* Seeds, budgets, resolution                                               */
/* ------------------------------------------------------------------------ */

/**
 * Per-SLOT seed, keyed on the SLOT ID plus its stand point (POKEMON-CORE L11:
 * never a species, so a cast change never moves a slot's schedule).
 */
export function slotSeed(slotId: string, x: number = 0, z: number = 0): number {
  return hashText(`${slotId}|${x.toFixed(2)}|${z.toFixed(2)}`);
}

export interface FigureLifeBudget {
  /** Path movement (patrol, waterline, drift) allowed at all. */
  paths: boolean;
  /** Seeded idle fidgets. */
  fidgets: boolean;
  /** Floating play events (breach/dive/spin). */
  playEvents: boolean;
  /** Loiter look arcs. */
  looks: boolean;
  /** Director ceiling on figures moving at once (Infinity = unbounded). */
  maxMovers: number;
}

/**
 * What each `QualityStep.figureLife` level allows. Buoyancy/hover bob is kept
 * at every level: it is a transform, not a draw call, and a floater without it
 * reads as standing on glass.
 */
const LIFE_BUDGETS: Readonly<Record<FigureLifeLevel, Readonly<FigureLifeBudget>>> = {
  full: Object.freeze({ paths: true, fidgets: true, playEvents: true, looks: true, maxMovers: Infinity }),
  reduced: Object.freeze({ paths: true, fidgets: true, playEvents: false, looks: true, maxMovers: 4 }),
  minimal: Object.freeze({ paths: false, fidgets: true, playEvents: false, looks: true, maxMovers: 0 }),
  static: Object.freeze({ paths: false, fidgets: false, playEvents: false, looks: false, maxMovers: 0 }),
};

/** The budget of a level: a shared frozen object, so the director's loop allocates nothing. */
export function figureLifeBudget(level: FigureLifeLevel): FigureLifeBudget {
  return LIFE_BUDGETS[level];
}

export type DowngradeReason = 'degenerate-path' | 'no-locomotion-clip';

export interface ResolvedBehavior {
  spec: BehaviorSpec;
  /** Set when the authored role could not be honoured. */
  downgraded: { from: BehaviorRole; reason: DowngradeReason } | null;
}

/** Consecutive duplicate points removed. */
function cleanPath(path: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-3) out.push(p);
  }
  return out;
}

function pathLength(path: readonly Vec2[], closed: boolean): number {
  let length = 0;
  const segments = closed ? path.length : path.length - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return length;
}

function canLocomote(spec: PatrolSpec | WaterlineSpec): boolean {
  const has = (clip: string) => spec.clips.includes(clip);
  if (spec.requestedClip && isLocomotionClip(spec.requestedClip) && has(spec.requestedClip)) return true;
  if (has('walk')) return true;
  return spec.gait === 'run' && has('run');
}

function asLoiter(spec: BehaviorSpec): LoiterSpec {
  return {
    role: 'loiter',
    anchor: spec.anchor,
    clips: spec.clips,
    clipDurations: spec.clipDurations,
    requestedClip: spec.requestedClip && !isLocomotionClip(spec.requestedClip) ? spec.requestedClip : undefined,
  };
}

/**
 * Honour the authored role only where the path and the asset support it. A
 * patrol on a degenerate path, or any path role on a model with no usable
 * locomotion clip, becomes a loiter at its AUTHORED anchor and yaw.
 */
export function resolveBehavior(spec: BehaviorSpec): ResolvedBehavior {
  if (spec.role === 'patrol') {
    const path = cleanPath(spec.path);
    const closed = spec.closed === true && path.length >= 3;
    if (path.length < 2 || pathLength(path, closed) < MIN_PATROL_LENGTH_M) {
      return { spec: asLoiter(spec), downgraded: { from: 'patrol', reason: 'degenerate-path' } };
    }
    if (!canLocomote(spec)) {
      return { spec: asLoiter(spec), downgraded: { from: 'patrol', reason: 'no-locomotion-clip' } };
    }
    return { spec: { ...spec, path, closed }, downgraded: null };
  }
  if (spec.role === 'waterline') {
    if (Math.hypot(spec.edge[0] - spec.anchor.x, spec.edge[1] - spec.anchor.z) < MIN_PATROL_LENGTH_M) {
      return { spec: asLoiter(spec), downgraded: { from: 'waterline', reason: 'degenerate-path' } };
    }
    if (!canLocomote(spec)) {
      return { spec: asLoiter(spec), downgraded: { from: 'waterline', reason: 'no-locomotion-clip' } };
    }
  }
  return { spec, downgraded: null };
}

/* ------------------------------------------------------------------------ */
/* Clip selection (spec §5.1 order)                                         */
/* ------------------------------------------------------------------------ */

export interface ClipRequest {
  clips: readonly string[];
  role: BehaviorRole;
  /** The root is translating along a ground path this frame. */
  locomotion: boolean;
  /** Clip asked for right now (profile request, or the scheduled fidget). */
  requested?: string | null;
  /** The authored profile asks for the faster gait. */
  wantsRun?: boolean;
}

export type ClipPick =
  | { clip: string; rule: 1 | 2 | 3 | 4 | 5 }
  /**
   * Rule 6, the documented low-motion fallback: no usable clip. The renderer
   * holds the rest pose (or the first frame of `freezeClip`, paused) and
   * applies the bounded breath — disclosed as a static-export behavior, never
   * a fake gait.
   */
  | { clip: null; rule: 6; freezeClip: string | null };

/**
 * 1. requested clip when present (a locomotion clip only while moving);
 * 2. `walk` when the behavior is a path role (patrol, and waterline — a path
 *    role constrained to a shore) and the root is moving;
 * 3. `run` only when the profile requests the faster gait and it exists;
 * 4. `idle` for a stopped behavior;
 * 5. the first available clip (a stopped figure skips locomotion clips);
 * 6. the low-motion fallback.
 */
export function selectClip(request: ClipRequest): ClipPick {
  const { clips, locomotion, requested } = request;
  const has = (clip: string) => clips.includes(clip);
  if (requested && has(requested) && (locomotion || !isLocomotionClip(requested))) {
    return { clip: requested, rule: 1 };
  }
  const pathRole = request.role === 'patrol' || request.role === 'waterline';
  if (locomotion && pathRole && has('walk')) return { clip: 'walk', rule: 2 };
  if (locomotion && request.wantsRun && has('run')) return { clip: 'run', rule: 3 };
  if (!locomotion && has('idle')) return { clip: 'idle', rule: 4 };
  const first = locomotion ? clips[0] : clips.find((clip) => !isLocomotionClip(clip));
  if (first) return { clip: first, rule: 5 };
  return { clip: null, rule: 6, freezeClip: clips[0] ?? null };
}

/* ------------------------------------------------------------------------ */
/* State, events, step                                                      */
/* ------------------------------------------------------------------------ */

export type BehaviorMode = 'hold' | 'look' | 'pause' | 'turn' | 'move' | 'settle' | 'drift' | 'play';

/** Serializable per-figure state (numbers and strings only). */
export interface BehaviorState {
  role: BehaviorRole;
  seed: number;
  /** Accumulated clamped seconds. */
  t: number;
  /** Base pose (bob/play offsets are applied on top in `pose`). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: BehaviorMode;
  /** Seconds spent in the current mode. */
  modeT: number;
  /** Planned length of the current mode (OPEN_ENDED_S = until an event). */
  modeS: number;
  /** Patrol: segment index; waterline: 0 outbound, 1 homebound. */
  leg: number;
  /** Patrol travel direction along an open path. */
  dir: 1 | -1;
  /** Distance travelled along the current segment. */
  u: number;
  /** Look yaw / drift or walk goal. */
  goalX: number;
  goalZ: number;
  goalYaw: number;
  /** Seeded draw counter (every random choice consumes one). */
  draws: number;
  /** Floating: accumulated time of the next play event. */
  nextPlayT: number;
  /** Floating: the play in progress ('' when none). */
  play: PlayKind | '';
  /** Floating: drift seconds since the last wake emission. */
  wakeT: number;
  /** Floating: the entry contact has been emitted. */
  entered: boolean;
  /** Bob phase offset (radians). */
  phase: number;
}

export type BehaviorEvent =
  | { kind: 'contact'; t: number; x: number; z: number; strength: number; cause: 'arrive' | 'enter' | 'splash' }
  | { kind: 'wake'; t: number; x: number; z: number; dirX: number; dirZ: number; strength: number }
  | { kind: 'play'; t: number; x: number; z: number; play: PlayKind; durationS: number };

export interface BehaviorPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** False for airborne (and for floaters: they touch water, not ground). */
  grounded: boolean;
}

export interface BehaviorInput {
  /** A spec already passed through `resolveBehavior`. */
  spec: BehaviorSpec;
  /** The rung's `figureLife` level (default `full`). */
  life?: FigureLifeLevel;
  /** The director granted this figure a mover slot (default true). */
  moverSlot?: boolean;
  /** POKEMON-CORE C10: the water handle is live (a `buoyancy: 'field'` floater drops its synthetic bob). */
  water?: boolean;
  /**
   * POKEMON-CORE A1: the loiter glance target (the active board's x/z). About
   * half of a loiterer's new holds aim at it (clamped to its arc); null or
   * absent keeps the seeded arcs around the authored yaw.
   */
  lookAt?: { x: number; z: number } | null;
}

export interface StepResult {
  state: BehaviorState;
  pose: BehaviorPose;
  clip: ClipPick;
  /** Clip playback rate (stride-matched while moving, else 1). */
  timeScale: number;
  events: BehaviorEvent[];
}

/** Wrap an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  const two = Math.PI * 2;
  let r = (a + Math.PI) % two;
  if (r < 0) r += two;
  return r - Math.PI;
}

/** Rotate `from` toward `to` along the shortest arc by at most `maxStep`. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const err = wrapAngle(to - from);
  if (Math.abs(err) <= maxStep) return wrapAngle(to);
  return wrapAngle(from + Math.sign(err) * maxStep);
}

/** Yaw that faces `(dx, dz)` for a +Z-forward model (matches `headingYaw`). */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

function rangeDraw(s: BehaviorState, range: Range, salt: number): number {
  const u = hash01(mix32(s.seed, s.draws), salt);
  s.draws += 1;
  return range[0] + (range[1] - range[0]) * u;
}

function unitDraw(s: BehaviorState, salt: number): number {
  const u = hash01(mix32(s.seed, s.draws), salt);
  s.draws += 1;
  return u;
}

/** Seeded point inside a disc (area-uniform). */
function discPoint(s: BehaviorState, cx: number, cz: number, r: number): [number, number] {
  const radius = r * Math.sqrt(unitDraw(s, 11));
  const angle = unitDraw(s, 13) * Math.PI * 2;
  return [cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius];
}

/** Segment endpoints in travel order. */
function segment(spec: PatrolSpec, leg: number, dir: 1 | -1): [Vec2, Vec2] {
  const n = spec.path.length;
  const a = spec.path[leg];
  const b = spec.path[(leg + 1) % n];
  return dir === 1 ? [a, b] : [b, a];
}

function segmentCount(spec: PatrolSpec): number {
  return spec.closed ? spec.path.length : spec.path.length - 1;
}

/** Initial state. The spec should come from `resolveBehavior`. */
export function initBehaviorState(spec: BehaviorSpec, seed: number): BehaviorState {
  const s: BehaviorState = {
    role: spec.role,
    seed: seed >>> 0,
    t: 0,
    x: spec.anchor.x,
    y: spec.anchor.y ?? 0,
    z: spec.anchor.z,
    yaw: wrapAngle(spec.anchor.yaw),
    mode: 'hold',
    modeT: 0,
    modeS: OPEN_ENDED_S,
    leg: 0,
    dir: 1,
    u: 0,
    goalX: spec.anchor.x,
    goalZ: spec.anchor.z,
    goalYaw: wrapAngle(spec.anchor.yaw),
    draws: 0,
    nextPlayT: OPEN_ENDED_S,
    play: '',
    wakeT: 0,
    entered: false,
    phase: hash01(seed, 0xb0b) * Math.PI * 2,
  };

  switch (spec.role) {
    case 'loiter':
      s.mode = 'look';
      s.modeS = rangeDraw(s, LOOK_HOLD_S, 1);
      break;
    case 'patrol': {
      // Start somewhere seeded along the path, mid-pause, so a group of
      // patrollers never sets off in lockstep.
      const segments = segmentCount(spec);
      s.leg = Math.min(Math.floor(unitDraw(s, 2) * segments), segments - 1);
      s.dir = spec.closed || unitDraw(s, 3) < 0.5 ? 1 : -1;
      const [a, b] = segment(spec, s.leg, s.dir);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      s.u = unitDraw(s, 4) * len;
      const k = len > 0 ? s.u / len : 0;
      s.x = a[0] + (b[0] - a[0]) * k;
      s.z = a[1] + (b[1] - a[1]) * k;
      s.yaw = yawToward(b[0] - a[0], b[1] - a[1]);
      s.goalYaw = s.yaw;
      s.mode = 'pause';
      s.modeS = rangeDraw(s, [0, (spec.pauseS ?? PATROL_PAUSE_S)[1]], 5);
      break;
    }
    case 'waterline':
      s.mode = 'pause';
      s.leg = 1; // "home" — the next leg goes out to the edge
      s.modeS = rangeDraw(s, [0, (spec.restS ?? WATERLINE_REST_S)[1]], 6);
      break;
    case 'floating': {
      const [x, z] = discPoint(s, spec.anchor.x, spec.anchor.z, spec.radiusM * 0.5);
      s.x = x;
      s.z = z;
      s.y = spec.surfaceY;
      s.mode = 'pause';
      s.modeS = rangeDraw(s, DRIFT_HOLD_S, 7);
      s.nextPlayT = rangeDraw(s, spec.playEveryS ?? PLAY_EVERY_S, 8);
      break;
    }
    case 'airborne':
      s.y = spec.hoverY;
      s.mode = 'pause';
      s.modeS = rangeDraw(s, DRIFT_HOLD_S, 9);
      break;
    case 'stationary':
      break;
  }
  return s;
}

function stoppedClip(spec: BehaviorSpec, s: BehaviorState, budget: FigureLifeBudget, fidgetsNow: boolean): ClipPick {
  let requested: string | null = null;
  if (spec.requestedClip && !isLocomotionClip(spec.requestedClip)) requested = spec.requestedClip;
  if (!requested && budget.fidgets && fidgetsNow) {
    const frame = idleFidgetSchedule(s.seed, spec.clips, s.t, spec.clipDurations);
    if (frame.fidget) requested = frame.clip;
  }
  return selectClip({ clips: spec.clips, role: spec.role, locomotion: false, requested });
}

function movingClip(spec: PatrolSpec | WaterlineSpec): ClipPick {
  const requested = spec.requestedClip && isLocomotionClip(spec.requestedClip) ? spec.requestedClip : null;
  return selectClip({ clips: spec.clips, role: spec.role, locomotion: true, requested, wantsRun: spec.gait === 'run' });
}

function enterMode(s: BehaviorState, mode: BehaviorMode, lengthS: number): void {
  s.mode = mode;
  s.modeT = 0;
  s.modeS = lengthS;
}

/* --- per-role steps ----------------------------------------------------- */

/**
 * POKEMON-CORE A1: the loiter glance toward a target point: the authored yaw
 * turned toward `target`, clamped to +-`arc` (never a spin around).
 */
export function loiterGlanceYaw(anchor: BehaviorAnchor, target: { x: number; z: number }, arc: number): number {
  const base = wrapAngle(anchor.yaw);
  const off = wrapAngle(yawToward(target.x - anchor.x, target.z - anchor.z) - base);
  return wrapAngle(base + Math.max(-arc, Math.min(arc, off)));
}

function stepLoiter(
  spec: LoiterSpec,
  s: BehaviorState,
  dt: number,
  budget: FigureLifeBudget,
  lookAt: { x: number; z: number } | null,
): void {
  const arc = Math.min(Math.abs(spec.lookArcRad ?? LOOK_ARC_RAD), LOOK_ARC_RAD * 1.2);
  const base = wrapAngle(spec.anchor.yaw);
  if (!budget.looks) {
    s.goalYaw = base;
  } else if (s.modeT >= s.modeS) {
    // With a board to glance at, about half the holds aim at it. The draw is
    // consumed only when a target exists, so target-less schedules are unchanged.
    if (lookAt && unitDraw(s, 23) < 0.5) s.goalYaw = loiterGlanceYaw(spec.anchor, lookAt, arc);
    else s.goalYaw = wrapAngle(base + (unitDraw(s, 21) * 2 - 1) * arc);
    enterMode(s, 'look', rangeDraw(s, LOOK_HOLD_S, 22));
  }
  s.yaw = turnToward(s.yaw, s.goalYaw, LOOK_TURN_RATE * dt);
  // The bound holds even mid-turn: never further than `arc` off the anchor.
  const off = wrapAngle(s.yaw - base);
  if (Math.abs(off) > arc) s.yaw = wrapAngle(base + Math.sign(off) * arc);
}

function stepPatrol(spec: PatrolSpec, s: BehaviorState, dt: number, canMove: boolean): boolean {
  const pause = spec.pauseS ?? PATROL_PAUSE_S;
  if (s.mode === 'move' && !canMove) enterMode(s, 'settle', SETTLE_S);

  if (s.mode === 'settle' && s.modeT >= s.modeS) enterMode(s, 'pause', rangeDraw(s, pause, 31));
  if (s.mode === 'pause' && s.modeT >= s.modeS && canMove) {
    const [a, b] = segment(spec, s.leg, s.dir);
    s.goalYaw = yawToward(b[0] - a[0], b[1] - a[1]);
    enterMode(s, 'turn', OPEN_ENDED_S);
  }
  if (s.mode === 'turn') {
    s.yaw = turnToward(s.yaw, s.goalYaw, GROUND_TURN_RATE * dt);
    if (Math.abs(wrapAngle(s.goalYaw - s.yaw)) <= TURN_ALIGNED_RAD) enterMode(s, 'move', OPEN_ENDED_S);
    return false;
  }
  if (s.mode !== 'move') return false;

  const [a, b] = segment(spec, s.leg, s.dir);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tangent = yawToward(b[0] - a[0], b[1] - a[1]);
  s.yaw = turnToward(s.yaw, tangent, GROUND_TURN_RATE * dt);
  // Heading converges before speed: a misaligned body slows instead of
  // crab-walking.
  const align = Math.max(0, Math.cos(wrapAngle(tangent - s.yaw)));
  const before = s.u;
  s.u = Math.min(len, s.u + spec.speedMps * align * dt);
  const translated = s.u > before;
  const k = len > 0 ? s.u / len : 1;
  s.x = a[0] + (b[0] - a[0]) * k;
  s.z = a[1] + (b[1] - a[1]) * k;

  if (s.u >= len - 1e-9) {
    // Arrived at a vertex: pick the next leg, then settle (always at an open
    // end, seeded at interior vertices) or turn straight on.
    const segments = segmentCount(spec);
    let atEnd = false;
    if (spec.closed) {
      s.leg = (s.leg + 1) % segments;
    } else if (s.dir === 1 && s.leg === segments - 1) {
      s.dir = -1;
      atEnd = true;
    } else if (s.dir === -1 && s.leg === 0) {
      s.dir = 1;
      atEnd = true;
    } else {
      s.leg += s.dir;
    }
    s.u = 0;
    if (atEnd || unitDraw(s, 32) < INTERIOR_PAUSE_CHANCE) {
      enterMode(s, 'settle', SETTLE_S);
    } else {
      const [na, nb] = segment(spec, s.leg, s.dir);
      s.goalYaw = yawToward(nb[0] - na[0], nb[1] - na[1]);
      enterMode(s, 'turn', OPEN_ENDED_S);
    }
  }
  // The arrival frame still translated: it plays the gait, and the settle
  // that follows carries the crossfade into idle.
  return translated;
}

function stepWaterline(
  spec: WaterlineSpec,
  s: BehaviorState,
  dt: number,
  canMove: boolean,
  budget: FigureLifeBudget,
  events: BehaviorEvent[],
): boolean {
  const home: Vec2 = [spec.anchor.x, spec.anchor.z];
  if (s.mode === 'move' && !canMove) enterMode(s, 'settle', SETTLE_S);
  if (s.mode === 'settle' && s.modeT >= s.modeS) {
    const atEdge = s.leg === 0;
    enterMode(s, 'pause', rangeDraw(s, atEdge ? spec.pauseS ?? PATROL_PAUSE_S : spec.restS ?? WATERLINE_REST_S, 41));
    if (atEdge && spec.after === 'remain') {
      s.goalYaw = s.yaw;
      enterMode(s, 'look', rangeDraw(s, LOOK_HOLD_S, 42));
    }
  }
  if (s.mode === 'look') {
    // Remaining at the edge: bounded look arcs around the water-facing yaw.
    const facing = yawToward(spec.edge[0] - home[0], spec.edge[1] - home[1]);
    if (budget.looks && s.modeT >= s.modeS) {
      s.goalYaw = wrapAngle(facing + (unitDraw(s, 43) * 2 - 1) * LOOK_ARC_RAD);
      enterMode(s, 'look', rangeDraw(s, LOOK_HOLD_S, 44));
    }
    s.yaw = turnToward(s.yaw, budget.looks ? s.goalYaw : facing, LOOK_TURN_RATE * dt);
    return false;
  }
  if (s.mode === 'pause' && s.modeT >= s.modeS && canMove) {
    // Toggle leg: 1 (home) → 0 (outbound to the edge) and back.
    s.leg = s.leg === 0 ? 1 : 0;
    const goal = s.leg === 0 ? spec.edge : home;
    s.goalX = goal[0];
    s.goalZ = goal[1];
    s.goalYaw = yawToward(goal[0] - s.x, goal[1] - s.z);
    enterMode(s, 'turn', OPEN_ENDED_S);
  }
  if (s.mode === 'turn') {
    s.yaw = turnToward(s.yaw, s.goalYaw, GROUND_TURN_RATE * dt);
    if (Math.abs(wrapAngle(s.goalYaw - s.yaw)) <= TURN_ALIGNED_RAD) enterMode(s, 'move', OPEN_ENDED_S);
    return false;
  }
  if (s.mode !== 'move') return false;

  const dx = s.goalX - s.x;
  const dz = s.goalZ - s.z;
  const dist = Math.hypot(dx, dz);
  const tangent = yawToward(dx, dz);
  s.yaw = turnToward(s.yaw, tangent, GROUND_TURN_RATE * dt);
  const stepLen = spec.speedMps * Math.max(0, Math.cos(wrapAngle(tangent - s.yaw))) * dt;
  if (stepLen >= dist) {
    s.x = s.goalX;
    s.z = s.goalZ;
    if (s.leg === 0) {
      // ONE contact per arrival at the water's edge.
      events.push({ kind: 'contact', t: s.t, x: s.x, z: s.z, strength: 1, cause: 'arrive' });
    }
    enterMode(s, 'settle', SETTLE_S);
    return dist > 0;
  }
  s.x += (dx / dist) * stepLen;
  s.z += (dz / dist) * stepLen;
  return true;
}

function stepDrift(
  spec: FloatingSpec | AirborneSpec,
  s: BehaviorState,
  dt: number,
  canMove: boolean,
  events: BehaviorEvent[] | null,
): void {
  if (s.mode === 'pause' && s.modeT >= s.modeS && canMove) {
    const [gx, gz] = discPoint(s, spec.anchor.x, spec.anchor.z, spec.radiusM);
    s.goalX = gx;
    s.goalZ = gz;
    enterMode(s, 'drift', OPEN_ENDED_S);
  }
  if (s.mode !== 'drift') return;
  if (!canMove) {
    enterMode(s, 'pause', OPEN_ENDED_S);
    return;
  }
  const dx = s.goalX - s.x;
  const dz = s.goalZ - s.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= DRIFT_ARRIVE_M) {
    enterMode(s, 'pause', rangeDraw(s, DRIFT_HOLD_S, 51));
    return;
  }
  const tangent = yawToward(dx, dz);
  s.yaw = turnToward(s.yaw, tangent, DRIFT_TURN_RATE * dt);
  // Swimmers and fliers keep a little way on while they turn.
  const align = Math.max(0.25, Math.cos(wrapAngle(tangent - s.yaw)));
  const stepLen = Math.min(dist, spec.driftMps * align * dt);
  const dirX = Math.sin(s.yaw);
  const dirZ = Math.cos(s.yaw);
  s.x += dirX * stepLen;
  s.z += dirZ * stepLen;
  // Hard bound: never leave the region (the ripple pool and the W1 sight
  // corridors are authored against it).
  const ox = s.x - spec.anchor.x;
  const oz = s.z - spec.anchor.z;
  const r = Math.hypot(ox, oz);
  if (r > spec.radiusM) {
    s.x = spec.anchor.x + (ox / r) * spec.radiusM;
    s.z = spec.anchor.z + (oz / r) * spec.radiusM;
  }
  if (events) {
    s.wakeT += dt;
    if (s.wakeT >= WAKE_INTERVAL_S) {
      // Reset, not carry: consecutive wakes are never closer than WAKE_INTERVAL_S.
      s.wakeT = 0;
      events.push({ kind: 'wake', t: s.t, x: s.x, z: s.z, dirX, dirZ, strength: Math.min(1, stepLen / Math.max(spec.driftMps * dt, 1e-6)) });
    }
  }
}

function playProgress(s: BehaviorState): number {
  return s.play ? Math.min(s.modeT / Math.max(s.modeS, 1e-6), 1) : 0;
}

function stepFloating(
  spec: FloatingSpec,
  s: BehaviorState,
  dt: number,
  canMove: boolean,
  budget: FigureLifeBudget,
  events: BehaviorEvent[],
): void {
  if (!s.entered) {
    s.entered = true;
    events.push({ kind: 'contact', t: s.t, x: s.x, z: s.z, strength: 0.6, cause: 'enter' });
  }
  if (s.mode === 'play') {
    if (s.modeT >= s.modeS) {
      if (s.play !== 'spin') events.push({ kind: 'contact', t: s.t, x: s.x, z: s.z, strength: 1, cause: 'splash' });
      s.play = '';
      s.nextPlayT = s.t + rangeDraw(s, spec.playEveryS ?? PLAY_EVERY_S, 61);
      enterMode(s, 'pause', rangeDraw(s, DRIFT_HOLD_S, 62));
    }
    return;
  }
  if (budget.playEvents && s.t >= s.nextPlayT) {
    const kinds = spec.playKinds && spec.playKinds.length > 0 ? spec.playKinds : (['breach', 'dive', 'spin'] as const);
    const kind = kinds[Math.min(Math.floor(unitDraw(s, 63) * kinds.length), kinds.length - 1)];
    s.play = kind;
    enterMode(s, 'play', PLAY_DURATION_S[kind]);
    events.push({ kind: 'play', t: s.t, x: s.x, z: s.z, play: kind, durationS: PLAY_DURATION_S[kind] });
    events.push({ kind: 'contact', t: s.t, x: s.x, z: s.z, strength: 0.8, cause: 'splash' });
    return;
  }
  if (!budget.playEvents && s.t >= s.nextPlayT) {
    // Play is off at this rung: re-arm instead of firing a backlog later.
    s.nextPlayT = s.t + rangeDraw(s, spec.playEveryS ?? PLAY_EVERY_S, 64);
  }
  stepDrift(spec, s, dt, canMove, events);
}

/** Writes the pose of `s` into `out` (no allocation). */
function poseInto(spec: BehaviorSpec, s: BehaviorState, water: boolean, out: BehaviorPose): BehaviorPose {
  if (spec.role === 'floating') {
    // C10: a field-buoyed floater on a live handle takes its bob from the water field.
    const bob =
      spec.buoyancy === 'field' && water
        ? 0
        : spec.bobM * (0.7 * Math.sin((2 * Math.PI * s.t) / 2.8 + s.phase) + 0.3 * Math.sin((2 * Math.PI * s.t) / 4.3 + 1.7 * s.phase));
    const p = playProgress(s);
    let lift = 0;
    let spin = 0;
    if (s.play === 'breach') lift = (spec.playLiftM ?? 0.6) * Math.sin(Math.PI * p);
    if (s.play === 'dive') lift = -(spec.diveDepthM ?? 0.8) * Math.sin(Math.PI * p);
    if (s.play === 'spin') spin = Math.PI * 2 * (p * p * (3 - 2 * p));
    out.x = s.x;
    out.y = spec.surfaceY + bob + lift;
    out.z = s.z;
    out.yaw = wrapAngle(s.yaw + spin);
    out.grounded = false;
    return out;
  }
  if (spec.role === 'airborne') {
    out.x = s.x;
    out.y = spec.hoverY + spec.bobM * Math.sin((2 * Math.PI * s.t) / 3.4 + s.phase);
    out.z = s.z;
    out.yaw = s.yaw;
    out.grounded = false;
    return out;
  }
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.yaw = s.yaw;
  out.grounded = true;
  return out;
}

function poseFor(spec: BehaviorSpec, s: BehaviorState, water: boolean): BehaviorPose {
  return poseInto(spec, s, water, { x: 0, y: 0, z: 0, yaw: 0, grounded: true });
}

/** Advance `s` IN PLACE by one clamped step; returns whether the root translated along a path. */
function advanceState(s: BehaviorState, input: BehaviorInput, dt: number, budget: FigureLifeBudget, events: BehaviorEvent[]): boolean {
  const spec = input.spec;
  const canMove = budget.paths && (input.moverSlot ?? true);
  s.role = spec.role;
  s.t += dt;
  s.modeT += dt;
  switch (spec.role) {
    case 'stationary':
      return false;
    case 'loiter':
      stepLoiter(spec, s, dt, budget, input.lookAt ?? null);
      return false;
    case 'patrol':
      return stepPatrol(spec, s, dt, canMove);
    case 'waterline':
      return stepWaterline(spec, s, dt, canMove, budget, events);
    case 'floating':
      stepFloating(spec, s, dt, canMove, budget, events);
      return false;
    case 'airborne':
      stepDrift(spec, s, dt, canMove, null);
      return false;
  }
}

function clampStep(dtSeconds: number): number {
  return Math.min(Math.max(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0), MAX_STEP_S);
}

/**
 * Advance one figure by `dtSeconds` (clamped to [0, MAX_STEP_S]). Pure: the
 * input state is not mutated.
 */
export function stepBehavior(state: BehaviorState, input: BehaviorInput, dtSeconds: number): StepResult {
  const dt = clampStep(dtSeconds);
  const spec = input.spec;
  const budget = figureLifeBudget(input.life ?? 'full');
  const s: BehaviorState = { ...state, role: spec.role };
  const events: BehaviorEvent[] = [];
  const moving = advanceState(s, input, dt, budget, events);

  let clip: ClipPick;
  let timeScale = 1;
  if (moving && (spec.role === 'patrol' || spec.role === 'waterline')) {
    clip = movingClip(spec);
    timeScale = spec.locomotionTimeScale ?? 1;
  } else {
    // The settle window plays plain idle (the crossfade out of the gait);
    // fidgets resume after it.
    clip = stoppedClip(spec, s, budget, s.mode !== 'settle');
  }

  return { state: s, pose: poseFor(spec, s, input.water === true), clip, timeScale, events };
}

/* ------------------------------------------------------------------------ */
/* Mutating step (POKEMON-CORE A1, L11: the director loop allocates nothing) */
/* ------------------------------------------------------------------------ */

/**
 * The reusable output of `stepBehaviorInto`. `clip` / `rule` / `freezeClip`
 * are `selectClip`'s pick, flattened (rule 6 <=> `clip === null`). `events`
 * is CLEARED and refilled on every step: read it before the next one.
 */
export interface BehaviorStepOut {
  pose: BehaviorPose;
  clip: string | null;
  rule: 1 | 2 | 3 | 4 | 5 | 6;
  freezeClip: string | null;
  timeScale: number;
  events: BehaviorEvent[];
}

export function createBehaviorStepOut(): BehaviorStepOut {
  return { pose: { x: 0, y: 0, z: 0, yaw: 0, grounded: true }, clip: null, rule: 6, freezeClip: null, timeScale: 1, events: [] };
}

/** `selectClip` written into `out` (the same picks, tested). */
function selectClipInto(
  out: BehaviorStepOut,
  clips: readonly string[],
  role: BehaviorRole,
  locomotion: boolean,
  requested: string | null,
  wantsRun: boolean,
): void {
  out.freezeClip = null;
  if (requested && clips.includes(requested) && (locomotion || !isLocomotionClip(requested))) {
    out.clip = requested;
    out.rule = 1;
    return;
  }
  const pathRole = role === 'patrol' || role === 'waterline';
  if (locomotion && pathRole && clips.includes('walk')) {
    out.clip = 'walk';
    out.rule = 2;
    return;
  }
  if (locomotion && wantsRun && clips.includes('run')) {
    out.clip = 'run';
    out.rule = 3;
    return;
  }
  if (!locomotion && clips.includes('idle')) {
    out.clip = 'idle';
    out.rule = 4;
    return;
  }
  let first: string | null = null;
  if (locomotion) first = clips[0] ?? null;
  else {
    for (const clip of clips) {
      if (!isLocomotionClip(clip)) {
        first = clip;
        break;
      }
    }
  }
  if (first) {
    out.clip = first;
    out.rule = 5;
    return;
  }
  out.clip = null;
  out.rule = 6;
  out.freezeClip = clips[0] ?? null;
}

/** Fidget plans cached per spec object (computed once, then read allocation-free). */
const fidgetPlans = new WeakMap<BehaviorSpec, FidgetPlan>();
const fidgetScratch = createFidgetFrame();

function fidgetPlanFor(spec: BehaviorSpec, seed: number): FidgetPlan {
  const cached = fidgetPlans.get(spec);
  if (cached && cached.seed === seed) return cached;
  const plan = createFidgetPlan(seed, spec.clips, spec.clipDurations);
  fidgetPlans.set(spec, plan);
  return plan;
}

/**
 * `stepBehavior`, MUTATING: `state` advances in place and the pick, pose and
 * events land in `out` (events cleared first). Given the same inputs it
 * produces `stepBehavior`'s state, pose, clip and events exactly (tested).
 * A steady-state step allocates nothing; an event allocates its record, and a
 * new drift goal one tuple.
 */
export function stepBehaviorInto(state: BehaviorState, input: BehaviorInput, dtSeconds: number, out: BehaviorStepOut): BehaviorStepOut {
  const dt = clampStep(dtSeconds);
  const spec = input.spec;
  const budget = figureLifeBudget(input.life ?? 'full');
  out.events.length = 0;
  const moving = advanceState(state, input, dt, budget, out.events);
  out.timeScale = 1;
  if (moving && (spec.role === 'patrol' || spec.role === 'waterline')) {
    const requested = spec.requestedClip && isLocomotionClip(spec.requestedClip) ? spec.requestedClip : null;
    selectClipInto(out, spec.clips, spec.role, true, requested, spec.gait === 'run');
    out.timeScale = spec.locomotionTimeScale ?? 1;
  } else {
    let requested: string | null = null;
    if (spec.requestedClip && !isLocomotionClip(spec.requestedClip)) requested = spec.requestedClip;
    if (!requested && budget.fidgets && state.mode !== 'settle') {
      const frame = fidgetAt(fidgetPlanFor(spec, state.seed), state.t, fidgetScratch);
      if (frame.fidget) requested = frame.clip;
    }
    selectClipInto(out, spec.clips, spec.role, false, requested, false);
  }
  poseInto(spec, state, input.water === true, out.pose);
  return out;
}

/* ------------------------------------------------------------------------ */
/* The plaza Walker's path step (POKEMON-CORE A1 step 7, fix round)         */
/* ------------------------------------------------------------------------ */

/** Seconds a walker idles at a path vertex before setting off again. */
export const WALKER_PAUSE_S: Range = [2.5, 6.5];
/**
 * The longest a walker with an idle2 goes without one (A1.1: every visible
 * group with idle2 plays it at least once in 30 s). Past it the walker plays
 * the pass where it stands: at once while standing, or by stopping in place
 * (a pause off the vertex, no hop) while walking. Only while fidgets are on.
 * A DESIGN value in AWAKE seconds (design decision R16): 20 s, the top of the
 * director's own 8–20 s idle dwell for standing figures. It is measured on
 * the director's clamped awake clock (the step's `dt`), never wall time: a hidden
 * or dormant walker accrues nothing, and 30 fps and 60 fps agree. (The fix-1
 * value, 12 s, was tuned to a capture artefact: under capture load the awake
 * clock ran at about half of wall time.)
 */
export const WALKER_FIDGET_GAP_S = 20;
/** The step off a vertex when a pause ends, so the arrival test does not retrigger. */
export const WALKER_VERTEX_HOP_M = 0.05;

/** A walker's mutable path state (one per walker, mutated by `advanceWalkerPath`). */
export interface WalkerPathState {
  /** Distance along the track (m). */
  s: number;
  /** Seconds left of the current pause (0 = walking; 1e-3 = holding for a mover slot). */
  pause: number;
  /** Heading (rad) as last posed. */
  yaw: number;
  initialised: boolean;
  /** Pauses so far (every other VERTEX pause opens with the fidget pass). */
  pauses: number;
  /** Seconds left of the running fidget pass (0 = none). */
  fidgetLeft: number;
  /** Awake seconds since the last fidget pass started (counts only while fidgets are on). */
  sinceFidget: number;
  /** The current pause is at a vertex (leaving it hops `WALKER_VERTEX_HOP_M`). */
  atVertex: boolean;
}

export function createWalkerPathState(s: number): WalkerPathState {
  return { s, pause: 0, yaw: 0, initialised: false, pauses: 0, fidgetLeft: 0, sinceFidget: 0, atVertex: false };
}

/** The walker's fidget: its rig's idle2 (one pass, clamped like the director's), or none. */
export interface WalkerFidget {
  clip: string | null;
  passS: number;
}

export const NO_WALKER_FIDGET: WalkerFidget = Object.freeze({ clip: null, passS: 0 });

function startWalkerFidget(st: WalkerPathState, fidget: WalkerFidget): string {
  st.fidgetLeft = fidget.passS;
  st.sinceFidget = 0;
  // A pause always covers the pass it opens (the walker never leaves mid-pass).
  if (st.pause < fidget.passS) st.pause = fidget.passS;
  return fidget.clip as string;
}

/**
 * One walker step (pure over its arguments): advance along the track or run
 * down a pause. Returns the clip the walker switches to this step, or null.
 *
 * - C3: without a mover slot a walker finishes its segment and holds its
 *   vertex pause (it never freezes mid-stride; a held walker still fidgets).
 * - Every other vertex pause opens with one idle2 pass; `WALKER_FIDGET_GAP_S`
 *   bounds the gap between passes (A1.1).
 * - `fidget` is `NO_WALKER_FIDGET` whenever fidgets are off (reduced motion,
 *   the rung's `figureLife`): then nothing here plays or counts a pass.
 * - `dt` is the director's clamped awake delta (D40).
 */
export function advanceWalkerPath(
  st: WalkerPathState,
  dt: number,
  granted: boolean,
  speedMps: number,
  toVertexAt: (s: number) => number,
  random: () => number,
  fidget: WalkerFidget,
): string | null {
  const canFidget = fidget.clip !== null && fidget.passS > 0;
  if (canFidget) st.sinceFidget += dt;
  if (st.pause > 0) {
    let next: string | null = null;
    if (st.fidgetLeft > 0) {
      st.fidgetLeft -= dt;
      if (st.fidgetLeft <= 0) {
        st.fidgetLeft = 0;
        next = 'idle';
      }
    }
    st.pause -= dt;
    if (st.pause <= 0) {
      if (!granted) {
        st.pause = 1e-3; // hold until a slot comes back
        if (canFidget && st.fidgetLeft === 0 && st.sinceFidget >= WALKER_FIDGET_GAP_S) return startWalkerFidget(st, fidget);
        return next;
      }
      st.pause = 0;
      st.fidgetLeft = 0;
      if (st.atVertex) st.s += WALKER_VERTEX_HOP_M;
      st.atVertex = false;
      return 'walk';
    }
    if (next === null && canFidget && st.fidgetLeft === 0 && st.sinceFidget >= WALKER_FIDGET_GAP_S) return startWalkerFidget(st, fidget);
    return next;
  }
  if (canFidget && st.sinceFidget >= WALKER_FIDGET_GAP_S) {
    // Overdue: stop where it stands (no vertex, so no hop when it sets off).
    st.pause = WALKER_PAUSE_S[0] + random() * (WALKER_PAUSE_S[1] - WALKER_PAUSE_S[0]);
    st.pauses += 1;
    st.atVertex = false;
    return startWalkerFidget(st, fidget);
  }
  const toVertex = toVertexAt(st.s);
  const step = speedMps * dt;
  if (toVertex <= step) {
    st.s += toVertex;
    st.pause = WALKER_PAUSE_S[0] + random() * (WALKER_PAUSE_S[1] - WALKER_PAUSE_S[0]);
    st.pauses += 1;
    st.atVertex = true;
    if (canFidget && st.pauses % 2 === 1) return startWalkerFidget(st, fidget);
    return 'idle';
  }
  st.s += step;
  return null;
}
