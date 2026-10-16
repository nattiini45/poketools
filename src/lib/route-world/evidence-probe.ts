/**
 * Evidence probe — the pure analyzers that turn the fidelity review's W1–W7
 * vetoes into numbers a reviewer can quote from a JSON file (proposal S9, D13).
 *
 * Two consumers share this module:
 *
 *  - the page side (`EvidenceBridges.tsx`, `?routeDebug=1` only) projects
 *    subject / figure boxes through the LIVE camera and aggregates the
 *    raycast grid through `projectAabbToRect`, `gridSamples` and
 *    `occlusionVerdict`;
 *  - the capture harness (`scripts/capture-route.mjs` via
 *    `scripts/lib/capture-evidence.mjs`) runtime-`import()`s this file with
 *    Node's native type stripping and runs the timeline analyzers
 *    (`phaseCollisions`, `occludedShare`, `directionFlips`, `loaderGaps`)
 *    over the traces it recorded.
 *
 * So it stays ERASABLE-SYNTAX-ONLY (types + pure functions; no enums,
 * namespaces, parameter properties, or `@/` path aliases — Node resolves
 * nothing but relative specifiers) and imports nothing at runtime.
 *
 * Honesty notes (never fake capability):
 *  - "Occluded" is a raycast verdict. Raycasts are blind to what they cannot
 *    hit: Points / sprite particles, shader-displaced water and post effects
 *    (bloom, vignette). W1 "dimming / fighting" needs the pixel A/B arm
 *    (`--hide-mesh` + `--blob-count`) on top of this.
 *  - Figure boxes are world AABBs of the rendered group from three's cached
 *    mesh bounds — a skinned mesh's box is computed once, not re-fitted to
 *    every animated frame.
 *  - Frame strips are SAMPLED presents, not video; timings come from the
 *    recorder's own clock and are approximate at the frame level.
 *
 * Coordinates: screen rects are CSS pixels, origin top-left, y down (the
 * `getBoundingClientRect` convention), so they intersect DOM boxes directly.
 * Matrices are three.js column-major 4×4 element arrays.
 */

export type Vec3 = readonly [number, number, number];

export interface AabbLike {
  min: Vec3;
  max: Vec3;
}

/** Screen rectangle in CSS px, origin top-left, y down. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectedRect {
  /** The projected box clipped to the viewport; null when nothing is on screen. */
  rect: ScreenRect | null;
  /** The unclipped projected rect (may extend past the viewport); null when fully behind the eye. */
  fullRect: ScreenRect | null;
  /** Share of the unclipped rect's area that lies inside the viewport, 0..1. */
  onScreenFraction: number;
  /** True when the whole box lies behind the camera's eye plane. */
  behind: boolean;
}

/** Clip-space w below this is "at or behind the eye plane". */
const EYE_EPS = 1e-4;

/** The eight corners of an AABB. */
export function aabbCorners(box: AabbLike): Vec3[] {
  const { min, max } = box;
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i += 1) {
    out.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  }
  return out;
}

/** The 12 edges of an AABB as corner-index pairs (corner index bits = x|y|z). */
const AABB_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

interface Clip4 {
  x: number;
  y: number;
  w: number;
}

function toClip(m: ArrayLike<number>, p: Vec3): Clip4 {
  return {
    x: m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    y: m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    w: m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  };
}

/**
 * Project a world point through a view-projection matrix into CSS px.
 * Returns null when the point sits at or behind the eye plane.
 */
export function projectPoint(
  viewProj: ArrayLike<number>,
  p: Vec3,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const c = toClip(viewProj, p);
  if (c.w <= EYE_EPS) return null;
  return { x: ((c.x / c.w + 1) / 2) * width, y: ((1 - c.y / c.w) / 2) * height };
}

function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Screen-space bounding rect of a world AABB seen through `viewProj`.
 *
 * Boxes that straddle the eye plane are clipped honestly: every box edge that
 * crosses w = 0 contributes its crossing point (nudged to w = EYE_EPS), so a
 * subject the camera stands beside still yields the rect it actually covers
 * instead of the rect of its in-front corners only.
 */
export function projectAabbToRect(
  box: AabbLike,
  viewProj: ArrayLike<number>,
  width: number,
  height: number,
): ProjectedRect {
  const corners = aabbCorners(box);
  const clips = corners.map((corner) => toClip(viewProj, corner));
  const points: Array<{ x: number; y: number }> = [];
  const push = (c: Clip4) => {
    points.push({ x: ((c.x / c.w + 1) / 2) * width, y: ((1 - c.y / c.w) / 2) * height });
  };
  for (const c of clips) if (c.w > EYE_EPS) push(c);
  for (const [a, b] of AABB_EDGES) {
    const ca = clips[a];
    const cb = clips[b];
    if (ca.w > EYE_EPS === cb.w > EYE_EPS) continue;
    const t = (EYE_EPS - ca.w) / (cb.w - ca.w);
    push({ x: ca.x + (cb.x - ca.x) * t, y: ca.y + (cb.y - ca.y) * t, w: EYE_EPS });
  }
  if (points.length === 0) return { rect: null, fullRect: null, onScreenFraction: 0, behind: true };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const fullRect: ScreenRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const rect = intersectRects(fullRect, { x: 0, y: 0, w: width, h: height });
  const fullArea = fullRect.w * fullRect.h;
  const onScreenFraction = rect === null ? 0 : fullArea > 0 ? (rect.w * rect.h) / fullArea : 1;
  return { rect, fullRect, onScreenFraction, behind: false };
}

export interface GridSample {
  /** CSS px inside the viewport. */
  x: number;
  y: number;
  /** Normalized device coordinates, the `Raycaster.setFromCamera` input. */
  ndcX: number;
  ndcY: number;
}

/** Grid caps: the probe is on-demand debug tooling, never a per-frame cost. */
export const GRID_MIN = 1;
export const GRID_MAX = 16;

/**
 * Cell-centre sample points of an `nx × ny` grid laid over `rect` (already
 * clipped to the viewport), with their NDC twins for the raycaster.
 */
export function gridSamples(
  rect: ScreenRect,
  nx: number,
  ny: number,
  width: number,
  height: number,
): GridSample[] {
  const cols = Math.min(GRID_MAX, Math.max(GRID_MIN, Math.round(nx)));
  const rows = Math.min(GRID_MAX, Math.max(GRID_MIN, Math.round(ny)));
  const out: GridSample[] = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = rect.x + ((i + 0.5) * rect.w) / cols;
      const y = rect.y + ((j + 0.5) * rect.h) / rows;
      out.push({ x, y, ndcX: (x / width) * 2 - 1, ndcY: 1 - (y / height) * 2 });
    }
  }
  return out;
}

export interface RaySample {
  /** The ray actually entered the subject's box (grid corners of a rect can miss it). */
  onSubject: boolean;
  /** A real, visible hit sat closer than the subject's box entry. */
  blocked: boolean;
  /** Label of the first blocking object, when blocked. */
  occluder: string | null;
}

export interface OccluderCount {
  name: string;
  count: number;
  /** Share of the considered (on-subject) samples this occluder blocked. */
  share: number;
}

export interface OcclusionVerdict {
  samples: number;
  /** Samples whose ray entered the subject's box — the denominator. */
  considered: number;
  blocked: number;
  /** blocked / considered; null when no sample reached the subject (off screen). */
  occludedFraction: number | null;
  topOccluders: OccluderCount[];
}

/** Aggregate one subject's ray grid into an occlusion verdict. */
export function occlusionVerdict(samples: readonly RaySample[], top = 3): OcclusionVerdict {
  let considered = 0;
  let blocked = 0;
  const byName = new Map<string, number>();
  for (const sample of samples) {
    if (!sample.onSubject) continue;
    considered += 1;
    if (!sample.blocked) continue;
    blocked += 1;
    const name = sample.occluder ?? '(unnamed)';
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  const topOccluders = [...byName.entries()]
    .map(([name, count]) => ({ name, count, share: considered > 0 ? count / considered : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, top));
  return {
    samples: samples.length,
    considered,
    blocked,
    occludedFraction: considered > 0 ? blocked / considered : null,
    topOccluders,
  };
}

/** Intersection area of two rects over the area of `b` (0..1; 0 for an empty b). */
export function rectOverlapShare(a: ScreenRect, b: ScreenRect): number {
  const hit = intersectRects(a, b);
  const area = b.w * b.h;
  if (!hit || area <= 0) return 0;
  return (hit.w * hit.h) / area;
}

export interface DomLayerRect {
  /** CSS selector or label of the DOM layer (HUD, docked panel, caption …). */
  layer: string;
  rect: ScreenRect;
}

export interface SubjectRect {
  id: string;
  kind: string;
  rect: ScreenRect | null;
}

export interface DomOverlap {
  layer: string;
  id: string;
  kind: string;
  /** Share of the SUBJECT's on-screen rect the DOM layer covers. */
  share: number;
}

/**
 * W1 DOM check: which DOM layers sit on top of which projected subjects.
 * Overlaps below `minShare` are dropped as edge noise.
 */
export function domOverlaps(
  layers: readonly DomLayerRect[],
  subjects: readonly SubjectRect[],
  minShare = 0.01,
): DomOverlap[] {
  const out: DomOverlap[] = [];
  for (const layer of layers) {
    for (const subject of subjects) {
      if (!subject.rect) continue;
      const share = rectOverlapShare(layer.rect, subject.rect);
      if (share >= minShare) out.push({ layer: layer.layer, id: subject.id, kind: subject.kind, share });
    }
  }
  return out.sort((a, b) => b.share - a.share);
}

// ---------------------------------------------------------------------------
// W2 — phase collisions
// ---------------------------------------------------------------------------

/** Normalized clip phase in [0, 1); null for a zero-length or missing clip. */
export function clipPhase01(time: number, duration: number): number | null {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return null;
  const p = (time / duration) % 1;
  return p < 0 ? p + 1 : p;
}

export interface FigurePhaseRow {
  id: string;
  clip: string | null;
  phase01: number | null;
  visible: boolean;
  timeScale?: number | null;
  /** Model identity (manifest file / species) — same model + same phase is the worst case. */
  model?: string | null;
  /**
   * POKEMON-CORE A1: the row's clipKey (`file|clip`, `clip-phase.ts`
   * `clipKeyFor`), when the bridge publishes it; otherwise it is derived from
   * `model` + `clip`.
   */
  clipKey?: string | null;
}

/** A row's clipKey: its own, else `model|clip`, else null (unknown model). */
export function rowClipKey(row: Pick<FigurePhaseRow, 'clip' | 'model' | 'clipKey'>): string | null {
  if (row.clipKey) return row.clipKey;
  if (row.model && row.clip) return `${row.model}|${row.clip}`;
  return null;
}

export interface PhaseCollision {
  a: string;
  b: string;
  clip: string;
  /** Circular phase distance, 0..0.5. */
  delta: number;
  /** Same playback speed too, so the pair stays locked instead of drifting apart. */
  lockstep: boolean;
  /** Both rows name the same model; null when either is unknown. */
  sameModel: boolean | null;
  /**
   * POKEMON-CORE A1 (critique item 1, R7): both rows loop the same clip of the
   * same FILE — the only pair the de-sync bar counts. A cross-model pair
   * (two species idling in phase by chance) is `false`: a drift check only.
   * Null when either clipKey is unknown.
   */
  sameClipKey: boolean | null;
}

export interface PhaseCollisionOptions {
  /** Phase distance (fraction of a loop) under which two loops read identical. */
  eps?: number;
  /** timeScale difference under which two loops never drift apart. */
  timeScaleEps?: number;
  /** POKEMON-CORE A1: keep only same-clipKey pairs (the A1.1 bar). Default false (every same-clip-name pair, the drift check). */
  sameClipKeyOnly?: boolean;
}

function circularDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
}

/**
 * W2 veto: every pair of VISIBLE figures running the same clip within `eps`
 * of the same phase. Rows without a clip or phase (clip-less statues on the
 * breathing fallback, scene-scan rows with no discoverable mixer) are skipped
 * — they cannot collide by this measure, and the report says so separately.
 */
export function phaseCollisions(
  rows: readonly FigurePhaseRow[],
  options: PhaseCollisionOptions = {},
): PhaseCollision[] {
  const eps = options.eps ?? 0.05;
  const tsEps = options.timeScaleEps ?? 0.02;
  const live = rows.filter(
    (row): row is FigurePhaseRow & { clip: string; phase01: number } =>
      row.visible && row.clip !== null && row.phase01 !== null,
  );
  const out: PhaseCollision[] = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i];
      const b = live[j];
      if (a.clip !== b.clip) continue;
      const delta = circularDistance(a.phase01, b.phase01);
      if (delta >= eps) continue;
      const tsA = a.timeScale ?? 1;
      const tsB = b.timeScale ?? 1;
      const sameModel = a.model && b.model ? a.model === b.model : null;
      const keyA = rowClipKey(a);
      const keyB = rowClipKey(b);
      const sameClipKey = keyA !== null && keyB !== null ? keyA === keyB : null;
      if (options.sameClipKeyOnly && sameClipKey !== true) continue;
      out.push({ a: a.id, b: b.id, clip: a.clip, delta, lockstep: Math.abs(tsA - tsB) < tsEps, sameModel, sameClipKey });
    }
  }
  return out.sort((x, y) => x.delta - y.delta);
}

export interface PairPersistence {
  a: string;
  b: string;
  clip: string;
  /** Snapshots in which the pair collided. */
  hits: number;
  /** hits / snapshots. */
  share: number;
  lockstep: boolean;
  sameModel: boolean | null;
  sameClipKey: boolean | null;
}

/**
 * Collision persistence over a trace: a drifting pair crosses phase briefly
 * (unavoidable, harmless); a pair that collides in most snapshots is the
 * "looping identically" veto. Sorted by share, highest first.
 */
export function phaseCollisionShare(
  snapshots: ReadonlyArray<readonly FigurePhaseRow[]>,
  options: PhaseCollisionOptions = {},
): PairPersistence[] {
  const pairs = new Map<string, PairPersistence>();
  for (const rows of snapshots) {
    for (const hit of phaseCollisions(rows, options)) {
      const [a, b] = hit.a < hit.b ? [hit.a, hit.b] : [hit.b, hit.a];
      const key = `${a}\u0000${b}\u0000${hit.clip}`;
      const prev = pairs.get(key);
      if (prev) {
        prev.hits += 1;
        prev.lockstep = prev.lockstep && hit.lockstep;
      } else {
        pairs.set(key, { a, b, clip: hit.clip, hits: 1, share: 0, lockstep: hit.lockstep, sameModel: hit.sameModel, sameClipKey: hit.sameClipKey });
      }
    }
  }
  const total = snapshots.length;
  return [...pairs.values()]
    .map((pair) => ({ ...pair, share: total > 0 ? pair.hits / total : 0 }))
    .sort((a, b) => b.share - a.share || a.a.localeCompare(b.a));
}

// ---------------------------------------------------------------------------
// W4 — share of a capture window a figure spends fully occluded
// ---------------------------------------------------------------------------

export interface OcclusionTimelineRow {
  id: string;
  /** null = no ray reached the subject (off screen / behind the camera). */
  occludedFraction: number | null;
  onScreen: boolean;
}

export interface OcclusionTimelineSample {
  t: number;
  rows: readonly OcclusionTimelineRow[];
}

export interface OccludedShareOptions {
  /** occludedFraction at or above this counts as FULLY occluded (default 0.95). */
  fullThreshold?: number;
  /** Veto line: share of the window fully occluded (default 0.5, the W4 bar). */
  vetoShare?: number;
  /** Count off-screen samples as wasted too (default false — open question in the report). */
  countOffscreen?: boolean;
  /** The window the bar is defined over (default 30 000 ms). */
  windowMs?: number;
}

export interface OccludedShareRow {
  id: string;
  samples: number;
  fullyOccluded: number;
  offscreen: number;
  /** Wasted samples / samples present for this id. */
  share: number;
  veto: boolean;
}

export interface OccludedShareReport {
  spanMs: number;
  /** The trace spans at least 90 % of the bar's window. */
  coversWindow: boolean;
  rows: OccludedShareRow[];
  vetoes: string[];
}

/** W4 veto: which ids spend more than `vetoShare` of the trace fully occluded. */
export function occludedShare(
  timeline: readonly OcclusionTimelineSample[],
  options: OccludedShareOptions = {},
): OccludedShareReport {
  const full = options.fullThreshold ?? 0.95;
  const vetoShare = options.vetoShare ?? 0.5;
  const countOffscreen = options.countOffscreen ?? false;
  const windowMs = options.windowMs ?? 30_000;
  const acc = new Map<string, { samples: number; fullyOccluded: number; offscreen: number }>();
  for (const sample of timeline) {
    for (const row of sample.rows) {
      const entry = acc.get(row.id) ?? { samples: 0, fullyOccluded: 0, offscreen: 0 };
      entry.samples += 1;
      if (!row.onScreen || row.occludedFraction === null) entry.offscreen += 1;
      else if (row.occludedFraction >= full) entry.fullyOccluded += 1;
      acc.set(row.id, entry);
    }
  }
  const rows = [...acc.entries()]
    .map(([id, e]) => {
      const wasted = e.fullyOccluded + (countOffscreen ? e.offscreen : 0);
      const share = e.samples > 0 ? wasted / e.samples : 0;
      return { id, ...e, share, veto: share > vetoShare };
    })
    .sort((a, b) => b.share - a.share || a.id.localeCompare(b.id));
  const spanMs = timeline.length > 1 ? timeline[timeline.length - 1].t - timeline[0].t : 0;
  return {
    spanMs,
    coversWindow: spanMs >= windowMs * 0.9,
    rows,
    vetoes: rows.filter((row) => row.veto).map((row) => row.id),
  };
}

// ---------------------------------------------------------------------------
// W6 — direction flips under constant input
// ---------------------------------------------------------------------------

/** +1 = scroll down / forward, -1 = up / back, 0 = no input seen yet. */
export type InputSign = -1 | 0 | 1;

export interface DirectionSample {
  t: number;
  inputSign: InputSign;
  /** Conductor progress (smooth station coordinate); null when unreadable. */
  progress: number | null;
  /** Camera yaw in radians; null when unreadable. Wrapped values are unwrapped here. */
  yaw: number | null;
}

export interface FlipEvent {
  channel: 'progress' | 'yaw';
  t: number;
  from: -1 | 1;
  to: -1 | 1;
  /** Channel value at the flip (unwrapped radians for yaw). */
  value: number;
  /** How far the channel had come back from its extreme when the latch flipped. */
  magnitude: number;
  inputSign: -1 | 1;
}

export interface DirectionFlipOptions {
  /** Hysteresis on progress, in station units (default 0.02). */
  progressEps?: number;
  /** Hysteresis on yaw, in radians (default 0.035 ≈ 2°). */
  yawEps?: number;
  /** Two yaw reversals inside this window read as whiplash (default 600 ms). */
  yawOscillationMs?: number;
  /**
   * Attribution window for a progress reversal (default 150 ms). The 0.02
   * deadband trips a few frames AFTER the retreat began, possibly on the very
   * frame the input flips back (review round 1: sakura jitter 390 — input
   * went −1 at the peak, the deadband tripped on the frame input returned to
   * +1). A reversal toward sign `d` is therefore attributed to the input held
   * while the retreat began: it is excused when input `d` was held at any
   * sample in [extremeT − inputLagMs, tripT], where extremeT is the time the
   * latch set its running extreme. Constant-input snap-backs (no `d` input in
   * that window) still fail.
   */
  inputLagMs?: number;
}

export interface DirectionFlipReport {
  /** Progress reversals AGAINST a constant input — the W6 snap-back veto. */
  progressFlips: FlipEvent[];
  /** Progress that first moved against the input it was given. */
  againstInput: FlipEvent[];
  /**
   * Reversals that tripped while the opposite input was held, but whose
   * retreat began under (or within `inputLagMs` of) an input in their own
   * direction — attributed to that input, so not vetoes. Listed for review.
   */
  lagAttributed: FlipEvent[];
  /** Every yaw reversal under constant input — informational: authored S-curves reverse yaw legitimately. */
  yawFlips: FlipEvent[];
  /** Yaw reversals that reverse again within `yawOscillationMs` — the whiplash veto. */
  yawOscillations: FlipEvent[];
  /** Constant-input segments analysed. */
  segments: number;
  verdict: 'pass' | 'fail';
  reasons: string[];
}

function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

interface Latch {
  dir: -1 | 0 | 1;
  anchor: number;
  extreme: number;
  /** Sample time at which `extreme` was last set (the retreat's start). */
  extremeT: number;
}

/**
 * Feed one channel value into a hysteresis latch. Returns the direction the
 * latch established or flipped to on this sample (null = no change).
 * `extreme` tracks the furthest value reached in the latched direction; a
 * reversal only registers once the channel comes back by more than `eps`, so
 * noise around a plateau cannot retrigger it.
 */
function feedLatch(
  latch: Latch,
  v: number,
  eps: number,
  t: number,
): { to: -1 | 1; magnitude: number; established: boolean; extremeT: number } | null {
  if (latch.dir === 0) {
    if (v - latch.anchor >= eps) {
      latch.dir = 1;
      latch.extreme = v;
      latch.extremeT = t;
      return { to: 1, magnitude: v - latch.anchor, established: true, extremeT: t };
    }
    if (latch.anchor - v >= eps) {
      latch.dir = -1;
      latch.extreme = v;
      latch.extremeT = t;
      return { to: -1, magnitude: latch.anchor - v, established: true, extremeT: t };
    }
    return null;
  }
  if (latch.dir === 1) {
    if (v > latch.extreme) {
      latch.extreme = v;
      latch.extremeT = t;
    } else if (latch.extreme - v >= eps) {
      const magnitude = latch.extreme - v;
      const extremeT = latch.extremeT;
      latch.dir = -1;
      latch.extreme = v;
      latch.extremeT = t;
      return { to: -1, magnitude, established: false, extremeT };
    }
    return null;
  }
  if (v < latch.extreme) {
    latch.extreme = v;
    latch.extremeT = t;
  } else if (v - latch.extreme >= eps) {
    const magnitude = v - latch.extreme;
    const extremeT = latch.extremeT;
    latch.dir = 1;
    latch.extreme = v;
    latch.extremeT = t;
    return { to: 1, magnitude, established: false, extremeT };
  }
  return null;
}

/**
 * W6 veto analyzer over a scripted-gesture trace.
 *
 * Progress: the latch carries ACROSS input reversals (the damped conductor
 * legitimately keeps coasting the old way for a few frames after the user
 * reverses), and a progress reversal counts as a veto only when it moves
 * AGAINST the input currently held — "advances then snaps back". A reversal
 * toward the input is the expected answer to a user reversal. A latch first
 * established against the input (a down-scroll that moves the world back)
 * is reported as `againstInput`.
 *
 * Yaw has no fixed mapping to input sign (a curved route can turn either
 * way), so every yaw reversal under constant input is reported, but only a
 * back-and-forth inside `yawOscillationMs` — whiplash — fails the verdict.
 * The yaw latch resets on every input reversal.
 */
export function directionFlips(
  samples: readonly DirectionSample[],
  options: DirectionFlipOptions = {},
): DirectionFlipReport {
  const progressEps = options.progressEps ?? 0.02;
  const yawEps = options.yawEps ?? 0.035;
  const oscMs = options.yawOscillationMs ?? 600;
  const lagMs = options.inputLagMs ?? 150;
  const progressFlips: FlipEvent[] = [];
  const againstInput: FlipEvent[] = [];
  const lagAttributed: FlipEvent[] = [];
  /** Every non-zero input sample, in time order (for reversal attribution). */
  const inputLog: Array<{ t: number; sign: -1 | 1 }> = [];
  const heldWithin = (sign: -1 | 1, from: number, to: number): boolean => {
    for (let i = inputLog.length - 1; i >= 0; i -= 1) {
      const entry = inputLog[i];
      // The first entry before `from` is the input in force AT `from`.
      if (entry.t < from) return entry.sign === sign;
      if (entry.t <= to && entry.sign === sign) return true;
    }
    return false;
  };
  const yawFlips: FlipEvent[] = [];
  const yawOscillations: FlipEvent[] = [];

  let progressLatch: Latch | null = null;
  let yawLatch: Latch | null = null;
  let segmentSign: InputSign = 0;
  let segments = 0;
  let yawUnwrapped: number | null = null;
  let yawRawPrev: number | null = null;
  let lastYawFlipT: number | null = null;

  for (const s of samples) {
    // Unwrap yaw continuously so a ±π crossing is not a reversal.
    if (s.yaw !== null && Number.isFinite(s.yaw)) {
      if (yawRawPrev === null || yawUnwrapped === null) yawUnwrapped = s.yaw;
      else yawUnwrapped += wrapAngle(s.yaw - yawRawPrev);
      yawRawPrev = s.yaw;
    }
    if (s.inputSign === 0) continue;
    const sign = s.inputSign;
    inputLog.push({ t: s.t, sign });
    if (sign !== segmentSign) {
      segmentSign = sign;
      segments += 1;
      yawLatch = yawUnwrapped !== null ? { dir: 0, anchor: yawUnwrapped, extreme: yawUnwrapped, extremeT: s.t } : null;
      lastYawFlipT = null;
    }
    if (s.progress !== null && Number.isFinite(s.progress)) {
      if (!progressLatch) progressLatch = { dir: 0, anchor: s.progress, extreme: s.progress, extremeT: s.t };
      const change = feedLatch(progressLatch, s.progress, progressEps, s.t);
      if (change) {
        const event: FlipEvent = {
          channel: 'progress',
          t: s.t,
          from: (change.to === 1 ? -1 : 1) as -1 | 1,
          to: change.to,
          value: s.progress,
          magnitude: change.magnitude,
          inputSign: sign,
        };
        if (change.to !== sign) {
          if (change.established) againstInput.push(event);
          else if (heldWithin(change.to, change.extremeT - lagMs, s.t)) lagAttributed.push(event);
          else progressFlips.push(event);
        }
      }
    }
    if (yawUnwrapped !== null) {
      if (!yawLatch) yawLatch = { dir: 0, anchor: yawUnwrapped, extreme: yawUnwrapped, extremeT: s.t };
      const change = feedLatch(yawLatch, yawUnwrapped, yawEps, s.t);
      if (change && !change.established) {
        const event: FlipEvent = {
          channel: 'yaw',
          t: s.t,
          from: (change.to === 1 ? -1 : 1) as -1 | 1,
          to: change.to,
          value: yawUnwrapped,
          magnitude: change.magnitude,
          inputSign: sign,
        };
        yawFlips.push(event);
        if (lastYawFlipT !== null && s.t - lastYawFlipT <= oscMs) yawOscillations.push(event);
        lastYawFlipT = s.t;
      }
    }
  }

  const reasons: string[] = [];
  if (progressFlips.length > 0) reasons.push(`${progressFlips.length} progress reversal(s) against constant input`);
  if (againstInput.length > 0) reasons.push(`${againstInput.length} progress start(s) against the input direction`);
  if (yawOscillations.length > 0) reasons.push(`${yawOscillations.length} yaw whiplash reversal(s) within ${oscMs} ms`);
  return {
    progressFlips,
    againstInput,
    lagAttributed,
    yawFlips,
    yawOscillations,
    segments,
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
  };
}

// ---------------------------------------------------------------------------
// W7 — loader gaps, overrun, Lite blocking
// ---------------------------------------------------------------------------

/**
 * Luma standard deviation (0..255) of a small canvas downsample at or below
 * which the frame counts as BLANK: a clear-colour-only or black canvas is
 * uniform; any painted world frame is far above this at 16×16.
 */
export const BLANK_SPREAD_MAX = 3;

/** Canvas opacity at or above which the world counts as visible. */
export const WORLD_VISIBLE_OPACITY = 0.98;

/** The route readiness deadline the loader may never outlive (world-readiness). */
export const READINESS_DEADLINE_MS = 10_000;

/** Luma mean + standard deviation of an RGBA (or `channels`-strided) pixel buffer. */
export function pixelSpread(data: ArrayLike<number>, channels = 4): { mean: number; spread: number } {
  const n = Math.floor(data.length / channels);
  if (n === 0) return { mean: 0, spread: 0 };
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    const o = i * channels;
    const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    sum += l;
    sumSq += l * l;
  }
  const mean = sum / n;
  return { mean, spread: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}

export interface LoaderSample {
  /** ms since navigation start (performance.now() in the page). */
  t: number;
  /** The ball root's `data-ball-phase`, null when no loader element exists. */
  ballPhase: string | null;
  /** The ball is rendered and not transparent. */
  ballVisible: boolean;
  /** `html.world-route-live` is set. */
  routeLive: boolean;
  /** Effective opacity of the canvas (product up its ancestor chain); null without a canvas. */
  canvasOpacity: number | null;
  /** Luma spread of the latest rendered canvas frame; null when unreadable / no canvas. */
  canvasSpread: number | null;
  /** `__routeWorldReadiness().phase` when the bridge exists. */
  scenePhase?: string | null;
}

export interface LoaderInterval {
  from: number;
  to: number;
  frames: number;
}

export interface LoaderGapOptions {
  deadlineMs?: number;
  /** How long the ball may linger after a failure before it counts as blocking Lite (default 300 ms). */
  abortGraceMs?: number;
  /** A rAF gap above this inside the reveal window is a stutter (default 100 ms). */
  hitchMs?: number;
  /** The reveal window ends this long after `world-route-live` (default 600 ms, the handoff window's tail). */
  revealSettleMs?: number;
  /**
   * An explicit failure anchor (the harness's injected-fault dispatch) for
   * runs whose trace never sampled the transient `failed` scene phase.
   */
  failedAt?: number | null;
  blankSpreadMax?: number;
  visibleOpacity?: number;
}

export interface LoaderStall {
  at: number;
  gapMs: number;
}

export interface LoaderGapReport {
  samples: number;
  ballShownAt: number | null;
  ballDismissedAt: number | null;
  routeLiveAt: number | null;
  worldVisibleAt: number | null;
  failedAt: number | null;
  /** Where the readiness deadline was measured from (first `loading` sample, else first ball frame). */
  deadlineAnchor: number | null;
  /** Frames with no ball, route live, and no visible painted world. */
  blankFrames: number;
  gaps: LoaderInterval[];
  /** Ball still visible past the readiness deadline. */
  overrun: LoaderInterval | null;
  /** Ball still visible after the scene failed (Lite fallback delayed). */
  liteBlock: LoaderInterval | null;
  /** rAF gaps above hitchMs inside the reveal window. */
  hitches: LoaderStall[];
  /**
   * Review round 5: the reveal window the hitches were judged in —
   * [first `opening` sample (else ball dismiss, else route-live),
   * route-live + revealSettleMs], cut at a failure inside it. Null when the
   * route never went live (no reveal happened, so nothing is a reveal hitch).
   */
  revealWindow: { from: number; to: number } | null;
  /**
   * Stalls from the failure anchor on (failure paths only): reported, never
   * counted as reveal hitches. `stallMs` = the longest one (0 when none).
   */
  failureStalls: { anchor: number; stallMs: number; totalMs: number; stalls: LoaderStall[] } | null;
  /** Stalls in neither window (loading, or after the settle): informational only. */
  otherStalls: LoaderStall[];
  verdict: 'pass' | 'fail';
  reasons: string[];
}

function worldVisible(s: LoaderSample, visibleOpacity: number, blankSpreadMax: number): boolean {
  if (s.canvasOpacity === null || s.canvasOpacity < visibleOpacity) return false;
  // Unreadable pixels (null) are not evidence of a blank frame.
  return s.canvasSpread === null || s.canvasSpread > blankSpreadMax;
}

function closeInterval(open: { from: number; last: number; frames: number } | null): LoaderInterval | null {
  return open ? { from: open.from, to: open.last, frames: open.frames } : null;
}

/**
 * W7 veto analyzer over a navigation-start loader trace.
 *
 * - Blank frame: the ball is not showing, the route is live, and the world is
 *   not visibly painted (canvas faded out, or its pixels are uniform). Before
 *   `world-route-live` the semantic page IS the content (D2), so an inert
 *   canvas there is by design, not blank.
 * - Overrun: the ball visible more than `deadlineMs` after the deadline's
 *   anchor — the first sample reporting scene phase `loading` (the readiness
 *   deadline arms when the generation begins), else the first ball frame.
 *   Anchoring at navigation start instead would over-grant the loader the
 *   time the page spent before the scene chunk even started.
 * - Lite block: the ball visible more than `abortGraceMs` after the scene
 *   reported `failed`.
 * - Hitch: a rAF gap above `hitchMs` inside the reveal window
 *   [first `opening` sample, route-live + `revealSettleMs`] (review r5; the
 *   start falls back to ball dismiss, then route-live, when the trace has no
 *   `opening` sample). A failure inside the window cuts it; stalls from the
 *   failure anchor on are `failureStalls`, never reveal hitches, and a run
 *   whose route never went live has no reveal window at all.
 */
export function loaderGaps(samples: readonly LoaderSample[], options: LoaderGapOptions = {}): LoaderGapReport {
  const deadlineMs = options.deadlineMs ?? READINESS_DEADLINE_MS;
  const abortGraceMs = options.abortGraceMs ?? 300;
  const hitchMs = options.hitchMs ?? 100;
  const blankSpreadMax = options.blankSpreadMax ?? BLANK_SPREAD_MAX;
  const visibleOpacity = options.visibleOpacity ?? WORLD_VISIBLE_OPACITY;

  let ballShownAt: number | null = null;
  let ballDismissedAt: number | null = null;
  let routeLiveAt: number | null = null;
  let worldVisibleAt: number | null = null;
  let failedAt: number | null = null;
  let loadingAt: number | null = null;
  let blankFrames = 0;
  const gaps: LoaderInterval[] = [];
  let openGap: { from: number; last: number; frames: number } | null = null;
  let overrunOpen: { from: number; last: number; frames: number } | null = null;
  let liteOpen: { from: number; last: number; frames: number } | null = null;

  for (const s of samples) {
    if (s.ballVisible && ballShownAt === null) ballShownAt = s.t;
    if (!s.ballVisible && ballShownAt !== null && ballDismissedAt === null) ballDismissedAt = s.t;
    if (s.routeLive && routeLiveAt === null) routeLiveAt = s.t;
    if (s.scenePhase === 'failed' && failedAt === null) failedAt = s.t;
    if (s.scenePhase === 'loading' && loadingAt === null) loadingAt = s.t;
    const deadlineAnchor = loadingAt ?? ballShownAt;
    const visible = worldVisible(s, visibleOpacity, blankSpreadMax);
    if (visible && s.routeLive && worldVisibleAt === null) worldVisibleAt = s.t;

    const blank = !s.ballVisible && s.routeLive && !visible;
    if (blank) {
      blankFrames += 1;
      if (openGap) {
        openGap.last = s.t;
        openGap.frames += 1;
      } else openGap = { from: s.t, last: s.t, frames: 1 };
    } else if (openGap) {
      gaps.push({ from: openGap.from, to: openGap.last, frames: openGap.frames });
      openGap = null;
    }

    if (s.ballVisible && deadlineAnchor !== null && s.t - deadlineAnchor > deadlineMs) {
      if (overrunOpen) {
        overrunOpen.last = s.t;
        overrunOpen.frames += 1;
      } else overrunOpen = { from: s.t, last: s.t, frames: 1 };
    }
    if (s.ballVisible && failedAt !== null && s.t - failedAt > abortGraceMs) {
      if (liteOpen) {
        liteOpen.last = s.t;
        liteOpen.frames += 1;
      } else liteOpen = { from: s.t, last: s.t, frames: 1 };
    }
  }
  if (openGap) gaps.push({ from: openGap.from, to: openGap.last, frames: openGap.frames });

  const revealSettleMs = options.revealSettleMs ?? 600;
  const failAnchor = typeof options.failedAt === 'number' ? options.failedAt : failedAt;
  const openingAt = samples.find((s) => s.ballPhase === 'opening')?.t ?? null;
  let revealWindow: { from: number; to: number } | null = null;
  if (routeLiveAt !== null) {
    const from = openingAt ?? (ballDismissedAt !== null ? Math.min(ballDismissedAt, routeLiveAt) : routeLiveAt);
    let to = routeLiveAt + revealSettleMs;
    if (failAnchor !== null && failAnchor >= from && failAnchor < to) to = failAnchor;
    revealWindow = { from, to };
  }
  const hitches: LoaderStall[] = [];
  const stalls: LoaderStall[] = [];
  const otherStalls: LoaderStall[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const t = samples[i].t;
    const gapMs = t - samples[i - 1].t;
    if (gapMs <= hitchMs) continue;
    if (failAnchor !== null && t > failAnchor) stalls.push({ at: t, gapMs });
    // A gap that began before the first opening frame is a loading stall.
    else if (revealWindow && samples[i - 1].t >= revealWindow.from && t <= revealWindow.to) hitches.push({ at: t, gapMs });
    else otherStalls.push({ at: t, gapMs });
  }
  const failureStalls =
    failAnchor === null
      ? null
      : {
          anchor: failAnchor,
          stallMs: stalls.reduce((m, s) => Math.max(m, s.gapMs), 0),
          totalMs: stalls.reduce((sum, s) => sum + s.gapMs, 0),
          stalls,
        };

  const overrun = closeInterval(overrunOpen);
  const liteBlock = closeInterval(liteOpen);
  const reasons: string[] = [];
  if (blankFrames > 0) reasons.push(`${blankFrames} blank frame(s) between loader and world paint`);
  if (overrun) reasons.push(`loader visible past the ${deadlineMs} ms readiness deadline`);
  if (liteBlock) reasons.push(`loader lingered more than ${abortGraceMs} ms after the scene failed`);
  if (hitches.length > 0) reasons.push(`${hitches.length} frame hitch(es) above ${hitchMs} ms during the reveal`);
  return {
    samples: samples.length,
    ballShownAt,
    ballDismissedAt,
    routeLiveAt,
    worldVisibleAt,
    failedAt,
    deadlineAnchor: loadingAt ?? ballShownAt,
    blankFrames,
    gaps,
    overrun,
    liteBlock,
    hitches,
    revealWindow,
    failureStalls,
    otherStalls,
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
  };
}
