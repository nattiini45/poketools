/**
 * Focus — framing math for the user-initiated close view of one Subject.
 *
 * ADR-0003: page scroll keeps the stations; a tap on a Subject frames it from
 * its real bounds, allows a bounded drag-orbit and a pinch / ctrl+wheel dolly,
 * and releases back to the station view. This module is the pure geometry:
 * where the camera stands for a given subject, viewport and orbit offset.
 * The store, the raycast proxies and the rig blend live under
 * `src/components/world/route/focus/`.
 *
 * World units are meters; angles in radians unless a name says `Deg`.
 * Pure data — no client-only imports, so it is unit-testable.
 */

export type Vec3Tuple = readonly [number, number, number];

export interface SubjectBounds {
  min: Vec3Tuple;
  max: Vec3Tuple;
}

/**
 * Subject kind. Open string — each route theme declares the kinds its
 * subjects use in `RouteThemeDefinition.focusVocabulary.kinds`; framing
 * options for unknown kinds fall back to `DEFAULT_FRAMING`.
 */
export type SubjectKind = string;

/** Which docked DOM panel a focused subject opens, if any. */
export interface SubjectPanel {
  /** Search-param name; theme-declared (`focusVocabulary.panelParams`). */
  param: string;
  value: string;
}

/**
 * Focus vocabulary every theme gets when it declares none (DOM-only worlds
 * and the pre-theme plaza lists — kept identical so behavior never shifts).
 */
export const DEFAULT_FOCUS_VOCABULARY = {
  kinds: ['board', 'ace', 'desk-pc', 'plaque', 'figure'],
  panelParams: ['team', 'mon', 'board', 'rules'],
} as const satisfies { kinds: readonly string[]; panelParams: readonly string[] };

export interface FocusSubject {
  /** Stable id, e.g. `board:pulse`, `ace:<player id>`, `desk-pc`, `plaque:gate`. */
  id: string;
  kind: SubjectKind;
  /** Accessible label, German like the rest of the world copy. */
  label: string;
  /** World-space axis-aligned bounds of the subject. */
  bounds: SubjectBounds;
  /** Horizontal unit direction the subject faces — the camera stands along it. */
  facing: Vec3Tuple;
  panel?: SubjectPanel;
}

/** Orbit offset the user applies on top of the authored framing. */
export interface FocusOrbit {
  /** Radians around the subject's up axis, clamped to ±FOCUS_LIMITS.yaw. */
  yaw: number;
  /** Radians of elevation change, clamped to ±FOCUS_LIMITS.pitch. */
  pitch: number;
  /** Multiplier on the framing distance, clamped to [dollyMin, dollyMax]. */
  dolly: number;
}

export const FOCUS_LIMITS = {
  yaw: (25 * Math.PI) / 180,
  pitch: (10 * Math.PI) / 180,
  dollyMin: 0.6,
  dollyMax: 1.8,
  /** Camera never stands closer than this — the rig's near plane is 0.5 m. */
  minDistance: 1.2,
  /** Nor further than a plaza half-width plus change — nothing is that big. */
  maxDistance: 40,
} as const;

export const IDLE_ORBIT: FocusOrbit = { yaw: 0, pitch: 0, dolly: 1 };

/** Framing knobs per subject kind. Fill is the share of the frame the subject spans. */
export interface FramingOptions {
  /** Share of the frame height / width the subject may fill (0..1). */
  fill: number;
  /** Camera swings this far off the subject's facing axis so it reads in 3D. */
  offAxisDeg: number;
  /** Camera elevation above the subject center line, in degrees. */
  elevationDeg: number;
  /**
   * Shift of the subject center inside the frame, as a fraction of frame width
   * / height. Positive x pushes the subject left (room for a right-docked
   * panel); positive y raises the subject (room for a bottom sheet) — the
   * look target moves opposite the subject, so a positive y lowers the target.
   */
  frameOffset: {
    x: number;
    y: number;
    /**
     * Share of the frame height a bottom sheet covers (0 = none). The subject
     * is fitted into `fill` of the visible band above it and centered in that
     * band, so it always reads above the sheet (C-031).
     */
    sheet?: number;
  };
}

/** Framing for a subject kind the theme did not teach the engine. */
const DEFAULT_FRAMING = { fill: 0.72, offAxisDeg: 14, elevationDeg: 6 } as const;

const KIND_DEFAULTS: Partial<Record<SubjectKind, Omit<FramingOptions, 'frameOffset'>>> = {
  board: { fill: 0.78, offAxisDeg: 6, elevationDeg: 0 },
  // An ace is a metre-scale body on a near-square footprint — Ivysaur measures
  // 1.44 m across for 1.0 m of height — so the *horizontal* fit sets the
  // distance and the half-depth term adds another 0.9 m on top: at 0.68 / 22°
  // that put a 1 m ace at 37 % of frame height, and at 0.85 / 14° still only
  // 51 %. Filling to the cap and swinging barely off the facing axis keeps the
  // horizontal fit under the vertical one, which is what buys the height back.
  ace: { fill: 0.85, offAxisDeg: 6, elevationDeg: 6 },
  figure: { fill: 0.68, offAxisDeg: 22, elevationDeg: 8 },
  'desk-pc': { fill: 0.72, offAxisDeg: 14, elevationDeg: 10 },
  plaque: { fill: 0.8, offAxisDeg: 10, elevationDeg: 2 },
};

/** Resolved camera pose for a subject before any user orbit is applied. */
export interface FocusFraming {
  target: Vec3Tuple;
  distance: number;
  /** Camera azimuth around +Y, measured like `atan2(x, z)`. */
  azimuth: number;
  elevation: number;
  /**
   * The point the camera orbits (distance, azimuth, elevation are measured
   * from it); the camera LOOKS at `target`. Equal to `target` except under a
   * bottom sheet, where the lift is a tilt rather than a pan (W6 round 3,
   * see `frameSubject`). Absent = `target`.
   */
  pivot?: Vec3Tuple;
  /** Lowest the eye may stand (world y); absent = unbounded. */
  minEyeY?: number;
}

/**
 * The eye never drops below the subject's base plus this (capped at half the
 * subject's height, so a small wall plaque is not forced into a look-down).
 * W6 round 3: at 390 the sheet lift panned the whole pose down and a board's
 * focus eye sat at y −1.57 (sakura −5.40), under the ground plane.
 */
export const FOCUS_MIN_EYE_ABOVE_BASE = 1.2;

/**
 * World ground height every route theme builds on (the plaza cobbles, the
 * sakura lawn, the mountain and clouds walkways sit at y ≈ 0). A subject
 * standing on or above it never gets an eye lower than this + 1.2 m; a
 * subject set below it (a sunken basin) is judged by its own base only.
 */
export const FOCUS_GROUND_Y = 0;

/**
 * Portrait viewports: how far past the frame width the horizontal fit may let
 * a wide subject overflow, reached at aspect ≤ PORTRAIT_OVERFLOW_ASPECT. The
 * docked sheet carries the detail at phone width; fitting a 7.6 m board
 * across a 0.46-aspect frame put the camera 15–20 m back (a whip, and a
 * board too small to read). Landscape (aspect ≥ 1) is unchanged.
 */
export const PORTRAIT_MAX_FILL_ACROSS = 1.15;
const PORTRAIT_OVERFLOW_ASPECT = 0.6;

export interface CameraPose {
  position: Vec3Tuple;
  target: Vec3Tuple;
}

export function boundsSize(bounds: SubjectBounds): Vec3Tuple {
  return [
    Math.max(0, bounds.max[0] - bounds.min[0]),
    Math.max(0, bounds.max[1] - bounds.min[1]),
    Math.max(0, bounds.max[2] - bounds.min[2]),
  ];
}

export function boundsCenter(bounds: SubjectBounds): Vec3Tuple {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

export function framingOptionsFor(
  kind: SubjectKind,
  frameOffset: FramingOptions['frameOffset'] = { x: 0, y: 0 },
): FramingOptions {
  return { ...(KIND_DEFAULTS[kind] ?? DEFAULT_FRAMING), frameOffset };
}

/**
 * Share of the frame height the mobile bottom sheet can cover: the sheet CSS
 * caps it at 46 vh plus its bottom inset, rounded up so shorter panels still
 * leave the subject clear above them.
 */
export const SHEET_FRAME_COVERAGE = 0.5;

/**
 * Where the camera stands to see the whole subject.
 *
 * Distance is the larger of the vertical fit (subject height into `fill` of
 * the frame height) and the horizontal fit (the subject's extent across the
 * view axis into `fill` of the frame width), plus the half-depth in front of
 * the subject center so a deep subject is measured from its near face.
 */
export function frameSubject(
  subject: FocusSubject,
  fovDeg: number,
  aspect: number,
  options: FramingOptions = framingOptionsFor(subject.kind),
): FocusFraming {
  const [sx, sy, sz] = boundsSize(subject.bounds);
  const center = boundsCenter(subject.bounds);
  const fill = Math.min(0.95, Math.max(0.2, options.fill));
  // A bottom sheet covering the lower frame steals vertical room: fit the
  // subject into `fill` of the band that remains above it (C-031).
  const sheet = Math.min(0.6, Math.max(0, options.frameOffset.sheet ?? 0));
  const visible = 1 - sheet;

  const facingAzimuth = Math.atan2(subject.facing[0], subject.facing[2]);
  const azimuth = facingAzimuth + (options.offAxisDeg * Math.PI) / 180;
  const elevation = (options.elevationDeg * Math.PI) / 180;

  // View axis on the ground plane, and its perpendicular.
  const vx = Math.sin(azimuth);
  const vz = Math.cos(azimuth);
  const across = Math.abs(sx * vz) + Math.abs(sz * vx);
  const along = Math.abs(sx * vx) + Math.abs(sz * vz);

  const tanHalfV = Math.tan((fovDeg * Math.PI) / 360);
  const tanHalfH = tanHalfV * Math.max(0.2, aspect);
  const dv = sy / fill / visible / (2 * tanHalfV);
  const dh = across / fillAcross(fill, aspect) / (2 * tanHalfH);

  const distance = clamp(
    Math.max(dv, dh) + along / 2,
    FOCUS_LIMITS.minDistance,
    FOCUS_LIMITS.maxDistance,
  );

  // Shift the look target so the subject lands off-center when a panel docks.
  // The target moves opposite the intended subject shift: a target below the
  // subject center raises the subject in frame (clear of a bottom sheet), a
  // target right of it shifts the subject left (clear of a right rail).
  const frameHeight = 2 * distance * tanHalfV;
  const frameWidth = frameHeight * Math.max(0.2, aspect);
  const px = -vz;
  const pz = vx;
  const shiftX = -options.frameOffset.x * frameWidth;
  const shiftY = -options.frameOffset.y * frameHeight;
  // Sideways (right rail): a pan — camera and target move together. Upward
  // lift (bottom sheet): a TILT — the camera keeps orbiting the subject's own
  // center line and only the look target drops. A tilt by atan(shiftY / d)
  // puts the subject center exactly as far above the frame center as the old
  // pan did (tan θ / tan(fov/2) = 2 · frameOffset.y), but without carrying the
  // eye down by a quarter frame height — which at portrait distances sank it
  // under the ground (W6 round 3).
  const pivot: Vec3Tuple = [center[0] + px * shiftX, center[1], center[2] + pz * shiftX];
  const target: Vec3Tuple = [pivot[0], center[1] + shiftY, pivot[2]];
  const base = subject.bounds.min[1];
  const minEyeY = Math.max(
    base + Math.min(FOCUS_MIN_EYE_ABOVE_BASE, sy / 2),
    base >= FOCUS_GROUND_Y - 0.5 ? FOCUS_GROUND_Y + FOCUS_MIN_EYE_ABOVE_BASE : -Infinity,
  );

  return { target, distance, azimuth, elevation, pivot, minEyeY };
}

/** Share of the frame WIDTH a subject may span (see PORTRAIT_MAX_FILL_ACROSS). */
function fillAcross(fill: number, aspect: number): number {
  if (aspect >= 1) return fill;
  const t = clamp((1 - aspect) / (1 - PORTRAIT_OVERFLOW_ASPECT), 0, 1);
  return fill + (Math.max(fill, PORTRAIT_MAX_FILL_ACROSS) - fill) * t;
}

export function clampOrbit(orbit: FocusOrbit): FocusOrbit {
  return {
    yaw: clamp(orbit.yaw, -FOCUS_LIMITS.yaw, FOCUS_LIMITS.yaw),
    pitch: clamp(orbit.pitch, -FOCUS_LIMITS.pitch, FOCUS_LIMITS.pitch),
    dolly: clamp(orbit.dolly, FOCUS_LIMITS.dollyMin, FOCUS_LIMITS.dollyMax),
  };
}

/** Camera pose for a framing plus the user's clamped orbit offset. */
export function orbitPose(framing: FocusFraming, orbit: FocusOrbit = IDLE_ORBIT): CameraPose {
  const safe = clampOrbit(orbit);
  const distance = framing.distance * safe.dolly;
  const azimuth = framing.azimuth + safe.yaw;
  const elevation = clamp(framing.elevation + safe.pitch, -1.2, 1.2);
  const horizontal = Math.cos(elevation) * distance;
  const [px, py, pz] = framing.pivot ?? framing.target;
  const y = py + Math.sin(elevation) * distance;
  return {
    target: framing.target,
    position: [
      px + Math.sin(azimuth) * horizontal,
      framing.minEyeY === undefined ? y : Math.max(framing.minEyeY, y),
      pz + Math.cos(azimuth) * horizontal,
    ],
  };
}

/**
 * Frame offset for a docked panel: right rail on wide viewports, bottom sheet
 * at ≤ 767 px — the same `mobile` flag (WorldStateProvider MOBILE_QUERY) that
 * selects the mobile camera endpoints, and the same breakpoint the panel CSS
 * docks at (W6 standardized both; the sheet CSS used to switch at 640 px, so
 * 641–767 px framed for a sheet while the panel sat on the right). The sheet
 * variant carries its coverage so `frameSubject` fits
 * the subject into the visible band and lifts its center to the middle of
 * that band (`y = sheet / 2` raises the subject by a quarter frame — C-031
 * measured the old `y: -0.14` pushing subjects DOWN into the sheet).
 */
export function panelFrameOffset(hasPanel: boolean, mobile: boolean): FramingOptions['frameOffset'] {
  if (!hasPanel) return { x: 0, y: 0 };
  return mobile
    ? { x: 0, y: SHEET_FRAME_COVERAGE / 2, sheet: SHEET_FRAME_COVERAGE }
    : { x: 0.18, y: 0 };
}

// ── Station ↔ focus blends (ADR-0003, bar W6) ───────────────────────────────

/**
 * Exponential damping for every focus blend (station ↔ focus, and the
 * cross-blend when the target changes) — quicker than the walk.
 */
export const FOCUS_DAMPING = 6.5;

/**
 * Frame-rate independent exponential approach of `value` toward `target`
 * (`dt` in seconds, clamped by the caller). Never overshoots.
 */
export function dampToward(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

/**
 * Positional speed cap for a focus blend, in metres per 60 fps frame (W6
 * round 3: at 390 the camera covered 15–20 m in ~250 ms — 1.6–2.4 m a frame,
 * a whip). The peak of d/dt smoothstep(b) under the exponential approach is
 * 6·r·b(1−b)² ≤ (8/9)·r of the travel per second, whichever way it runs, so
 * a blend over `travel` metres stays under the cap when r ≤ cap·60 / ((8/9)·
 * travel). Short blends (≤ ~6 m) keep FOCUS_DAMPING unchanged.
 */
export const FOCUS_MAX_STEP_M = 0.6;
const FOCUS_PEAK_RATE_SHARE = 8 / 9;

/** Damping rate for a focus blend that moves the camera `travel` metres. */
export function focusBlendRate(travel: number): number {
  if (!(travel > 0)) return FOCUS_DAMPING;
  return Math.min(FOCUS_DAMPING, (FOCUS_MAX_STEP_M * 60) / (FOCUS_PEAK_RATE_SHARE * travel));
}

/** A position the step clamp reads and writes (three's Vector3 fits). */
export interface FocusStepVector {
  x: number;
  y: number;
  z: number;
}

/**
 * The hard per-frame distance cap for a live focus blend: FOCUS_MAX_STEP_M
 * per 1/60 s of real frame time (`dt` in seconds), and never more than
 * FOCUS_MAX_STEP_M in any single rendered frame — a long frame does not buy
 * a longer jump (the r4 plaza 390 panel sweep measured a 1.19 m frame where
 * the rig's clock delta spanned two display frames); the camera simply
 * carries the remainder into the next frames. A frame with no time (`dt`
 * zero, negative or not a number) moves nothing.
 */
export function focusStepLimit(dt: number): number {
  return FOCUS_MAX_STEP_M * Math.min(1, dt > 0 ? dt * 60 : 0);
}

/**
 * Review r4: `focusBlendRate` is a RATE heuristic — it bounds the eased
 * station ↔ focus blend on its own, but the travel it is sized from changes
 * every frame, a discrete frame can be longer than 1/60 s, and the
 * cross-blend (subject B tapped while A is framed) is layered on top, so the
 * steps add up: the r3 panel sweeps measured 0.76–0.87 m frames at 390. This
 * is the CLAMP the rig applies after the whole pose is composed: `out`
 * becomes `previous` moved toward `target` by at most `focusStepLimit(dt)`.
 * The blend state is not touched — the remainder carries into the next
 * frame, which starts from the clamped position and chases the target again.
 * A frame with no time (limit 0: the driver's first frame after an unpark,
 * the capture pin's forced advance) holds `previous` — it never jumps the
 * whole remainder at once (PR #65 review). `out` may alias `target`. Returns
 * true when it clamped (still lagging).
 */
export function clampFocusStep(
  previous: FocusStepVector,
  target: FocusStepVector,
  dt: number,
  out: FocusStepVector,
): boolean {
  const dx = target.x - previous.x;
  const dy = target.y - previous.y;
  const dz = target.z - previous.z;
  const distance = Math.hypot(dx, dy, dz);
  const limit = focusStepLimit(dt);
  if (!(distance > limit)) {
    out.x = target.x;
    out.y = target.y;
    out.z = target.z;
    return false;
  }
  const k = limit / distance;
  out.x = previous.x + dx * k;
  out.y = previous.y + dy * k;
  out.z = previous.z + dz * k;
  return true;
}

/**
 * The curve every focus blend weight passes through before it mixes poses.
 * Dolly-in and dolly-out share it, so the camera retraces the dolly-in path
 * exactly on the way out (the out path is the in path in reverse).
 */
export function focusBlendCurve(blend: number): number {
  const t = clamp(blend, 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
