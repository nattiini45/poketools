import type { DataFace, DataSurfaceTheme, KeepOutBox, KeepOutLane } from '@/lib/route-world/data-surfaces';
import { AMBIENT_PATHS } from '@/lib/route-world/ambient';
import { FURNITURE, GATE, HERO_PROPS, JUMBOTRON } from '@/lib/route-world/layout';
import { PLAZA_LAMP_SEATS, PLAZA_TEAMS_PLAN, makeTeamsSite, teamsLedgerFace } from '@/lib/route-world/teams-formation';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';

/**
 * The EvoLiga plaza's data surfaces (fidelity wave 2, seat 2A —
 * `data-surfaces.ts`): the painted faces the keep-out wedges, the standby dim
 * and the Station Card placement read, the prop boxes and walker lanes the
 * keep-out test holds against them. The plaza has no particle field, so it
 * has no corridor table.
 *
 * Pure data (no client imports). Anchors come from `layout.ts`; sizes that
 * live as component-local constants are restated with their source named —
 * a component that changes one must change it here too (the analytic
 * model's known risk; captures stay the evidence of record).
 */

// ── Component constants, restated ───────────────────────────────────────────

/** board/Board.tsx: the painted plane at local z 0.14 inside the JUMBOTRON bezel, facing +Z. */
const BOARD_FACE = { w: JUMBOTRON.width + 2 * JUMBOTRON.bezel, h: JUMBOTRON.height + 2 * JUMBOTRON.bezel, z: 0.14 } as const;
/**
 * CenterDesk.tsx kiosk: screen 0.96 × 1.42 inside a 0.1 m bezel border,
 * centre at desk-local (KIOSK_X 0.2 + KIOSK_SCREEN_X 0.375, 1.4, KIOSK_Z −1.78), facing +X.
 */
const KIOSK = { x: 0.2 + 0.375, y: 1.4, z: -1.78, w: 0.96 + 0.2, h: 1.42 + 0.2 } as const;
/**
 * ChallengeGate.tsx RulePlaque: PLAQUE_W = GATE.plaqueW · 0.56 wide, height
 * from the 640 × 896 canvas, framed +0.14 m per side, centre y 1.8 on the
 * pier face (PIER_X ±3.8, PIER_FACE_Z −depth/2, glass 0.03 proud), facing −Z.
 */
const PLAQUE_W = GATE.plaqueW * 0.56;
const RULE_PLAQUE = { w: PLAQUE_W + 0.28, h: (PLAQUE_W * 896) / 640 + 0.28, y: 1.8, x: 3.8, z: -GATE.depth / 2 - 0.03 } as const;
/**
 * ChallengeGate.tsx FieldBoard (the REGELWERK passage board): a
 * `GATE.doorW` × FIELD_FACE_H 4.4 plane in a group at gate-local
 * (0, SILL_TOP 0.26 + 2.2, 0.3), turned to face −Z.
 */
const RULE_FIELD = { w: GATE.doorW, h: 4.4, y: 0.26 + 2.2, z: 0.3 } as const;
/**
 * ChallengeGate.tsx Lantern (wave-2 r2): a standing lantern on the cyma top
 * (Y.cyma 6.4) over each pier centre (PIER_X ±3.8), set LANTERN_Z 0.15 back
 * from the pier face (−depth/2): base plinth to finial 6.40–7.99, hood 0.30
 * wide.
 */
const LANTERN = { pierX: 3.8, baseY: 6.4, topY: 7.99, z: -GATE.depth / 2 + 0.15, half: 0.3 } as const;

// ── Data faces ───────────────────────────────────────────────────────────────

function boardFace(id: string, station: string, at: { x: number; y: number; z: number }): DataFace {
  return {
    id,
    station,
    kind: 'board',
    center: [at.x, at.y, at.z + BOARD_FACE.z],
    normal: [0, 0, 1],
    size: { w: BOARD_FACE.w, h: BOARD_FACE.h },
  };
}

const ROSTER_FACE: DataFace = {
  id: 'roster:kiosk',
  station: 'roster',
  kind: 'tablet',
  center: [FURNITURE.desk.x + KIOSK.x, KIOSK.y, FURNITURE.desk.z + KIOSK.z],
  normal: [1, 0, 0],
  size: { w: KIOSK.w, h: KIOSK.h },
};

/**
 * The teams Roll-Call Ledger (fidelity wave 2, seat 2G — D16): ONE rail at
 * the forecourt front edge replaces the eight plinth plates. Geometry from
 * `teams-formation.ts` (the same pure law StatueRow mounts), the conservative
 * covering face of a full formation (`teamsLedgerFace`).
 */
const TEAMS_LEDGER_FACE: DataFace = teamsLedgerFace(makeTeamsSite('plaza', PLAZA_STATIONS, PLAZA_TEAMS_PLAN));

const RULES_FACES: DataFace[] = ([-1, 1] as const).map((side) => ({
  id: `rules:plaque:${side < 0 ? 'left' : 'right'}`,
  station: 'rules',
  kind: 'tablet',
  center: [FURNITURE.gate.x + side * RULE_PLAQUE.x, RULE_PLAQUE.y, FURNITURE.gate.z + RULE_PLAQUE.z],
  normal: [0, 0, -1],
  size: { w: RULE_PLAQUE.w, h: RULE_PLAQUE.h },
}));

/** The REGELWERK passage board between the piers (wave-2 r2: declared so gate props are held off it). */
const RULES_FIELD_FACE: DataFace = {
  id: 'rules:field',
  station: 'rules',
  kind: 'board',
  center: [FURNITURE.gate.x, RULE_FIELD.y, FURNITURE.gate.z + RULE_FIELD.z],
  normal: [0, 0, -1],
  size: { w: RULE_FIELD.w, h: RULE_FIELD.h },
};

export const PLAZA_DATA_FACES: readonly DataFace[] = [
  boardFace('pulse:board', 'pulse', FURNITURE.pulseBoard),
  ROSTER_FACE,
  TEAMS_LEDGER_FACE,
  boardFace('schedule:board', 'schedule', FURNITURE.scheduleBoard),
  ...RULES_FACES,
  RULES_FIELD_FACE,
];

export const PLAZA_DATA_SURFACES: DataSurfaceTheme = {
  id: 'plaza',
  stations: PLAZA_STATIONS,
  faces: PLAZA_DATA_FACES,
};

// ── Prop boxes and walker lanes ──────────────────────────────────────────────

/**
 * PlazaHall.tsx LAMP_POSTS: the `haussmann-lamp-post` GLB fitted to 4.4 m;
 * boxed as a 0.5 m lantern head over a 0.2 m shaft. The seats are the
 * renderer's own list (`PLAZA_LAMP_SEATS`, teams-formation.ts) — never restated.
 */
const LAMP_POSTS = PLAZA_LAMP_SEATS;

export function lampPost(at: readonly [number, number]): KeepOutBox[] {
  const id = `lamp:${at[0]},${at[1]}`;
  return [
    { id: `${id}:shaft`, center: [at[0], 1.9, at[1]], half: [0.1, 1.9, 0.1] },
    { id: `${id}:head`, center: [at[0], 4.1, at[1]], half: [0.25, 0.3, 0.25] },
  ];
}

/** The two gate lanterns, boxed from base plinth to finial. */
function gateLantern(side: -1 | 1): KeepOutBox {
  return {
    id: `gate-lantern:${side < 0 ? 'left' : 'right'}`,
    center: [FURNITURE.gate.x + side * LANTERN.pierX, (LANTERN.baseY + LANTERN.topY) / 2, FURNITURE.gate.z + LANTERN.z],
    half: [LANTERN.half, (LANTERN.topY - LANTERN.baseY) / 2, LANTERN.half],
  };
}

export const PLAZA_PROP_BOXES: readonly KeepOutBox[] = [
  ...LAMP_POSTS.flatMap(lampPost),
  gateLantern(-1),
  gateLantern(1),
  // HeroProps.tsx: the LED wayfinding kiosk, `sizeM` wide along x, ≈ 2.4 m tall, ≈ 0.6 m deep.
  ...HERO_PROPS.map((seat) => ({
    id: `hero:${seat.prop}`,
    center: [seat.at.x, seat.at.y + 1.2, seat.at.z] as const,
    half: [seat.sizeM / 2, 1.2, 0.3] as const,
    yaw: seat.yaw,
  })),
];

/**
 * The ambient walker lanes (ambient.ts AMBIENT_PATHS): a body up to
 * AMBIENT_MAX_HEIGHT_M, sampled as a sphere of 0.6 m radius at 1.0 m —
 * covering 0.4–1.6 m of the walker (the feet and a 2.2 m walker's crown are
 * not modelled; the lane grammar keeps them below every board anyway).
 */
export const PLAZA_WALKER_LANES: readonly KeepOutLane[] = AMBIENT_PATHS.map((path) => ({
  id: `walker:${path.id}`,
  points: path.points.map(([x, z]) => [x, 1.0, z] as const),
  radius: 0.6,
  closed: path.closed,
}));
