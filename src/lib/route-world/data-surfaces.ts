/**
 * Data surfaces — the W1 law every other system reads (fidelity wave 2, seat
 * 2A; WAVE-PLAN §2 "2A LAW", anti-pattern §5.1).
 *
 * A DATA FACE is a painted surface that carries league data: a board, a name
 * plate, a rules tablet, the teams ledger, a sign cloth. Each world declares
 * its faces as pure data (`data-faces.ts` beside the theme furniture). This
 * module turns them into the four contracts the clarity layer shares:
 *
 * 1. KEEP-OUT WEDGES — `keepOutWedge(face, pose, pad)`: the view frustum from
 *    one eye to the face, padded by `KEEP_OUT_PAD` (0.3 m around the face in
 *    the world, then 4 % of the viewport on screen), cut at the face plane.
 *    `themeWedges(theme)` builds them from EVERY eye that can look at the
 *    face: the station's desktop eye (1440 × 900), the 768 eye (desktop
 *    ledger + pullback), the landed 390 eye, the face's own focus poses
 *    (desktop rail and mobile sheet) and the dolly corridor — samples of the
 *    rig's own `samplePath` between neighbouring endpoints. `createKeepOut`
 *    bundles the tests placement code asks: `pointClear`, `sphereClear`,
 *    `segmentClear(a, b, r)`, `laneClears(lane)`, `headroomAt(x, z)`,
 *    `boxClear(box)`.
 * 2. SCREEN RECTS — `faceRectAt(face, camera, viewport)` reuses the evidence
 *    probe's `projectAabbToRect` (the same projection the capture harness
 *    audits with), so the unit tests and the sidecars agree; a face that
 *    straddles the rig's near plane is clipped there first (see below).
 * 3. PORTRAIT BANDS — `portraitBands(theme, station, viewport)`: where the
 *    Station Card, the data, the life and the HUD may live on screen, from
 *    the frozen station pose. The PARTIAL-FACE TABLE (`partialFaceTable`)
 *    lists the faces a station pose shows less than 80 % of (the standby-dim
 *    set, seat 2F) — precomputed because the endpoints are frozen.
 * 4. SETTLE LATCH — `stepSettleLatch`: the single latched `settled` signal
 *    (the card, the reading window and every ceremony key on it; §5.4).
 *
 * Honest limits (disclosed, never sold as more):
 *  - A face is a flat rectangle restated from layout tables and component
 *    constants (named at each restatement). Curved or multi-part faces are
 *    covered by several rectangles or by a conservative covering rectangle.
 *  - Focus poses are computed for each face as its OWN focus subject (the
 *    face's bounds framed with the theme-agnostic `frameSubject`). The real
 *    subject bounds (a board plus its frame, an ace plus its pedestal) live
 *    in client components and are a little larger, so the real focus eye
 *    stands a little further back than modelled; the padding absorbs most of
 *    it, captures remain the evidence of record. Ace / desk subjects are not
 *    modelled as eyes of their own.
 *  - The dolly corridor is SAMPLED (quarter points of every crossing, three
 *    viewports), and a face contributes a wedge at a sample only when at
 *    least half of its padded rect is on screen there (a face entering from
 *    the frame edge is the next stop, not data being read).
 *  - Containment is analytic (sphere vs. a frustum cut at the face plane);
 *    a box is sampled on a grid (0.25 m spacing, capped at 9 points per
 *    axis — coarser along boxes longer than 2 m), so a wedge narrower than
 *    the grid step can slip between samples of a long box. Segments and
 *    lanes are sampled every 0.1 m.
 *  - Faces are clipped at the rig's 0.5 m near plane (CameraRig); a figure
 *    or prop nearer the eye than that is not rendered and not counted.
 *
 * Pure data + math — no client-only imports (three is used as math only,
 * through camera-path).
 */

import { createPose, buildPoseLedger, samplePath, type PoseLedger } from './camera-path';
import type { CameraEndpoint, RouteStation, Vec3 } from './chapters';
import { projectAabbToRect, type ProjectedRect, type ScreenRect } from './evidence-probe';
import { framingOptionsFor, frameSubject, orbitPose, panelFrameOffset, type FocusSubject } from './focus';

// ── Types ────────────────────────────────────────────────────────────────────

export type WorldId = 'plaza' | 'sakura' | 'mountain' | 'clouds';

export type DataFaceKind = 'board' | 'plate' | 'tablet' | 'ledger' | 'sign';

/**
 * One painted data surface. `normal` is the unit direction the painted side
 * faces (toward its readers); `size` is the rectangle's width along the
 * face's right axis (world up × normal) and height along its up axis, bezel
 * included when the bezel frames the data.
 */
export interface DataFace {
  /** Stable id, `<station>:<surface>` (e.g. `pulse:board`, `teams:plate:3`). */
  id: string;
  /** Station id whose composition reads this face. */
  station: string;
  center: Vec3;
  normal: Vec3;
  size: { w: number; h: number };
  kind: DataFaceKind;
}

/** A world's data surfaces, as the clarity layer consumes them. */
export interface DataSurfaceTheme {
  id: WorldId;
  stations: readonly RouteStation[];
  faces: readonly DataFace[];
  /**
   * ROLLOUT §2.2 (j): faces that share ONE calm-rect slot (their union rect)
   * for the calm uniform only — e.g. mountain's five schedule cloths in four
   * slots. The keep-out law and the wedges keep every face on its own.
   * `members` are face ids.
   */
  calmUnions?: readonly { id: string; members: readonly string[] }[];
}

export interface Viewport {
  width: number;
  height: number;
}

/** The capture viewports of record (legibility.ts, capture-route). */
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const satisfies Record<string, Viewport>;

export type ViewportKey = keyof typeof VIEWPORTS;

/** Widest viewport that docks panels as a bottom sheet (WorldStateProvider MOBILE_QUERY). */
export const MOBILE_MAX_WIDTH = 767;

export type KeepOutPoseKind = 'desktop' | 'tablet' | 'landed390' | 'focus' | 'dolly';

/** One camera the keep-out is judged from. */
export interface KeepOutPose {
  id: string;
  kind: KeepOutPoseKind;
  camera: CameraEndpoint;
  viewport: Viewport;
}

/** Keep-out padding: metres around the face, then a share of the viewport on screen. */
export interface KeepOutPad {
  metres: number;
  /** Share of the viewport width (x) and height (y) added on each side. */
  viewport: number;
}

export const KEEP_OUT_PAD: KeepOutPad = { metres: 0.3, viewport: 0.04 };

/**
 * The rig's near plane (CameraRig.tsx `near={0.5}`). A face straddling
 * it — a cloth hanging beside the lens — renders only its part beyond the
 * plane; the probe's `projectAabbToRect` clips at w → 0 (right for the
 * harness's AABBs of whole subjects, but it turns a sliver 5 cm from the
 * eye into a frame-filling rect). Such faces are clipped here instead.
 */
const RIG_NEAR_M = 0.5;

/**
 * The padded view wedge from one eye to one face: an NDC rectangle (padded,
 * clipped to the frame) swept from the eye to the face plane.
 */
export interface KeepOutWedge {
  faceId: string;
  stationId: string;
  poseId: string;
  poseKind: KeepOutPoseKind;
  eye: Vec3;
  /** Camera basis (unit vectors) and projection constants. */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanHalf: number;
  aspect: number;
  /** Padded face rect in NDC (x right, y up), clipped to [−1, 1]². */
  ndc: { x0: number; x1: number; y0: number; y1: number };
  /** A point on the face plane and the plane normal pointing toward the eye. */
  planePoint: Vec3;
  planeNormal: Vec3;
}

// ── Vector helpers ───────────────────────────────────────────────────────────

type V3 = [number, number, number];

function sub(a: Vec3, b: Vec3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Camera basis for a look-at pose with world +Y up (three's `Camera.lookAt`). */
export function cameraBasis(camera: CameraEndpoint): { right: V3; up: V3; forward: V3 } {
  const forward = normalize(sub(camera.target, camera.position));
  let right = cross(forward, [0, 1, 0]);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  const up = cross(right, forward);
  return { right, up, forward };
}

/**
 * The face's own frame: right = world up × normal (a face whose normal is
 * +Z has right +X, three's convention for an unrotated plane), up =
 * normal × right. A horizontal face (normal ±Y) takes +X as its right.
 */
export function faceBasis(face: DataFace): { right: V3; up: V3; normal: V3 } {
  const normal = normalize(face.normal);
  let right = cross([0, 1, 0], normal);
  if (Math.hypot(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  const up = cross(normal, right);
  return { right, up, normal };
}

/** The four world corners of a face, grown by `padM` on every side. */
export function faceCorners(face: DataFace, padM = 0): V3[] {
  const { right, up } = faceBasis(face);
  const hw = face.size.w / 2 + padM;
  const hh = face.size.h / 2 + padM;
  const out: V3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      out.push([
        face.center[0] + right[0] * sx * hw + up[0] * sy * hh,
        face.center[1] + right[1] * sx * hw + up[1] * sy * hh,
        face.center[2] + right[2] * sx * hw + up[2] * sy * hh,
      ]);
    }
  }
  return out;
}

/** World axis-aligned bounds of a (padded) face. */
export function faceBounds(face: DataFace, padM = 0): { min: V3; max: V3 } {
  const corners = faceCorners(face, padM);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const c of corners) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], c[k]);
      max[k] = Math.max(max[k], c[k]);
    }
  }
  return { min, max };
}

// ── Projection (faceRectAt) ──────────────────────────────────────────────────

/**
 * Column-major matrix taking FACE-LOCAL points (x along the face's right, y
 * along its up, z along its normal, origin at the centre) to clip space for
 * a camera + aspect. Only the x, y and w rows are meaningful — the rows
 * `projectAabbToRect` reads. Composing the face's model transform into the
 * view-projection lets a yawed (or tilted) face project as its own thin box
 * instead of as a conservative world AABB.
 */
function faceClipMatrix(face: DataFace, camera: CameraEndpoint, aspect: number): number[] {
  const { right: cr, up: cu, forward: cf } = cameraBasis(camera);
  const f = 1 / Math.tan((camera.fov * Math.PI) / 360);
  const { right: R, up: U, normal: N } = faceBasis(face);
  const eye = camera.position;
  const C = face.center;
  const ax: V3 = [(cr[0] * f) / aspect, (cr[1] * f) / aspect, (cr[2] * f) / aspect];
  const ay: V3 = [cu[0] * f, cu[1] * f, cu[2] * f];
  const aw: V3 = cf;
  const m = new Array<number>(16).fill(0);
  const row = (a: V3, offset: number) => {
    m[offset] = dot(a, R);
    m[offset + 4] = dot(a, U);
    m[offset + 8] = dot(a, N);
    m[offset + 12] = dot(a, C) - dot(a, eye);
  };
  row(ax, 0);
  row(ay, 1);
  row(aw, 3);
  // z row: unused by projectAabbToRect; keep it finite.
  m[14] = 0;
  return m;
}

/**
 * Screen rect (CSS px, origin top-left) of a face seen from `camera` in
 * `viewport`, grown by `padM` metres on every side. Reuses the evidence
 * probe's `projectAabbToRect`, so near-plane straddling is clipped the same
 * way the harness clips it.
 */
export function faceRectAt(face: DataFace, camera: CameraEndpoint, viewport: Viewport, padM = 0): ProjectedRect {
  const aspect = viewport.width / viewport.height;
  const hw = face.size.w / 2 + padM;
  const hh = face.size.h / 2 + padM;
  const { forward } = cameraBasis(camera);
  const corners = faceCorners(face, padM);
  const depths = corners.map((c) => dot(sub(c, camera.position), forward));
  if (depths.every((d) => d >= RIG_NEAR_M)) {
    return projectAabbToRect(
      { min: [-hw, -hh, 0], max: [hw, hh, 0] },
      faceClipMatrix(face, camera, aspect),
      viewport.width,
      viewport.height,
    );
  }
  return nearClippedRect(corners, depths, camera, viewport);
}

/** Screen rect of the face polygon clipped to depth ≥ RIG_NEAR_M (Sutherland–Hodgman, one plane). */
function nearClippedRect(corners: V3[], depths: number[], camera: CameraEndpoint, viewport: Viewport): ProjectedRect {
  // Corner order from faceCorners is (−,−), (−,+), (+,−), (+,+): walk it as a loop.
  const loop = [0, 1, 3, 2];
  const kept: V3[] = [];
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const da = depths[a];
    const db = depths[b];
    if (da >= RIG_NEAR_M) kept.push(corners[a]);
    if (da >= RIG_NEAR_M !== db >= RIG_NEAR_M) {
      const t = (RIG_NEAR_M - da) / (db - da);
      kept.push([
        corners[a][0] + (corners[b][0] - corners[a][0]) * t,
        corners[a][1] + (corners[b][1] - corners[a][1]) * t,
        corners[a][2] + (corners[b][2] - corners[a][2]) * t,
      ]);
    }
  }
  const points = kept.map((p) => screenPoint(p, camera, viewport)).filter((p): p is { x: number; y: number } => p !== null);
  if (points.length === 0) return { rect: null, fullRect: null, onScreenFraction: 0, behind: true };
  const x0 = Math.min(...points.map((p) => p.x));
  const x1 = Math.max(...points.map((p) => p.x));
  const y0 = Math.min(...points.map((p) => p.y));
  const y1 = Math.max(...points.map((p) => p.y));
  const fullRect: ScreenRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(viewport.width, x1);
  const cy1 = Math.min(viewport.height, y1);
  const rect = cx1 > cx0 && cy1 > cy0 ? { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 } : null;
  const area = fullRect.w * fullRect.h;
  // Only PART of the face lies beyond the near plane: the in-frame share is
  // the kept polygon's share of the face's world area times the share of
  // its screen rect inside the viewport — a straddling face never counts
  // as fully in frame.
  const keptShare = polygonArea(kept) / Math.max(polygonArea(loop.map((i) => corners[i])), 1e-9);
  const onScreenFraction = rect === null || area <= 0 ? 0 : keptShare * ((rect.w * rect.h) / area);
  return { rect, fullRect, onScreenFraction, behind: false };
}

/** Area of a planar polygon in 3D (vertices in order). */
function polygonArea(points: readonly V3[]): number {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < points.length; i += 1) {
    const c = cross(points[i], points[(i + 1) % points.length]);
    sx += c[0];
    sy += c[1];
    sz += c[2];
  }
  return Math.hypot(sx, sy, sz) / 2;
}

/**
 * The padded screen rect of a face: `pad.metres` in the world, then
 * `pad.viewport` of the viewport on every side, clipped to the viewport.
 * Null when nothing of the face is on screen.
 */
export function paddedFaceRect(
  face: DataFace,
  camera: CameraEndpoint,
  viewport: Viewport,
  pad: KeepOutPad = KEEP_OUT_PAD,
): ScreenRect | null {
  const projected = faceRectAt(face, camera, viewport, pad.metres);
  if (!projected.fullRect || !projected.rect) return null;
  const px = pad.viewport * viewport.width;
  const py = pad.viewport * viewport.height;
  const r = projected.fullRect;
  const x0 = Math.max(0, r.x - px);
  const y0 = Math.max(0, r.y - py);
  const x1 = Math.min(viewport.width, r.x + r.w + px);
  const y1 = Math.min(viewport.height, r.y + r.h + py);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Share (0..1) of a face's unpadded rect that lies inside the viewport. */
export function faceInFrameFraction(face: DataFace, camera: CameraEndpoint, viewport: Viewport): number {
  return faceRectAt(face, camera, viewport).onScreenFraction;
}

// ── Poses ────────────────────────────────────────────────────────────────────

/** Is this viewport laid out as a phone (bottom sheet, mobile ledger)? */
export function isMobileViewport(viewport: Viewport): boolean {
  return viewport.width <= MOBILE_MAX_WIDTH;
}

const ledgerCache = new WeakMap<readonly RouteStation[], { desktop: PoseLedger; mobile: PoseLedger }>();

function ledgersFor(stations: readonly RouteStation[]) {
  let cached = ledgerCache.get(stations);
  if (!cached) {
    cached = { desktop: buildPoseLedger(stations, false), mobile: buildPoseLedger(stations, true) };
    ledgerCache.set(stations, cached);
  }
  return cached;
}

/**
 * The rig's pose at conductor position `position` (station units) for a
 * viewport — `samplePath` over the ledger the rig would pick (mobile below
 * 768 px) with the aspect's pullback — as a look-at endpoint. At an integer
 * position this is the frozen endpoint (desktop, 768 pulled back, landed 390).
 */
export function routePoseAt(stations: readonly RouteStation[], position: number, viewport: Viewport): CameraEndpoint {
  const ledgers = ledgersFor(stations);
  const ledger = isMobileViewport(viewport) ? ledgers.mobile : ledgers.desktop;
  const aspect = viewport.width / viewport.height;
  const pose = samplePath(ledger, position, aspect, createPose());
  // Camera looks down its local −Z.
  const q = pose.quaternion;
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fy = -2 * (q.y * q.z - q.w * q.x);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const p = pose.position;
  return { position: [p.x, p.y, p.z], target: [p.x + fx * 10, p.y + fy * 10, p.z + fz * 10], fov: pose.fov };
}

/** The frozen station pose for a viewport key (desktop / tablet / landed 390). */
export function stationPose(theme: DataSurfaceTheme, stationIndex: number, viewportKey: ViewportKey): KeepOutPose {
  const station = theme.stations[stationIndex];
  const viewport = VIEWPORTS[viewportKey];
  const kind: KeepOutPoseKind = viewportKey === 'mobile' ? 'landed390' : viewportKey;
  return { id: `${station.id}:${kind}`, kind, camera: routePoseAt(theme.stations, stationIndex, viewport), viewport };
}

/** Focus-framing kind for a face kind (focus.ts KIND_DEFAULTS). */
function focusKindFor(kind: DataFaceKind): string {
  return kind === 'plate' || kind === 'tablet' ? 'plaque' : 'board';
}

/** The face framed as its own focus subject (see the module's honest limits). */
export function faceFocusSubject(face: DataFace): FocusSubject {
  const bounds = faceBounds(face);
  const n = normalize([face.normal[0], 0, face.normal[2]]);
  return {
    id: `face:${face.id}`,
    kind: focusKindFor(face.kind),
    label: face.id,
    bounds,
    facing: n[0] === 0 && n[2] === 0 ? [0, 0, 1] : n,
  };
}

/**
 * The focus poses of a face: the desktop rail pose (1440, station fov) and
 * the mobile sheet pose (390, mobile fov) — `frameSubject` + `orbitPose`
 * with the panel offset the rig applies when the subject opens a panel.
 */
export function faceFocusPoses(theme: DataSurfaceTheme, face: DataFace): KeepOutPose[] {
  const station = theme.stations.find((s) => s.id === face.station);
  if (!station) return [];
  const subject = faceFocusSubject(face);
  const out: KeepOutPose[] = [];
  for (const [key, mobile] of [
    ['desktop', false],
    ['mobile', true],
  ] as const) {
    const viewport = VIEWPORTS[key];
    const fov = mobile ? station.cameraMobile.fov : station.camera.fov;
    const framing = frameSubject(
      subject,
      fov,
      viewport.width / viewport.height,
      framingOptionsFor(subject.kind, panelFrameOffset(true, mobile)),
    );
    const pose = orbitPose(framing);
    out.push({
      id: `${face.id}:focus:${mobile ? '390' : '1440'}`,
      kind: 'focus',
      camera: { position: pose.position, target: pose.target, fov },
      viewport,
    });
  }
  return out;
}

/** Quarter points of every crossing the dolly corridor is sampled at. */
export const DOLLY_SAMPLES = [0.25, 0.5, 0.75] as const;

/**
 * LOOK r6 (C4): the denser crossing samples the LAMP / PROP tests judge
 * (never the wedges — `DOLLY_SAMPLES` above stays the keep-out corridor, so
 * no wedge, calm box or baked mask moves). The r4 dolly film caught a teams
 * street lamp over the aces at s ≈ 3.64, between the quarter points; the
 * extra 0.6 / 0.65 / 0.7 samples cover that approach.
 */
export const DOLLY_PROP_SAMPLES = [0.25, 0.5, 0.6, 0.65, 0.7, 0.75] as const;

/** A face joins a dolly sample's wedge set when this much of its padded rect is on screen. */
export const DOLLY_MIN_ON_SCREEN = 0.5;

/** Dolly-corridor poses between station `index` and `index + 1`, all three viewports. */
export function dollyPoses(theme: DataSurfaceTheme, index: number): KeepOutPose[] {
  const out: KeepOutPose[] = [];
  if (index < 0 || index >= theme.stations.length - 1) return out;
  const from = theme.stations[index].id;
  const to = theme.stations[index + 1].id;
  for (const key of ['desktop', 'tablet', 'mobile'] as const) {
    for (const t of DOLLY_SAMPLES) {
      out.push({
        id: `${from}>${to}@${t}:${key}`,
        kind: 'dolly',
        camera: routePoseAt(theme.stations, index + t, VIEWPORTS[key]),
        viewport: VIEWPORTS[key],
      });
    }
  }
  return out;
}

// ── Keep-out wedges ──────────────────────────────────────────────────────────

/**
 * The padded wedge from `pose`'s eye to `face`: the face grown by
 * `pad.metres`, projected, grown by `pad.viewport` of the frame per side,
 * clipped to the frame, swept from the eye to the face plane. Null when the
 * face is entirely off screen or behind the eye at this pose.
 */
export function keepOutWedge(face: DataFace, pose: KeepOutPose, pad: KeepOutPad = KEEP_OUT_PAD): KeepOutWedge | null {
  const projected = faceRectAt(face, pose.camera, pose.viewport, pad.metres);
  if (!projected.rect || !projected.fullRect) return null;
  const { width, height } = pose.viewport;
  const r = projected.fullRect;
  const toNdcX = (x: number) => (x / width) * 2 - 1;
  const toNdcY = (y: number) => 1 - (y / height) * 2;
  const padNdc = pad.viewport * 2;
  const ndc = {
    x0: clamp(toNdcX(r.x) - padNdc, -1, 1),
    x1: clamp(toNdcX(r.x + r.w) + padNdc, -1, 1),
    y0: clamp(toNdcY(r.y + r.h) - padNdc, -1, 1),
    y1: clamp(toNdcY(r.y) + padNdc, -1, 1),
  };
  if (ndc.x1 <= ndc.x0 || ndc.y1 <= ndc.y0) return null;
  const basis = cameraBasis(pose.camera);
  const n = normalize(face.normal);
  const towardEye = dot(sub(pose.camera.position, face.center), n) >= 0 ? n : ([-n[0], -n[1], -n[2]] as V3);
  return {
    faceId: face.id,
    stationId: face.station,
    poseId: pose.id,
    poseKind: pose.kind,
    eye: pose.camera.position,
    right: basis.right,
    up: basis.up,
    forward: basis.forward,
    tanHalf: Math.tan((pose.camera.fov * Math.PI) / 360),
    aspect: width / height,
    ndc,
    planePoint: face.center,
    planeNormal: towardEye,
  };
}

/**
 * Does a sphere (centre `c`, radius `r` ≥ 0) reach into the wedge? True when
 * some part of it lies in front of the eye, on the eye's side of the face
 * plane, and inside the padded NDC rect (the rect grown by the sphere's
 * angular radius at its depth).
 */
export function wedgeHitsSphere(wedge: KeepOutWedge, c: Vec3, r = 0): boolean {
  const rel = sub(c, wedge.eye);
  const depth = dot(rel, wedge.forward);
  if (depth + r <= RIG_NEAR_M) return false;
  const side = dot(sub(c, wedge.planePoint), wedge.planeNormal);
  if (side < -r) return false;
  const d = Math.max(depth, RIG_NEAR_M);
  const sx = d * wedge.tanHalf * wedge.aspect;
  const sy = d * wedge.tanHalf;
  const x = dot(rel, wedge.right) / sx;
  const y = dot(rel, wedge.up) / sy;
  const rx = r / sx;
  const ry = r / sy;
  return x + rx >= wedge.ndc.x0 && x - rx <= wedge.ndc.x1 && y + ry >= wedge.ndc.y0 && y - ry <= wedge.ndc.y1;
}

/** Every pose a face's keep-out is judged from (see the module header). */
export function faceKeepOutPoses(theme: DataSurfaceTheme, face: DataFace): KeepOutPose[] {
  const index = theme.stations.findIndex((s) => s.id === face.station);
  if (index < 0) return [];
  const poses: KeepOutPose[] = [
    stationPose(theme, index, 'desktop'),
    stationPose(theme, index, 'tablet'),
    stationPose(theme, index, 'mobile'),
    ...faceFocusPoses(theme, face),
  ];
  for (const crossing of [index - 1, index]) {
    for (const pose of dollyPoses(theme, crossing)) {
      if (faceRectAt(face, pose.camera, pose.viewport, KEEP_OUT_PAD.metres).onScreenFraction >= DOLLY_MIN_ON_SCREEN) {
        poses.push(pose);
      }
    }
  }
  return poses;
}

const wedgeCache = new WeakMap<DataSurfaceTheme, KeepOutWedge[]>();

/** Every keep-out wedge of a world (memoized per theme object). */
export function themeWedges(theme: DataSurfaceTheme, pad: KeepOutPad = KEEP_OUT_PAD): KeepOutWedge[] {
  const cacheable = pad === KEEP_OUT_PAD;
  const cached = cacheable ? wedgeCache.get(theme) : undefined;
  if (cached) return cached;
  const out: KeepOutWedge[] = [];
  for (const face of theme.faces) {
    for (const pose of faceKeepOutPoses(theme, face)) {
      const wedge = keepOutWedge(face, pose, pad);
      if (wedge) out.push(wedge);
    }
  }
  if (cacheable) wedgeCache.set(theme, out);
  return out;
}

// ── Clearance tests ──────────────────────────────────────────────────────────

/** An axis-aligned box (optionally yawed about +Y), as prop / figure tables state it. */
export interface KeepOutBox {
  id: string;
  center: Vec3;
  half: Vec3;
  /** Yaw of the box's local frame about +Y (three convention); 0 = axis-aligned. */
  yaw?: number;
}

/** A moving actor's lane: a polyline of samples with a body radius. */
export interface KeepOutLane {
  id: string;
  points: readonly Vec3[];
  radius: number;
  /** Closed loop: the last point joins the first. */
  closed?: boolean;
}

/** Column clearance at (x, z) between `floor` and `ceiling` (see `headroomAt`). */
export interface Headroom {
  /** Highest y such that [floor, below] is clear of every wedge (floor when floor itself is blocked). */
  below: number;
  /** Lowest y such that [above, ceiling] is clear (ceiling when the top is blocked). */
  above: number;
  /** The whole column is clear. */
  clear: boolean;
}

export interface KeepOut {
  readonly wedges: readonly KeepOutWedge[];
  /** Wedges a sphere reaches into (empty = clear). */
  hits(c: Vec3, r?: number): KeepOutWedge[];
  pointClear(p: Vec3): boolean;
  sphereClear(c: Vec3, r: number): boolean;
  /** A swept sphere of radius `r` from `a` to `b` (sampled ≤ 0.1 m). */
  segmentClear(a: Vec3, b: Vec3, r?: number): boolean;
  /** Wedges any sample of the lane reaches (empty = the lane clears). */
  laneHits(lane: KeepOutLane): KeepOutWedge[];
  laneClears(lane: KeepOutLane): boolean;
  /** Wedges a (yawed) box reaches, grid-sampled (≤ 0.25 m, ≤ 9 per axis). */
  boxHits(box: KeepOutBox): KeepOutWedge[];
  boxClear(box: KeepOutBox): boolean;
  /**
   * Altitude clamps at (x, z): a surfacer / wader keeps under `below`, a
   * flyer over `above`. Scans [floor, ceiling] at `stepM` (default 0.1 m)
   * with a body radius `r` (default 0).
   */
  headroomAt(x: number, z: number, options?: { floor?: number; ceiling?: number; stepM?: number; r?: number }): Headroom;
}

const SEGMENT_STEP_M = 0.1;
const BOX_STEP_M = 0.25;
const BOX_MAX_SAMPLES = 9;

/** Grid samples of a (yawed) box (corners and faces included). */
export function boxSamples(box: KeepOutBox): V3[] {
  const counts = box.half.map((h) => clamp(Math.ceil((2 * h) / BOX_STEP_M) + 1, 2, BOX_MAX_SAMPLES));
  const yaw = box.yaw ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out: V3[] = [];
  for (let i = 0; i < counts[0]; i += 1) {
    const lx = -box.half[0] + (2 * box.half[0] * i) / (counts[0] - 1);
    for (let j = 0; j < counts[1]; j += 1) {
      const ly = -box.half[1] + (2 * box.half[1] * j) / (counts[1] - 1);
      for (let k = 0; k < counts[2]; k += 1) {
        const lz = -box.half[2] + (2 * box.half[2] * k) / (counts[2] - 1);
        // three.js rotation about +Y: world = (x c + z s, y, −x s + z c).
        out.push([box.center[0] + lx * c + lz * s, box.center[1] + ly, box.center[2] - lx * s + lz * c]);
      }
    }
  }
  return out;
}

function segmentSamples(a: Vec3, b: Vec3): V3[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const steps = Math.max(1, Math.ceil(length / SEGMENT_STEP_M));
  const out: V3[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

export function createKeepOut(wedges: readonly KeepOutWedge[]): KeepOut {
  const hits = (c: Vec3, r = 0) => wedges.filter((w) => wedgeHitsSphere(w, c, r));
  const anyHit = (c: Vec3, r = 0) => wedges.some((w) => wedgeHitsSphere(w, c, r));
  const hitsOf = (points: readonly Vec3[], r: number): KeepOutWedge[] =>
    wedges.filter((w) => points.some((p) => wedgeHitsSphere(w, p, r)));
  const lanePoints = (lane: KeepOutLane): V3[] => {
    const pts = lane.points;
    if (pts.length === 0) return [];
    if (pts.length === 1) return [[pts[0][0], pts[0][1], pts[0][2]]];
    const out: V3[] = [];
    const last = lane.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < last; i += 1) out.push(...segmentSamples(pts[i], pts[(i + 1) % pts.length]));
    return out;
  };
  return {
    wedges,
    hits,
    pointClear: (p) => !anyHit(p, 0),
    sphereClear: (c, r) => !anyHit(c, r),
    segmentClear: (a, b, r = 0) => segmentSamples(a, b).every((p) => !anyHit(p, r)),
    laneHits: (lane) => hitsOf(lanePoints(lane), lane.radius),
    laneClears: (lane) => lanePoints(lane).every((p) => !anyHit(p, lane.radius)),
    boxHits: (box) => hitsOf(boxSamples(box), 0),
    boxClear: (box) => boxSamples(box).every((p) => !anyHit(p, 0)),
    headroomAt: (x, z, options = {}) => {
      const floor = options.floor ?? 0;
      const ceiling = options.ceiling ?? 40;
      const step = options.stepM ?? SEGMENT_STEP_M;
      const r = options.r ?? 0;
      const n = Math.max(1, Math.ceil((ceiling - floor) / step));
      const blocked: boolean[] = [];
      for (let i = 0; i <= n; i += 1) blocked.push(anyHit([x, floor + ((ceiling - floor) * i) / n, z], r));
      const firstBlocked = blocked.indexOf(true);
      if (firstBlocked < 0) return { below: ceiling, above: floor, clear: true };
      const lastBlocked = blocked.lastIndexOf(true);
      const at = (i: number) => floor + ((ceiling - floor) * i) / n;
      return {
        below: firstBlocked === 0 ? floor : at(firstBlocked - 1),
        above: lastBlocked === n ? ceiling : at(lastBlocked + 1),
        clear: false,
      };
    },
  };
}

const keepOutCache = new WeakMap<DataSurfaceTheme, KeepOut>();

/** The world's keep-out (all wedges), memoized per theme object. */
export function themeKeepOut(theme: DataSurfaceTheme): KeepOut {
  let cached = keepOutCache.get(theme);
  if (!cached) {
    cached = createKeepOut(themeWedges(theme));
    keepOutCache.set(theme, cached);
  }
  return cached;
}

// ── Figure placement rules beside the wedges ─────────────────────────────────

/** Bottom HUD band (WorldNav `.world-nav-hud`: 56 px, bottom edge, every viewport). */
export const HUD_BAND_PX = 56;

/** No figure root inside this share of the frame from any edge. */
export const EDGE_INSET = 0.03;

/** A figure must face within this many degrees of the eye (no backs to the camera). */
export const FACING_MAX_DEG = 100;

/** Screen position (CSS px) of a world point, or null behind the eye. */
export function screenPoint(p: Vec3, camera: CameraEndpoint, viewport: Viewport): { x: number; y: number } | null {
  const { right, up, forward } = cameraBasis(camera);
  const rel = sub(p, camera.position);
  const depth = dot(rel, forward);
  if (depth < RIG_NEAR_M - 1e-9) return null;
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const aspect = viewport.width / viewport.height;
  const nx = dot(rel, right) / (depth * tanHalf * aspect);
  const ny = dot(rel, up) / (depth * tanHalf);
  return { x: ((nx + 1) / 2) * viewport.width, y: ((1 - ny) / 2) * viewport.height };
}

export type RootPlacement = 'ok' | 'off-frame' | 'hud-band' | 'edge-inset';

/**
 * Where a figure root lands on screen: in the HUD band, inside the 3 % edge
 * inset, off frame entirely (not this rule's business — the W4 audit judges
 * visibility), or fine.
 */
export function rootPlacement(root: Vec3, camera: CameraEndpoint, viewport: Viewport): RootPlacement {
  const p = screenPoint(root, camera, viewport);
  if (!p || p.x < 0 || p.x > viewport.width || p.y < 0 || p.y > viewport.height) return 'off-frame';
  if (p.y > viewport.height - HUD_BAND_PX) return 'hud-band';
  const ix = EDGE_INSET * viewport.width;
  const iy = EDGE_INSET * viewport.height;
  if (p.x < ix || p.x > viewport.width - ix || p.y < iy) return 'edge-inset';
  return 'ok';
}

/**
 * The facing rule: a figure whose model faces local +Z, turned by `yaw`
 * about +Y (three convention: forward = (sin yaw, 0, cos yaw)), must face
 * within ±FACING_MAX_DEG of the direction to the eye.
 */
export function facesEye(root: Vec3, yaw: number, eye: Vec3): boolean {
  const tx = eye[0] - root[0];
  const tz = eye[2] - root[2];
  const len = Math.hypot(tx, tz);
  if (len < 1e-6) return true;
  const cos = (Math.sin(yaw) * tx + Math.cos(yaw) * tz) / len;
  return cos >= Math.cos((FACING_MAX_DEG * Math.PI) / 180);
}

// ── Partial-face table (standby dim, seat 2F) ────────────────────────────────

/** A face less than this share in frame at a station pose is "partial" (standby dim). */
export const PARTIAL_FACE_THRESHOLD = 0.8;

export type PartialFaceTable = Readonly<Record<string, Readonly<Record<ViewportKey, readonly string[]>>>>;

const partialCache = new WeakMap<DataSurfaceTheme, PartialFaceTable>();

/**
 * Per station and viewport: the ids of faces that are on screen but less
 * than 80 % in frame at the frozen station pose. Precomputed (memoized per
 * theme) — the endpoints are frozen, so the table is a constant of the world.
 */
export function partialFaceTable(theme: DataSurfaceTheme): PartialFaceTable {
  const cached = partialCache.get(theme);
  if (cached) return cached;
  const table: Record<string, Record<ViewportKey, string[]>> = {};
  theme.stations.forEach((station, index) => {
    const row = { desktop: [], tablet: [], mobile: [] } as Record<ViewportKey, string[]>;
    for (const key of ['desktop', 'tablet', 'mobile'] as const) {
      const pose = stationPose(theme, index, key);
      for (const face of theme.faces) {
        const f = faceInFrameFraction(face, pose.camera, pose.viewport);
        if (f > 0 && f < PARTIAL_FACE_THRESHOLD) row[key].push(face.id);
      }
    }
    table[station.id] = row;
  });
  partialCache.set(theme, table);
  return table;
}

// ── Portrait bands (Station Card placement, seat 2B) ─────────────────────────

/** A horizontal screen band in CSS px (top inclusive, bottom exclusive). */
export interface Band {
  top: number;
  bottom: number;
}

export const CAPTION_MIN_PX = 96;
/** The compact one-line caption fallback's height. */
export const CAPTION_COMPACT_PX = 44;
export const LIFE_MIN_PX = 120;
/** Desktop caption box (≥ 768 px): 360 × 120 at a 24 px inset, top-left or top-right. */
export const DESKTOP_CAPTION = { w: 360, h: 120, inset: 24 } as const;

export interface StationBands {
  layout: 'portrait' | 'landscape';
  viewport: Viewport;
  /** The caption band (portrait: full width; landscape: the box's rows). */
  caption: Band;
  /** The caption's rectangle (portrait: the full-width band; landscape: the 360 × 120 box). */
  captionRect: ScreenRect;
  captionSide: 'left' | 'right' | 'full';
  /** The caption band is under CAPTION_MIN_PX: render the compact one-line card. */
  captionCompact: boolean;
  /** Even the chosen caption rect meets a padded face (a placement defect to fix). */
  captionConflict: boolean;
  /** Vertical extent of the station's own padded faces (null: none on screen). */
  data: Band | null;
  /** Between the data and the HUD: where life may move. */
  life: Band;
  hud: Band;
  /** Padded rects of every face on screen at this pose (own and neighbours). */
  faceRects: readonly ScreenRect[];
}

function rectsMeet(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlapArea(a: ScreenRect, b: ScreenRect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Screen bands at a station's frozen pose for a viewport.
 *
 * Portrait (≤ 767 px): four full-width bands top to bottom — caption (sky
 * above every padded face), data (the station's own padded faces), life
 * (below the data, above the HUD) and the 56 px HUD. A caption band under
 * CAPTION_MIN_PX flags the compact one-line fallback.
 *
 * Landscape (≥ 768 px): the caption is a 360 × 120 box at a 24 px inset,
 * top-left unless that meets a padded face, then top-right; if both meet
 * one, the side with less overlap is taken and `captionConflict` is set.
 */
export function portraitBands(theme: DataSurfaceTheme, stationIndex: number, viewport: Viewport): StationBands {
  const station = theme.stations[stationIndex];
  const camera = routePoseAt(theme.stations, stationIndex, viewport);
  const own: ScreenRect[] = [];
  const all: ScreenRect[] = [];
  for (const face of theme.faces) {
    const rect = paddedFaceRect(face, camera, viewport);
    if (!rect) continue;
    all.push(rect);
    if (face.station === station.id) own.push(rect);
  }
  const H = viewport.height;
  const hud: Band = { top: H - HUD_BAND_PX, bottom: H };
  const data: Band | null =
    own.length > 0
      ? {
          top: Math.min(...own.map((r) => r.y)),
          bottom: Math.min(hud.top, Math.max(...own.map((r) => r.y + r.h))),
        }
      : null;
  const lifeTop = data ? data.bottom : 0;
  const life: Band = { top: Math.min(lifeTop, hud.top), bottom: hud.top };

  if (isMobileViewport(viewport)) {
    // The caption must clear every padded face (own and neighbour), not
    // only the station's own.
    const firstFace = all.length > 0 ? Math.min(...all.map((r) => r.y)) : hud.top;
    const bottom = Math.max(0, Math.min(firstFace, hud.top));
    const caption: Band = { top: 0, bottom };
    const height = bottom;
    return {
      layout: 'portrait',
      viewport,
      caption,
      captionRect: { x: 0, y: 0, w: viewport.width, h: height },
      captionSide: 'full',
      captionCompact: height < CAPTION_MIN_PX,
      captionConflict: height < CAPTION_COMPACT_PX,
      data,
      life,
      hud,
      faceRects: all,
    };
  }

  const { w, h, inset } = DESKTOP_CAPTION;
  const left: ScreenRect = { x: inset, y: inset, w, h };
  const right: ScreenRect = { x: viewport.width - inset - w, y: inset, w, h };
  const leftHits = all.filter((r) => rectsMeet(left, r));
  const rightHits = all.filter((r) => rectsMeet(right, r));
  let side: 'left' | 'right' = 'left';
  if (leftHits.length > 0 && rightHits.length === 0) side = 'right';
  else if (leftHits.length > 0 && rightHits.length > 0) {
    const lo = leftHits.reduce((s, r) => s + overlapArea(left, r), 0);
    const ro = rightHits.reduce((s, r) => s + overlapArea(right, r), 0);
    side = ro < lo ? 'right' : 'left';
  }
  const rect = side === 'left' ? left : right;
  return {
    layout: 'landscape',
    viewport,
    caption: { top: rect.y, bottom: rect.y + rect.h },
    captionRect: rect,
    captionSide: side,
    captionCompact: false,
    captionConflict: (side === 'left' ? leftHits : rightHits).length > 0,
    data,
    life,
    hud,
    faceRects: all,
  };
}

/** Does a screen rect stay clear of every padded face at a station pose? */
export function rectClearOfFaces(
  theme: DataSurfaceTheme,
  stationIndex: number,
  viewport: Viewport,
  rect: ScreenRect,
): boolean {
  const camera = routePoseAt(theme.stations, stationIndex, viewport);
  return theme.faces.every((face) => {
    const padded = paddedFaceRect(face, camera, viewport);
    return !padded || !rectsMeet(rect, padded);
  });
}

// ── Settle latch (useStationSettle) ──────────────────────────────────────────

/** `|smooth − exact|` under this counts as caught up. */
export const SETTLE_EPS = 0.02;
/** The hysteretic nearest station must hold this long (ms) before settling. */
export const SETTLE_HOLD_MS = 150;
/**
 * A station settles only while the rendered position is this close to it —
 * a visitor parked mid-crossing (exact 1.4) is not "at" station 1, and the
 * card must not show mid-crossing (§5.3).
 */
export const SETTLE_ARRIVE = 0.1;
/**
 * A settled station releases once the rendered position leaves this far
 * (or the nearest station changes). Wider than SETTLE_ARRIVE, so a jitter
 * around the arrival edge can never toggle the latch.
 */
export const SETTLE_RELEASE = 0.3;

export interface SettleState {
  /** The hysteretic nearest station this state is tracking (−1 before the first sample). */
  station: number;
  /** When `station` became the nearest (ms, caller's clock). */
  heldSince: number;
  settled: boolean;
}

export interface SettleInput {
  smooth: number;
  exact: number;
  /** The conductor's hysteretic nearest station (`progress.nearest`). */
  nearest: number;
  /** Caller's clock, ms. */
  now: number;
}

export function createSettleState(): SettleState {
  return { station: -1, heldSince: 0, settled: false };
}

/**
 * Advance the settle latch. Returns `prev` itself when nothing changed (so a
 * React state setter bails out).
 *
 * - A change of the nearest station resets the hold clock and unsettles.
 * - Unsettled → settled once `|smooth − exact| < SETTLE_EPS`, the nearest
 *   station has held ≥ SETTLE_HOLD_MS, and `|smooth − station| ≤ SETTLE_ARRIVE`.
 * - Settled → unsettled only when the nearest station changes or the
 *   rendered position leaves SETTLE_RELEASE of the station. Catch-up noise
 *   (`smooth` trailing `exact` while both stay at the station) never
 *   releases it — that is the latch.
 *
 * The nearest station itself is `stepStationLatch`'s (±`NEAREST_STATION_BAND`
 * past each x.5, direction-latch.ts), so the station can never flip on noise around a midpoint.
 */
export function stepSettleLatch(prev: SettleState, input: SettleInput): SettleState {
  const { smooth, exact, nearest, now } = input;
  if (!Number.isFinite(smooth) || !Number.isFinite(exact)) return prev;
  if (nearest !== prev.station) return { station: nearest, heldSince: now, settled: false };
  const away = Math.abs(smooth - nearest);
  if (prev.settled) {
    return away > SETTLE_RELEASE ? { ...prev, settled: false } : prev;
  }
  const ready =
    Math.abs(smooth - exact) < SETTLE_EPS && now - prev.heldSince >= SETTLE_HOLD_MS && away <= SETTLE_ARRIVE;
  return ready ? { ...prev, settled: true } : prev;
}

// ── Calm boxes (LOOK-PLAN §2 SEAT S item 3) ──────────────────────────────────

/**
 * A vertical backdrop rectangle — a façade plane (or a terrace front) that a
 * data face is seen against. The plane is perpendicular to `axis` at `at`;
 * it spans `span` along the other horizontal axis and `y` vertically.
 * `depth` is the half-thickness a calm box keeps around the plane, so proud
 * cornices, recessed window infill and kit bays all fall inside it.
 */
export interface CalmBackdrop {
  id: string;
  axis: 'x' | 'z';
  at: number;
  span: readonly [number, number];
  y: readonly [number, number];
  depth?: number;
}

/** A world-space AABB where painted façade detail (joints, streaks, jitter) is flattened. */
export interface CalmBox {
  id: string;
  min: Vec3;
  max: Vec3;
  /** Faces whose padded rects this box covers. */
  faceIds: readonly string[];
}

/** Shader slots for calm boxes (the ashlar patch's uniform array length). */
export const CALM_BOX_MAX = 8;
/** In-plane margin (m) each calm box keeps beyond the cast rect. */
export const CALM_BOX_MARGIN_M = 0.3;
/** Default half-thickness (m) of a calm box around its backdrop plane. */
export const CALM_BOX_DEPTH_M = 1.0;
/** Rays per rect side the caster samples (corners included). */
export const CALM_BOX_GRID = 9;
/** A dolly sample joins the calm sweep when this much of the face is on screen. */
export const CALM_DOLLY_MIN_ON_SCREEN = 0.1;

/**
 * Every pose a face's calm box is swept from: the station's desktop, 768 and
 * landed 390 eyes, the face's focus poses and EVERY dolly sample of every
 * crossing (a chip jump flies through the others) at which a real share of
 * the face is on screen (the mid-dolly halo check: the calm must already be
 * there while the face slides in, not only once it is half on screen).
 */
export function calmPoses(theme: DataSurfaceTheme, face: DataFace): KeepOutPose[] {
  const index = theme.stations.findIndex((s) => s.id === face.station);
  if (index < 0) return [];
  const poses: KeepOutPose[] = [
    stationPose(theme, index, 'desktop'),
    stationPose(theme, index, 'tablet'),
    stationPose(theme, index, 'mobile'),
    ...faceFocusPoses(theme, face),
  ];
  for (let crossing = 0; crossing < theme.stations.length - 1; crossing += 1) {
    for (const pose of dollyPoses(theme, crossing)) {
      if (faceRectAt(face, pose.camera, pose.viewport, KEEP_OUT_PAD.metres).onScreenFraction >= CALM_DOLLY_MIN_ON_SCREEN) {
        poses.push(pose);
      }
    }
  }
  return poses;
}

/** First backdrop a ray from `eye` along `dir` meets beyond the rig's near plane (null: sky). */
function castOnBackdrops(eye: Vec3, dir: Vec3, backdrops: readonly CalmBackdrop[]): { backdrop: CalmBackdrop; p: V3 } | null {
  let best: { backdrop: CalmBackdrop; p: V3; t: number } | null = null;
  for (const b of backdrops) {
    const k = b.axis === 'x' ? 0 : 2;
    const o = b.axis === 'x' ? 2 : 0;
    if (Math.abs(dir[k]) < 1e-9) continue;
    const t = (b.at - eye[k]) / dir[k];
    if (t <= RIG_NEAR_M || (best && t >= best.t)) continue;
    const p: V3 = [eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t];
    if (p[o] < b.span[0] || p[o] > b.span[1] || p[1] < b.y[0] || p[1] > b.y[1]) continue;
    best = { backdrop: b, p, t };
  }
  return best ? { backdrop: best.backdrop, p: best.p } : null;
}

/**
 * Where a face's padded rect (the keep-out wedge's NDC rect, clipped to the
 * frame) lands on the backdrops from one pose: a `grid × grid` fan of rays
 * through the rect, each stopped at the first backdrop it meets. On one
 * plane the hit set's AABB contains the whole cast (a convex quad whose
 * corners are the corner rays), so the corners carry the exactness and the
 * interior rays only matter where the rect straddles two planes.
 */
export function castFaceOnBackdrops(
  face: DataFace,
  pose: KeepOutPose,
  backdrops: readonly CalmBackdrop[],
  grid: number = CALM_BOX_GRID,
  pad: KeepOutPad = KEEP_OUT_PAD,
): { backdrop: CalmBackdrop; p: Vec3 }[] {
  const wedge = keepOutWedge(face, pose, pad);
  if (!wedge) return [];
  const out: { backdrop: CalmBackdrop; p: Vec3 }[] = [];
  const n = Math.max(2, grid);
  for (let i = 0; i < n; i += 1) {
    const nx = wedge.ndc.x0 + ((wedge.ndc.x1 - wedge.ndc.x0) * i) / (n - 1);
    for (let j = 0; j < n; j += 1) {
      const ny = wedge.ndc.y0 + ((wedge.ndc.y1 - wedge.ndc.y0) * j) / (n - 1);
      const sx = nx * wedge.tanHalf * wedge.aspect;
      const sy = ny * wedge.tanHalf;
      const dir: V3 = [
        wedge.forward[0] + wedge.right[0] * sx + wedge.up[0] * sy,
        wedge.forward[1] + wedge.right[1] * sx + wedge.up[1] * sy,
        wedge.forward[2] + wedge.right[2] * sx + wedge.up[2] * sy,
      ];
      const hit = castOnBackdrops(wedge.eye, dir, backdrops);
      if (hit) out.push(hit);
    }
  }
  return out;
}

function boxVolume(min: Vec3, max: Vec3): number {
  return Math.max(0, max[0] - min[0]) * Math.max(0, max[1] - min[1]) * Math.max(0, max[2] - min[2]);
}

/**
 * The world-space calm boxes of a world (≤ `maxBoxes`, default
 * `CALM_BOX_MAX`): every face's padded rect cast onto the backdrops from
 * every calm pose (`calmPoses`), one AABB per (face, backdrop plane) grown
 * by `CALM_BOX_MARGIN_M` in the plane and the backdrop's `depth` across it,
 * then merged greedily (the pair whose union adds the least volume) until
 * the shader's slot count holds. A union contains both inputs, so merging
 * never loses coverage — only precision.
 *
 * The keep-out law itself is untouched: calm boxes only say where painted
 * façade DETAIL flattens behind a face; they never admit or exclude a prop.
 */
export function calmBoxesFor(
  theme: DataSurfaceTheme,
  backdrops: readonly CalmBackdrop[],
  options: { maxBoxes?: number; grid?: number; marginM?: number } = {},
): CalmBox[] {
  const maxBoxes = options.maxBoxes ?? CALM_BOX_MAX;
  const grid = options.grid ?? CALM_BOX_GRID;
  const margin = options.marginM ?? CALM_BOX_MARGIN_M;
  const boxes = new Map<string, { min: V3; max: V3; faceIds: Set<string>; backdrop: CalmBackdrop }>();
  for (const face of theme.faces) {
    for (const pose of calmPoses(theme, face)) {
      for (const hit of castFaceOnBackdrops(face, pose, backdrops, grid)) {
        const key = `${face.id}|${hit.backdrop.id}`;
        let box = boxes.get(key);
        if (!box) {
          box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], faceIds: new Set(), backdrop: hit.backdrop };
          boxes.set(key, box);
        }
        box.faceIds.add(face.id);
        for (let k = 0; k < 3; k += 1) {
          box.min[k] = Math.min(box.min[k], hit.p[k]);
          box.max[k] = Math.max(box.max[k], hit.p[k]);
        }
      }
    }
  }
  let list: CalmBox[] = [...boxes.entries()].map(([key, box]) => {
    const b = box.backdrop;
    const k = b.axis === 'x' ? 0 : 2;
    const o = b.axis === 'x' ? 2 : 0;
    const depth = b.depth ?? CALM_BOX_DEPTH_M;
    const min: V3 = [box.min[0], box.min[1] - margin, box.min[2]];
    const max: V3 = [box.max[0], box.max[1] + margin, box.max[2]];
    min[o] -= margin;
    max[o] += margin;
    min[k] = b.at - depth;
    max[k] = b.at + depth;
    min[1] = Math.max(min[1], b.y[0] - margin);
    max[1] = Math.min(max[1], b.y[1] + margin);
    return { id: key, min, max, faceIds: [...box.faceIds].sort() };
  });
  // Deterministic order before merging (face order, then backdrop id).
  list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  while (list.length > maxBoxes) {
    let bestI = 0;
    let bestJ = 1;
    let bestCost = Infinity;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const min: V3 = [0, 1, 2].map((k) => Math.min(list[i].min[k], list[j].min[k])) as V3;
        const max: V3 = [0, 1, 2].map((k) => Math.max(list[i].max[k], list[j].max[k])) as V3;
        const cost = boxVolume(min, max) - boxVolume(list[i].min, list[i].max) - boxVolume(list[j].min, list[j].max);
        if (cost < bestCost) {
          bestCost = cost;
          bestI = i;
          bestJ = j;
        }
      }
    }
    const a = list[bestI];
    const b = list[bestJ];
    const merged: CalmBox = {
      id: `${a.id}+${b.id}`,
      min: [0, 1, 2].map((k) => Math.min(a.min[k], b.min[k])) as V3,
      max: [0, 1, 2].map((k) => Math.max(a.max[k], b.max[k])) as V3,
      faceIds: [...new Set([...a.faceIds, ...b.faceIds])].sort(),
    };
    list = list.filter((_, i) => i !== bestI && i !== bestJ);
    list.push(merged);
  }
  return list;
}

/** Is a world point inside any calm box (grown by `grow` metres)? */
export function pointInCalmBoxes(boxes: readonly CalmBox[], p: Vec3, grow = 0): boolean {
  return boxes.some(
    (box) =>
      p[0] >= box.min[0] - grow &&
      p[0] <= box.max[0] + grow &&
      p[1] >= box.min[1] - grow &&
      p[1] <= box.max[1] + grow &&
      p[2] >= box.min[2] - grow &&
      p[2] <= box.max[2] + grow,
  );
}

