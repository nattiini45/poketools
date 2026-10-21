/**
 * W4 audit scenes: every placed wild / pool / statue slot of the four route
 * worlds, with the occluders that can hide them, restated as analytic boxes
 * for `figure-visibility.ts`.
 *
 * Positions come from the theme layout tables (imported, never copied). The
 * few dimensions that live as component-private constants are restated here
 * with their source file named beside them — if a component changes one, the
 * audit must be updated with it (a stale restatement is the known risk of an
 * analytic model; captures remain the evidence of record).
 *
 * Roster-driven figures (grandstand, podium, statuary, float riders, plaza
 * statue row) carry a NOMINAL ace size: their species come from live data, so
 * the audit checks the slot, not a particular Pokémon.
 */

import type { RouteStation } from '../chapters';
import { TINY_M } from '../figure-contract';
import {
  figureObstacle,
  yawedPanel,
  type FigureBox,
  type Obstacle,
  type VisibilityScene,
} from '../figure-visibility';
import { FURNITURE, GATE as PLAZA_GATE, JUMBOTRON, STATUE_ROW } from '../layout';
import {
  PLAZA_TEAMS_PLAN,
  alternatingAces,
  makeTeamsSite,
  teamsFormation,
  type TeamsFormation,
} from '../teams-formation';
import { LOITER_SPOTS } from '../ambient';
import { FigureIndex, figureScale, WORLD_MANIFEST_FILE } from '../model-manifest';
import { readMirrorManifest } from './world-manifest-fixture';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import { SAKURA_STATIONS } from '@/components/world/themes/sakura/theme';
import { MOUNTAIN_STATIONS } from '@/components/world/themes/mountain/theme';
import { CLOUDS_STATIONS } from '@/components/world/themes/clouds/theme';
import * as sakura from '@/components/world/themes/sakura/furniture/layout';
import * as mountain from '@/components/world/themes/mountain/furniture/layout';
import * as clouds from '@/components/world/themes/clouds/furniture/layout';

const { manifest: MANIFEST, present } = readMirrorManifest(WORLD_MANIFEST_FILE);
/** Whether the mirror manifest exists (maintainer-only); the audits skip without it. */
export const MANIFEST_PRESENT = present;
const INDEX = new FigureIndex(MANIFEST);

/** ThemeFigures.tsx TINY_PEDESTAL_M. */
const TINY_PEDESTAL_M = 0.35;
/** AceStatuary.tsx / Statuary.tsx CAP_HALF. */
const STATUARY_HALF = 0.46;

/** Nominal roster ace (live-data species): median-ish stature. */
const NOMINAL_ACE = { heightM: 1.2, widthM: 0.8 } as const;

export interface AuditSlot {
  id: string;
  /** Station index whose composition must show it; null = every station. */
  station: number | null;
  figure: FigureBox;
  /** Obstacle ids this slot never counts against itself (its own plinth). */
  ignore: string[];
  /** Declared reveal mechanic (W4 option b), when one exists. */
  reveal?: string;
  /**
   * Authored model yaw about +Y (three convention, the model faces local +Z)
   * when the layout states one — the keep-out test's facing rule reads it.
   * Absent: the slot has no authored facing (roster-driven statues turn with
   * their pedestal; loiterers are cast per visit).
   */
  yaw?: number;
}

export interface AuditTheme {
  id: 'plaza' | 'sakura' | 'mountain' | 'clouds';
  stations: readonly RouteStation[];
  scene: VisibilityScene;
  slots: AuditSlot[];
}

/** Rendered size of a species from the tracked manifest (Figure.tsx scale law). */
function speciesBox(species: string): { heightM: number; widthM: number } {
  const entry = INDEX.find(species);
  if (!entry) return { ...NOMINAL_ACE };
  const scale = figureScale(entry);
  const h = (entry.bounds.max[1] - entry.bounds.min[1]) * scale;
  const w = (entry.bounds.max[0] - entry.bounds.min[0]) * scale;
  const d = (entry.bounds.max[2] - entry.bounds.min[2]) * scale;
  return { heightM: h, widthM: (w + d) / 2 };
}

/** A pool wild placed through ThemeFigures (tiny stance → pedestal). */
function wildSlot(id: string, species: string, x: number, z: number, y: number, station: number, yaw?: number): AuditSlot {
  const { heightM, widthM } = speciesBox(species);
  const tiny = heightM < TINY_M;
  return {
    id,
    station,
    yaw,
    figure: { id, x, z, baseY: y + (tiny ? TINY_PEDESTAL_M : 0), heightM, widthM },
    ignore: [`figure:${id}`],
  };
}

function aceSlot(id: string, x: number, z: number, baseY: number, station: number, pedestal?: string): AuditSlot {
  return {
    id,
    station,
    figure: { id, x, z, baseY, ...NOMINAL_ACE },
    ignore: [`figure:${id}`, ...(pedestal ? [pedestal] : [])],
  };
}

function box(id: string, center: [number, number, number], half: [number, number, number]): Obstacle {
  return { id, center, half };
}

function withFigureObstacles(obstacles: Obstacle[], slots: AuditSlot[]): Obstacle[] {
  return [...obstacles, ...slots.map((slot) => figureObstacle(slot.figure))];
}

/**
 * The teams station (fidelity wave 2, seat 2G — D16) through the SAME pure
 * law the components mount (`teams-formation.ts`): the zipper seats of
 * `STATUE_ROW.count` nominal aces, their pedestals, the rear riser (a box
 * yawed to the formation frame) and the Roll-Call Ledger rail (an upright
 * panel of the face's size — it leans back ≈ 20° in the scene; the upright
 * box is conservative). Every figure turns to the #teams eye (`yaw`).
 */
function teamsAudit(
  formation: TeamsFormation,
  names: { figure: string; pedestal: string },
  size: { heightM: number; widthM: number },
  capHalf: number,
): { slots: AuditSlot[]; obstacles: Obstacle[] } {
  const { site, frame, riser, ledger } = formation;
  const slots: AuditSlot[] = formation.slots.map((slot, i) => ({
    ...aceSlot(`${names.figure}:${i}`, slot.figure[0], slot.figure[2], slot.figure[1], 2, `${names.pedestal}:${i}`),
    figure: { id: `${names.figure}:${i}`, x: slot.figure[0], z: slot.figure[2], baseY: slot.figure[1], ...size },
    yaw: slot.yaw,
  }));
  const obstacles: Obstacle[] = formation.slots.map((slot, i) =>
    box(`${names.pedestal}:${i}`, [slot.pedestal[0], slot.pedestal[1] + site.pedestal.capH / 2, slot.pedestal[2]], [capHalf, site.pedestal.capH / 2, capHalf]),
  );
  const mx = (riser.x0 + riser.x1) / 2;
  const mz = (riser.z0 + riser.z1) / 2;
  obstacles.push({
    id: 'riser',
    center: [frame.origin[0] + frame.back[0] * mx + frame.across[0] * mz, site.groundY + riser.height / 2, frame.origin[2] + frame.back[2] * mx + frame.across[2] * mz],
    half: [(riser.x1 - riser.x0) / 2, riser.height / 2, (riser.z1 - riser.z0) / 2],
    yaw: frame.yaw,
  });
  obstacles.push({
    id: 'teams-ledger',
    center: ledger.center,
    half: [ledger.width / 2 + ledger.margin, (ledger.height / 2 + ledger.margin) * Math.cos(ledger.tilt), ledger.thickness / 2],
    yaw: ledger.yaw,
  });
  return { slots, obstacles };
}

/** The nominal roster ace as the formation sees it. */
const NOMINAL_FORMATION_ACE = { heightM: NOMINAL_ACE.heightM, footprintM: NOMINAL_ACE.widthM } as const;

/* ------------------------------------------------------------------------ */
/* Sakura                                                                   */
/* ------------------------------------------------------------------------ */

function sakuraTheme(): AuditTheme {
  const slots: AuditSlot[] = [];
  for (const w of sakura.WILD_SPOTS) slots.push(wildSlot(`wild:${w.species}`, w.species, w.x, w.z, 0, w.station, w.yaw));
  sakura.GRANDSTAND.slots.forEach((s, i) =>
    slots.push({
      ...aceSlot(`grandstand:${i}`, s.x, s.z, 0, 0),
      // ParkFigures.tsx: each grandstand ace turns to GRANDSTAND.eye.
      yaw: Math.atan2(sakura.GRANDSTAND.eye.x - s.x, sakura.GRANDSTAND.eye.z - s.z),
    }),
  );
  const teams = teamsAudit(
    teamsFormation(makeTeamsSite('sakura', SAKURA_STATIONS, sakura.ACES_LINE.site), alternatingAces(STATUE_ROW.count, NOMINAL_FORMATION_ACE)),
    { figure: 'statuary', pedestal: 'pedestal' },
    NOMINAL_ACE,
    STATUARY_HALF,
  );
  slots.push(...teams.slots);

  const obstacles: Obstacle[] = [];
  const rock = { x: sakura.ROCK.x, z: sakura.ROCK.z, yaw: sakura.ROCK.faceYaw };
  // JumbotronRock.tsx: bezel box (ROCK_SCREEN_W + 0.5) × (H + 0.5) × 0.36 at
  // local (0, 2.7, 1.35); rock body icosahedron r 2.6 scaled (1.55, 1.5, 1.0)
  // at (0, 1.35, −1.6), boxed at 0.8 of its bounding ellipsoid.
  obstacles.push(yawedPanel('rock-screen', rock, [0, 2.7, 1.35], [3.75, 7 * (9 / 16) / 2 + 0.25, 0.18]));
  obstacles.push(yawedPanel('rock-body', rock, [0, 1.35, -1.6], [2.6 * 1.55 * 0.8, 2.6 * 1.5 * 0.8, 2.6 * 0.8]));
  // FestivalBanners.tsx: 2.0 × 6.0 cloths, arm y 6.5, row yawed to the eye.
  const banners = { x: sakura.BANNERS.x, z: sakura.BANNERS.z, yaw: Math.atan2(1.2 - sakura.BANNERS.x, -3.4 - sakura.BANNERS.z) };
  for (let i = 0; i < sakura.BANNERS.count; i += 1) {
    const lx = (i - (sakura.BANNERS.count - 1) / 2) * sakura.BANNERS.spacing;
    obstacles.push(yawedPanel(`banner:${i}`, banners, [lx, 6.5 - 3 - 0.06, 0.075], [1.0, 3.0, 0.02]));
  }
  // RosterShrine.tsx: wall box 0.7 × height × length.
  obstacles.push(box('shrine-wall', [sakura.SHRINE.x, sakura.SHRINE.height / 2, sakura.SHRINE.z], [0.35, sakura.SHRINE.height / 2, sakura.SHRINE.length / 2]));
  // ToriiGate.tsx: tablet, pillars, and the nuki/kasagi beam stack.
  const t = sakura.TORII;
  obstacles.push(box('torii-tablet', [t.x, t.height * 0.62 - 1.65, t.z + 0.3], [1.3, 1.475, 0.05]));
  for (const side of [-1, 1]) obstacles.push(box(`torii-pillar:${side}`, [t.x + (side * t.span) / 2, (t.height * 0.84) / 2, t.z], [0.44, (t.height * 0.84) / 2, 0.44]));
  obstacles.push(box('torii-nuki', [t.x, t.height * 0.62, t.z], [(t.span + 1.1) / 2, 0.21, 0.25]));
  obstacles.push(box('torii-kasagi', [t.x, t.height - 0.2, t.z], [(t.span + 2.35) / 2, 0.35, 0.36]));
  // Statuary pedestals, the rear riser and the ledger (the D16 formation).
  obstacles.push(...teams.obstacles);

  return { id: 'sakura', stations: SAKURA_STATIONS, scene: { obstacles: withFigureObstacles(obstacles, slots) }, slots };
}

/* ------------------------------------------------------------------------ */
/* Mountain                                                                 */
/* ------------------------------------------------------------------------ */

function mountainTheme(): AuditTheme {
  const slots: AuditSlot[] = [];
  for (const w of mountain.WILD_SPOTS) slots.push(wildSlot(`wild:${w.species}`, w.species, w.x, w.z, w.y, w.station, w.yaw));
  mountain.SUMMIT_PODIUM.slots.forEach((s, i) =>
    slots.push({
      ...aceSlot(`podium:${i}`, s.x, s.z, mountain.SUMMIT_PODIUM.standY, 0),
      // PassFigures.tsx: each podium ace turns to SUMMIT_PODIUM.eye.
      yaw: Math.atan2(mountain.SUMMIT_PODIUM.eye.x - s.x, mountain.SUMMIT_PODIUM.eye.z - s.z),
    }),
  );
  const teams = teamsAudit(
    teamsFormation(makeTeamsSite('mountain', MOUNTAIN_STATIONS, mountain.CAIRN_LINE.site), alternatingAces(STATUE_ROW.count, NOMINAL_FORMATION_ACE)),
    { figure: 'statuary', pedestal: 'pedestal' },
    NOMINAL_ACE,
    STATUARY_HALF,
  );
  slots.push(...teams.slots);

  const obstacles: Obstacle[] = [];
  // SummitCairn.tsx: bezel (boardW + 0.6) × (boardH + 0.6) × 0.3 at local z 0.62.
  const summit = mountain.SUMMIT;
  obstacles.push(
    yawedPanel('summit-board', { x: summit.board.x, z: summit.board.z, yaw: summit.faceYaw }, [0, summit.board.y, 0.62], [(summit.boardW + 0.6) / 2, (summit.boardH + 0.6) / 2, 0.15]),
  );
  // TrailSigns.tsx: 1:3 cloths (2.0 × 6.0 on desktop; W1 r3: 1.84 × 5.52 on
  // mobile — layout.ts `signClothWidthFor`), arm y 7.1, every sign at its seat
  // (layout.ts `signSeatsFor` — lateral lx, toward-the-eye lz) under the one
  // row yaw (the faces are not individually yawed). Fidelity W1 r2: the
  // seats depend on the pose (flat on desktop, arced on mobile) but this
  // scene is shared by both poses, so it restates BOTH sets — conservative:
  // each pose also sees the other set's cloths as occluders.
  const signs = { x: mountain.SIGNS.x, z: mountain.SIGNS.z, yaw: mountain.SIGNS_ROW_YAW };
  for (const [set, seats, clothW] of [
    ['mobile', mountain.signSeatsFor(true), mountain.signClothWidthFor(true)],
    ['desktop', mountain.signSeatsFor(false), mountain.signClothWidthFor(false)],
  ] as const) {
    const halfH = (clothW * 3) / 2;
    seats.forEach((seat, i) => {
      obstacles.push(
        yawedPanel(`sign:${set}:${i}`, signs, [seat.lx, 7.1 - halfH - 0.06, seat.lz + 0.075], [clothW / 2, halfH, 0.02]),
      );
    });
  }
  const reg = mountain.REGISTER;
  obstacles.push(box('register-wall', [reg.x, reg.height / 2, reg.z], [0.35, reg.height / 2, reg.length / 2]));
  // PassGate.tsx: tablet 5.6 × 2.24 at y 4.1, pillars r 0.92 × 0.88 h, lintel.
  const g = mountain.GATE;
  obstacles.push(box('gate-tablet', [g.x, 4.1, g.z + 0.36], [2.8, 1.12, 0.06]));
  for (const side of [-1, 1]) obstacles.push(box(`gate-pillar:${side}`, [g.x + (side * g.span) / 2, (g.height * 0.88) / 2, g.z], [0.92, (g.height * 0.88) / 2, 0.92]));
  obstacles.push(box('gate-lintel', [g.x, g.height * 0.86, g.z], [(g.span + 2.2) / 2, 0.55, 0.33]));
  obstacles.push(...teams.obstacles);

  return {
    id: 'mountain',
    stations: MOUNTAIN_STATIONS,
    scene: { obstacles: withFigureObstacles(obstacles, slots), ground: mountain.knollHeight },
    slots,
  };
}

/* ------------------------------------------------------------------------ */
/* Clouds                                                                   */
/* ------------------------------------------------------------------------ */

function cloudsTheme(): AuditTheme {
  const slots: AuditSlot[] = [];
  for (const w of clouds.SKY_WILDS) slots.push(wildSlot(`wild:${w.species}`, w.species, w.x, w.z, w.y, w.station, w.yaw));
  // AcesFloats.tsx (D16): the zipper float seats of `floatFormation` — the
  // formation law over the rank caps' nominal riders; gondola box at
  // (0, 0.32, 0) of each seat, every rider on its gondola roof (riderLift).
  // Riders are cast later inside the rank caps; the audit keeps its nominal
  // sizes (front tiny 0.4, rear NOMINAL_ACE).
  const row = clouds.FLOAT_ROW;
  const isleTop = clouds.ISLES.teams.top;
  const floats = teamsFormation(
    makeTeamsSite('clouds', CLOUDS_STATIONS, row.site),
    alternatingAces(STATUE_ROW.count, row.nominal.front, row.nominal.rear, 'float'),
  );
  const obstacles: Obstacle[] = [];
  floats.slots.forEach((seat, i) => {
    const [px, seatY, pz] = seat.pedestal;
    obstacles.push(yawedPanel(`gondola:${i}`, { x: px, z: pz, yaw: seat.yaw }, [0, seatY + 0.32, 0], [0.36, 0.18, 0.28]));
    const id = `rider:${i}`;
    const nominal = seat.row === 'front' ? { heightM: 0.4, widthM: 0.4 } : NOMINAL_ACE;
    slots.push({
      id,
      station: 2,
      yaw: seat.yaw,
      figure: { id, x: px, z: pz, baseY: seat.figure[1] + (seat.row === 'front' ? TINY_PEDESTAL_M : 0), ...nominal },
      ignore: [`figure:${id}`, `gondola:${i}`],
    });
  });
  {
    const { frame, riser, ledger } = floats;
    const mx = (riser.x0 + riser.x1) / 2;
    const mz = (riser.z0 + riser.z1) / 2;
    const bottom = isleTop;
    const top = row.site.groundY + riser.height;
    obstacles.push({
      id: 'riser',
      center: [frame.origin[0] + frame.back[0] * mx + frame.across[0] * mz, (bottom + top) / 2, frame.origin[2] + frame.back[2] * mx + frame.across[2] * mz],
      half: [(riser.x1 - riser.x0) / 2, (top - bottom) / 2, (riser.z1 - riser.z0) / 2],
      yaw: frame.yaw,
    });
    obstacles.push({
      id: 'teams-ledger',
      center: ledger.center,
      half: [ledger.width / 2 + ledger.margin, (ledger.height / 2 + ledger.margin) * Math.cos(ledger.tilt), ledger.thickness / 2],
      yaw: ledger.yaw,
    });
  }
  // Airships.tsx: sail bezel (faceW + 0.5) × (faceH + 0.5) × 0.14 riding at
  // hull.y; envelope boxed at 0.85 of its ellipsoid, slid by hullShift.
  for (const [name, ship] of [
    ['flagship', clouds.FLAGSHIP],
    ['register', clouds.REGISTER_AIRSHIP],
    ['fixtures', clouds.FIXTURES_AIRSHIP],
  ] as const) {
    obstacles.push(yawedPanel(`sail:${name}`, { x: ship.face.x, z: ship.face.z, yaw: ship.faceYaw }, [0, ship.hull.y, -0.07], [(ship.faceW + 0.5) / 2, (ship.faceH + 0.5) / 2, 0.07]));
    if (ship.hullProp) {
      const p = ship.hullProp;
      obstacles.push({ id: `hull:${name}`, center: [p.x, p.y, p.z], half: [(8.49 * p.scale) / 2, (3.72 * p.scale) / 2, (2.71 * p.scale) / 2], yaw: p.yaw });
    } else {
      const cx = ship.hull.x + Math.cos(ship.hullYaw) * ship.hullShift;
      const cz = ship.hull.z - Math.sin(ship.hullYaw) * ship.hullShift;
      obstacles.push({ id: `hull:${name}`, center: [cx, ship.hull.y, cz], half: [(ship.hullLength / 2) * 0.85, ship.hullRadius * 0.85, ship.hullRadius * 0.85], yaw: ship.hullYaw });
    }
  }
  // Halo gate: plaque, the stone ring as four boxes, the pier.
  const h = clouds.HALO_GATE;
  obstacles.push(box('halo-plaque', [h.face.x, h.face.y, h.face.z], [h.faceW / 2, h.faceH / 2, 0.05]));
  const r = h.ringRadius;
  const tube = h.ringTube;
  obstacles.push(box('halo-ring:w', [h.ring.x - r, h.ring.y, h.ring.z], [tube, r * 0.7, tube]));
  obstacles.push(box('halo-ring:e', [h.ring.x + r, h.ring.y, h.ring.z], [tube, r * 0.7, tube]));
  obstacles.push(box('halo-ring:top', [h.ring.x, h.ring.y + r, h.ring.z], [r * 0.7, tube, tube]));
  obstacles.push(box('halo-ring:foot', [h.ring.x, h.ring.y - r, h.ring.z], [r * 0.7, tube, tube]));
  obstacles.push(box('halo-pier', [h.pier.x, clouds.ISLES.rules.top + h.pier.h / 2, h.pier.z], [h.pier.w / 2, h.pier.h / 2, h.pier.d / 2]));

  return { id: 'clouds', stations: CLOUDS_STATIONS, scene: { obstacles: withFigureObstacles(obstacles, slots) }, slots };
}

/* ------------------------------------------------------------------------ */
/* Plaza                                                                    */
/* ------------------------------------------------------------------------ */

/** StatueRow.tsx (D16): the plinth prop cap half-width (the fitted `statue-plinth`, ≈ 1.4 m plan). */
const PLAZA_PLINTH_HALF = 0.62;

function plazaTheme(): AuditTheme {
  const slots: AuditSlot[] = [];
  // StatueRow.tsx lays the formation out in WORLD coordinates (it cancels
  // PlazaHall's C-051 re-seat group), so the audit reads it as-is.
  const teams = teamsAudit(
    teamsFormation(makeTeamsSite('plaza', PLAZA_STATIONS, PLAZA_TEAMS_PLAN), alternatingAces(STATUE_ROW.count, NOMINAL_FORMATION_ACE)),
    { figure: 'statue', pedestal: 'plinth' },
    NOMINAL_ACE,
    PLAZA_PLINTH_HALF,
  );
  slots.push(...teams.slots);
  // Loiterers are cast per visit (idle-only roster species); nominal size.
  LOITER_SPOTS.forEach((spot, i) => {
    const id = `loiter:${i}`;
    slots.push({ id, station: null, figure: { id, x: spot.at[0], z: spot.at[1], baseY: 0, heightM: 1.0, widthM: 0.7 }, ignore: [`figure:${id}`] });
  });

  const obstacles: Obstacle[] = [];
  for (const [name, at] of [
    ['pulse', FURNITURE.pulseBoard],
    ['schedule', FURNITURE.scheduleBoard],
  ] as const) {
    obstacles.push(box(`board:${name}`, [at.x, at.y, at.z], [JUMBOTRON.width / 2 + 0.25, JUMBOTRON.height / 2 + 0.25, 0.2]));
  }
  // CenterDesk: the counter block (DESK width runs along z at the west edge).
  obstacles.push(box('desk', [FURNITURE.desk.x, 0.56, FURNITURE.desk.z], [1.1, 0.56, 3.2]));
  obstacles.push(...teams.obstacles);
  obstacles.push(box('gate', [FURNITURE.gate.x, PLAZA_GATE.height / 2, FURNITURE.gate.z], [PLAZA_GATE.width / 2, PLAZA_GATE.height / 2, PLAZA_GATE.depth / 2]));

  return { id: 'plaza', stations: PLAZA_STATIONS, scene: { obstacles: withFigureObstacles(obstacles, slots) }, slots };
}

export function auditThemes(): AuditTheme[] {
  return [plazaTheme(), sakuraTheme(), mountainTheme(), cloudsTheme()];
}
