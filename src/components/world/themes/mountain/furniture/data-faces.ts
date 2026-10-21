import type { DataFace, DataSurfaceTheme, KeepOutBox } from '@/lib/route-world/data-surfaces';
import type { StationFaces } from '@/lib/route-world/particle-discipline';
import { makeTeamsSite, teamsLedgerFace } from '@/lib/route-world/teams-formation';
import { MOUNTAIN_STATIONS } from '../theme';
import {
  CAIRN_LINE,
  GATE,
  REGISTER,
  REGISTER_DRESSING,
  SIGN_ROW_HALF_WIDTH,
  SIGNS,
  SIGNS_ROW_YAW,
  SUMMIT,
  SUMMIT_SURROUND,
  signLocalToWorld,
  signSeatsFor,
} from './layout';

/**
 * The Mountain Pass data surfaces (fidelity wave 2, seat 2A —
 * `data-surfaces.ts`): the painted faces the keep-out wedges, the standby
 * dim and the Station Card placement read, the prop boxes the keep-out test
 * holds against them, and the particle corridors the snowfall keeps clear
 * (`particle-discipline.ts`; `particle-faces.ts` re-exports this module).
 *
 * Pure data (no client imports). Positions come from the layout anchors;
 * sizes that live as component-local constants are restated with their
 * source named. The sign row reads `SIGNS` / `signSeatsFor` directly, so a
 * re-spaced row moves its faces and corridor with it. The data faces use the
 * DESKTOP row (2.0 m cloths, flat); the mobile arc's 1.84 m cloths sit
 * within ≤ 0.3 m of those planes, inside the keep-out's 0.3 m pad.
 */

// ── Component constants, restated ───────────────────────────────────────────

/** SummitCairn.tsx: bezel (boardW + 0.6) × (boardH + 0.6), painted plane at local z 0.79. */
const SUMMIT_FACE = { w: SUMMIT.boardW + 0.6, h: SUMMIT.boardH + 0.6, z: 0.79 } as const;
/** TrailSigns.tsx: 2.0 × 6.0 m cloths hung from the 7.1 m arm, cloth at local z 0.075. */
const SIGN_CLOTH = { w: 2.0, h: 6.0, armY: 7.1, z: 0.075 } as const;
/** PassGate.tsx TABLET: the 5.6 × 2.24 m tablet at y 4.1, local z 0.36, facing +Z. */
const GATE_TABLET = { w: 5.6, h: 2.24, y: 4.1, z: 0.36 } as const;
/** TrailRegister.tsx: the frieze plane at local x 0.36, friezeW × (height − 0.14), facing +X. */
const REGISTER_FACE = { x: 0.36, w: REGISTER.friezeW, h: REGISTER.height - 0.14 } as const;
const MARGIN = 0.3;

function yawNormal(yaw: number): [number, number, number] {
  return [Math.sin(yaw), 0, Math.cos(yaw)];
}

// ── Data faces ───────────────────────────────────────────────────────────────

const PULSE_FACE: DataFace = {
  id: 'pulse:board',
  station: 'pulse',
  kind: 'board',
  center: [
    SUMMIT.board.x + Math.sin(SUMMIT.faceYaw) * SUMMIT_FACE.z,
    SUMMIT.board.y,
    SUMMIT.board.z + Math.cos(SUMMIT.faceYaw) * SUMMIT_FACE.z,
  ],
  normal: yawNormal(SUMMIT.faceYaw),
  size: { w: SUMMIT_FACE.w, h: SUMMIT_FACE.h },
};

const ROSTER_FACE: DataFace = {
  id: 'roster:frieze',
  station: 'roster',
  kind: 'board',
  center: [REGISTER.x + REGISTER_FACE.x, REGISTER.height / 2, REGISTER.z],
  normal: [1, 0, 0],
  size: { w: REGISTER_FACE.w, h: REGISTER_FACE.h },
};

/**
 * The teams Roll-Call Ledger (fidelity wave 2, seat 2G — D16): ONE bronze
 * rail at the forecourt front edge replaces the eight cairn plates. Geometry
 * from `teams-formation.ts` (the law CairnCircle mounts), the conservative
 * covering face of a full formation (`teamsLedgerFace`).
 */
const TEAMS_LEDGER_FACE: DataFace = teamsLedgerFace(makeTeamsSite('mountain', MOUNTAIN_STATIONS, CAIRN_LINE.site));

const SCHEDULE_FACES: DataFace[] = signSeatsFor(false).map((seat, i) => ({
  id: `schedule:sign:${i}`,
  station: 'schedule',
  kind: 'sign',
  center: signLocalToWorld(seat, [0, SIGN_CLOTH.armY - SIGN_CLOTH.h / 2 - 0.06, SIGN_CLOTH.z]),
  normal: yawNormal(SIGNS_ROW_YAW),
  size: { w: SIGN_CLOTH.w, h: SIGN_CLOTH.h },
}));

const RULES_FACE: DataFace = {
  id: 'rules:tablet',
  station: 'rules',
  kind: 'tablet',
  center: [GATE.x, GATE_TABLET.y, GATE.z + GATE_TABLET.z],
  normal: [0, 0, 1],
  size: { w: GATE_TABLET.w, h: GATE_TABLET.h },
};

export const MOUNTAIN_DATA_FACES: readonly DataFace[] = [
  PULSE_FACE,
  ROSTER_FACE,
  TEAMS_LEDGER_FACE,
  ...SCHEDULE_FACES,
  RULES_FACE,
];

export const MOUNTAIN_DATA_SURFACES: DataSurfaceTheme = {
  id: 'mountain',
  stations: MOUNTAIN_STATIONS,
  faces: MOUNTAIN_DATA_FACES,
};

// ── Prop boxes the keep-out holds against the faces ──────────────────────────

/** Props.tsx StormLantern: 1.47 m × scale to the finial, ≈ 0.18 m × scale body half-width. */
function stormLantern(id: string, x: number, z: number, scale: number): KeepOutBox {
  return { id, center: [x, 0.735 * scale, z], half: [0.18 * scale, 0.735 * scale, 0.18 * scale] };
}

/** Props.tsx RopeRailing: 0.95 m posts, the rope hung from the caps (≈ 0.92 m). */
function ropeRailing(prefix: string, x: number, posts: readonly number[]): KeepOutBox[] {
  const out: KeepOutBox[] = posts.map((z, i) => ({ id: `${prefix}:post:${i}`, center: [x, 0.47, z], half: [0.06, 0.47, 0.06] }));
  for (let i = 0; i + 1 < posts.length; i += 1) {
    const z0 = posts[i];
    const z1 = posts[i + 1];
    out.push({ id: `${prefix}:rope:${i}`, center: [x, 0.86, (z0 + z1) / 2], half: [0.02, 0.07, Math.abs(z1 - z0) / 2] });
  }
  return out;
}

export const MOUNTAIN_PROP_BOXES: readonly KeepOutBox[] = [
  ...SUMMIT_SURROUND.lanterns.map((l, i) => stormLantern(`pulse-lantern:${i}`, l.x, l.z, l.scale)),
  ...SUMMIT_SURROUND.pennants.map((p, i) => ({ id: `pulse-pennant:${i}`, center: [p.x, p.h / 2, p.z] as const, half: [0.05, p.h / 2, 0.05] as const })),
  { id: 'pulse-signpost', center: [SUMMIT_SURROUND.signpost.x, 0.95, SUMMIT_SURROUND.signpost.z], half: [0.4, 0.95, 0.06], yaw: SUMMIT_SURROUND.signpost.yaw },
  ...([-1, 1] as const).map((side) => stormLantern(`teams-bookend:${side}`, CAIRN_LINE.bookends.x, side * CAIRN_LINE.bookends.z, CAIRN_LINE.bookends.scale)),
  ...CAIRN_LINE.flankers.map((f, i) => stormLantern(`teams-flanker:${i}`, f.x, f.z, 0.95)),
  ...ropeRailing('teams-railing', CAIRN_LINE.railing.x, CAIRN_LINE.railing.posts),
  ...CAIRN_LINE.pennants.map((p, i) => ({ id: `teams-pennant:${i}`, center: [p.x, p.h / 2, p.z] as const, half: [0.05, p.h / 2, 0.05] as const })),
  // Props.tsx Scrub (TrailRegister wall-foot dressing): two blobs, the pair's
  // extent ±0.41·s around the seat and 0–0.66·s tall (wave-2 r2: boxed so
  // the roster focus poses hold them out of the wedge).
  ...REGISTER_DRESSING.shrubs.map((b) => ({
    id: `roster-scrub:${b.z}`,
    center: [b.x + 0.07 * b.s, 0.33 * b.s, b.z] as const,
    half: [0.41 * b.s, 0.33 * b.s, 0.41 * b.s] as const,
  })),
];

// ── Particle corridors (the snowfall keeps these clear) ─────────────────────

export const MOUNTAIN_PARTICLE_FACES: StationFaces = {
  pulse: {
    center: [SUMMIT.board.x, SUMMIT.board.y, SUMMIT.board.z],
    halfWidth: SUMMIT.boardW / 2 + MARGIN,
    halfHeight: SUMMIT.boardH / 2 + MARGIN,
  },
  roster: {
    center: [REGISTER.x + 0.36, REGISTER.height / 2, REGISTER.z],
    halfWidth: REGISTER.friezeW / 2 + MARGIN,
    halfHeight: REGISTER.height / 2 + MARGIN,
  },
  // Fidelity wave 2 (2G, D16): the teams data face is the Roll-Call Ledger
  // (the plaques are gone; the statues are figures, not data).
  teams: {
    center: TEAMS_LEDGER_FACE.center,
    halfWidth: TEAMS_LEDGER_FACE.size.w / 2 + MARGIN,
    halfHeight: TEAMS_LEDGER_FACE.size.h / 2 + MARGIN,
  },
  schedule: {
    center: [SIGNS.x, SIGN_CLOTH.armY - SIGN_CLOTH.h / 2, SIGNS.z],
    halfWidth: SIGN_ROW_HALF_WIDTH + MARGIN,
    halfHeight: SIGN_CLOTH.h / 2 + MARGIN,
  },
  rules: {
    center: RULES_FACE.center,
    halfWidth: GATE_TABLET.w / 2 + MARGIN,
    halfHeight: GATE_TABLET.h / 2 + MARGIN,
  },
};
