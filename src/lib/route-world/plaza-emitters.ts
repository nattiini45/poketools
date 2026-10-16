/**
 * Night puddle emitters (LOOK-PLAN §2 SEAT S item 1, §1.3 dark): the light
 * sources whose STATIC mirror streaks the painted ground draws in its wet
 * patches (`paint-ground.ts`). Pure data — no client imports.
 *
 * - The table is ordered by priority. The ground draws the first
 *   `quality.puddleEmitters` entries (8 / 6 / 4 / 2 / 0 by rung), clamped to
 *   `PLAZA_EMITTER_SLOTS` — a uniform-bounded loop, so a rung step is a
 *   uniform write, never a program change.
 * - Streaks only ever appear where the story mask's B channel is wet, and B
 *   is 0 inside every keep-out wedge and inside the footer DRY BAND
 *   (`plaza-ground.ts`), so no emitter reflects under a footer. The ground's
 *   `uPgReflCap` then clamps any streak to ≤ ⅓ of a face's P50.
 * - The east lamp pair stands at the teams terrace, where §1.3 allows wet
 *   grout glints but NO emitter reflections: it sorts last, past the rung-0
 *   count, so it never draws.
 * - The board rects are the one clarity-contested moment (§7 Q7): they sit
 *   right after the spine so the pulse and schedule dark frames carry their
 *   colour; the fallback drops them from the table (lamps and spine only).
 *
 * Positions restate component constants with their source named (the same
 * discipline as `data-faces.ts`); colours are night light colours, or a
 * palette role the component resolves (the boards and the Center fascia wear
 * the palette's own colours).
 */

import { FURNITURE, GATE, JUMBOTRON } from './layout';
import { PLAZA_LAMP_SEATS, PLAZA_TEAMS_LAMPS } from './teams-formation';
import { LAMP_HALO, type LampHalo } from './lamp-halos';

/** Shader slots (the ground's uniform array length). */
export const PLAZA_EMITTER_SLOTS = 12;

/** The most emitters any rung draws (quality.ts rung 0 `puddleEmitters`). */
export const PLAZA_EMITTERS_RUNG0 = 8;

export type PlazaEmitterKind = 'spine' | 'board' | 'lamp' | 'gate-lamp' | 'fascia';

/** A palette key the component resolves to a colour at night. */
export type EmitterPaletteRole = 'boardPulse' | 'boardSchedule' | 'centerRed';

export interface PlazaEmitter {
  id: string;
  kind: PlazaEmitterKind;
  /** Ground position (x, z) of the source. */
  at: readonly [number, number];
  /** Vertical extent of the glowing part (m): [base, top]; a point source has base ≈ top. */
  y: readonly [number, number];
  /** Lateral half-width of the source (m) — a board or fascia is a rect, a lamp a point. */
  halfWidth: number;
  /** Night light colour (hex), or a palette role. */
  color: string | { role: EmitterPaletteRole };
  /** Streak radiance scale (linear); the ground's reflection cap bounds the sum. */
  intensity: number;
}

/**
 * PlazaHall.tsx `LAMP_NIGHT_POOL`: the lantern head around y 3.65–4.4 on the
 * 4.4 m lamp GLB (data-faces.ts boxes the head at 4.1 ± 0.3).
 */
// LOOK r6 (L6.2): a deeper gold, so the capped streak reads gold, not silver.
const LAMP_HEAD = { y: [3.8, 4.4] as const, halfWidth: 0.22, color: '#ffc27a', intensity: 1.2 };

/**
 * ChallengeGate.tsx lanterns: glass on the cyma top (6.4) + 0.86 over each
 * pier centre (PIER_X ±3.8), LANTERN_Z 0.15 behind the pier face; glow
 * `LANTERN_GLOW` #ffcb87.
 */
const GATE_LANTERN = { x: 3.8, y: [6.9, 7.6] as const, z: -GATE.depth / 2 + 0.15, color: '#ffcb87', intensity: 1.0 };

/** PlazaHall.tsx PrismTower: the lit spine is a 64 m cylinder from the ground; night core #ff7ad9. */
const SPINE = { y: [2, 64] as const, halfWidth: 0.25, color: '#ff7ad9', intensity: 0.8 };

/**
 * CenterDesk.tsx fascia: the red band over the opening, OPEN_H 3.42 + FASCIA_H
 * 0.88, BAY_HALF 2.76 either side of the desk axis, its front at desk-local
 * FRONT_X −1.32 + FASCIA_D 0.7 / 2 (+X faces the plaza).
 */
const FASCIA = { x: -1.32 + 0.35, y: [3.42, 4.3] as const, halfWidth: 2.76, intensity: 0.5 };

/** board/Board.tsx: the face plane (JUMBOTRON + bezel) at local z 0.14, centred on the board anchor. */
const BOARD = {
  halfWidth: JUMBOTRON.width / 2 + JUMBOTRON.bezel,
  halfHeight: JUMBOTRON.height / 2 + JUMBOTRON.bezel,
  z: 0.14,
  intensity: 0.35,
};

function lamp(at: readonly [number, number]): PlazaEmitter {
  return {
    id: `lamp:${at[0]},${at[1]}`,
    kind: 'lamp',
    at: [at[0], at[1]],
    y: LAMP_HEAD.y,
    halfWidth: LAMP_HEAD.halfWidth,
    color: LAMP_HEAD.color,
    intensity: LAMP_HEAD.intensity,
  };
}

function board(id: 'pulse' | 'schedule'): PlazaEmitter {
  const anchor = id === 'pulse' ? FURNITURE.pulseBoard : FURNITURE.scheduleBoard;
  return {
    id: `board:${id}`,
    kind: 'board',
    at: [anchor.x, anchor.z + BOARD.z],
    y: [anchor.y - BOARD.halfHeight, anchor.y + BOARD.halfHeight],
    halfWidth: BOARD.halfWidth,
    color: { role: id === 'pulse' ? 'boardPulse' : 'boardSchedule' },
    intensity: BOARD.intensity,
  };
}

function gateLamp(side: -1 | 1): PlazaEmitter {
  return {
    id: `gate-lamp:${side < 0 ? 'left' : 'right'}`,
    kind: 'gate-lamp',
    at: [FURNITURE.gate.x + side * GATE_LANTERN.x, FURNITURE.gate.z + GATE_LANTERN.z],
    y: GATE_LANTERN.y,
    halfWidth: 0.2,
    color: GATE_LANTERN.color,
    intensity: GATE_LANTERN.intensity,
  };
}

const isTeamsLamp = (at: readonly [number, number]) =>
  PLAZA_TEAMS_LAMPS.some((seat) => seat[0] === at[0] && seat[1] === at[1]);
const northLamps = PLAZA_LAMP_SEATS.filter((at) => !isTeamsLamp(at) && at[1] < 0);
const southLamps = PLAZA_LAMP_SEATS.filter((at) => !isTeamsLamp(at) && at[1] >= 0);
const teamsLamps = PLAZA_LAMP_SEATS.filter(isTeamsLamp);

/** The emitter table, highest priority first (see the module note). */
export const PLAZA_EMITTERS: readonly PlazaEmitter[] = [
  {
    id: 'prism-spine',
    kind: 'spine',
    at: [FURNITURE.tower.x, FURNITURE.tower.z],
    y: SPINE.y,
    halfWidth: SPINE.halfWidth,
    color: SPINE.color,
    intensity: SPINE.intensity,
  },
  board('pulse'),
  board('schedule'),
  ...northLamps.map(lamp),
  gateLamp(-1),
  gateLamp(1),
  {
    id: 'center-fascia',
    kind: 'fascia',
    at: [FURNITURE.desk.x + FASCIA.x, FURNITURE.desk.z],
    y: FASCIA.y,
    halfWidth: FASCIA.halfWidth,
    color: { role: 'centerRed' },
    intensity: FASCIA.intensity,
  },
  ...southLamps.map(lamp),
  ...teamsLamps.map(lamp),
];

/**
 * The emitters a rung draws: the first `count` of the table, within the
 * shader's slots — LOOK r6 (L6.2): at a settled `station`, that station's
 * prefix first (`STATION_EMITTER_PREFIX`), then the table's global order.
 */
export function activeEmitters(count: number, station?: string | null): readonly PlazaEmitter[] {
  return stationEmitters(count, station);
}

/** Resolve an emitter's night colour against a palette (role → palette value, else the hex). */
export function emitterColor(emitter: PlazaEmitter, palette: Partial<Record<EmitterPaletteRole, string>>): string {
  if (typeof emitter.color === 'string') return emitter.color;
  return palette[emitter.color.role] ?? '#ffffff';
}

// ── Station-aware priority (LOOK r6, L6.2) ──────────────────────────────────

/**
 * Per-station emitter priority prefixes (LOOK r6, L6.2): at the settled
 * station its own practicals draw FIRST, so a low rung (few emitter slots)
 * still reflects what that frame is about — at rules the gate lanterns. The
 * rest of the table follows in its global order; the teams lamps never enter
 * a prefix (§1.3: no emitter reflections at teams).
 */
export const STATION_EMITTER_PREFIX: Readonly<Record<string, readonly string[]>> = {
  rules: ['gate-lamp:left', 'gate-lamp:right'],
  pulse: ['board:pulse', 'prism-spine'],
  schedule: ['board:schedule', 'prism-spine'],
  roster: ['center-fascia'],
};

/**
 * The emitters a rung draws at a station: the station's prefix (in order),
 * then the rest of the table in its global order, the first `count` within
 * the shader's slots. No station (or an unknown one) = the global order.
 */
export function stationEmitters(count: number, station?: string | null): readonly PlazaEmitter[] {
  const n = Math.max(0, Math.min(Math.floor(Number.isFinite(count) ? count : 0), PLAZA_EMITTER_SLOTS, PLAZA_EMITTERS.length));
  const prefix = station ? (STATION_EMITTER_PREFIX[station] ?? []) : [];
  if (prefix.length === 0) return PLAZA_EMITTERS.slice(0, n);
  const first = prefix
    .map((id) => PLAZA_EMITTERS.find((e) => e.id === id))
    .filter((e): e is PlazaEmitter => e !== undefined && !(e.kind === 'lamp' && isTeamsLamp(e.at)));
  const rest = PLAZA_EMITTERS.filter((e) => !first.includes(e));
  return [...first, ...rest].slice(0, n);
}

// ── Lamp and lantern fog halos (LOOK r6, L6.5) ──────────────────────────────

// The halo type, law and cull are shared by every painted world (ROLLOUT §2.2 f):
// `lamp-halos.ts`, re-exported here so the plaza's imports keep their paths.
export { LAMP_HALO, clearLampHalos, haloGain, type LampHalo } from './lamp-halos';

/** Lamp head centre height on the 4.4 m lamp (PlazaHall LAMP_NIGHT_POOL / the data-faces head box). */
const LAMP_HALO_HEAD_Y = 4.1;
/** ChallengeGate.tsx LANTERN_GLASS_Y: the cyma top (6.4) + 0.86. */
const GATE_LANTERN_GLASS_Y = 6.4 + 0.86;

/** Every candidate halo: the boulevard / gate lamp heads (never the teams pair) and the two gate lanterns. */
export function plazaLampHaloSeats(): LampHalo[] {
  const lamps = [...northLamps, ...southLamps].map((at) => ({
    id: `halo:lamp:${at[0]},${at[1]}`,
    center: [at[0], LAMP_HALO_HEAD_Y, at[1]] as const,
    radius: LAMP_HALO.radius,
    color: LAMP_HEAD.color,
  }));
  const lanterns = ([-1, 1] as const).map((side) => ({
    id: `halo:gate-lantern:${side < 0 ? 'left' : 'right'}`,
    center: [FURNITURE.gate.x + side * GATE_LANTERN.x, GATE_LANTERN_GLASS_Y, FURNITURE.gate.z + GATE_LANTERN.z] as const,
    radius: LAMP_HALO.radius,
    color: GATE_LANTERN.color,
  }));
  return [...lamps, ...lanterns];
}

// ── Wet lanes beside the gate (LOOK r6, L6.2) ────────────────────────────────

/**
 * Wet lanes (LOOK r6, L6.2: "each practical drops a long vertical gold streak
 * on the wet setts beside the board, never under it"): narrow strips of
 * standing water along the ground line from a practical's base toward the
 * rules desktop eye — exactly where its rough-water reflection streak falls
 * in that frame — kept only where the ground is outside every footer dry band
 * and every keep-out wedge (`solveWetLanes`). The ground treats a lane as a
 * puddle (mask B) at night. Never hand-placed: the shipped table is the
 * solver's output frozen as data, and the test re-solves it.
 */
export const WET_LANE = { halfWidth: 0.3, stepM: 0.2, minLengthM: 1.2, max: 4 } as const;

/** One wet lane on the ground (world x, z), `from` nearer the source. */
export interface WetLane {
  id: string;
  from: readonly [number, number];
  to: readonly [number, number];
}

/** The practicals whose streaks the rules frame should carry: the gate lanterns, then the south lamps. */
export function wetLaneSources(): { id: string; at: readonly [number, number] }[] {
  const lanterns = PLAZA_EMITTERS.filter((e) => e.kind === 'gate-lamp').map((e) => ({ id: e.id, at: e.at }));
  const lamps = southLamps.map((at) => ({ id: `lamp:${at[0]},${at[1]}`, at }));
  return [...lanterns, ...lamps];
}

/**
 * For each source, the longest run of ground points on the line from its
 * base toward `eye` (x, z) that is dry-band free, wedge free (a sphere of the
 * lane half-width) and inside `bounds` (|x|, |z|) — at least `minLengthM`.
 */
export function solveWetLanes(input: {
  eye: readonly [number, number];
  isDry: (x: number, z: number) => boolean;
  sphereClear: (c: readonly [number, number, number], r: number) => boolean;
  /** Is the ground point in the rules desktop frame (a lane nobody sees is not shipped)? */
  inFrame: (x: number, z: number) => boolean;
  bounds: number;
  sources?: readonly { id: string; at: readonly [number, number] }[];
}): WetLane[] {
  const out: WetLane[] = [];
  const round = (v: number) => Math.round(v * 100) / 100;
  for (const source of input.sources ?? wetLaneSources()) {
    const dx = input.eye[0] - source.at[0];
    const dz = input.eye[1] - source.at[1];
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.floor(len / WET_LANE.stepM));
    let best: [number, number] | null = null;
    let runStart = -1;
    for (let i = 0; i <= n; i += 1) {
      const s = i / n;
      const x = source.at[0] + dx * s;
      const z = source.at[1] + dz * s;
      const ok =
        Math.abs(x) <= input.bounds &&
        Math.abs(z) <= input.bounds &&
        input.inFrame(x, z) &&
        !input.isDry(x, z) &&
        input.sphereClear([x, 0, z], WET_LANE.halfWidth);
      if (ok && runStart < 0) runStart = i;
      if ((!ok || i === n) && runStart >= 0) {
        const end = ok ? i : i - 1;
        if (!best || end - runStart > best[1] - best[0]) best = [runStart, end];
        runStart = -1;
      }
    }
    if (!best) continue;
    const lengthM = ((best[1] - best[0]) / n) * len;
    if (lengthM < WET_LANE.minLengthM) continue;
    const at = (i: number): [number, number] => [round(source.at[0] + (dx * i) / n), round(source.at[1] + (dz * i) / n)];
    out.push({ id: `wet-lane:${source.id}`, from: at(best[0]), to: at(best[1]) });
    if (out.length >= WET_LANE.max) break;
  }
  return out;
}

/**
 * The shipped wet lanes: `solveWetLanes` at the rules desktop eye against the
 * plaza dry band and keep-out (frozen as data; `plaza-emitters.test.ts`
 * re-solves and requires equality). Two vertical streaks in the rules frame,
 * under the forecourt lamps, from their bases to the frame's lower edge.
 */
export const PLAZA_WET_LANES: readonly WetLane[] = [
  { id: 'wet-lane:lamp:-7.6,12.6', from: [-7.6, 12.6], to: [-3.4, 3.09] },
  { id: 'wet-lane:lamp:7.6,12.6', from: [7.6, 12.6], to: [3.4, 3.09] },
];
