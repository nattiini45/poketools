/**
 * The plaza's storytelling ground (LOOK-PLAN §2 SEAT A.4, consumed by SEAT S)
 * — ONE pure source for the baked story mask
 * (`scripts/world-assets/bake-plaza-mask.mts`) and the ground shader
 * (`paint-ground.ts`): the plane and its mask texel mapping, the Poké Ball
 * compass medallion, the desire-line (lane) anchors, the lamp and furniture
 * seats contact grime gathers at, and the DRY-BAND solver that keeps night
 * puddles out from under every data face's footer.
 *
 * Mask channels (512² RGBA WebP, lossless, one copy over the whole plane):
 *   R  wear lanes   — medallion ring, spokes to the five forecourts, perimeter promenade
 *   G  contact grime — façade line, planters, gate piers, gantry flanges, desk, terrace, lamp feet, kerb gutter
 *   B  puddles      — FORCED 0 inside every keep-out wedge and inside the dry band
 *   A  macro noise  — the anti-tiling index and low-frequency value drift
 *
 * The keep-out law is `data-surfaces.ts`; nothing here widens or loosens it.
 * Data faces are never painted by the ground: the ground is a separate mesh
 * and the mask only ever affects the ground's own pixels.
 *
 * Pure data + math (no client-only imports). The plaza's data faces live in
 * a client-tree module, so the solver takes the `DataSurfaceTheme` as a
 * parameter (the bake and the tests pass `PLAZA_DATA_SURFACES`).
 */

import {
  cameraBasis,
  faceKeepOutPoses,
  faceRectAt,
  KEEP_OUT_PAD,
  themeWedges,
  wedgeHitsSphere,
  type DataFace,
  type DataSurfaceTheme,
  type KeepOutPose,
  type KeepOutWedge,
} from './data-surfaces';
import { FURNITURE, GATE, JUMBOTRON, PLAZA } from './layout';
import { PLAZA_LAMP_SEATS } from './teams-formation';

// ── Plane and mask mapping ───────────────────────────────────────────────────

/**
 * The ground plane: PlazaHall's `COBBLE_PLANE` (PLAZA.half · 2 + 6 = 42 m),
 * centred on the origin, lying at y 0.01.
 */
export const PLAZA_GROUND_PLANE = {
  size: PLAZA.half * 2 + 6,
  y: 0.01,
} as const;

/** Story-mask raster (`env/plaza/mask.webp`). */
export const PLAZA_MASK = {
  size: 512,
  /** Metres per mask texel. */
  texelM: PLAZA_GROUND_PLANE.size / 512,
} as const;

/**
 * World (x, z) → mask UV in three's texture convention (flipY true, v = 1 at
 * the image's TOP row). The plane is rotated −π/2 about X, so +u runs east
 * (+x) and +v runs NORTH (−z): u = (x + 21) / 42, v = (21 − z) / 42. The
 * shader can use the plane's own `uv` (identical) or this from world position.
 */
export function worldToMaskUv(x: number, z: number): [number, number] {
  const half = PLAZA_GROUND_PLANE.size / 2;
  return [(x + half) / PLAZA_GROUND_PLANE.size, (half - z) / PLAZA_GROUND_PLANE.size];
}

/** Mask image texel (column, row; row 0 = top = north edge) → world (x, z) of its centre. */
export function maskTexelToWorld(col: number, row: number): [number, number] {
  const half = PLAZA_GROUND_PLANE.size / 2;
  return [-half + (col + 0.5) * PLAZA_MASK.texelM, -half + (row + 0.5) * PLAZA_MASK.texelM];
}

/** World (x, z) → mask image texel (column, row), or null off the plane. */
export function worldToMaskTexel(x: number, z: number): [number, number] | null {
  const half = PLAZA_GROUND_PLANE.size / 2;
  const col = Math.floor((x + half) / PLAZA_MASK.texelM);
  const row = Math.floor((z + half) / PLAZA_MASK.texelM);
  if (col < 0 || row < 0 || col >= PLAZA_MASK.size || row >= PLAZA_MASK.size) return null;
  return [col, row];
}

// ── Medallion ────────────────────────────────────────────────────────────────

/**
 * The Poké Ball compass medallion (analytic SDF in the ground shader, P2
 * geometry). No text, no numerals. ΔL ≤ 15 against the surrounding setts
 * (clarity veto: it must read as inlaid stone, never as a sign).
 */
export const MEDALLION = {
  center: [0, 0] as const,
  /** Outer radius of the inlay (m). */
  radius: 2.9,
  /** Outer ring band width (m) — the ball's rim. */
  ringWidth: 0.22,
  /** Equator band half-width (m) and the centre button radii (m). */
  bandHalf: 0.14,
  buttonOuter: 0.62,
  buttonInner: 0.38,
  /** Compass ticks: one per station forecourt, just outside the rim. */
  tickLength: 0.55,
  tickWidth: 0.12,
  /** Maximum lightness difference (CIE L*) of any medallion stone vs the setts. */
  maxDeltaL: 15,
  /** fwidth anti-aliasing width, in shader derivative units. */
  aaPixels: 1.25,
} as const;

// ── Lanes (desire lines) ─────────────────────────────────────────────────────

export interface LaneAnchor {
  /** Station id whose forecourt the lane leads to. */
  station: string;
  /** Forecourt centre on the ground (x, z). */
  at: readonly [number, number];
  /** Lateral bow of the desire line at its midpoint (m, + = to the lane's left). */
  bow: number;
}

/**
 * Forecourts the spokes run to, from the medallion rim: the ground in front
 * of each station's furniture (layout.ts anchors), set back from the data
 * face so a lane fades before it reaches a footer.
 */
export const LANE_ANCHORS: readonly LaneAnchor[] = [
  { station: 'pulse', at: [FURNITURE.pulseBoard.x, FURNITURE.pulseBoard.z + 5.2], bow: 0.9 },
  { station: 'roster', at: [FURNITURE.desk.x + 4.2, FURNITURE.desk.z], bow: -0.7 },
  { station: 'teams', at: [FURNITURE.statues.x - 5.4, FURNITURE.statues.z], bow: 0.6 },
  { station: 'schedule', at: [FURNITURE.scheduleBoard.x, FURNITURE.scheduleBoard.z + 5.2], bow: -0.9 },
  { station: 'rules', at: [FURNITURE.gate.x, FURNITURE.gate.z - 4.6], bow: 0.5 },
];

/** Lane profile (m): full wear inside `core`, fading to 0 at `core + falloff`. */
export const LANE_PROFILE = { core: 0.45, falloff: 0.7, strength: 0.85 } as const;

/** The perimeter promenade: a rounded-square ring of wear this far from the centre, this wide. */
export const PROMENADE = { offset: 15.4, halfWidth: 0.8, cornerRadius: 3, strength: 0.55 } as const;

// ── Seats (contact grime) ────────────────────────────────────────────────────

/** Street-lamp seats — the renderer's own list, re-exported (no restated literals). */
export const LAMP_SEATS = PLAZA_LAMP_SEATS;

export interface GroundBox {
  id: string;
  /** Centre (x, z) and half-extents (x, z) on the ground. */
  center: readonly [number, number];
  half: readonly [number, number];
}

/** Gate piers: GATE.width wide overall, doorway GATE.doorW, GATE.depth deep. */
const PIER_HALF_X = (GATE.width - GATE.doorW) / 4;
const PIER_CENTER_X = (GATE.doorW / 2 + GATE.width / 2) / 2;

/**
 * Furniture footprints grime gathers at (restated from the owning components,
 * named): PlazaHall Planters (2.34 × 1.24 rim at (±6, 8), (±9, 14)); the gate
 * piers; the BoardGantry pylon flanges (x −9.2 / 0 / 9.2 at pulse z − 1.7);
 * the CenterDesk shopfront (desk anchor, BAY_HALF 2.76 along z, 1.65 m deep);
 * the teams terrace (the statue forecourt, x 12.7–16.5, z ±4).
 */
export const GRIME_BOXES: readonly GroundBox[] = [
  ...([
    [-6, 8],
    [6, 8],
    [-9, 14],
    [9, 14],
  ] as const).map(([x, z]) => ({ id: `planter:${x},${z}`, center: [x, z] as const, half: [1.17, 0.62] as const })),
  ...([-1, 1] as const).map((side) => ({
    id: `pier:${side}`,
    center: [FURNITURE.gate.x + side * PIER_CENTER_X, FURNITURE.gate.z] as const,
    half: [PIER_HALF_X, GATE.depth / 2] as const,
  })),
  ...([-9.2, 0, 9.2] as const).map((x) => ({
    id: `gantry:${x}`,
    center: [x, FURNITURE.pulseBoard.z - 1.7] as const,
    half: [0.45, 0.45] as const,
  })),
  { id: 'desk', center: [FURNITURE.desk.x - 0.8, FURNITURE.desk.z], half: [0.85, 2.76] },
  { id: 'terrace', center: [14.6, 0], half: [1.9, 4] },
];

/** Grime profile: the façade line (|x| or |z| = PLAZA.half), the kerb gutter, feet. */
export const GRIME_PROFILE = {
  facadeReach: 0.9,
  kerb: { offset: 17.2, halfWidth: 0.25, strength: 0.55 },
  boxReach: 0.55,
  lampReach: 0.4,
  strength: 0.8,
} as const;

// ── Dry band ─────────────────────────────────────────────────────────────────

/** The footer band below each face that must stay free of reflections (share of viewport height). */
export const DRY_BAND_VIEWPORT = 0.18;
/** data-surfaces.ts RIG_NEAR_M (CameraRig near plane), restated: nearer ground is not rendered. */
const RIG_NEAR_M = 0.5;
/** Ground kept dry around the board walls (m) and in front of the gate threshold (m). */
export const DRY_BOARD_WALL_M = 1.2;
export const DRY_GATE_THRESHOLD_M = 1.5;

/** One dry zone: a screen rect (CSS px, origin top-left) seen from one pose. */
export interface DryScreenZone {
  faceId: string;
  poseId: string;
  pose: KeepOutPose;
  rect: { x0: number; y0: number; x1: number; y1: number };
}

/** The poses a footer is READ from: every landed station pose (1440, 768, 390) and each face's focus poses. */
export function dryBandPoses(theme: DataSurfaceTheme, face: DataFace): KeepOutPose[] {
  return faceKeepOutPoses(theme, face).filter((pose) => pose.kind !== 'dolly');
}

/**
 * The footer band of one face at one pose: the face's padded screen rect
 * (KEEP_OUT_PAD metres, then its viewport share) extended down to
 * `DRY_BAND_VIEWPORT` of the viewport height below the face's bottom edge,
 * clipped to the frame. Null when the face is off screen at this pose.
 */
export function footerBandRect(face: DataFace, pose: KeepOutPose): DryScreenZone['rect'] | null {
  const projected = faceRectAt(face, pose.camera, pose.viewport, KEEP_OUT_PAD.metres);
  if (!projected.rect || !projected.fullRect) return null;
  const { width, height } = pose.viewport;
  const r = projected.fullRect;
  const px = KEEP_OUT_PAD.viewport * width;
  const py = KEEP_OUT_PAD.viewport * height;
  const x0 = Math.max(0, r.x - px);
  const x1 = Math.min(width, r.x + r.w + px);
  const y0 = Math.max(0, r.y - py);
  const y1 = Math.min(height, r.y + r.h + py + DRY_BAND_VIEWPORT * height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/** Every dry screen zone of a world (face × reading pose). */
export function dryScreenZones(theme: DataSurfaceTheme): DryScreenZone[] {
  const out: DryScreenZone[] = [];
  for (const face of theme.faces) {
    for (const pose of dryBandPoses(theme, face)) {
      const rect = footerBandRect(face, pose);
      if (rect) out.push({ faceId: face.id, poseId: pose.id, pose, rect });
    }
  }
  return out;
}

/**
 * Ground boxes kept dry regardless of pose: `DRY_BOARD_WALL_M` around each
 * board's wall footprint (board face to the north façade) and
 * `DRY_GATE_THRESHOLD_M` in front of the gate.
 */
export function dryGroundBoxes(): GroundBox[] {
  const boardHalfW = JUMBOTRON.width / 2 + JUMBOTRON.bezel;
  const boards = [FURNITURE.pulseBoard, FURNITURE.scheduleBoard].map((b, i) => {
    const zFront = b.z + DRY_BOARD_WALL_M;
    const zBack = -PLAZA.half;
    return {
      id: `board-wall:${i === 0 ? 'pulse' : 'schedule'}`,
      center: [b.x, (zFront + zBack) / 2] as const,
      half: [boardHalfW + DRY_BOARD_WALL_M, (zFront - zBack) / 2] as const,
    };
  });
  const gateFront = FURNITURE.gate.z - GATE.depth / 2 - DRY_GATE_THRESHOLD_M;
  const gate: GroundBox = {
    id: 'gate-threshold',
    center: [FURNITURE.gate.x, (gateFront + PLAZA.half) / 2],
    half: [GATE.width / 2 + DRY_GATE_THRESHOLD_M, (PLAZA.half - gateFront) / 2],
  };
  return [...boards, gate];
}

function inBox(box: GroundBox, x: number, z: number, grow = 0): boolean {
  return Math.abs(x - box.center[0]) <= box.half[0] + grow && Math.abs(z - box.center[1]) <= box.half[1] + grow;
}

/** The compiled dry-band solver: zones + boxes + wedges, queried per ground point. */
export interface DryBand {
  zones: readonly DryScreenZone[];
  boxes: readonly GroundBox[];
  wedges: readonly KeepOutWedge[];
  /** Is the ground point (x, 0, z) inside a footer band seen from any reading pose, or a dry box? */
  isDry(x: number, z: number): boolean;
  /** Is the ground point inside any keep-out wedge? */
  inWedge(x: number, z: number): boolean;
}

export function createDryBand(theme: DataSurfaceTheme): DryBand {
  const zones = dryScreenZones(theme);
  const boxes = dryGroundBoxes();
  const wedges = themeWedges(theme);
  // Per-zone projection constants (screenPoint's maths, hoisted out of the per-texel loop).
  const compiled = zones.map((zone) => {
    const { right, up, forward } = cameraBasis(zone.pose.camera);
    const tanHalf = Math.tan((zone.pose.camera.fov * Math.PI) / 360);
    const { width, height } = zone.pose.viewport;
    return { zone, eye: zone.pose.camera.position, right, up, forward, sx: tanHalf * (width / height), sy: tanHalf, width, height };
  });
  const y = PLAZA_GROUND_PLANE.y;
  return {
    zones,
    boxes,
    wedges,
    isDry(x, z) {
      for (const box of boxes) if (inBox(box, x, z)) return true;
      for (const c of compiled) {
        const rx = x - c.eye[0];
        const ry = y - c.eye[1];
        const rz = z - c.eye[2];
        const depth = rx * c.forward[0] + ry * c.forward[1] + rz * c.forward[2];
        if (depth < RIG_NEAR_M) continue;
        const nx = (rx * c.right[0] + ry * c.right[1] + rz * c.right[2]) / (depth * c.sx);
        const ny = (rx * c.up[0] + ry * c.up[1] + rz * c.up[2]) / (depth * c.sy);
        const px = ((nx + 1) / 2) * c.width;
        const py = ((1 - ny) / 2) * c.height;
        const r = c.zone.rect;
        if (px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1) return true;
      }
      return false;
    },
    inWedge(x, z) {
      const p: [number, number, number] = [x, y, z];
      for (const wedge of wedges) if (wedgeHitsSphere(wedge, p, 0)) return true;
      return false;
    },
  };
}

/**
 * Cast a screen point of a pose onto the ground plane. Returns the world
 * (x, z) the pixel sees on y = PLAZA_GROUND_PLANE.y, or null when the ray
 * points at or above the horizon. (Tests use it to sample footer bands.)
 */
export function screenToGround(pose: KeepOutPose, sx: number, sy: number): [number, number] | null {
  const { camera, viewport } = pose;
  const eye = camera.position;
  const { right, up, forward } = cameraBasis(camera);
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const aspect = viewport.width / viewport.height;
  const nx = (sx / viewport.width) * 2 - 1;
  const ny = 1 - (sy / viewport.height) * 2;
  const dir = [0, 1, 2].map((k) => forward[k] + right[k] * nx * tanHalf * aspect + up[k] * ny * tanHalf);
  if (dir[1] >= -1e-6) return null;
  const t = (PLAZA_GROUND_PLANE.y - eye[1]) / dir[1];
  if (t <= 0) return null;
  return [eye[0] + dir[0] * t, eye[2] + dir[2] * t];
}

// ── Deterministic noise (no Math.random, no trig) ────────────────────────────

/** 32-bit integer hash → [0, 1). */
export function hash2(ix: number, iy: number, seed = 0): number {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Smooth value noise at world (x, z) with a cell size (m). */
export function valueNoise(x: number, z: number, cell: number, seed = 0): number {
  const fx = x / cell;
  const fz = z / cell;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

/** Fractal value noise, 0..1. */
export function fbm(x: number, z: number, cell: number, octaves: number, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let c = cell;
  for (let o = 0; o < octaves; o += 1) {
    sum += valueNoise(x, z, c, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    c *= 0.5;
  }
  return sum / norm;
}

// ── Channel fields (world metres → 0..1) ─────────────────────────────────────

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Distance from (x, z) to the quadratic Bézier a → c → b, sampled (the desire line). */
function distToBezier(x: number, z: number, a: readonly [number, number], c: readonly [number, number], b: readonly [number, number]): number {
  let best = Infinity;
  let px = a[0];
  let pz = a[1];
  const steps = 24;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const qx = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
    const qz = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
    // Segment distance.
    const vx = qx - px;
    const vz = qz - pz;
    const len2 = vx * vx + vz * vz || 1e-9;
    const s = Math.min(1, Math.max(0, ((x - px) * vx + (z - pz) * vz) / len2));
    best = Math.min(best, Math.hypot(x - (px + vx * s), z - (pz + vz * s)));
    px = qx;
    pz = qz;
  }
  return best;
}

/** Rounded-square distance to the promenade centre line. */
function promenadeDistance(x: number, z: number): number {
  const o = PROMENADE.offset - PROMENADE.cornerRadius;
  const qx = Math.abs(x) - o;
  const qz = Math.abs(z) - o;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  return Math.abs(outside - PROMENADE.cornerRadius);
}

/** R: wear lanes (0..1). */
export function laneWear(x: number, z: number): number {
  const r = Math.hypot(x - MEDALLION.center[0], z - MEDALLION.center[1]);
  // The ring just outside the medallion where every walker turns.
  let wear = LANE_PROFILE.strength * (1 - smoothstep(0.35, 0.95, Math.abs(r - (MEDALLION.radius + 0.55))));
  for (const lane of LANE_ANCHORS) {
    const dx = lane.at[0] - MEDALLION.center[0];
    const dz = lane.at[1] - MEDALLION.center[1];
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const start: [number, number] = [MEDALLION.center[0] + ux * (MEDALLION.radius + 0.4), MEDALLION.center[1] + uz * (MEDALLION.radius + 0.4)];
    const mid: [number, number] = [(start[0] + lane.at[0]) / 2 - uz * lane.bow, (start[1] + lane.at[1]) / 2 + ux * lane.bow];
    const d = distToBezier(x, z, start, mid, lane.at);
    // Fade out over the last 2 m into the forecourt (a path dissolves, it does not stop).
    const along = Math.hypot(x - lane.at[0], z - lane.at[1]);
    const fade = smoothstep(0.4, 2.4, along);
    wear = Math.max(wear, LANE_PROFILE.strength * fade * (1 - smoothstep(LANE_PROFILE.core, LANE_PROFILE.core + LANE_PROFILE.falloff, d)));
  }
  const prom = PROMENADE.strength * (1 - smoothstep(PROMENADE.halfWidth * 0.5, PROMENADE.halfWidth, promenadeDistance(x, z)));
  wear = Math.max(wear, prom);
  // Worn stone is patchy: modulate by mid-frequency noise.
  return wear * (0.7 + 0.3 * fbm(x, z, 2.4, 2, 7));
}

function boxDistance(box: GroundBox, x: number, z: number): number {
  const qx = Math.abs(x - box.center[0]) - box.half[0];
  const qz = Math.abs(z - box.center[1]) - box.half[1];
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

/** G: contact grime (0..1). */
export function contactGrime(x: number, z: number): number {
  const g = GRIME_PROFILE;
  const facade = PLAZA.half - Math.max(Math.abs(x), Math.abs(z));
  // Under the façades (never seen): flat, so the lossless encode spends nothing there.
  if (facade <= 0) return g.strength;
  let grime = 1 - smoothstep(0, g.facadeReach, facade);
  const kerb = Math.abs(Math.max(Math.abs(x), Math.abs(z)) - g.kerb.offset);
  grime = Math.max(grime, g.kerb.strength * (1 - smoothstep(g.kerb.halfWidth * 0.4, g.kerb.halfWidth, kerb)));
  for (const box of GRIME_BOXES) {
    const d = boxDistance(box, x, z);
    if (d <= 0) return g.strength;
    if (d < g.boxReach) grime = Math.max(grime, 1 - smoothstep(0, g.boxReach, Math.max(0, d)));
  }
  for (const [lx, lz] of LAMP_SEATS) {
    const d = Math.hypot(x - lx, z - lz);
    if (d < g.lampReach + 0.2) grime = Math.max(grime, 1 - smoothstep(0.12, 0.12 + g.lampReach, d));
  }
  return g.strength * grime * (0.65 + 0.35 * fbm(x, z, 1.8, 2, 13));
}

/** Raw puddle field before the keep-out and dry-band law (0..1): gutters and low worn stone. */
export function puddleField(x: number, z: number): number {
  const n = fbm(x, z, 2.6, 3, 29);
  const low = smoothstep(0.55, 0.72, n);
  const kerb = Math.abs(Math.max(Math.abs(x), Math.abs(z)) - GRIME_PROFILE.kerb.offset);
  const gutter = (1 - smoothstep(0.2, 0.6, kerb)) * smoothstep(0.45, 0.6, n);
  return Math.max(low, gutter);
}

/** A: macro noise (0..1) — the anti-tiling index. */
export function macroNoise(x: number, z: number): number {
  return fbm(x, z, 6, 3, 41);
}

/** Puddles keep this far (m) from the dry band and the wedges, so a lossy edge never creeps in. */
export const PUDDLE_MARGIN_M = 0.25;
