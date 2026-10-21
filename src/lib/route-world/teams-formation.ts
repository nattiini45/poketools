/**
 * Teams formation + Roll-Call Ledger geometry (fidelity wave 2, seat 2G;
 * WAVE-PLAN §2 "2G TEAMS", decision D16 — user-approved).
 *
 * The teams station in every world used to be a two-rank horseshoe with a
 * name plate on each pedestal. Rear-rank plates sat behind front-rank aces,
 * lamps and ropes stood in front of names, and the left-to-right order was
 * the participants' join order. D16 replaces it with:
 *
 * 1. A ZIPPER FORMATION in standings order. Odd ranks (1, 3, 5, …) stand in
 *    the front row, even ranks in the rear row, so the left-to-right SCREEN
 *    order is 1 … N. Laterals follow a horizontal screen law
 *    (`lateral = s · depth`), so every rank has one screen position `s`.
 * 2. A REAR RISER from the ray-height law (the mountain podium's law,
 *    `mountain/furniture/layout.ts` SUMMIT_PODIUM): every rear ace — and
 *    every colossal on the back line — stands high enough that the sight
 *    line from the desktop eye over the heads of the front aces it overlaps
 *    on screen crosses its silhouette low; the law solves for
 *    `REAR_CLEAR_SOLVE` (85 %) so the brief's "≥ 70 %" holds in the sampled
 *    figure-visibility model too (its lowest sample row sits at 15 %).
 * 3. THE SCREEN RHYTHM (wave-2 r2). Consecutive ranks stand ≥ Δ apart on
 *    screen; two aces of one depth class (the front row; the back: rear
 *    pedestals + the colossal line) stand ≥ their two across-widths' halves
 *    + 0.2 m apart (`adjacencyPitch` states the front-row pitch this needs).
 *    Δ is the widest base rhythm (≤ `maxPitch`) that fits, in priority
 *    order: the 1440 LEDGER (a veto: its outer column edges and bezel caps
 *    inside `LEDGER_SCREEN_INSET_PX`), the desktop frame (`FRAME_FILL`), the
 *    landed 390 frame.
 * 4. COLOSSAL aces (> 1.5 m) are never shrunk (no stature clamping). Each
 *    stands on its own LOW PLINTH (`TEAMS_COLOSSAL_PLINTH_M`, gym band on
 *    its lip) on a common back line `COLOSSAL_SETBACK_M` behind the rear
 *    pedestals, on the riser. Wave-2 r2 retired the r1 seat (an empty
 *    full-height pedestal in the rear row with the giant behind it), which
 *    hid every giant's lower body behind its own pedestal.
 * 5. ONE LEDGER RAIL at the forecourt front edge: a single leaning slab
 *    whose face turns to the desktop eye, placed so its top edge sits just
 *    below the front pedestals' feet on screen. Each column is centred where
 *    the eye → ace ray crosses the face plane, so a column's projected x IS
 *    its ace's projected x. Above `LEDGER_TWO_LINE_OVER` (10) aces the
 *    ledger paints two lines (front-row ranks on top, rear-row ranks below)
 *    so each column gets twice the width.
 *
 * Honest limits (disclosed, never sold as more):
 *  - Heights and footprints come from the manifest bounds at Pokédex scale
 *    (`figureHeightM`, bounds × `figureScale`); idle poses, wings and tails
 *    are not modelled. A billboard/card stand-in is sized by its card.
 *  - The screen law is horizontal (yaw only). The teams camera pitches
 *    ≈ −6°, so a point's projected x also depends a little on its height;
 *    the ledger columns avoid that error by construction (ray intersection)
 *    and the ledger fit keeps a 3 % margin for it.
 *  - The riser is capped at `RISER_MAX_M`; an ace set whose front heads
 *    stand above the eye line cannot be satisfied and reports `riserCapped`.
 *  - A roster whose clearance cannot fit the frames reports `pitchOverflow`:
 *    the 390 frame gives way first (the 390 roll-call rail carries the names
 *    there); if the 1440 ledger still does not fit, two NEIGHBOURING GIANTS'
 *    back-line gap shrinks first (side by side they interleave spread limbs
 *    — the r1 live cast, four giants in a row, lands here), then the whole
 *    rhythm compresses. No pedestal ever stands before a giant.
 *  - The riser depth is capped at `RISER_DEPTH_MAX_M` (a deep colossal
 *    overhangs its back edge).
 *
 * Pure math — no client-only imports; the plaza site reads the lib layout.
 */

import type { CameraEndpoint, Vec3 } from './chapters';
import type { DataFace } from './data-surfaces';
import { landedEndpoint } from './legibility';
import { DESKTOP_ASPECT, MOBILE_390_ASPECT, projectPoint } from './figure-visibility';

// ── Law constants ────────────────────────────────────────────────────────────

/** Aces taller than this stand set back on the rear riser (D16; no clamping). */
export const TEAMS_COLOSSAL_M = 1.5;
/**
 * Wave-2 round 2 (TEAMS judge): a colossal ace stands on a LOW PLINTH of this
 * height (its gym band on the plinth's lip) at its own set-back seat — never
 * behind an empty full-height pedestal, which hid Hydreigon / Sceptile /
 * Slaking below their heads in r1.
 */
export const TEAMS_COLOSSAL_PLINTH_M = 0.25;
/** Depth (m) behind the rear pedestal line of the common colossal back line. */
export const COLOSSAL_SETBACK_M = 1.4;
/** The ledger bezel's outer edges stay this far (px) inside the 1440 frame (TEAMS judge r1 veto). */
export const LEDGER_SCREEN_INSET_PX = 24;
/** Air between neighbouring footprints in one row (brief: max footprint + 0.2 m). */
export const TEAMS_PITCH_MARGIN_M = 0.2;
/** The brief's bar: at least this share of each rear silhouette clears the front heads. */
export const REAR_CLEAR_SHARE = 0.7;
/** The share the riser law solves for (the sampled model's lowest row sits at 15 %). */
export const REAR_CLEAR_SOLVE = 0.85;
/** Lowest riser that still reads as a step, and the cap the law may not exceed. */
export const RISER_MIN_M = 0.3;
export const RISER_MAX_M = 2.2;
/** Deepest the rear riser may run behind the front line (colossal seats included). */
export const RISER_DEPTH_MAX_M = 4.2;
/** Above this many aces the ledger paints two lines. */
export const LEDGER_TWO_LINE_OVER = 10;
/** Share of the binding frame half-width the outermost footprint edge may reach. */
export const FRAME_FILL = 0.9;
/** Share of the landed 390 frame half-width the outermost ace CENTRE may reach. */
export const MOBILE_FRAME_FILL = 0.94;
/** Rendered cap height of the painted name at 1440 must reach this (acceptance). */
export const LEDGER_CAP_MIN_PX = 14;
/** Cap height as a share of the font size (system-ui bold; conservative). */
export const CAP_EM = 0.7;
/** Canvas texels per metre of ledger face (≈ 2× the 1440 screen density at the rail). */
export const LEDGER_TEXELS_PER_M = 480;

// ── Types ────────────────────────────────────────────────────────────────────

/** One ace as the formation sees it (standings order is the caller's). */
export interface TeamsAce {
  id: string;
  /** Real stature (m) — never clamped. */
  heightM: number;
  /** Largest plan extent (m) of the figure at its real scale. */
  footprintM: number;
  /**
   * Width (m) ACROSS the view — the figure's local x extent (it is yawed so
   * its local +Z faces the eye). Lateral clearance and screen overlap use
   * it; absent, the conservative `footprintM`.
   */
  widthM?: number;
  /** Extra stand above the pedestal cap (the plaza's tiny-ace insert), m. */
  liftM?: number;
}

/** Where a world's teams formation stands and how its pedestals are built. */
export interface TeamsSite {
  id: string;
  /** The frozen desktop #teams endpoint (chapters are frozen; never moved here). */
  camera: CameraEndpoint;
  /** The authored mobile endpoint; the landed 390 pose pulls it back 9.75 m. */
  cameraMobile: CameraEndpoint;
  /** Front-row line centre on the ground (world x, z). */
  anchor: { x: number; z: number };
  /** The surface the front row stands on (world y). */
  groundY: number;
  /** Pedestal cap height above its row surface, and its plan half-width. */
  pedestal: { capH: number; half: number };
  /** Front → rear pedestal line depth (m). */
  rowGap: number;
  /** Widest front-row pitch the composition wants (m). */
  maxPitch: number;
  /** The ledger rail. */
  ledger: {
    /** Horizontal distance from the desktop eye to the face centre (m). */
    distance: number;
    /** NDC gap between the front pedestals' feet and the ledger's top edge. */
    gapNdc: number;
    /** Slab thickness (m) and the bezel margin around the painted face (m). */
    thickness: number;
    margin: number;
    /** End-cap width (m) each side of the columns — the kicker lives on the left cap. */
    endCap: number;
  };
}

export type TeamsRow = 'front' | 'rear';

export interface TeamsSlot {
  id: string;
  /** 1-based standings rank. */
  rank: number;
  index: number;
  row: TeamsRow;
  colossal: boolean;
  /** Pedestal base centre (on its row surface; a colossal's low plinth sits under its feet). */
  pedestal: Vec3;
  /** Pedestal height (m): the site's cap, or `TEAMS_COLOSSAL_PLINTH_M` for a colossal's low plinth. */
  pedestalH: number;
  /** Feet of the figure (pedestal cap + lift, or the low plinth's top for a colossal). */
  figure: Vec3;
  /** Three.js yaw about +Y turning local +Z toward the desktop eye. */
  yaw: number;
  /** Horizontal screen coordinate (tan units) of the uniform law. */
  screenS: number;
  /** The desktop NDC x the slot is solved to (uniform rhythm, 1 … N left to right). */
  screenX: number;
  heightM: number;
  footprintM: number;
}

export interface LedgerColumn {
  id: string;
  rank: number;
  index: number;
  /** 0 = top line (front-row ranks when two lines), 1 = bottom line. */
  line: 0 | 1;
  /** Offset (m) along the face's right axis from the face centre: the ace's own x (chip + chevron). */
  across: number;
  /** Centre (m, same axis) of the column's cell — the text centres here. */
  cellAcross: number;
  /** Width (m) of the column's cell (the columns tile their line). */
  width: number;
}

export interface LedgerLayout {
  /** Painted face centre (world). */
  center: Vec3;
  /** Unit normal of the painted side (toward the desktop eye). */
  normal: Vec3;
  /** Unit right axis on the face (world up × normal): screen right. */
  right: Vec3;
  /** Unit up axis on the face (leans back with the tilt). */
  up: Vec3;
  /** Face lean from vertical (rad) — the face looks up at the eye by this much. */
  tilt: number;
  /** Horizontal yaw (three.js, about +Y) turning local +Z to the eye. */
  yaw: number;
  /** Painted face size (m), bezel margin excluded. */
  width: number;
  height: number;
  lines: 1 | 2;
  /** Line height (m) on the face, and the line metrics' scale (1, or 0.8 on two lines). */
  lineH: number;
  lineScale: number;
  columns: LedgerColumn[];
  /** Ground point under the face centre (the slab's base line centre). */
  base: Vec3;
  /** Slab thickness / bezel margin (from the site). */
  thickness: number;
  margin: number;
  endCap: number;
  /** Canvas size for the painted face. */
  canvas: { width: number; height: number };
  /** Screen px per metre of face at 1440 (at the face centre). */
  pxPerM1440: number;
}

export interface RiserLayout {
  /** Height of the rear riser above the front row surface (m). */
  height: number;
  /** Extent in the formation frame: depth (m past the front line) and lateral (m). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface TeamsFormation {
  site: TeamsSite;
  slots: TeamsSlot[];
  /** Front-row neighbour pitch (m); rear sits half a pitch off. */
  pitch: number;
  /** The minimum pitch the footprints demanded. */
  minPitch: number;
  riser: RiserLayout;
  riserCapped: boolean;
  pitchOverflow: boolean;
  /** Formation frame: origin on the front line centre, +x back, +z screen right. */
  frame: { origin: Vec3; yaw: number; back: Vec3; across: Vec3 };
  ledger: LedgerLayout;
}

// ── Vector helpers ───────────────────────────────────────────────────────────

type V3 = [number, number, number];

function sub(a: Vec3, b: Vec3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(v: Vec3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function round(v: number, step: number): number {
  return Math.ceil(v / step - 1e-9) * step;
}

// ── Standings order ──────────────────────────────────────────────────────────

/**
 * Participants in standings order (the data order the boards paint): each
 * participant at its standings row, participants without a row after them in
 * their original order. Pure; shared with the 390 roll-call rail.
 */
export function teamsInStandingsOrder<T extends { id: string }>(
  participants: readonly T[],
  standings: readonly { player_id: string }[],
): T[] {
  const rankOf = new Map<string, number>();
  standings.forEach((row, i) => {
    if (!rankOf.has(row.player_id)) rankOf.set(row.player_id, i);
  });
  return participants
    .map((p, i) => ({ p, i, r: rankOf.get(p.id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((entry) => entry.p);
}

/** Largest plan extent (m) of a figure from its recorded bounds and scale. */
export function footprintFromBounds(bounds: { min: readonly number[]; max: readonly number[] }, scale: number): number {
  return Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]) * scale;
}

// ── Frame helpers ────────────────────────────────────────────────────────────

/** Horizontal view axes of the desktop pose: `back` away from the eye, `across` screen right. */
export function teamsAxes(camera: CameraEndpoint): { back: V3; across: V3 } {
  const back = norm([camera.target[0] - camera.position[0], 0, camera.target[2] - camera.position[2]]);
  return { back, across: [-back[2], 0, back[0]] };
}

/** The landed 390 pose the rig settles at on a phone. */
export function teamsLandedPose(site: TeamsSite): CameraEndpoint {
  return landedEndpoint(site.cameraMobile);
}

/**
 * Largest lateral offset (m, from the eye's horizontal view axis) a point at
 * `depth` and height `y` may take and still project inside `fill` of `pose`'s
 * frame, on the `side` (+1 right, −1 left). Bisection on the real projection.
 */
function lateralLimit(
  eye: Vec3,
  axes: { back: V3; across: V3 },
  depth: number,
  y: number,
  pose: CameraEndpoint,
  aspect: number,
  fill: number,
  side: 1 | -1,
): number {
  const at = (lat: number): Vec3 => [
    eye[0] + axes.back[0] * depth + axes.across[0] * lat,
    y,
    eye[2] + axes.back[2] * depth + axes.across[2] * lat,
  ];
  let lo = 0;
  let hi = depth * 3;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const p = projectPoint(at(mid * side), pose, aspect);
    if (p.depth > 0 && Math.abs(p.ndcX) <= fill) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** A figure's width across the view (m): `widthM`, else the conservative plan extent. */
export function acrossM(ace: TeamsAce): number {
  return ace.widthM ?? ace.footprintM;
}

/**
 * The clearance pitch: neighbours standing in ONE row (the next standing ace
 * of the same row, `g` ranks on — colossal aces leave for the back line) keep
 * their two footprint halves + `TEAMS_PITCH_MARGIN_M` apart, and two full
 * pedestals never touch. Pitch is the front-row neighbour distance (two
 * ranks); a same-row pair `g` ranks apart stands `pitch · g / 2` apart.
 */
export function adjacencyPitch(aces: readonly TeamsAce[], isColossal: (ace: TeamsAce) => boolean, pedHalf: number): number {
  let need = pedHalf * 2 + TEAMS_PITCH_MARGIN_M;
  for (const parity of [0, 1]) {
    const row = aces.map((ace, i) => ({ ace, i })).filter(({ ace, i }) => i % 2 === parity && !isColossal(ace));
    for (let k = 1; k < row.length; k += 1) {
      const a = row[k - 1];
      const b = row[k];
      const gap = Math.max(pedHalf, acrossM(a.ace) / 2) + Math.max(pedHalf, acrossM(b.ace) / 2) + TEAMS_PITCH_MARGIN_M;
      need = Math.max(need, gap / ((b.i - a.i) / 2));
    }
  }
  return need;
}

// ── The formation ────────────────────────────────────────────────────────────

/**
 * Lay out `aces` (standings order — index 0 is rank 1) on `site`. Pure and
 * deterministic; the client components mount exactly these seats.
 */
export function teamsFormation(site: TeamsSite, aces: readonly TeamsAce[]): TeamsFormation {
  const { camera } = site;
  const eye = camera.position;
  const axes = teamsAxes(camera);
  const n = aces.length;
  const rel = sub([site.anchor.x, site.groundY, site.anchor.z], eye);
  const dFront = dot(rel, axes.back);
  const dRear = dFront + site.rowGap;
  const s0 = dot(rel, axes.across) / dFront;
  const capH = site.pedestal.capH;
  const pedHalf = site.pedestal.half;

  const isColossal = (ace: TeamsAce) => ace.heightM > TEAMS_COLOSSAL_M;
  // Colossal aces share one back line on the riser (a common depth: no giant
  // stands in front of another giant).
  const dColossal = Math.min(dRear + COLOSSAL_SETBACK_M, dFront + RISER_DEPTH_MAX_M - 0.5);
  const minPitch = adjacencyPitch(aces, isColossal, pedHalf);

  // THE SCREEN RHYTHM (wave-2 r2). Consecutive ranks stand at least Δ apart
  // on screen (tan units); two aces of ONE depth class — the front row, or
  // the back (rear pedestals + colossal back line, whose tall pedestals must
  // never stand before a giant's low plinth) — stand at least their two
  // screen halves + the clearance margin apart. Δ is the widest base rhythm
  // that fits, in priority order: the 1440 ledger (a veto — columns track the
  // aces, so its outer column edges + bezel caps must fit), the desktop
  // frame (outer footprints inside FRAME_FILL), the landed 390 frame (outer
  // centres). When even the clearance alone cannot fit the ledger, the
  // rhythm is compressed about its centre and `pitchOverflow` is reported.
  const landed = teamsLandedPose(site);
  const midY = site.groundY + capH + 0.8;
  const depthOf = (i: number) => (isColossal(aces[i]) ? dColossal : i % 2 === 0 ? dFront : dRear);
  const back = (i: number) => isColossal(aces[i]) || i % 2 === 1;
  const halfS = aces.map((ace, i) => Math.max(pedHalf, acrossM(ace) / 2) / depthOf(i));
  const marginS = aces.map((_, i) => TEAMS_PITCH_MARGIN_M / depthOf(i));
  const tanH = Math.tan((camera.fov * Math.PI) / 360) * DESKTOP_ASPECT;
  const ledgerLimit = (1 - (2 * LEDGER_SCREEN_INSET_PX) / 1440) * tanH * 0.97;
  const capS = (site.ledger.endCap + site.ledger.margin) / site.ledger.distance;
  const twoLines = n > LEDGER_TWO_LINE_OVER;
  const edgeLimit = (i: number, side: 1 | -1, pose: CameraEndpoint, aspect: number, fill: number) =>
    lateralLimit(eye, axes, depthOf(i), midY, pose, aspect, fill, side) / depthOf(i);
  const deskL = n > 0 ? edgeLimit(0, -1, camera, DESKTOP_ASPECT, FRAME_FILL) : 1;
  const deskR = n > 0 ? edgeLimit(n - 1, 1, camera, DESKTOP_ASPECT, FRAME_FILL) : 1;
  const mobL = n > 0 ? edgeLimit(0, -1, landed, MOBILE_390_ASPECT, MOBILE_FRAME_FILL) : 1;
  const mobR = n > 0 ? edgeLimit(n - 1, 1, landed, MOBILE_390_ASPECT, MOBILE_FRAME_FILL) : 1;

  /** Screen positions (tan units, centred on s0) for base rhythm `d`, compressed by `lambda`. */
  const rhythm = (d: number, lambda = 1, backShare = 1): number[] => {
    const out: number[] = [];
    const last: [number, number] = [-1, -1];
    for (let i = 0; i < n; i += 1) {
      let at = i === 0 ? 0 : out[i - 1] + d;
      const cls = back(i) ? 1 : 0;
      const k = last[cls];
      const share = k >= 0 && isColossal(aces[k]) && isColossal(aces[i]) ? backShare : 1;
      if (k >= 0) at = Math.max(at, out[k] + (halfS[k] + halfS[i] + Math.max(marginS[k], marginS[i])) * share);
      last[cls] = i;
      out.push(at);
    }
    const mid = n > 0 ? (out[0] + out[n - 1]) / 2 : 0;
    return out.map((v) => s0 + (v - mid) * lambda);
  };
  /** Outer ledger column edges for positions `s` (a column is its nearest same-line gap wide). */
  const ledgerEdges = (s: readonly number[]): [number, number] => {
    if (n < 2) return [s0 - 0.6 / site.ledger.distance, s0 + 0.6 / site.ledger.distance];
    const lines = twoLines ? [s.filter((_, i) => i % 2 === 0), s.filter((_, i) => i % 2 === 1)] : [[...s]];
    let l = Number.POSITIVE_INFINITY;
    let r = Number.NEGATIVE_INFINITY;
    for (const line of lines) {
      if (line.length < 2) continue;
      l = Math.min(l, line[0] - (line[1] - line[0]) / 2);
      r = Math.max(r, line[line.length - 1] + (line[line.length - 1] - line[line.length - 2]) / 2);
    }
    return [l, r];
  };
  const fitsLedger = (s: readonly number[]) => {
    const [l, r] = ledgerEdges(s);
    return l - capS >= -ledgerLimit && r + capS <= ledgerLimit;
  };
  const fitsDesktop = (s: readonly number[]) => s[0] - halfS[0] >= -deskL && s[n - 1] + halfS[n - 1] <= deskR;
  const fitsMobile = (s: readonly number[]) => s[0] >= -mobL && s[n - 1] <= mobR;
  /** Largest base rhythm in [0, max] whose positions pass `ok` (monotone: wider Δ, wider span). */
  const widest = (max: number, ok: (s: readonly number[]) => boolean): number => {
    if (ok(rhythm(max))) return max;
    let lo = 0;
    let hi = max;
    for (let k = 0; k < 40; k += 1) {
      const mid = (lo + hi) / 2;
      if (ok(rhythm(mid))) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  const deltaMax = site.maxPitch / 2 / dFront;
  // Floor of the base rhythm: a column wide enough for a condensed name at the
  // 14 px-cap floor (≈ 100 px at 1440; on two lines a column spans two ranks).
  const deltaFloor = ((twoLines ? 50 : 100) / 720) * tanH;
  let delta = deltaMax;
  let lambda = 1;
  let backShare = 1;
  let pitchOverflow = false;
  if (n > 1) {
    delta = widest(deltaMax, (s) => fitsLedger(s) && fitsDesktop(s) && fitsMobile(s));
    if (delta < deltaFloor) {
      // The 390 frame gives way first (the phone reads names from the DOM rail).
      pitchOverflow = true;
      delta = Math.max(deltaFloor, widest(deltaMax, (s) => fitsLedger(s) && fitsDesktop(s)));
      if (!fitsLedger(rhythm(delta))) {
        // Even the clearance cannot fit the 1440 ledger (the veto wins). Two
        // neighbouring giants give first — side by side on one back line they
        // only interleave spread limbs — then the whole rhythm compresses.
        const bisect = (ok: (x: number) => boolean): number => {
          let lo = 0;
          let hi = 1;
          for (let k = 0; k < 40; k += 1) {
            const mid = (lo + hi) / 2;
            if (ok(mid)) lo = mid;
            else hi = mid;
          }
          return lo;
        };
        if (fitsLedger(rhythm(delta, 1, 0))) backShare = bisect((x) => fitsLedger(rhythm(delta, 1, x)));
        else {
          backShare = 0;
          lambda = bisect((x) => fitsLedger(rhythm(delta, x, 0)));
        }
      }
    }
  }
  const positions = rhythm(delta, lambda, backShare);
  const pitch = 2 * delta * dFront;

  const screenS = (i: number) => positions[i];
  const toWorld = (depth: number, lateral: number, y: number): V3 => [
    eye[0] + axes.back[0] * depth + axes.across[0] * lateral,
    y,
    eye[2] + axes.back[2] * depth + axes.across[2] * lateral,
  ];
  const yawToEye = (p: Vec3) => Math.atan2(eye[0] - p[0], eye[2] - p[2]);

  // Ray-height law: each rear ace — and each colossal on its back line —
  // clears the heads of the standing front aces its screen span overlaps
  // (colossal fronts stand on the back line — never in front).
  let riserNeed = RISER_MIN_M;
  for (let i = 0; i < n; i += 1) {
    const ace = aces[i];
    const colossal = isColossal(ace);
    if (!colossal && i % 2 === 0) continue;
    const depth = colossal ? dColossal : dRear;
    const sr = screenS(i);
    const halfR = acrossM(ace) / 2 / depth;
    let line = Number.NEGATIVE_INFINITY;
    for (let j = 0; j < n; j += 2) {
      const front = aces[j];
      if (j === i || isColossal(front)) continue;
      const sf = screenS(j);
      const halfF = acrossM(front) / 2 / dFront;
      if (Math.abs(sf - sr) >= halfF + halfR) continue;
      const top = site.groundY + capH + (front.liftM ?? 0) + front.heightM;
      line = Math.max(line, eye[1] + (top - eye[1]) * (depth / dFront));
    }
    if (!Number.isFinite(line)) continue;
    const stand = line - (1 - REAR_CLEAR_SOLVE) * ace.heightM + 0.03;
    const underFeet = colossal ? TEAMS_COLOSSAL_PLINTH_M : capH + (ace.liftM ?? 0);
    riserNeed = Math.max(riserNeed, stand - site.groundY - underFeet);
  }
  const riserCapped = riserNeed > RISER_MAX_M;
  const riserH = Math.min(RISER_MAX_M, round(riserNeed, 0.05));

  // The desktop screen target of each rank (NDC x), and the lateral that puts
  // a point at `depth` / height `y` exactly there on the REAL (pitched)
  // projection — so the rhythm is even on screen, riser and all.
  const ndcTarget = (i: number) => screenS(i) / tanH;
  const lateralFor = (depth: number, y: number, ndc: number): number => {
    let lo = -depth * 3;
    let hi = depth * 3;
    for (let k = 0; k < 48; k += 1) {
      const mid = (lo + hi) / 2;
      if (projectPoint(toWorld(depth, mid, y), camera, DESKTOP_ASPECT).ndcX < ndc) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const slots: TeamsSlot[] = aces.map((ace, i) => {
    const row: TeamsRow = i % 2 === 0 ? 'front' : 'rear';
    const colossal = isColossal(ace);
    // A colossal stands on the common back line on its low plinth; a standing
    // ace on its row's full pedestal (+ lift). Both are aligned at mid-body.
    const depth = colossal ? dColossal : row === 'front' ? dFront : dRear;
    const surface = site.groundY + (colossal || row === 'rear' ? riserH : 0);
    const s = screenS(i);
    const pedestalH = colossal ? TEAMS_COLOSSAL_PLINTH_M : capH;
    const lift = colossal ? 0 : (ace.liftM ?? 0);
    const alignY = surface + pedestalH + lift + ace.heightM / 2;
    const pedestal = toWorld(depth, lateralFor(depth, alignY, ndcTarget(i)), surface);
    const figure: V3 = [pedestal[0], surface + pedestalH + lift, pedestal[2]];
    return {
      id: ace.id,
      rank: i + 1,
      index: i,
      row,
      colossal,
      pedestal,
      pedestalH,
      figure,
      yaw: yawToEye(pedestal),
      screenS: s,
      screenX: ndcTarget(i),
      heightM: ace.heightM,
      footprintM: ace.footprintM,
    };
  });

  // Riser extent in the formation frame (x past the front line, z lateral).
  const originLat = s0 * dFront;
  const rearLats: number[] = [];
  let x1 = site.rowGap + pedHalf + 0.45;
  for (const slot of slots) {
    const lat = dot(sub(slot.pedestal, eye), axes.across) - originLat;
    if (slot.row === 'rear') rearLats.push(lat - pedHalf - 0.35, lat + pedHalf + 0.35);
    if (slot.colossal) {
      const fr = sub(slot.figure, eye);
      const fx = dot(fr, axes.back) - dFront;
      const fl = dot(fr, axes.across) - originLat;
      x1 = Math.max(x1, Math.min(RISER_DEPTH_MAX_M, fx + slot.footprintM / 2 + 0.1));
      rearLats.push(fl - slot.footprintM / 2 - 0.1, fl + slot.footprintM / 2 + 0.1);
    }
  }
  const riser: RiserLayout = {
    height: riserH,
    x0: site.rowGap - pedHalf - 0.3,
    x1,
    z0: rearLats.length ? Math.min(...rearLats) : -1,
    z1: rearLats.length ? Math.max(...rearLats) : 1,
  };

  const origin = toWorld(dFront, originLat, site.groundY);
  const frameYaw = Math.atan2(-axes.back[2], axes.back[0]);

  return {
    site,
    slots,
    pitch,
    minPitch,
    riser,
    riserCapped,
    pitchOverflow,
    frame: { origin, yaw: frameYaw, back: axes.back, across: axes.across },
    ledger: ledgerLayout(site, slots, n),
  };
}

// ── The ledger rail ──────────────────────────────────────────────────────────

/** Per-line face layout (m): chevron + chip row, name, species · height. */
export const LEDGER_LINE = {
  padTop: 0.025,
  /**
   * Wave-2 r2 (TEAMS judge): the rank chip grew from 0.075 m (an 8–10 px
   * rank at 1440) to a full-row chip whose rank carries a ≥ 14 px cap on
   * every site and line count (`ledgerChipFontM`), so the rank and the name
   * read as one unit. The name / sub rows and pads gave the room back: the
   * line height is unchanged (0.455 m), so the rail keeps its seat.
   */
  chipRow: 0.13,
  nameFont: 0.125,
  /** Room for one name line at 0.125 m, or two wrapped lines at the ≈ 0.086 m floor. */
  nameRow: 0.18,
  subFont: 0.088,
  subRow: 0.1,
  padBottom: 0.02,
} as const;

export const LEDGER_LINE_H =
  LEDGER_LINE.padTop + LEDGER_LINE.chipRow + LEDGER_LINE.nameRow + LEDGER_LINE.subRow + LEDGER_LINE.padBottom;

/** Face height for one or two lines (a hairline rule between two). */
/**
 * Two-line rails set each line at 0.8 of the one-line metrics (the name
 * still ≥ the 14 px-cap floor at every site — unit-tested), so a 12-trainer
 * rail fits between the front aces' feet and the HUD band.
 */
export const LEDGER_TWO_LINE_SCALE = 0.8;

export function ledgerLineScale(lines: 1 | 2): number {
  return lines === 1 ? 1 : LEDGER_TWO_LINE_SCALE;
}

export function ledgerFaceHeight(lines: 1 | 2): number {
  return lines === 1 ? LEDGER_LINE_H : LEDGER_LINE_H * LEDGER_TWO_LINE_SCALE * 2 + 0.02;
}

/**
 * Solve the face centre height so the top edge lands `gapNdc` under the
 * front pedestals' feet on the desktop frame (bisection; the face leans back
 * to look at the eye, so the top edge moves back and up with the centre).
 */
function ledgerCentreY(
  site: TeamsSite,
  axes: { back: V3; across: V3 },
  lateral: number,
  height: number,
): number {
  const { camera } = site;
  const eye = camera.position;
  const dFront = dot(sub([site.anchor.x, site.groundY, site.anchor.z], eye), axes.back);
  const footLat = (dot(sub([site.anchor.x, site.groundY, site.anchor.z], eye), axes.across) / dFront) * dFront;
  const foot: Vec3 = [
    eye[0] + axes.back[0] * dFront + axes.across[0] * footLat,
    site.groundY,
    eye[2] + axes.back[2] * dFront + axes.across[2] * footLat,
  ];
  const topTarget = projectPoint(foot, camera, DESKTOP_ASPECT).ndcY - site.ledger.gapNdc;
  const d = site.ledger.distance;
  const edgeNdc = (cy: number, sign: 1 | -1) => {
    const tilt = Math.atan2(eye[1] - cy, d);
    const up = sign * (height / 2 + site.ledger.margin) * Math.cos(tilt);
    const back = sign * (height / 2 + site.ledger.margin) * Math.sin(tilt);
    const p: Vec3 = [
      eye[0] + axes.back[0] * (d + back) + axes.across[0] * lateral,
      cy + up,
      eye[2] + axes.back[2] * (d + back) + axes.across[2] * lateral,
    ];
    return projectPoint(p, camera, DESKTOP_ASPECT).ndcY;
  };
  const solve = (sign: 1 | -1, target: number) => {
    let lo = site.groundY + height / 2 + site.ledger.margin;
    let hi = eye[1] - 0.05;
    for (let i = 0; i < 48; i += 1) {
      const mid = (lo + hi) / 2;
      if (edgeNdc(mid, sign) < target) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // Top edge just under the pedestals' feet — unless that drops the bottom
  // edge into the HUD band, in which case the rail rises over the (dataless)
  // front pedestal bases instead: the bottom edge never goes below the band.
  return Math.max(solve(1, topTarget), solve(-1, LEDGER_BOTTOM_NDC));
}

/** Lowest NDC y the ledger's bottom edge may reach at 1440 (above the 56 px HUD band + 16 px). */
export const LEDGER_BOTTOM_NDC = -1 + (2 * (56 + 16)) / 900;

function ledgerLayout(site: TeamsSite, slots: readonly TeamsSlot[], n: number): LedgerLayout {
  const { camera } = site;
  const eye = camera.position;
  const axes = teamsAxes(camera);
  const lines: 1 | 2 = n > LEDGER_TWO_LINE_OVER ? 2 : 1;
  const height = ledgerFaceHeight(lines);
  const lineScale = ledgerLineScale(lines);
  const lineH = LEDGER_LINE_H * lineScale;
  const d = site.ledger.distance;

  // Provisional plane at the view axis (lateral centred later): tilt from
  // the solved centre height; the columns come from ray intersections.
  const s0 = dot(sub([site.anchor.x, site.groundY, site.anchor.z], eye), axes.across) /
    dot(sub([site.anchor.x, site.groundY, site.anchor.z], eye), axes.back);
  const lateral0 = s0 * d;
  const cy = ledgerCentreY(site, axes, lateral0, height);
  const tilt = Math.atan2(eye[1] - cy, d);
  const normal = norm([-axes.back[0] * Math.cos(tilt), Math.sin(tilt), -axes.back[2] * Math.cos(tilt)]);
  const right = norm(cross([0, 1, 0], normal));
  const up = cross(normal, right);
  const centre0: V3 = [eye[0] + axes.back[0] * d + axes.across[0] * lateral0, cy, eye[2] + axes.back[2] * d + axes.across[2] * lateral0];

  // Column centres: the point on the column's painted line whose desktop
  // projection lands on its ace's screen x (the slot's solved `screenX`) —
  // so a column sits exactly under its statue on screen, whatever the riser.
  const lineOffset = (line: 0 | 1): number =>
    lines === 1 ? 0 : line === 0 ? (lineH + 0.01) / 2 : -(lineH + 0.01) / 2;
  const acrossOf = (slot: TeamsSlot, line: 0 | 1): number => {
    const v = lineOffset(line);
    let lo = -12;
    let hi = 12;
    for (let k = 0; k < 48; k += 1) {
      const u = (lo + hi) / 2;
      const p: Vec3 = [
        centre0[0] + right[0] * u + up[0] * v,
        centre0[1] + right[1] * u + up[1] * v,
        centre0[2] + right[2] * u + up[2] * v,
      ];
      if (projectPoint(p, camera, DESKTOP_ASPECT).ndcX < slot.screenX) lo = u;
      else hi = u;
    }
    return (lo + hi) / 2;
  };
  const raw = slots.map((slot) => {
    const line = (lines === 2 && slot.row === 'rear' ? 1 : 0) as 0 | 1;
    return { slot, line, across: acrossOf(slot, line) };
  });
  // Wave-2 r2: the columns TILE their line. Each column's cell runs from the
  // midpoint with its left neighbour to the midpoint with its right one (an
  // outer cell mirrors its inner half-gap), so an uneven rhythm — giants
  // need room on the back line — never leaves dead face between columns nor
  // squeezes a name into the smaller of its two gaps. The chip and chevron
  // stay on the ace's own x (`across`); the text centres in the cell.
  const cellOf = (i: number): { left: number; right: number } => {
    const mine = raw[i];
    const peers = raw.filter((c) => c.line === mine.line).map((c) => c.across).sort((a, b) => a - b);
    const k = peers.indexOf(mine.across);
    if (peers.length < 2) return { left: mine.across - 0.6, right: mine.across + 0.6 };
    const leftGap = k > 0 ? peers[k] - peers[k - 1] : peers[k + 1] - peers[k];
    const rightGap = k < peers.length - 1 ? peers[k + 1] - peers[k] : peers[k] - peers[k - 1];
    return { left: mine.across - leftGap / 2, right: mine.across + rightGap / 2 };
  };
  const provisional = raw.map((c, i) => ({ ...c, ...cellOf(i) }));
  const lo = Math.min(...provisional.map((c) => c.left), -0.6);
  const hi = Math.max(...provisional.map((c) => c.right), 0.6);
  const shift = (lo + hi) / 2;
  const width = hi - lo + site.ledger.endCap * 2;

  const center: V3 = [centre0[0] + right[0] * shift, centre0[1], centre0[2] + right[2] * shift];
  const columns: LedgerColumn[] = provisional.map((c) => ({
    id: c.slot.id,
    rank: c.slot.rank,
    index: c.slot.index,
    line: c.line,
    across: c.across - shift,
    cellAcross: (c.left + c.right) / 2 - shift,
    width: c.right - c.left,
  }));
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const dist = Math.hypot(center[0] - eye[0], center[1] - eye[1], center[2] - eye[2]);
  const pxPerM1440 = 900 / 2 / (tanV * dist);
  // The face plane runs down to the ground: the slab's front-bottom line.
  const toGround = (site.groundY - center[1]) / up[1];
  const base: V3 = [center[0] + up[0] * toGround, site.groundY, center[2] + up[2] * toGround];

  return {
    center,
    normal,
    right,
    up,
    tilt,
    yaw: Math.atan2(-axes.back[0], -axes.back[2]),
    width,
    height,
    lines,
    lineH,
    lineScale,
    columns,
    base,
    thickness: site.ledger.thickness,
    margin: site.ledger.margin,
    endCap: site.ledger.endCap,
    canvas: {
      width: Math.min(4096, Math.ceil((width * LEDGER_TEXELS_PER_M) / 4) * 4),
      height: Math.ceil((height * LEDGER_TEXELS_PER_M) / 4) * 4,
    },
    pxPerM1440,
  };
}

/** Rendered cap height (px at 1440) of a font `fontM` metres tall on the ledger face. */
export function ledgerCapPx(ledger: LedgerLayout, fontM: number): number {
  return fontM * CAP_EM * ledger.pxPerM1440;
}

/** Smallest font (m) whose cap reaches `LEDGER_CAP_MIN_PX` at 1440 — the painter's floor. */
export function ledgerFontFloorM(ledger: LedgerLayout): number {
  return LEDGER_CAP_MIN_PX / (CAP_EM * ledger.pxPerM1440);
}

/** Share of the chip row the chip is tall, and the chip font as a share of the chip. */
export const LEDGER_CHIP_FILL = 1;
export const LEDGER_CHIP_FONT = 0.78;

/**
 * The rank chip's font (m): its row's natural size, never under the 14 px-cap
 * floor (the chip is `1 / LEDGER_CHIP_FONT` of its font tall — the unit test
 * pins that it still fits its row plus the top pad on every site).
 */
export function ledgerChipFontM(ledger: LedgerLayout): number {
  return Math.max(LEDGER_LINE.chipRow * ledger.lineScale * LEDGER_CHIP_FILL * LEDGER_CHIP_FONT, ledgerFontFloorM(ledger));
}

/**
 * The ledger as a `DataFace` for the keep-out law: the face of a full
 * formation at the site's widest composition (bezel margin included) —
 * conservative, because the real rail is never wider (its screen span is
 * capped by the 1440 fit, which the nominal oversized roster reaches). The
 * two-line height is used so an N > 10 rail stays covered too.
 */
export function teamsLedgerFace(site: TeamsSite, id = 'teams:ledger'): DataFace {
  // Wave-2 r2: the rail's screen span is bounded by the 1440 fit
  // (`LEDGER_SCREEN_INSET_PX`), so a roster wide enough to reach that bound
  // — 2.4 m footprints overflow the frame and compress to it — gives the
  // widest rail any roster can paint, on one line (N = 10) and on two (N = 12).
  const nominal: TeamsAce[] = Array.from({ length: 12 }, (_, i) => ({
    id: `nominal-${i}`,
    heightM: 1.0,
    footprintM: 2.4,
  }));
  const wide = teamsFormation(site, nominal.slice(0, 10)).ledger;
  const tall = teamsFormation(site, nominal).ledger;
  const face = tall.height > wide.height ? tall : wide;
  return {
    id,
    station: 'teams',
    kind: 'ledger',
    center: face.center,
    normal: face.normal,
    size: {
      w: Math.max(wide.width, tall.width) + face.margin * 2,
      h: Math.max(wide.height, tall.height) + face.margin * 2,
    },
  };
}

// ── Sites ────────────────────────────────────────────────────────────────────

/** A site without its cameras — what a world's layout teams block declares. */
export type TeamsSitePlan = Omit<TeamsSite, 'id' | 'camera' | 'cameraMobile'>;

/** Bind a world's teams plan to its frozen #teams endpoints. */
export function makeTeamsSite(
  id: string,
  stations: readonly { id: string; camera: CameraEndpoint; cameraMobile: CameraEndpoint }[],
  plan: TeamsSitePlan,
): TeamsSite {
  const teams = stations.find((s) => s.id === 'teams');
  if (!teams) throw new Error(`teams-formation: world ${id} has no teams station`);
  return { id, camera: teams.camera, cameraMobile: teams.cameraMobile, ...plan };
}

/** The ledger rail every world shares (only the distance may differ per site). */
export const LEDGER_RAIL = { distance: 4.7, gapNdc: 0.035, thickness: 0.16, margin: 0.05, endCap: 0.3 } as const;

/**
 * PlazaHall.tsx `STATUE_ROW_RESEAT_Z` (C-051), restated: StatueRow renders
 * inside that re-seat group, so it cancels the offset to lay the formation
 * out in world coordinates.
 */
export const PLAZA_ROW_RESEAT_Z = 1.35;

/**
 * The plaza's teams plan: the east statue forecourt (FURNITURE.statues,
 * x 13.5). The front plinth line stands at x 13.3, centred on the #teams
 * view axis (z 0). Plinth: since wave-2 r2 the plain stone plinth StatueRow
 * builds (Plinth.tsx's courses without the plate; the Meshy `statue-plinth`
 * GLB carried a baked black plaque the judge read as a missing label), cap
 * PLINTH_H 1.03 m, footing half 0.54. The ledger stands at x ≈ 9.3 (4.1 m from the
 * eye): in FRONT of the C-047 walker pockets (x 10.4–10.9, walkers sampled
 * as 0.6 m spheres) plus the keep-out pad, so no walker lane is inside its
 * wedge, and the east lamp seats (`PLAZA_TEAMS_LAMPS`, 12.2, ±5.2) stand
 * behind its face plane, outside every ace column.
 */
export const PLAZA_TEAMS_PLAN: TeamsSitePlan = {
  anchor: { x: 13.3, z: 0 },
  groundY: 0,
  pedestal: { capH: 1.03, half: 0.54 },
  rowGap: 1.6,
  maxPitch: 2.4,
  ledger: { ...LEDGER_RAIL, distance: 4.1 },
};

/**
 * The plaza's east street-lamp pair, re-seated by the teams keep-out law
 * (wave-2 r2 TEAMS judge: the C-041 seats (12.2, ±2.6) stood in front of
 * ranks 2 and 7 and filled the `?team=` focus shots). These seats stand
 * outside every ace column and the ledger at 1440 / 768 / 390 and outside
 * every `?team=` focus shot — `teams-formation.test.ts` judges them.
 */
export const PLAZA_TEAMS_LAMPS: readonly (readonly [number, number])[] = [
  [12.2, -5.2],
  [12.2, 5.2],
];

/**
 * Every plaza street-lamp seat (world x, z) — the ONE source of truth
 * (wave-2 r3 TEAMS judge: PlazaHall.tsx kept its own list at the retired
 * C-041 east seats (12.2, ±2.6) while the keep-out test judged
 * `PLAZA_TEAMS_LAMPS`, so the renderer never moved). PlazaHall.tsx
 * `StreetLamps` mounts exactly these seats and the plaza data faces box
 * exactly these; the four boulevard / gate seats are the C-041 baseline,
 * the east pair is `PLAZA_TEAMS_LAMPS`.
 */
export const PLAZA_LAMP_SEATS: readonly (readonly [number, number])[] = [
  [-10.6, -13.4],
  [10.6, -13.4],
  [-7.6, 12.6],
  [7.6, 12.6],
  ...PLAZA_TEAMS_LAMPS,
];

// ── The plaza crest wall behind the rows (LOOK r6, C2) ──────────────────────

/**
 * The crest slide's raster (LedScreen `CREST_TEX_W × CREST_TEX_H`: the
 * painter reads these, so the layout law and the pixels share one number).
 */
export const CREST_RASTER = { w: 1024, h: 640 } as const;

/**
 * The crest slide's TOP BANNER (raster px, y down): the kicker
 * ("TRAINER 1/8 · PLATZ 1") and the trainer's name live inside
 * `[left, right] × [top, bottom]`, and nothing else is painted there.
 *
 * LOOK r5 CLARITY residual: the wall is a lit screen BEHIND the rows, and the
 * old layout set the kicker / name / ace line at raster y 212–384 — exactly
 * where the rear-rank crowns stand on screen (the rank-8 plinth cut the name
 * to 'MARA FE…KAMP'). The banner is the band the frozen #teams poses leave
 * clear above the crowns (`teams-crest-banner.test.ts` projects it):
 *  - `bottom` 76 (0.12 h): at 1440 the banner ends ≈ 8 px above the r5
 *    league's highest crown in its span (the back-line colossal at rank 6,
 *    measured rect top 137.5 px); at 390 the crowns start ≈ 20 px lower
 *    still;
 *  - `left` 216: at 1440 the Station Card's top strip (the only card slot
 *    clear of the ace keep-outs at #teams, x ≤ 864) ends before it;
 *  - `right` 720: the landed 390 frame cuts the wall at raster x ≈ 747, so
 *    the name ends inside the phone frame too.
 *
 * The wall's world seat (the east block's LED, HaussmannBlock `PictorialLed`)
 * is projected in the test, not here: this module stays free of the plaza
 * façade code, which every other world's formation would otherwise ship.
 *
 * Honest limit: a roster with a tall rear ace standing in front of the wall
 * can still reach the band — no layout of a wall BEHIND the rows can outrank
 * every stature. The wall is chrome (40 % emission); the ledger and the DOM
 * rail carry the same names as data.
 */
export const CREST_BANNER = { left: 216, right: 720, top: 8, bottom: 76 } as const;

/**
 * `n` nominal aces alternating front / rear statures (rank 1 front) — for
 * the analytic audits (the live roster is data) and the clouds floats, whose
 * riders are cast later inside per-rank stature caps.
 */
export function alternatingAces(
  n: number,
  front: { heightM: number; footprintM: number },
  rear: { heightM: number; footprintM: number } = front,
  prefix = 'nominal',
): TeamsAce[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, ...(i % 2 === 0 ? front : rear) }));
}
