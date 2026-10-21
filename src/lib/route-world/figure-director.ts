/**
 * The figure director (POKEMON-CORE-PLAN §4 SEAT A1 step 3; D35 3A FIG-CORE).
 *
 * ONE per-frame loop for every living thing in a route world: the registered
 * figures (`Figure.tsx`) and the registered actors (D's water residents and
 * lane flyers, the plaza Walker). It replaces every per-Figure `useFrame`:
 * `FigureDirector.tsx` owns the only `useFrame` and hands this pure core one
 * `DirectorFrameInput` per rendered frame.
 *
 * FROZEN PUBLIC TYPES (the A1 → A2 / B / D contract freeze): the structural
 * three subsets (`ActionLike`, `MixerLike`, `Object3DLike`, `FrustumLike`),
 * `FigureRole`, `FigureRegistration`, `ActorKind`, `ActorRegistration`,
 * `ActorFrame`, `ActorStep`, `DirectorMotion`, `DirectorLedger`,
 * `DirectorStepContext`, `DirectorFrameInput`, `FigureDirectorSource`,
 * `DirectedFigureRow`, `FigureDirector`. They change only through the lead.
 * A2 adds exports only (no frozen type changes): the beat tunables
 * (`LOOK_BEAT_*`, `QUIET_FIDGET_RATE`, `ROLL_CALL_ACTOR_ID`), the R27 frame
 * order (`runDirectorFrame`) and the grant precondition's projection
 * (`sphereFaceDistanceNdc`, `FACE_NDC_FAR`).
 *
 * Rules it keeps (plan §3):
 *  - C2 phases: ONE allocation per scene generation per clipKey (file + clip)
 *    over the whole resident set — recomputed while the registry changes
 *    before the reveal, frozen from it. The shared clock of every clipKey is
 *    the director's AWAKE clock; the base action's time is
 *    `(awakeS · timeScale + phase · duration) mod duration`, written
 *    ("re-seated") on wake, on the return from a fidget and by `pinPhase`.
 *  - C3: from the reveal nothing is re-allocated. A registration after live
 *    is a tripwire (`lateRegistrations`); an unregistration (ThemeFigures'
 *    off-camera tail) drops its row and its mover grant, nothing else moves.
 *  - C9 / D40: every clock accumulates the clamped delta
 *    (`[0, MAX_STEP_S]`) of rendered frames; hidden and dormant time does not.
 *  - Fidgets: `idleFidgetSchedule` (8–20 s idle dwell, one fidget pass), read
 *    through a plan cached at registration (`createFidgetPlan` / `fidgetAt`).
 *  - Idles shorter than 0.7 s loop at timeScale 0.7 (disclosed).
 *  - Movers: `figureLifeBudget(life).maxMovers` slots over AWAKE movers,
 *    nearest the active station first; a mover that loses its slot settles
 *    (the actor's own rule: nothing freezes mid-stride).
 *  - R14 visibility-gated sampling: once live, a director-owned figure's
 *    mixer is updated (and its breath applied) only while its root is shown
 *    and its padded bounding sphere (swept down the key light by its
 *    shadow's reach) meets the camera frustum; before live, and in the step
 *    after a pin, every figure samples. The logic (clip plans, fidget
 *    schedules, bus events, counts) always steps. On re-entry the figure is
 *    re-seated analytically (a cut) and updated by 0, so it matches a
 *    continuously sampled twin. R18 (c): a hidden root (or ancestor) never
 *    samples, prop-controlled figures included.
 *  - D12: reduced motion under a forced route tier runs `static`: idle loops
 *    (and D's buoy transform) only — no breath, no fidgets, no movers, no
 *    hero beats.
 *  - A2 quiet mode (a focus open): the focused participant plays ONE beat,
 *    on its figure the focus frames (shown, nearest the focus centre), never
 *    restarting a beat already running on it; its figures keep their full
 *    fidget rate; every other figure's idle dwell runs at half rate (its
 *    fidget rate halves; a fidget in progress keeps its speed) and the bus
 *    defers hero beats.
 *  - A2 roll call (D16): the Roll Call Ledger publishes its ordered
 *    participant ids and per-column offsets on the event channel; the
 *    director requests the data-bound `rollCall` hero beat and, once granted,
 *    fires each column's beat at its offset on the figures whose `subjectId`
 *    matches, then releases the beat.
 *  - A figure BEAT (quiet or roll call, R17) is `idle2` once when the figure
 *    owns its clips and has that clip; otherwise one breath swell plus a 6°
 *    look through `FigureRegistration.look`. Beats need full motion and a
 *    rung with fidgets; a running beat ends when motion goes static (D12).
 *    The fidget clock is held while a beat runs, and a beat never ends
 *    inside a fidget pass (R35).
 *
 * Steady-state frames allocate nothing: rows, scratch frames and the step
 * context are created once and mutated.
 *
 * Pure: no React, no three, no DOM (structural types only).
 */

import {
  allocateClipPhases,
  clipKeyFor,
  createFidgetFrame,
  createFidgetPlan,
  fidgetAt,
  hash01,
  hashText,
  isLocomotionClip,
  type FidgetFrame,
  type FidgetPlan,
} from './clip-phase';
import { figureLifeBudget, MAX_STEP_S, type FigureLifeBudget } from './figure-behavior';
import type { FigureLifeLevel } from './quality';
import { MIXER_MAX_STEP_S } from './residency';
import {
  createAmbientBeatBus,
  NO_BEAT_FORCE,
  type AmbientBeatBus,
  type BeatForce,
  type BeatSphere,
  type BeatTicket,
  type FaceSourceReason,
  type FigureBeatRecord,
  FACE_SOURCE_DENIED_NDC,
} from './ambient-beats';

/* ------------------------------------------------------------------------ */
/* Structural three subsets (frozen)                                        */
/* ------------------------------------------------------------------------ */

/** The subset of `THREE.AnimationAction` the director and the bridges read. */
export interface ActionLike {
  time: number;
  timeScale: number;
  getClip(): { name: string; duration: number };
  getEffectiveWeight(): number;
  isRunning(): boolean;
}

/** The subset of `THREE.AnimationMixer` the frame step needs. */
export interface MixerLike {
  update(deltaSeconds: number): unknown;
}

/** The subset of `THREE.Object3D` the director reads and writes. */
export interface Object3DLike {
  visible: boolean;
  scale: { x: number; y: number; z: number };
  /** World matrix (column-major; translation at 12, 13, 14). */
  matrixWorld: { elements: ArrayLike<number> };
  /**
   * A1 fix-2 (R14, additive): the parent, read to tell whether the root is
   * shown in the scene (a hidden ancestor, e.g. D's latch root, hides it).
   * `THREE.Object3D` has it; fakes may omit it (then only `visible` counts).
   */
  parent?: Object3DLike | null;
}

/** The shared per-frame camera frustum (built once per frame by FigureDirector.tsx). */
export interface FrustumLike {
  intersectsSphere(x: number, y: number, z: number, r: number): boolean;
  /**
   * A1 fix-2 (R14, additive): the same frustum as 6 planes, packed
   * `[nx, ny, nz, constant] × 6` (three's `Plane`: signed distance =
   * n·p + constant, inside ≥ 0). When present the director tests spheres
   * against it inline — no call, so no double is boxed for an argument.
   */
  planes?: ArrayLike<number>;
}

/* ------------------------------------------------------------------------ */
/* Registrations (frozen)                                                   */
/* ------------------------------------------------------------------------ */

/**
 * What a registered figure IS in its world (the call-site one-liner):
 * `ace` — a participant's ace (StatueRow, AceStatuary, Statuary, the
 * ThemeFigures roster slots incl. the clouds riders; carries `subjectId`);
 * `wild` — a pool / backfill / ambient figure standing still; `walker` — a
 * path mover driven by its own actor; `loiter` — the loiter glance's consumer
 * (none this round, plan §7 3C); `staff` — the plaza nurse; `resident` /
 * `flyer` — figures owned by D's actors.
 */
export type FigureRole = 'ace' | 'wild' | 'walker' | 'loiter' | 'staff' | 'resident' | 'flyer';

/**
 * One figure in the registry (`figure-registry.ts` `registerFigure`).
 *
 * Debug-only rows (tests, the pre-3A bridges) set `id` + `object` and nothing
 * else. A DIRECTED figure (every `Figure.tsx`) also sets `clips`, `durations`,
 * `mixer`, `isDormant`, `play` and `currentClip`; the director then drives it.
 */
export interface FigureRegistration {
  /** Row id — the figure's group name (`figure-<key>`, `ace-<participant>`, `ambient-<file>`, `nurse`). */
  id: string;
  /** Model identity: the manifest file. clipKey = `clipKeyFor(model, clip)`. */
  model?: string;
  /** The figure's root group (the breath target and the bridges' bounds). */
  object: { readonly current: Object3DLike | null };
  role?: FigureRole | string;
  /** Participant id (aces), matched to the roll call's ordered ids; null otherwise. */
  subjectId?: string | null;
  /** The station index the figure belongs to (mover ranking); null = anywhere. */
  station?: number | null;
  /**
   * No argument: the action currently driving the figure. With a clip name:
   * that clip's pre-created action (C16), or null when the model lacks it.
   */
  getAction?: (clip?: string) => ActionLike | null;
  getRole?: () => string | null;
  getState?: () => string | null;
  /** Clip-less (or rule-6 freeze) figure on the disclosed breath fallback. */
  lowMotion?: boolean;
  // ── directed figures ──
  mixer?: MixerLike | null;
  /** Clip names the GLB carries (`gltf.animations[i].name`). */
  clips?: readonly string[];
  /** Loop durations from `gltf.animations[i].duration` (never the manifest). */
  durations?: Readonly<Record<string, number>>;
  isDormant?: () => boolean;
  /**
   * True (default): once registered, the director flips clips and sets
   * timeScale; the `clip` / `timeScale` props were initial values. False: the
   * caller keeps prop control; the director only advances the mixer (while
   * the root is shown) and seats its phase on `pinPhase`. It plans NO
   * director fidgets for such a figure, and (R18 b) counts its non-idle clip
   * flips as fidget passes (P12) only for role `walker` (the plaza Walker,
   * until 3C). D's `resident` and `flyer` figures register with
   * `directorOwnsClip: false`: their actor sequences every clip, the director
   * never fidgets them and never fidget-counts them. A prop-controlled figure
   * is also never frustum-gated (R14): its clip timing is its actor's, so it
   * cannot be re-seated analytically; only a hidden root stops its mixer.
   */
  directorOwnsClip?: boolean;
  /** The resting clip (`selectClip` for a stopped figure); null = rule 6 (freeze + breath). */
  baseClip?: string | null;
  /** The resting clip's authored playback rate (the `timeScale` prop). */
  baseTimeScale?: number;
  /** Breathing allowed (`breathe` prop) — only a `lowMotion` figure breathes. */
  breathe?: boolean;
  /**
   * Imperative clip flip: play `clip` from loop time `timeS` at `timeScale`,
   * crossfading over `fadeS` (0 = cut: every other action stops). `null` =
   * hold the freeze pose (rule 6).
   */
  play?: (clip: string | null, timeS: number, fadeS: number, timeScale: number) => void;
  /** The clip currently driving the figure (null = freeze / clip-less). */
  currentClip?: () => string | null;
  /**
   * Look offset: turn the figure `yawRad` about +Y RELATIVE to its authored
   * heading (0 = authored; the caller's parent keeps the heading). Written
   * imperatively, no React state; `pinPhase` resets it to 0. Consumers: A2's
   * roll call ("breath plus a 6° look" for aces without idle2, D16) and 3C's
   * loiter glance (`loiterGlanceYaw`). Every `Figure.tsx` implements it.
   */
  look?: (yawRad: number) => void;
  /**
   * A1 fix-2 (R14, additive): the figure's rest bounds in its root's local
   * frame (metres, before any ancestor scale): the bounding-sphere `radius`
   * about the point `centerY` above the root, and whether it casts a shadow
   * (the frustum gate then pads the sphere by the shadow's reach). Without
   * it the figure is never frustum-gated (only a hidden root stops it).
   */
  bounds?: FigureBounds | null;
}

/** A figure's rest bounds for the R14 frustum gate (root-local metres). */
export interface FigureBounds {
  readonly radius: number;
  readonly centerY: number;
  readonly castsShadow: boolean;
}

export type ActorKind = 'resident' | 'flyer' | 'walker' | 'probe';

/** Per-actor frame values the director passes to `step`. */
export interface ActorFrame {
  /** A mover slot this frame (always true for non-movers). */
  moverSlot: boolean;
  /** This actor's own awake clock (s): frozen while dormant, set by `pinPhase`. */
  t: number;
  /** The actor's `isDormant()` this frame. */
  dormant: boolean;
}

/**
 * One actor's frame. Called on EVERY rendered frame, dormant or not: a
 * dormant actor does nothing but finish a running beat (the surfacer's sink).
 * It must set its pose / visibility / clip imperatively (no React state) and
 * route hero beats through `ctx.bus`.
 */
export type ActorStep = (ctx: DirectorStepContext, frame: ActorFrame) => void;

/** One actor in the registry (`figure-registry.ts` `registerActor`). */
export interface ActorRegistration {
  /** Prop-family id: `<world>-prop-resident-<slot>`, `<world>-prop-flyer-<lane>` (C15), `ambient-walker-<file>`. */
  id: string;
  kind: ActorKind;
  object: { readonly current: Object3DLike | null };
  /** The station index it belongs to (mover ranking); null = anywhere. */
  station?: number | null;
  isDormant?: () => boolean;
  /** A path / drift mover competing for `maxMovers` slots. */
  mover?: boolean;
  step: ActorStep;
  /** `director.pinPhase(t)`: set every clock the actor owns to canonical t and re-pose. */
  pin?: (t: number) => void;
  /** The registered figure this actor drives (its clip and root), if any. */
  figureId?: string | null;
}

/* ------------------------------------------------------------------------ */
/* Step context (frozen)                                                    */
/* ------------------------------------------------------------------------ */

/** `full`, or `static` = reduced motion under a forced route tier (D12). */
export type DirectorMotion = 'full' | 'static';

/** Ledger hooks riding `__routeWarmStats` (R5, R12). */
export interface DirectorLedger {
  /** Every visible false→true / true→false flip of an actor root, with the frustum test at that frame (K8). */
  noteAppearance(id: string, visible: boolean, inFrustum: boolean): void;
  /** The wader's waterline crossings (K6). */
  noteWaterline(id: string, submerged: boolean): void;
}

/** What every actor step reads. One object, mutated per frame — never keep a reference. */
export interface DirectorStepContext {
  /** Clamped frame delta, [0, MAX_STEP_S]; 0 while hidden. */
  dt: number;
  /** The director's awake clock (s) = every clipKey's shared clock. */
  awakeS: number;
  /** Awake seconds since the LATEST station settle; null while unsettled (the reading window). */
  sinceSettleS: number | null;
  /** Awake seconds since this generation's FIRST settled live frame (the `beatForce` clock); null before. */
  forceClockS: number | null;
  generation: number;
  live: boolean;
  settled: boolean;
  station: number;
  hidden: boolean;
  loader: boolean;
  focusOpen: boolean;
  /**
   * The focused subject as a BARE participant id (the `FigureRegistration.subjectId`
   * namespace): `focusSubjectOf(focusId)` of the focus store's id (`team:<id>` → `<id>`,
   * any other focus kind → null). R18 (a).
   */
  focusSubjectId: string | null;
  /** Effective level (`static` under D12 reduced motion). */
  life: FigureLifeLevel;
  budget: FigureLifeBudget;
  motion: DirectorMotion;
  frustum: FrustumLike;
  cameraPosition: { x: number; y: number; z: number };
  /** The loiter glance target (the active board), null when unknown. */
  activeBoard: { x: number; z: number } | null;
  bus: AmbientBeatBus;
  force: BeatForce;
  /** `?beatSeed=` or the world default. */
  seed: number;
  ledger: DirectorLedger;
  /** NDC distance of a sphere's projection from the active padded face (null: no active face). */
  faceDistanceNdc(sphere: BeatSphere): number | null;
}

/** What `FigureDirector.tsx` hands the core once per rendered frame. */
export interface DirectorFrameInput {
  /** The raw r3f delta (clamped here). */
  delta: number;
  generation: number;
  hidden: boolean;
  loader: boolean;
  focusOpen: boolean;
  /** Bare participant id: FigureDirector.tsx passes `focusSubjectOf(focus id)` (R18 a). */
  focusSubjectId: string | null;
  /** The reveal armed for `generation`. */
  live: boolean;
  /** Residency complete for `generation` (the allocation trigger). */
  residencyComplete: boolean;
  settled: boolean;
  station: number;
  /** The rung's `figureLife`. */
  life: FigureLifeLevel;
  /** prefers-reduced-motion under the (forced) route tier. */
  reducedMotion: boolean;
  frustum: FrustumLike;
  cameraPosition: { x: number; y: number; z: number };
  activeBoard: { x: number; z: number } | null;
  faceDistanceNdc: (sphere: BeatSphere) => number | null;
  /**
   * A1 fix-2 (R14, additive): the unit direction shadows are cast along (from
   * the key light toward the ground), so the frustum gate pads a caster's
   * sphere by its shadow's reach. Null / absent: no shadow padding (no
   * shadow-casting key light).
   */
  shadowDir?: { x: number; y: number; z: number } | null;
  /**
   * A2 fix (K1, additive): the world-space centre of the open focus subject's
   * bounds (`FocusSubject.bounds`), null / absent when no focus is open or it
   * is unknown. Quiet mode beats the focused participant's figure nearest it
   * (the figure the focus frames); without it, the one nearest the camera.
   */
  focusCenter?: { x: number; y: number; z: number } | null;
}

/** Where the director reads its registrations (the module registry in production, fakes in tests). */
export interface FigureDirectorSource {
  figures(): readonly FigureRegistration[];
  actors(): readonly ActorRegistration[];
  /** Bumps on every register / unregister. */
  version(): number;
}

/** One directed figure's evidence row (`__routeWorldFigures`, A1 step 8). */
export interface DirectedFigureRow {
  id: string;
  clip: string | null;
  clipKey: string | null;
  /** The allocated base phase in [0, 1) (null: clip-less / not directed). */
  phase: number | null;
  timeScale: number | null;
  role: string | null;
  subjectId: string | null;
  dormant: boolean;
  mover: boolean;
  moverGranted: boolean;
  /** Fidget passes started since load (P12: a cumulative counter, not a sample). */
  fidgets: number;
  fidgetsByClip: Readonly<Record<string, number>>;
  breathing: boolean;
  /** A1 fix-2 (R14, additive): the mixer was NOT sampled in the last step (out of view or hidden; the logic still stepped). */
  gated?: boolean;
}

export interface FigureDirector {
  readonly bus: AmbientBeatBus;
  step(input: DirectorFrameInput): void;
  /** Canonical clocks for captures (A1 step 6): every figure, fidget, breath, actor and bus clock at `t`, re-posed. */
  pinPhase(t: number): void;
  /** Allocate now (idempotent within a generation before live). Normally triggered by `residencyComplete`. */
  allocate(): void;
  row(id: string): DirectedFigureRow | null;
  moverGranted(id: string): boolean;
  /** Figure / actor ids first registered after the reveal armed (the D23 tripwire; empty in a healthy run). */
  lateRegistrations(): readonly string[];
  awakeS(): number;
  /** Mixer-update time of the last step (ms; 0 without `options.clock`). */
  mixerMs(): number;
  /** The context of the last step (debug / tests). */
  context(): Readonly<DirectorStepContext>;
  /**
   * Releases what the director holds on things that can outlive it: today its
   * roll-call listener on `bus` (a bus passed in `options.bus` may outlive the
   * director). Idempotent; the director is not stepped after it. (Additive to
   * the frozen interface, PR #65 test-pass follow-up.)
   */
  dispose(): void;
}

export interface FigureDirectorOptions {
  /** Phase / fidget / breath seed (the beat seed's world default). */
  seed?: number;
  force?: BeatForce;
  bus?: AmbientBeatBus;
  ledger?: DirectorLedger;
  /** Called once per late registration (FigureDirector.tsx forwards it to the warm-stats ledger). */
  onLateRegistration?: (id: string) => void;
  /**
   * A clock (ms) for the debug ledger: when given, the time spent inside
   * mixer updates is summed per step (`mixerMs`), so the director's OWN cost
   * is separable from the skinning-clip sampling it drives.
   */
  clock?: () => number;
}

/* ------------------------------------------------------------------------ */
/* Figure-set change notification (D42 N3's tagger)                         */
/* ------------------------------------------------------------------------ */

/** One subscription (an entry object, so the same callback can subscribe twice and unsubscribe once). */
interface FigureSetListener {
  readonly cb: () => void;
  /** The listener has thrown and been logged once (later throws stay silent: no per-step spam). */
  reported: boolean;
}

const figureSetListeners = new Set<FigureSetListener>();

/**
 * D42 (the frozen cross-seat interface for N3): `cb` runs after figures
 * register or unregister, at most once per frame. A director step that saw
 * the registered figure set change (a figure added, removed or replaced)
 * notifies at the END of that step, once, whatever number of registrations
 * the frame brought; a step that saw no change notifies nothing (the
 * steady-state step pays one boolean test). A change a `pinPhase` sync
 * picks up is notified at the next step's end. Module-level: every director
 * notifies the same listeners. Returns the unsubscribe.
 */
export function onFigureSetChanged(cb: () => void): () => void {
  const entry: FigureSetListener = { cb, reported: false };
  figureSetListeners.add(entry);
  return () => {
    figureSetListeners.delete(entry);
  };
}

function notifyFigureSetChanged(): void {
  // A Set iterates entries added during the loop too; a listener unsubscribing
  // itself (or another) mid-loop is skipped safely. One throwing listener
  // never starves the others or breaks the director's frame. Its first throw
  // is logged in every environment (production included), once per
  // subscription, so a listener that keeps failing cannot flood the console.
  for (const entry of figureSetListeners) {
    try {
      entry.cb();
    } catch (error) {
      if (!entry.reported) {
        entry.reported = true;
        console.error('[figure-director] onFigureSetChanged listener threw', error);
      }
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Tunables                                                                 */
/* ------------------------------------------------------------------------ */

/** Idles shorter than this loop slower (disclosed): a sub-0.7 s idle reads as a jitter. */
export const SHORT_IDLE_S = 0.7;
export const SHORT_IDLE_TIME_SCALE = 0.7;
/** Clip crossfade (equals `SETTLE_S` in figure-behavior.ts). */
export const DIRECTOR_CROSSFADE_S = 0.35;
/** Breath: ±1 % vertical swell at 1.7 rad/s (the pre-3A `Figure.tsx` look). */
export const BREATH_AMPLITUDE = 0.01;
export const BREATH_RATE = 1.7;

/** A2 figure beats (R17, D16): the look beat's length (s), its yaw (6°) and its breath swell. */
export const LOOK_BEAT_S = 2.4;
export const LOOK_BEAT_RAD = (6 * Math.PI) / 180;
export const LOOK_BEAT_BREATH = 0.015;
/** A2 quiet mode: the idle dwell of every figure other than the focused participant's runs at this rate (its fidget rate halves). */
export const QUIET_FIDGET_RATE = 0.5;
/** R35: past a fidget pass's end when a beat ends inside one (the schedule's boundary is half-open). */
const FIDGET_SKIP_EPS_S = 1e-6;
/** The actor id the director requests the data-bound roll-call beat under. */
export const ROLL_CALL_ACTOR_ID = 'roll-call';

/** The base clip's playback rate: sub-0.7 s idles at 0.7, else the authored rate. */
export function baseTimeScaleFor(clip: string | null, durationS: number | undefined, authored: number): number {
  if (clip === null) return authored;
  if (!isLocomotionClip(clip) && typeof durationS === 'number' && durationS > 0 && durationS < SHORT_IDLE_S) return SHORT_IDLE_TIME_SCALE;
  return authored;
}

/**
 * R14 frustum gate padding: an animated pose can reach past the rest bounds
 * (a stretch, a tail swing), so the gate tests `radius · FRUSTUM_PAD_SCALE +
 * FRUSTUM_PAD_M` (both in world metres after the root's scale).
 */
export const FRUSTUM_PAD_SCALE = 1.5;
export const FRUSTUM_PAD_M = 0.5;
/**
 * R14: the longest shadow sweep (m) a caster's sphere is padded by. The
 * sweep is the figure's top height over the key's descent (height / tan
 * elevation); a grazing key is bounded here (beyond the fitted shadow
 * frustum's reach, ~60 m across, a shadow is not drawn anyway).
 */
export const SHADOW_SWEEP_MAX_M = 40;

/**
 * R18 (a): the focus store's id → the bare participant id that
 * `FigureRegistration.subjectId` carries. `team:<id>` → `<id>`; every other
 * focus kind (boards, stations, fixtures), and an empty id, → null.
 */
export function focusSubjectOf(focusId: string | null | undefined): string | null {
  if (typeof focusId !== 'string' || !focusId.startsWith('team:')) return null;
  const id = focusId.slice('team:'.length);
  return id.length > 0 ? id : null;
}

/** Loop time of `phase` on a shared clock `t` (s): `(t · timeScale + phase · dur) mod dur`. */
export function seatTime(phase: number, t: number, timeScale: number, durationS: number): number {
  const dur = Math.max(durationS, 1e-3);
  const raw = (t * timeScale) / dur + phase;
  return (raw - Math.floor(raw)) * dur;
}

/* ------------------------------------------------------------------------ */
/* Core                                                                     */
/* ------------------------------------------------------------------------ */

interface FigureSlot {
  reg: FigureRegistration;
  directed: boolean;
  owns: boolean;
  baseClip: string | null;
  baseDur: number;
  baseTs: number;
  clipKey: string | null;
  phase: number;
  /** Seeded per-figure numbers. */
  seed: number;
  breathPhase: number;
  plan: FidgetPlan | null;
  frame: FidgetFrame;
  /** This figure's own awake clock (fidgets, breath). */
  t: number;
  fidgetClip: string | null;
  fidgets: number;
  fidgetsByClip: Record<string, number>;
  wasDormant: boolean;
  breathing: boolean;
  late: boolean;
  /** Prop-controlled figures: the clip seen last frame (fidget passes are counted on entry). */
  lastClip: string | null;
  /** R18 (b): a prop-controlled figure whose clip flips count as fidgets (role `walker` only). */
  countsPropFidgets: boolean;
  /** R14: the mixer was NOT sampled last frame (gated); the next sampled frame re-seats first. */
  gated: boolean;
  /** A2: the fidget schedule's clock (awake s; half rate between fidgets in quiet mode). */
  fidgetT: number;
  /** A2: the running figure beat (`BEAT_NONE` / `BEAT_IDLE2` / `BEAT_LOOK`), its elapsed time and length. */
  beat: number;
  beatT: number;
  beatDur: number;
  beatStarted: boolean;
  /** A2: ±1, the seeded side of the look beat. */
  lookSign: number;
}

const BEAT_NONE = 0;
const BEAT_IDLE2 = 1;
const BEAT_LOOK = 2;

interface ActorSlot {
  reg: ActorRegistration;
  frame: ActorFrame;
  granted: boolean;
  late: boolean;
}

const NOOP_LEDGER: DirectorLedger = { noteAppearance() {}, noteWaterline() {} };

const NO_FRUSTUM: FrustumLike = { intersectsSphere: () => true };

/** The world-default seed when no `?beatSeed=` is given. */
export const DEFAULT_DIRECTOR_SEED = hashText('figure-director|v1');

export function createFigureDirector(source: FigureDirectorSource, options: FigureDirectorOptions = {}): FigureDirector {
  const seed = (options.seed ?? DEFAULT_DIRECTOR_SEED) >>> 0;
  const force = options.force ?? NO_BEAT_FORCE;
  const bus = options.bus ?? createAmbientBeatBus({ force, seed });
  const ledger = options.ledger ?? NOOP_LEDGER;

  let figures: FigureSlot[] = [];
  let actors: ActorSlot[] = [];
  const figureById = new Map<string, FigureSlot>();
  let seenVersion = -1;
  let generation = -1;
  let allocated = false;
  let wasLive = false;
  let firstSettleAt: number | null = null;
  let lastSettleAt: number | null = null;
  let wasSettled = false;
  const late: string[] = [];
  /** D42: the registered figure set changed in a sync; notified once at the end of the next step. */
  let figureSetDirty = false;
  /**
   * The per-frame scalars, kept on ONE object (not closure `let`s): a double
   * written to a function-context slot is boxed afresh on every store, a
   * double object field is updated in place, so the steady-state step stays
   * allocation-free (tested with a heap delta).
   *  - `awake`: the awake clock (every clipKey's shared clock).
   *  - `seatLag`: seats written inside a step are followed by that step's
   *    mixer update (+dt), so they are written `dt` behind the clock: after
   *    the update every base action sits exactly on `seatTime(phase, awake)`
   *    (0 outside a step).
   *  - `mixerTime`: ms inside mixer updates this step (debug clock only).
   */
  const clk = { awake: 0, seatLag: 0, mixerTime: 0 };
  /** Set by `pinPhase`: the next step advances nothing. */
  let pinHold = false;
  /** True for the whole step right after a pin: every figure samples (R14). */
  let pinStep = false;
  const clock = options.clock ?? null;
  /** Mover ranking scratch (indexes into `actors`). */
  let moverOrder: number[] = [];
  /**
   * A2 quiet mode: `on` while a focus is open; `done` once the focused
   * participant's beat fired (retried each frame until one of its figures is
   * awake to play it); `lastQuiet` the participant focused last frame.
   */
  const quiet = { on: false, done: false, subjectId: null as string | null };
  /** A2 fix (K1): where quiet mode measures from this frame (the focus centre, else the camera). */
  const quietAt = { x: 0, y: 0, z: 0 };
  let lastQuiet: string | null = null;
  /**
   * A2 roll call: the ledger's last published call (copied at the event),
   * `pending` until the bus grants the data-bound beat, then `running` on the
   * awake clock from `startS`; `next` is the next column, `endS` when the
   * last fired beat ends (relative to the start), `sawSettled` whether the
   * director has seen the station settled since the call arrived (leaving
   * after that cancels the rest of the call).
   */
  const call = {
    participants: [] as readonly string[],
    offsets: [] as readonly number[],
    pending: false,
    running: false,
    sawSettled: false,
    startS: 0,
    endS: 0,
    next: 0,
  };
  let callTicket: BeatTicket | null = null;

  const ctx: DirectorStepContext = {
    dt: 0,
    awakeS: 0,
    sinceSettleS: null,
    forceClockS: null,
    generation: -1,
    live: false,
    settled: false,
    station: 0,
    hidden: false,
    loader: false,
    focusOpen: false,
    focusSubjectId: null,
    life: 'full',
    budget: figureLifeBudget('full'),
    motion: 'full',
    frustum: NO_FRUSTUM,
    cameraPosition: { x: 0, y: 0, z: 0 },
    activeBoard: null,
    bus,
    force,
    seed,
    ledger,
    faceDistanceNdc: () => null,
  };

  const directedOf = (reg: FigureRegistration): boolean =>
    typeof reg.play === 'function' && Array.isArray(reg.clips) && typeof reg.currentClip === 'function';

  const makeFigureSlot = (reg: FigureRegistration, lateNow: boolean): FigureSlot => {
    const directed = directedOf(reg);
    const clips = reg.clips ?? [];
    const baseClip = directed ? (reg.baseClip ?? null) : null;
    const baseDur = baseClip !== null ? (reg.durations?.[baseClip] ?? 0) : 0;
    const figureSeed = hash01(seed, hashText(reg.id)) * 4294967296 >>> 0;
    const owns = directed && reg.directorOwnsClip !== false;
    return {
      reg,
      directed,
      owns,
      baseClip,
      baseDur,
      baseTs: baseTimeScaleFor(baseClip, baseDur, reg.baseTimeScale ?? 1),
      clipKey: baseClip !== null && reg.model ? clipKeyFor(reg.model, baseClip) : null,
      phase: hash01(seed ^ 0x9e3779b1, hashText(reg.id)),
      seed: figureSeed,
      breathPhase: hash01(figureSeed, 0xb4ea7) * Math.PI * 2,
      plan: owns && baseClip !== null ? createFidgetPlan(figureSeed, clips, reg.durations) : null,
      frame: createFidgetFrame(),
      t: clk.awake - clk.seatLag,
      fidgetClip: null,
      fidgets: 0,
      fidgetsByClip: {},
      wasDormant: false,
      breathing: false,
      late: lateNow,
      lastClip: null,
      countsPropFidgets: directed && !owns && (reg.getRole?.() ?? reg.role ?? null) === 'walker',
      gated: false,
      fidgetT: clk.awake - clk.seatLag,
      beat: BEAT_NONE,
      beatT: 0,
      beatDur: 0,
      beatStarted: false,
      lookSign: hash01(figureSeed, 0x100c) < 0.5 ? -1 : 1,
    };
  };

  const noteLate = (id: string) => {
    late.push(id);
    options.onLateRegistration?.(id);
  };

  /** Re-read the registry (only when its version moved). */
  const sync = (live: boolean) => {
    const version = source.version();
    if (version === seenVersion) return;
    seenVersion = version;
    const nextFigures: FigureSlot[] = [];
    const previous = new Map<FigureRegistration, FigureSlot>();
    for (const slot of figures) previous.set(slot.reg, slot);
    figureById.clear();
    let added = false;
    for (const reg of source.figures()) {
      let slot = previous.get(reg);
      if (!slot) {
        slot = makeFigureSlot(reg, live && allocated);
        if (live && allocated) noteLate(reg.id);
        added = true;
      }
      nextFigures.push(slot);
      if (!figureById.has(reg.id)) figureById.set(reg.id, slot);
    }
    figures = nextFigures;
    if (added || nextFigures.length !== previous.size) figureSetDirty = true;
    const prevActors = new Map<ActorRegistration, ActorSlot>();
    for (const slot of actors) prevActors.set(slot.reg, slot);
    const nextActors: ActorSlot[] = [];
    for (const reg of source.actors()) {
      let slot = prevActors.get(reg);
      if (!slot) {
        const lateNow = live && allocated;
        slot = { reg, frame: { moverSlot: true, t: clk.awake - clk.seatLag, dormant: false }, granted: true, late: lateNow };
        if (lateNow) noteLate(reg.id);
      }
      nextActors.push(slot);
    }
    actors = nextActors;
    moverOrder = new Array<number>(actors.length).fill(0);
    // Before the reveal a registry change re-allocates (C2); from it, never (C3).
    if (allocated && !live && (added || nextFigures.length !== previous.size)) allocateNow();
    else if (allocated && live) {
      for (const slot of figures) if (slot.late && slot.clipKey !== null) seatBase(slot, 0);
    }
  };

  const allocateNow = () => {
    const members: { id: string; clipKey: string }[] = [];
    for (const slot of figures) if (slot.directed && slot.clipKey !== null) members.push({ id: slot.reg.id, clipKey: slot.clipKey });
    const phases = allocateClipPhases(members, seed);
    for (const slot of figures) {
      const phase = phases.get(slot.reg.id);
      if (phase !== undefined) slot.phase = phase;
      if (slot.directed && slot.reg.isDormant?.() === true) {
        // D42 N5: a figure dormant from mount never reaches its step's mixer
        // update (`stepFigure` returns first), so it stood in the never-mixed
        // pose (the export's rest / T-pose) until it woke. Mirror `pinPhase`:
        // seat at the clock itself (lag 0: no step update follows for it)
        // and sample once by exactly 0 (D40), so it holds its allocated pose.
        // The wake re-seat is unchanged. (Pinned captures pose every figure
        // in `pinPhase`, so they are identical by construction.)
        if (slot.fidgetClip === null) seatBase(slot, 0, 0);
        slot.reg.mixer?.update(0);
      } else if (slot.directed && slot.fidgetClip === null) seatBase(slot, 0);
    }
    allocated = true;
  };

  /**
   * Cut or crossfade the figure to its base clip at the shared clock. `lag`
   * is how far behind the clock the seat is written (the step's own mixer
   * update then advances it; 0 when the seat is followed by `update(0)`).
   */
  const seatBase = (slot: FigureSlot, fadeS: number, lag: number = clk.seatLag) => {
    const reg = slot.reg;
    if (!slot.directed || !reg.play) return;
    if (!slot.owns) {
      // Prop-controlled (the Walker): seat whatever it plays now, never flip it.
      const clip = reg.currentClip?.() ?? null;
      if (clip === null) return;
      const action = reg.getAction?.(clip) ?? null;
      const dur = reg.durations?.[clip] ?? action?.getClip().duration ?? 1;
      const ts = action?.timeScale ?? 1;
      const phase = hash01(slot.seed, hashText(clip));
      reg.play(clip, seatTime(phase, clk.awake - lag, ts, dur), 0, ts);
      return;
    }
    if (slot.baseClip === null) {
      reg.play(null, 0, 0, 1);
      return;
    }
    reg.play(slot.baseClip, seatTime(slot.phase, clk.awake - lag, slot.baseTs, slot.baseDur), fadeS, slot.baseTs);
  };

  /**
   * R14: the frame's shadow direction, copied from the input. Doubles live in
   * typed arrays here and in the sphere scratch below: V8 boxes a double it
   * keeps in a phi of mixed Smi / double (the heap-delta test caught ~10 B per
   * gated figure per step before this), a Float64Array slot never.
   */
  const shadow = { on: false, dir: new Float64Array([0, -1, 0]) };

  /** Shown in the scene: the root and every ancestor visible (R14, R18 c). */
  const shownInScene = (root: Object3DLike): boolean => {
    let node: Object3DLike | null | undefined = root;
    for (let depth = 0; node && depth < 64; depth += 1) {
      if (!node.visible) return false;
      node = node.parent;
    }
    return true;
  };

  /**
   * R14: the figure's padded bounding sphere, swept along the key light by
   * its shadow's reach when it casts one, intersects the camera frustum.
   * Without bounds a figure always counts as in view. Scratch `sph`:
   * [0..2] the centre, [3] the radius, [4] the top height, [5] half the reach.
   */
  const sph = new Float64Array(6);
  const inView = (slot: FigureSlot, root: Object3DLike): boolean => {
    const bounds = slot.reg.bounds;
    if (!bounds) return true;
    const e = root.matrixWorld.elements;
    const scale = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
    const cy0 = bounds.centerY;
    sph[3] = bounds.radius * scale * FRUSTUM_PAD_SCALE + FRUSTUM_PAD_M;
    sph[0] = e[12] + e[4] * cy0;
    sph[1] = e[13] + e[5] * cy0;
    sph[2] = e[14] + e[6] * cy0;
    if (bounds.castsShadow && shadow.on) {
      const d = shadow.dir;
      // The top of the padded sphere above the root (the feet), cast down the
      // key: the reach is height / tan(elevation), bounded; the sphere that
      // encloses the swept capsule sits at its midpoint, radius + half the reach.
      sph[4] = sph[1] - e[13];
      if (sph[4] < 0) sph[4] = 0;
      sph[4] += sph[3];
      sph[5] = SHADOW_SWEEP_MAX_M;
      if (d[1] < -1e-3 && sph[4] < SHADOW_SWEEP_MAX_M * -d[1]) sph[5] = sph[4] / -d[1];
      sph[5] *= 0.5;
      sph[0] += d[0] * sph[5];
      sph[1] += d[1] * sph[5];
      sph[2] += d[2] * sph[5];
      sph[3] += sph[5];
    }
    const planes = ctx.frustum.planes;
    if (planes === undefined || planes.length < 24) return ctx.frustum.intersectsSphere(sph[0], sph[1], sph[2], sph[3]);
    for (let p = 0; p < 24; p += 4) {
      if (planes[p] * sph[0] + planes[p + 1] * sph[1] + planes[p + 2] * sph[2] + planes[p + 3] < -sph[3]) return false;
    }
    return true;
  };

  /**
   * R14 re-entry: seat the figure analytically for THIS frame (lag 0): a
   * fidget in progress at its exact elapsed time, else the base clip on the
   * shared clock; a cut, never a crossfade. The caller then updates by 0.
   */
  const reseat = (slot: FigureSlot) => {
    if (slot.beat === BEAT_IDLE2 && slot.beatStarted) slot.reg.play?.('idle2', slot.beatT, 0, 1);
    else if (slot.fidgetClip !== null) slot.reg.play?.(slot.fidgetClip, slot.frame.elapsedS, 0, 1);
    else seatBase(slot, 0, 0);
  };

  /* -- A2 figure beats (quiet mode, roll call) -- */

  const beatsAllowed = () => ctx.motion === 'full' && ctx.budget.fidgets;

  /** End the running beat (the look back to the authored heading); the caller re-seats an idle2 beat's clip. */
  const endBeat = (slot: FigureSlot) => {
    if (slot.beat === BEAT_LOOK) slot.reg.look?.(0);
    slot.beat = BEAT_NONE;
    slot.beatT = 0;
    slot.beatStarted = false;
  };

  /**
   * R35: a beat's natural end (it ran out, its figure went dormant, or motion
   * went static / reduced, D12). The fidget clock was held while it ran; if
   * that clock sits inside a fidget pass (the beat began during one), it skips
   * to the pass's end, so no fidget is in progress when the beat ends and the
   * figure never cuts into a fidget part-way. An idle2 beat that had started
   * crossfades back to the base clip. (A pin or a generation change ends a
   * beat with `endBeat` alone: they set the clocks themselves.)
   */
  const finishBeat = (slot: FigureSlot) => {
    const idle2 = slot.beat === BEAT_IDLE2 && slot.beatStarted;
    endBeat(slot);
    const plan = slot.plan;
    if (plan !== null && plan.hasIdle && plan.fidgets.length > 0) {
      const frame = fidgetAt(plan, slot.fidgetT, slot.frame);
      if (frame.fidget) slot.fidgetT += frame.remainingS + FIDGET_SKIP_EPS_S;
    }
    if (idle2 && slot.owns) seatBase(slot, DIRECTOR_CROSSFADE_S);
  };

  /**
   * The beat `slot` would play now (R17): idle2 when the director owns the
   * figure's clips and it has idle2, else breath plus the 6° look; null when
   * it cannot beat (not directed, dormant, no look hook, static motion or a
   * rung without fidgets). The ONE guard `startBeat` and the quiet picker
   * share (A2-3), so the picker never chooses a figure `startBeat` refuses.
   */
  const beatModeOf = (slot: FigureSlot): FigureBeatRecord['mode'] | null => {
    if (!slot.directed || !beatsAllowed() || slot.reg.isDormant?.() === true) return null;
    const clips = slot.reg.clips ?? [];
    if (slot.owns && slot.baseClip !== null && slot.baseClip !== 'idle2' && clips.includes('idle2')) return 'idle2';
    return typeof slot.reg.look === 'function' ? 'look' : null;
  };

  /**
   * Start one figure beat (R17); the beat itself starts in the figure's next
   * step. False when the figure cannot beat (`beatModeOf`).
   *
   * A2 fix (K1 overlap): a running beat is NEVER restarted, so its look or
   * idle2 never snaps back to its start. A roll-call hit on a figure that is
   * mid-beat takes the running beat over (recorded, `beatT` kept: the figure
   * is already moving, K3 still sees its hit). A quiet beat on a figure that
   * is mid-beat is refused, so quiet mode retries each frame and fires a
   * fresh beat once the running one has finished (`finishBeat`).
   */
  const startBeat = (slot: FigureSlot, source: FigureBeatRecord['source'], subjectId: string): boolean => {
    const next = beatModeOf(slot);
    if (next === null) return false;
    const reg = slot.reg;
    if (slot.beat !== BEAT_NONE) {
      if (source === 'quiet') return false;
      bus.noteFigureBeat?.({ source, subjectId, figureId: reg.id, mode: slot.beat === BEAT_IDLE2 ? 'idle2' : 'look', intoS: slot.beatT });
      return true;
    }
    if (next === 'idle2') {
      const dur = reg.durations?.idle2 ?? reg.getAction?.('idle2')?.getClip().duration ?? 0;
      slot.beat = BEAT_IDLE2;
      slot.beatDur = dur > 0 ? dur : 1;
    } else {
      slot.beat = BEAT_LOOK;
      slot.beatDur = LOOK_BEAT_S;
    }
    slot.beatT = 0;
    slot.beatStarted = false;
    bus.noteFigureBeat?.({ source, subjectId, figureId: reg.id, mode: next });
    return true;
  };

  /** One frame of a running beat (inside the figure's step, before its mixer update). */
  const stepBeat = (slot: FigureSlot, dt: number) => {
    const reg = slot.reg;
    slot.beatT += dt;
    if (slot.beat === BEAT_IDLE2) {
      if (!slot.beatStarted) {
        slot.beatStarted = true;
        slot.fidgetClip = null;
        // Written `seatLag` behind so the step's own mixer update lands it on beatT.
        reg.play?.('idle2', slot.beatT - clk.seatLag, DIRECTOR_CROSSFADE_S, 1);
      }
      if (slot.beatT >= slot.beatDur) finishBeat(slot);
      return;
    }
    slot.beatStarted = true;
    const u = Math.min(slot.beatT / slot.beatDur, 1);
    reg.look?.(slot.lookSign * LOOK_BEAT_RAD * (0.5 - 0.5 * Math.cos(2 * Math.PI * u)));
    if (u >= 1) finishBeat(slot);
  };

  /**
   * A2 fix (K1 / R40): quiet mode is ONE beat for the focused SUBJECT. A
   * participant can own several figures (sakura: the #pulse grandstand ace
   * `figure-<id>` and the #teams statuary ace `sakura-ace-<id>`). The beat
   * goes to the figure that can beat and is shown in the scene first, then
   * the one nearest `quietAt` (the focus subject's bounds centre: the figure
   * the focus frames; the camera when the centre is unknown), then registry
   * order. No frustum tier: with a focus open the director samples
   * everywhere (FigureDirector.tsx), so a frustum test could never decide.
   * Index loop, no allocation.
   */
  const pickQuietFigure = (subjectId: string): FigureSlot | null => {
    let best: FigureSlot | null = null;
    let bestShown = false;
    let bestD2 = Infinity;
    for (let i = 0; i < figures.length; i += 1) {
      const slot = figures[i];
      if (slot.reg.subjectId !== subjectId || beatModeOf(slot) === null) continue;
      const root = slot.reg.object.current;
      const shown = root !== null && shownInScene(root);
      let d2 = Infinity;
      if (root !== null) {
        const e = root.matrixWorld.elements;
        const dx = e[12] - quietAt.x;
        const dy = e[13] - quietAt.y;
        const dz = e[14] - quietAt.z;
        d2 = dx * dx + dy * dy + dz * dz;
      }
      if (best === null || (shown && !bestShown) || (shown === bestShown && d2 < bestD2)) {
        best = slot;
        bestShown = shown;
        bestD2 = d2;
      }
    }
    return best;
  };

  /**
   * Fire `source` beats for `subjectId`: a roll call beats EVERY figure of the
   * subject (K3 hits per figure); quiet mode beats ONE (`pickQuietFigure`; 0
   * while that figure is still mid-beat, so the caller retries). The longest
   * REMAINING beat length (0: none fired).
   */
  const beatSubject = (subjectId: string, source: FigureBeatRecord['source']): number => {
    if (source === 'quiet') {
      const slot = pickQuietFigure(subjectId);
      return slot !== null && startBeat(slot, source, subjectId) ? slot.beatDur - slot.beatT : 0;
    }
    let longest = 0;
    for (let i = 0; i < figures.length; i += 1) {
      const slot = figures[i];
      if (slot.reg.subjectId !== subjectId || !startBeat(slot, source, subjectId)) continue;
      const left = slot.beatDur - slot.beatT;
      if (left > longest) longest = left;
    }
    return longest;
  };

  const cancelCall = () => {
    if (callTicket !== null) bus.release(callTicket);
    callTicket = null;
    call.pending = false;
    call.running = false;
  };

  /** The roll call's frame: request, start on the grant, fire due columns, release when done or left. */
  const stepRollCall = () => {
    if (!call.pending && !call.running) return;
    if (ctx.settled) call.sawSettled = true;
    else if (call.sawSettled) {
      cancelCall();
      return;
    }
    if (call.pending) {
      if (callTicket === null || callTicket.state === 'released') callTicket = bus.request('rollCall', ROLL_CALL_ACTOR_ID, null);
      if (callTicket.state !== 'granted') return;
      call.pending = false;
      call.running = true;
      call.startS = clk.awake;
      call.endS = 0;
      call.next = 0;
    }
    const elapsed = clk.awake - call.startS;
    const n = call.participants.length;
    while (call.next < n) {
      const at = call.offsets[call.next] ?? 0;
      if (elapsed < at) break;
      const longest = beatSubject(call.participants[call.next], 'rollCall');
      if (at + longest > call.endS) call.endS = at + longest;
      call.next += 1;
    }
    if (call.next >= n && elapsed >= call.endS) cancelCall();
  };

  // Kept so `dispose` can detach it: a bus handed in through `options.bus`
  // can outlive this director and would otherwise accumulate its listeners.
  let unsubscribeBus: (() => void) | null = bus.subscribe((event) => {
    if (event.kind !== 'rollCall') return;
    cancelCall();
    call.participants = event.participants.slice();
    call.offsets = event.columnOffsetsS.slice();
    call.pending = call.participants.length > 0;
    call.sawSettled = false;
  });

  const advanceMixer = (mixer: MixerLike, dt: number) => {
    if (clock) {
      const t0 = clock();
      mixer.update(dt);
      clk.mixerTime += clock() - t0;
    } else {
      mixer.update(dt);
    }
  };

  const fidgetsAllowed = () => ctx.motion === 'full' && ctx.budget.fidgets;

  const stepFigure = (slot: FigureSlot, dt: number) => {
    const reg = slot.reg;
    const dormant = reg.isDormant?.() === true;
    if (dormant) {
      slot.wasDormant = true;
      return;
    }
    if (!slot.directed) return;
    slot.t += dt;
    // R35 (D12): motion went static / reduced (or the rung lost its fidgets): a running beat ends now.
    if (slot.beat !== BEAT_NONE && !beatsAllowed()) finishBeat(slot);
    // A2 quiet mode: between fidgets the schedule of every figure OTHER than
    // the focused participant's runs at half rate (a fidget in progress keeps
    // its speed). R35: the clock is held while a beat runs.
    if (slot.beat === BEAT_NONE) {
      const halved = quiet.on && slot.fidgetClip === null && (quiet.subjectId === null || slot.reg.subjectId !== quiet.subjectId);
      slot.fidgetT += halved ? dt * QUIET_FIDGET_RATE : dt;
    }
    if (slot.wasDormant) {
      slot.wasDormant = false;
      // A beat that was running when the figure went dormant does not survive it (its moment has passed).
      if (slot.beat !== BEAT_NONE && slot.beatStarted) finishBeat(slot);
      // Re-seat on wake: a dormant mixer stopped while its clipKey neighbours advanced.
      if (slot.owns && slot.fidgetClip === null) seatBase(slot, 0);
    }
    if (slot.beat !== BEAT_NONE) {
      // A2: a running beat (quiet mode, roll call) holds the fidget plan off.
      stepBeat(slot, dt);
    } else if (slot.owns && slot.plan !== null) {
      if (fidgetsAllowed() && slot.plan.fidgets.length > 0 && slot.plan.hasIdle) {
        const frame = fidgetAt(slot.plan, slot.fidgetT, slot.frame);
        if (frame.fidget && frame.clip !== null) {
          if (slot.fidgetClip !== frame.clip) {
            slot.fidgetClip = frame.clip;
            slot.fidgets += 1;
            slot.fidgetsByClip[frame.clip] = (slot.fidgetsByClip[frame.clip] ?? 0) + 1;
            reg.play?.(frame.clip, frame.elapsedS - clk.seatLag, DIRECTOR_CROSSFADE_S, 1);
            bus.emit({ kind: 'fidget', figureId: reg.id, clip: frame.clip, t: clk.awake });
          }
        } else if (slot.fidgetClip !== null) {
          slot.fidgetClip = null;
          seatBase(slot, DIRECTOR_CROSSFADE_S);
        }
      } else if (slot.fidgetClip !== null) {
        slot.fidgetClip = null;
        seatBase(slot, DIRECTOR_CROSSFADE_S);
      }
    } else if (slot.countsPropFidgets) {
      // Prop-controlled WALKER (R18 b): count its fidget passes too (P12).
      // Residents and flyers (D) are sequenced by their actors: never counted.
      const clip = reg.currentClip?.() ?? null;
      if (clip !== slot.lastClip) {
        if (clip !== null && clip !== 'idle' && !isLocomotionClip(clip) && reg.lowMotion !== true) {
          slot.fidgets += 1;
          slot.fidgetsByClip[clip] = (slot.fidgetsByClip[clip] ?? 0) + 1;
        }
        slot.lastClip = clip;
      }
    }
    // R14 / R18 (c): the logic above always steps; the mixer and the breath
    // run only for a figure that is shown and (director-owned figures, once
    // live) in view. Before live every figure samples (the warm's poses,
    // the push latch shows every actor), and the step after a pin samples all.
    const root = reg.object.current;
    const shown = root === null || shownInScene(root);
    const sample = shown && (!slot.owns || !ctx.live || pinStep || root === null || inView(slot, root));
    if (!sample) {
      if (slot.owns) slot.gated = true;
      return;
    }
    if (slot.gated) {
      slot.gated = false;
      reseat(slot);
      if (reg.mixer) advanceMixer(reg.mixer, 0);
    } else if (reg.mixer) {
      advanceMixer(reg.mixer, Math.min(Math.max(dt, 0), MIXER_MAX_STEP_S));
    }
    breathe(slot);
  };

  const breathe = (slot: FigureSlot) => {
    const root = slot.reg.object.current;
    if (!root) return;
    const wants = slot.reg.lowMotion === true && slot.reg.breathe !== false && ctx.motion === 'full';
    // A2: the look beat's one breath swell (R17), on top of any resting breath.
    const swell = slot.beat === BEAT_LOOK ? LOOK_BEAT_BREATH * Math.sin(Math.PI * Math.min(slot.beatT / slot.beatDur, 1)) : 0;
    if (wants || swell > 0) {
      root.scale.y = 1 + (wants ? Math.sin(slot.t * BREATH_RATE + slot.breathPhase) * BREATH_AMPLITUDE : 0) + swell;
      slot.breathing = true;
    } else if (slot.breathing) {
      root.scale.y = 1;
      slot.breathing = false;
    }
  };

  const actorStation = (slot: ActorSlot) => {
    const s = slot.reg.station;
    return typeof s === 'number' ? Math.abs(s - ctx.station) : 0;
  };

  const grantMovers = () => {
    const max = ctx.budget.maxMovers;
    let n = 0;
    for (let i = 0; i < actors.length; i += 1) {
      const slot = actors[i];
      if (!slot.reg.mover) {
        slot.granted = true;
        continue;
      }
      slot.granted = false;
      if (slot.frame.dormant || !ctx.budget.paths) continue;
      // Insertion sort by (distance to the active station, registry order): no allocation.
      let j = n;
      const d = actorStation(slot);
      while (j > 0 && actorStation(actors[moverOrder[j - 1]]) > d) {
        moverOrder[j] = moverOrder[j - 1];
        j -= 1;
      }
      moverOrder[j] = i;
      n += 1;
    }
    const slots = Math.min(n, max);
    for (let k = 0; k < slots; k += 1) actors[moverOrder[k]].granted = true;
  };

  const director: FigureDirector = {
    bus,

    step(input) {
      if (input.generation !== generation) {
        generation = input.generation;
        allocated = false;
        wasLive = false;
        firstSettleAt = null;
        lastSettleAt = null;
        wasSettled = false;
        late.length = 0;
        bus.reset();
        seenVersion = -1;
        callTicket = null;
        call.pending = false;
        call.running = false;
        lastQuiet = null;
        for (let i = 0; i < figures.length; i += 1) if (figures[i].beat !== BEAT_NONE) endBeat(figures[i]);
      }
      // The step right after a pin is the pin's own synchronous advance: it
      // poses the pinned clocks exactly (dt 0), whatever delta the canvas's
      // frameloop hands it (A1.6 determinism).
      const dt = input.hidden || pinHold ? 0 : Math.min(Math.max(Number.isFinite(input.delta) ? input.delta : 0, 0), MAX_STEP_S);
      pinStep = pinHold;
      pinHold = false;
      clk.awake += dt;
      const motion: DirectorMotion = input.reducedMotion ? 'static' : 'full';
      const life: FigureLifeLevel = motion === 'static' ? 'static' : input.life;
      if (input.settled && !wasSettled) lastSettleAt = clk.awake;
      // R41: the force clock arms on the first settled frame while live, not
      // only on a settle edge — the load station settles before the reveal.
      if (input.settled && input.live && firstSettleAt === null) firstSettleAt = clk.awake;
      wasSettled = input.settled;
      ctx.dt = dt;
      ctx.awakeS = clk.awake;
      ctx.sinceSettleS = input.settled && lastSettleAt !== null ? clk.awake - lastSettleAt : null;
      ctx.forceClockS = firstSettleAt !== null ? clk.awake - firstSettleAt : null;
      ctx.generation = input.generation;
      ctx.live = input.live;
      ctx.settled = input.settled;
      ctx.station = input.station;
      ctx.hidden = input.hidden;
      ctx.loader = input.loader;
      ctx.focusOpen = input.focusOpen;
      ctx.focusSubjectId = input.focusSubjectId;
      ctx.life = life;
      ctx.budget = figureLifeBudget(life);
      ctx.motion = motion;
      ctx.frustum = input.frustum;
      ctx.cameraPosition = input.cameraPosition;
      ctx.activeBoard = input.activeBoard;
      ctx.faceDistanceNdc = input.faceDistanceNdc;
      const dir = input.shadowDir ?? null;
      shadow.on = dir !== null;
      if (dir !== null) {
        shadow.dir[0] = dir.x;
        shadow.dir[1] = dir.y;
        shadow.dir[2] = dir.z;
      }

      clk.seatLag = dt;
      clk.mixerTime = 0;
      sync(input.live);
      if (!allocated && input.residencyComplete) allocateNow();
      if (input.live && !wasLive) {
        wasLive = true;
        // The reveal freezes the allocation (C3); allocate now if residency never reported.
        if (!allocated) allocateNow();
        bus.emit({ kind: 'reveal', generation: input.generation, t: clk.awake });
      }

      // A2 quiet mode: a focus is open; the focused participant's figures beat once per opening.
      quiet.on = input.focusOpen;
      const quietId = input.focusOpen ? input.focusSubjectId : null;
      quiet.subjectId = quietId;
      if (quietId !== lastQuiet) {
        lastQuiet = quietId;
        quiet.done = false;
      }
      const center = input.focusCenter ?? null;
      quietAt.x = center !== null ? center.x : input.cameraPosition.x;
      quietAt.y = center !== null ? center.y : input.cameraPosition.y;
      quietAt.z = center !== null ? center.z : input.cameraPosition.z;
      if (quietId !== null && !quiet.done && beatSubject(quietId, 'quiet') > 0) quiet.done = true;
      stepRollCall();

      for (let i = 0; i < figures.length; i += 1) stepFigure(figures[i], dt);
      clk.seatLag = 0;

      for (let i = 0; i < actors.length; i += 1) {
        const slot = actors[i];
        slot.frame.dormant = slot.reg.isDormant?.() === true;
      }
      grantMovers();
      for (let i = 0; i < actors.length; i += 1) {
        const slot = actors[i];
        if (!slot.frame.dormant) slot.frame.t += dt;
        slot.frame.moverSlot = slot.granted;
        slot.reg.step(ctx, slot.frame);
      }

      bus.grant(beatContext(ctx, input));

      // D42: after the frame's registrations are synced and stepped, once.
      if (figureSetDirty) {
        figureSetDirty = false;
        notifyFigureSetChanged();
      }
    },

    pinPhase(t) {
      const at = Math.max(0, Number.isFinite(t) ? t : 0);
      clk.awake = at;
      pinHold = true;
      bus.pin(at);
      sync(wasLive);
      if (!allocated) allocateNow();
      for (const slot of actors) {
        slot.frame.t = at;
        slot.reg.pin?.(at);
      }
      callTicket = null;
      call.pending = false;
      call.running = false;
      for (const slot of figures) {
        if (!slot.directed) continue;
        slot.t = at;
        slot.fidgetT = at;
        if (slot.beat !== BEAT_NONE) endBeat(slot);
        slot.wasDormant = false;
        // Posed below whatever its visibility: no re-seat pending (R14).
        slot.gated = false;
        slot.fidgetClip = null;
        slot.reg.look?.(0);
        if (slot.owns && slot.plan !== null && fidgetsAllowed() && slot.plan.fidgets.length > 0 && slot.plan.hasIdle) {
          const frame = fidgetAt(slot.plan, at, slot.frame);
          if (frame.fidget && frame.clip !== null) {
            slot.fidgetClip = frame.clip;
            slot.reg.play?.(frame.clip, frame.elapsedS, 0, 1);
          }
        }
        if (slot.fidgetClip === null) seatBase(slot, 0);
        slot.reg.mixer?.update(0);
        breathe(slot);
      }
    },

    allocate() {
      allocateNow();
    },

    row(id) {
      const slot = figureById.get(id);
      if (!slot) return null;
      const actor = actors.find((candidate) => candidate.reg.figureId === id) ?? null;
      const clip = slot.reg.currentClip?.() ?? null;
      const action = clip !== null ? (slot.reg.getAction?.(clip) ?? null) : null;
      return {
        id,
        clip,
        clipKey: clip !== null && slot.reg.model ? clipKeyFor(slot.reg.model, clip) : null,
        phase: slot.clipKey !== null ? slot.phase : null,
        timeScale: action ? action.timeScale : null,
        role: (slot.reg.getRole?.() ?? slot.reg.role ?? null) as string | null,
        subjectId: slot.reg.subjectId ?? null,
        dormant: slot.reg.isDormant?.() === true,
        mover: actor?.reg.mover === true,
        moverGranted: actor ? actor.granted : false,
        fidgets: slot.fidgets,
        fidgetsByClip: { ...slot.fidgetsByClip },
        breathing: slot.breathing,
        gated: slot.gated,
      };
    },

    moverGranted(id) {
      for (const slot of actors) if (slot.reg.id === id || slot.reg.figureId === id) return slot.granted;
      return false;
    },

    lateRegistrations() {
      return late;
    },

    awakeS() {
      return clk.awake;
    },

    mixerMs() {
      return clk.mixerTime;
    },

    context() {
      return ctx;
    },

    dispose() {
      unsubscribeBus?.();
      unsubscribeBus = null;
    },
  };

  return director;
}

/** The bus's view of the frame (one object reused). */
const beatScratch = {
  dt: 0,
  hidden: false,
  loader: false,
  focusOpen: false,
  focusSubjectId: null as string | null,
  live: false,
  settled: false,
  sinceSettleS: null as number | null,
  station: 0,
  staticMotion: false,
  faceDistanceNdc: (() => null) as (sphere: BeatSphere) => number | null,
};

function beatContext(ctx: DirectorStepContext, input: DirectorFrameInput) {
  beatScratch.dt = ctx.dt;
  beatScratch.hidden = input.hidden;
  beatScratch.loader = input.loader;
  beatScratch.focusOpen = input.focusOpen;
  beatScratch.focusSubjectId = input.focusSubjectId;
  beatScratch.live = input.live;
  beatScratch.settled = input.settled;
  beatScratch.sinceSettleS = ctx.sinceSettleS;
  beatScratch.station = input.station;
  beatScratch.staticMotion = ctx.motion === 'static';
  beatScratch.faceDistanceNdc = input.faceDistanceNdc;
  return beatScratch;
}

/**
 * R27: one rendered frame in `FigureDirector.tsx`'s order — the push latch
 * FIRST (`applyLatchVisibility`), then the director step — so an actor the
 * latch shows in frame N is sampled (mixer and breath) in frame N rather than
 * rendering its stale pose for a frame. `applyLatch` must be a stable,
 * allocation-free closure.
 */
export function runDirectorFrame(director: FigureDirector, input: DirectorFrameInput, applyLatch: () => void): void {
  applyLatch();
  director.step(input);
}

/** The largest NDC distance `sphereFaceDistanceNdc` reports (the frame's diagonal span is 2 per axis). */
export const FACE_NDC_FAR = 2;

/**
 * A2 (the clarity law's grant precondition, K4): the NDC distance of a
 * world-space sphere's projection from the nearest of `count` padded face
 * rects (`rects` packed `[x0, x1, y0, y1] × count`, NDC, y up) — 0 when they
 * overlap, `FACE_NDC_FAR` at most, null when there is no face (`count` 0).
 * `viewProjection` is the column-major view-projection of the frame and
 * `projX` / `projY` the projection's `elements[0]` / `elements[5]` (the NDC
 * scale of a unit length at depth w). A sphere that reaches the eye plane
 * cannot be judged and counts as touching (0). Allocation-free.
 */
export function sphereFaceDistanceNdc(
  viewProjection: ArrayLike<number>,
  projX: number,
  projY: number,
  sphere: BeatSphere,
  rects: ArrayLike<number>,
  count: number,
): number | null {
  if (count <= 0) return null;
  const e = viewProjection;
  const x = sphere.x;
  const y = sphere.y;
  const z = sphere.z;
  const r = Math.max(0, sphere.r);
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (!(w > r) || !(w > 1e-6)) return 0;
  const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
  const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
  const rx = (r * Math.abs(projX)) / w;
  const ry = (r * Math.abs(projY)) / w;
  let best = FACE_NDC_FAR;
  for (let k = 0; k < count; k += 1) {
    const o = k * 4;
    const dx = Math.max(rects[o] - (cx + rx), cx - rx - rects[o + 1], 0);
    const dy = Math.max(rects[o + 2] - (cy + ry), cy - ry - rects[o + 3], 0);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best) best = d;
  }
  return best;
}

/**
 * R34: the director's face source, fail closed. `unavailable` non-null (the
 * active world's faces, the camera, the viewport or the station are missing)
 * → `FACE_SOURCE_DENIED_NDC` (0): the bus denies every hero grant `ndc`.
 * Available with no active face on screen (`count` 0) → `FACE_NDC_FAR`
 * (nothing to overlap). Otherwise `sphereFaceDistanceNdc`. Never null.
 * Allocation-free.
 */
export function guardedFaceDistanceNdc(
  unavailable: FaceSourceReason | null,
  viewProjection: ArrayLike<number>,
  projX: number,
  projY: number,
  sphere: BeatSphere,
  rects: ArrayLike<number>,
  count: number,
): number {
  if (unavailable !== null) return FACE_SOURCE_DENIED_NDC;
  return sphereFaceDistanceNdc(viewProjection, projX, projY, sphere, rects, count) ?? FACE_NDC_FAR;
}
