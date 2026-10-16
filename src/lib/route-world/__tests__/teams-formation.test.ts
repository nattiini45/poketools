import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_ASPECT,
  MOBILE_390_ASPECT,
  figureObstacle,
  figureVisibility,
  projectPoint,
  type FigureBox,
  type Obstacle,
} from '../figure-visibility';
import type { CameraEndpoint, RouteStation, Vec3 } from '../chapters';
import { HUD_BAND_PX, VIEWPORTS, routePoseAt, type KeepOutBox, type Viewport } from '../data-surfaces';
import { frameSubject, framingOptionsFor, orbitPose, panelFrameOffset } from '../focus';
import {
  LEDGER_BOTTOM_NDC,
  LEDGER_CAP_MIN_PX,
  LEDGER_CHIP_FONT,
  LEDGER_LINE,
  LEDGER_SCREEN_INSET_PX,
  LEDGER_TWO_LINE_OVER,
  PLAZA_LAMP_SEATS,
  PLAZA_TEAMS_LAMPS,
  PLAZA_TEAMS_PLAN,
  REAR_CLEAR_SHARE,
  TEAMS_COLOSSAL_M,
  TEAMS_COLOSSAL_PLINTH_M,
  TEAMS_PITCH_MARGIN_M,
  acrossM,
  adjacencyPitch,
  alternatingAces,
  ledgerCapPx,
  ledgerChipFontM,
  ledgerFontFloorM,
  makeTeamsSite,
  teamsFormation,
  teamsInStandingsOrder,
  teamsLandedPose,
  teamsLedgerFace,
  type TeamsAce,
  type TeamsFormation,
  type TeamsSite,
} from '../teams-formation';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import { SAKURA_STATIONS } from '@/components/world/themes/sakura/theme';
import { MOUNTAIN_STATIONS } from '@/components/world/themes/mountain/theme';
import { CLOUDS_STATIONS } from '@/components/world/themes/clouds/theme';
import { ACES_LINE } from '@/components/world/themes/sakura/furniture/layout';
import { CAIRN_LINE } from '@/components/world/themes/mountain/furniture/layout';
import { FLOAT_ROW, TEAMS_DRESSING_BOXES } from '@/components/world/themes/clouds/furniture/layout';
import { PLAZA_PROP_BOXES } from '@/components/world/evoliga/route/plaza/data-faces';
import { SAKURA_PROP_BOXES } from '@/components/world/themes/sakura/furniture/data-faces';
import { MOUNTAIN_PROP_BOXES } from '@/components/world/themes/mountain/furniture/data-faces';
import { CLOUDS_PROP_BOXES } from '@/components/world/themes/clouds/furniture/data-faces';

/**
 * D16 acceptance (WAVE-PLAN §2 "2G TEAMS") + the wave-2 r2 TEAMS judge: for
 * each world and N ∈ {4, 6, 8, 10, 12} — EVERY ace (front, rear and colossal)
 * ≥ 70 % visible in the figure-visibility model at the desktop pose with
 * every pedestal (its own included) as an occluder, the ledger's column
 * order = ascending projected x = standings order, every column and both
 * bezel end caps inside [24, 1416] px at 1440, the painted name's and the
 * rank chip's cap ≥ 14 px at 1440 — plus the clearance, no-clamping,
 * colossal low-plinth, frame and two-line laws, and the teams prop keep-out
 * (no lamp, flag, rope or sign in front of an ace column or the ledger at
 * 1440 / 768 / 390 or in any `?team=` focus shot).
 */

interface WorldCase {
  site: TeamsSite;
  stations: readonly RouteStation[];
  /** The teams-station props the keep-out judges (restated boxes). */
  props: readonly KeepOutBox[];
}

/** Props.tsx EmaBoard / CairnCircle ConditionsBoard: 1.66 m wide, 1.5 m tall (posts + roof), yawed to the eye. */
function signBoard(id: string, x: number, z: number, eye: Vec3): KeepOutBox {
  return { id, center: [x, 0.75, z], half: [0.85, 0.75, 0.15], yaw: Math.atan2(eye[0] - x, eye[2] - z) };
}

const PLAZA_SITE = makeTeamsSite('plaza', PLAZA_STATIONS, PLAZA_TEAMS_PLAN);
const SAKURA_SITE = makeTeamsSite('sakura', SAKURA_STATIONS, ACES_LINE.site);
const MOUNTAIN_SITE = makeTeamsSite('mountain', MOUNTAIN_STATIONS, CAIRN_LINE.site);
const CLOUDS_SITE = makeTeamsSite('clouds', CLOUDS_STATIONS, FLOAT_ROW.site);

const WORLDS: readonly WorldCase[] = [
  {
    site: PLAZA_SITE,
    stations: PLAZA_STATIONS,
    // Wave-2 r3: the lamp boxes the renderer's own seats produce
    // (PLAZA_LAMP_SEATS → PlazaHall + data faces) — never a parallel list.
    props: PLAZA_PROP_BOXES,
  },
  {
    site: SAKURA_SITE,
    stations: SAKURA_STATIONS,
    props: [
      ...SAKURA_PROP_BOXES.filter((b) => b.id.startsWith('teams-')),
      signBoard('teams-ema', ACES_LINE.ema.x, ACES_LINE.ema.z, SAKURA_SITE.camera.position),
    ],
  },
  {
    site: MOUNTAIN_SITE,
    stations: MOUNTAIN_STATIONS,
    props: [
      ...MOUNTAIN_PROP_BOXES.filter((b) => b.id.startsWith('teams-')),
      signBoard('teams-conditions', CAIRN_LINE.conditionsBoard.x, CAIRN_LINE.conditionsBoard.z, MOUNTAIN_SITE.camera.position),
    ],
  },
  // Wave-2 r3: the teams isle's dressing + bookends (they were never judged,
  // and two lamps and a pennant stood in front of the aces).
  { site: CLOUDS_SITE, stations: CLOUDS_STATIONS, props: [...CLOUDS_PROP_BOXES, ...TEAMS_DRESSING_BOXES] },
];

const SITES: readonly TeamsSite[] = WORLDS.map((w) => w.site);

const COUNTS = [4, 6, 8, 10, 12] as const;

/** A varied, deterministic roster (Pokédex-like statures and footprints; no species). */
function roster(n: number): TeamsAce[] {
  const heights = [1.2, 0.5, 1.0, 0.8, 1.5, 0.4, 0.9, 1.1, 0.7, 1.3, 0.6, 1.0];
  const feet = [0.9, 0.6, 1.1, 0.7, 1.2, 0.5, 0.8, 1.0, 0.7, 1.1, 0.6, 0.9];
  return Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, heightM: heights[i % 12], footprintM: feet[i % 12] }));
}

/** The same roster with two colossal aces (one front rank, one rear rank). */
function rosterWithGiants(n: number): TeamsAce[] {
  return roster(n).map((ace, i) =>
    i === 2 ? { ...ace, heightM: 2.6, footprintM: 1.8 } : i === 3 ? { ...ace, heightM: 3.4, footprintM: 2.2 } : ace,
  );
}

/**
 * The r1 live roster's shape (statures and max plan extents as the manifest
 * reports them; numbers only): four colossal aces in a row, a 2.2 m-wide
 * front ace — the case that put the ledger off both frame edges in r1.
 */
function liveLikeRoster(): TeamsAce[] {
  const shape: [number, number, number][] = [
    [1.0, 1.3, 1.3], [1.7, 1.82, 1.8], [1.4, 2.22, 2.22], [1.8, 1.83, 1.83], [1.7, 4.68, 3.46], [2.0, 3.35, 3.35], [1.2, 1.27, 1.27], [0.9, 0.94, 0.94],
  ];
  return shape.map(([heightM, footprintM, widthM], i) => ({ id: `live${i + 1}`, heightM, footprintM, widthM }));
}

/** Clouds floats carry riders cast later inside the rank caps: the law runs on the nominal riders. */
function acesFor(site: TeamsSite, n: number): TeamsAce[] {
  return site.id === 'clouds' ? alternatingAces(n, FLOAT_ROW.nominal.front, FLOAT_ROW.nominal.rear) : roster(n);
}

function box(slotAce: TeamsAce, figure: readonly number[]): FigureBox {
  return { id: slotAce.id, x: figure[0], z: figure[2], baseY: figure[1], heightM: slotAce.heightM, widthM: acrossM(slotAce) };
}

/**
 * The formation as occluders: every figure (shrunk boxes), EVERY pedestal —
 * each at its own height, a colossal's low plinth included — and the ledger.
 */
function formationObstacles(f: TeamsFormation, aces: readonly TeamsAce[]): Obstacle[] {
  const { site, ledger } = f;
  const out: Obstacle[] = [];
  f.slots.forEach((slot, i) => {
    out.push(figureObstacle(box(aces[i], slot.figure)));
    out.push({
      id: `pedestal:${aces[i].id}`,
      center: [slot.pedestal[0], slot.pedestal[1] + slot.pedestalH / 2, slot.pedestal[2]],
      half: [site.pedestal.half * 0.9, slot.pedestalH / 2, site.pedestal.half * 0.9],
    });
  });
  out.push({
    id: 'ledger',
    center: ledger.center,
    half: [ledger.width / 2, (ledger.height / 2) * Math.cos(ledger.tilt), ledger.thickness / 2],
    yaw: ledger.yaw,
  });
  return out;
}

/** Every ace's visibility at the desktop pose; only its own figure box is ignored. */
function everyAceVisible(f: TeamsFormation, aces: readonly TeamsAce[], label: string): void {
  const obstacles = formationObstacles(f, aces);
  const desktop = { id: 'desktop', camera: f.site.camera, aspect: DESKTOP_ASPECT };
  f.slots.forEach((slot, i) => {
    const r = figureVisibility(box(aces[i], slot.figure), desktop, { obstacles }, [`figure:${aces[i].id}`]);
    expect(r.visibleFraction, `${label} rank ${slot.rank} ${slot.row}${slot.colossal ? ' colossal' : ''} ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(REAR_CLEAR_SHARE);
  });
}

/** Under a reported overflow: no pedestal blocks any ace, and every standing ace is ≥ 70 % visible. */
function noPedestalHidesAnAce(f: TeamsFormation, aces: readonly TeamsAce[], label: string): void {
  expect(f.pitchOverflow).toBe(true);
  const obstacles = formationObstacles(f, aces);
  const desktop = { id: 'desktop', camera: f.site.camera, aspect: DESKTOP_ASPECT };
  f.slots.forEach((slot, i) => {
    const r = figureVisibility(box(aces[i], slot.figure), desktop, { obstacles }, [`figure:${aces[i].id}`]);
    expect(r.blockers.filter((b) => b.startsWith('pedestal:')), `${label} rank ${slot.rank}`).toEqual([]);
    if (!slot.colossal) expect(r.visibleFraction, `${label} rank ${slot.rank} ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(REAR_CLEAR_SHARE);
  });
}

// ── Screen-rect keep-out (props vs ace columns and the ledger) ──────────────

interface PoseCase {
  id: string;
  camera: CameraEndpoint;
  viewport: Viewport;
}

interface ScreenBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Depth of the box centre along the view axis. */
  depth: number;
}

function corners(center: Vec3, half: Vec3, yaw = 0): Vec3[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = sx * half[0];
        const lz = sz * half[2];
        out.push([center[0] + lx * c + lz * s, center[1] + sy * half[1], center[2] - lx * s + lz * c]);
      }
    }
  }
  return out;
}

/** Screen box (px) of world points at a pose; null when any point is behind the eye. */
function screenBox(points: readonly Vec3[], centre: Vec3, pose: PoseCase): ScreenBox | null {
  const aspect = pose.viewport.width / pose.viewport.height;
  const ps = points.map((p) => projectPoint(p, pose.camera, aspect));
  if (ps.some((p) => p.depth <= 0.05)) return null;
  const xs = ps.map((p) => ((p.ndcX + 1) / 2) * pose.viewport.width);
  const ys = ps.map((p) => ((1 - p.ndcY) / 2) * pose.viewport.height);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
    depth: projectPoint(centre, pose.camera, aspect).depth,
  };
}

function overlaps(a: ScreenBox, b: ScreenBox, pose: PoseCase): boolean {
  const x0 = Math.max(a.x0, b.x0, 0);
  const x1 = Math.min(a.x1, b.x1, pose.viewport.width);
  const y0 = Math.max(a.y0, b.y0, 0);
  const y1 = Math.min(a.y1, b.y1, pose.viewport.height);
  return x1 > x0 + 0.5 && y1 > y0 + 0.5;
}

/** The statue's world box: its pedestal and its figure (footprint square, full stature). */
function statuePoints(f: TeamsFormation, aces: readonly TeamsAce[], i: number): { points: Vec3[]; centre: Vec3 } {
  const slot = f.slots[i];
  const half = Math.max(f.site.pedestal.half, aces[i].footprintM / 2);
  const top = slot.figure[1] + aces[i].heightM;
  const centre: Vec3 = [slot.figure[0], (slot.pedestal[1] + top) / 2, slot.figure[2]];
  return { points: corners(centre, [half, (top - slot.pedestal[1]) / 2, half]), centre };
}

function ledgerPoints(f: TeamsFormation): Vec3[] {
  const L = f.ledger;
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const u = sx * (L.width / 2 + L.margin);
      const v = sy * (L.height / 2 + L.margin);
      out.push([L.center[0] + L.right[0] * u + L.up[0] * v, L.center[1] + L.right[1] * u + L.up[1] * v, L.center[2] + L.right[2] * u + L.up[2] * v]);
    }
  }
  out.push(L.base);
  return out;
}

/** Props in front of an ace column (or the ledger) on screen at `pose`: `<prop>@<target>` keys. */
function intrusions(
  f: TeamsFormation,
  aces: readonly TeamsAce[],
  props: readonly KeepOutBox[],
  pose: PoseCase,
  only?: number,
): string[] {
  const targets: { id: string; box: ScreenBox }[] = [];
  f.slots.forEach((slot, i) => {
    if (only !== undefined && i !== only) return;
    const { points, centre } = statuePoints(f, aces, i);
    const b = screenBox(points, centre, pose);
    if (b) targets.push({ id: `rank${slot.rank}`, box: b });
  });
  if (only === undefined) {
    const b = screenBox(ledgerPoints(f), f.ledger.center, pose);
    if (b) targets.push({ id: 'ledger', box: b });
  }
  const out: string[] = [];
  for (const prop of props) {
    const pts = corners(prop.center, prop.half, prop.yaw ?? 0);
    const aspect = pose.viewport.width / pose.viewport.height;
    // A prop straddling the eye plane is judged by its in-front part.
    const front = pts.filter((p) => projectPoint(p, pose.camera, aspect).depth > 0.05);
    if (front.length === 0) continue;
    const pb = screenBox(front, prop.center, pose);
    if (!pb) continue;
    for (const t of targets) {
      if (pb.depth < t.box.depth && overlaps(pb, t.box, pose)) out.push(`${prop.id}@${t.id}`);
    }
  }
  return out;
}

function stationPoses(stations: readonly RouteStation[]): PoseCase[] {
  const index = stations.findIndex((s) => s.id === 'teams');
  return (['desktop', 'tablet', 'mobile'] as const).map((k) => ({
    id: k,
    camera: routePoseAt(stations, index, VIEWPORTS[k]),
    viewport: VIEWPORTS[k],
  }));
}

/** The `?team=` focus shot of slot `i` (the ace's statue framed with a docked panel), desktop and 390. */
function focusPoses(w: WorldCase, f: TeamsFormation, aces: readonly TeamsAce[], i: number): PoseCase[] {
  const slot = f.slots[i];
  const { points } = statuePoints(f, aces, i);
  const min: [number, number, number] = [0, 1, 2].map((a) => Math.min(...points.map((p) => p[a]))) as [number, number, number];
  const max: [number, number, number] = [0, 1, 2].map((a) => Math.max(...points.map((p) => p[a]))) as [number, number, number];
  const subject = {
    id: `team:${slot.id}`,
    kind: 'ace',
    label: slot.id,
    bounds: { min, max },
    facing: [Math.sin(slot.yaw), 0, Math.cos(slot.yaw)] as [number, number, number],
  };
  return ([['desktop', false], ['mobile', true]] as const).map(([k, mobile]) => {
    const viewport = VIEWPORTS[k];
    const fov = mobile ? w.site.cameraMobile.fov : w.site.camera.fov;
    const framing = frameSubject(subject, fov, viewport.width / viewport.height, framingOptionsFor('ace', panelFrameOffset(true, mobile)));
    const pose = orbitPose(framing);
    return { id: `focus:${k}`, camera: { position: pose.position, target: pose.target, fov }, viewport };
  });
}

describe('teamsInStandingsOrder', () => {
  it('orders participants by their standings row, unknowns last in original order', () => {
    const participants = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const standings = [{ player_id: 'c' }, { player_id: 'a' }, { player_id: 'x' }];
    expect(teamsInStandingsOrder(participants, standings).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});

for (const world of WORLDS) {
  const { site } = world;
  describe(`teams formation — ${site.id}`, () => {
    for (const n of COUNTS) {
      describe(`N = ${n}`, () => {
        const aces = acesFor(site, n);
        const f = teamsFormation(site, aces);

        it('zips the standings: odd ranks front, even ranks rear, screen order 1 … N', () => {
          expect(f.slots.map((s) => s.row)).toEqual(aces.map((_, i) => (i % 2 === 0 ? 'front' : 'rear')));
          const xs = f.slots.map((s, i) => projectPoint([s.figure[0], s.figure[1] + aces[i].heightM / 2, s.figure[2]], site.camera, DESKTOP_ASPECT).ndcX);
          for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
          expect(f.slots.map((s) => s.rank)).toEqual(aces.map((_, i) => i + 1));
        });

        it('keeps same-row neighbours a footprint-half pair + 0.2 m apart (or reports the overflow)', () => {
          const need = adjacencyPitch(aces, (a) => a.heightM > TEAMS_COLOSSAL_M, site.pedestal.half);
          expect(need).toBeGreaterThanOrEqual(site.pedestal.half * 2 + TEAMS_PITCH_MARGIN_M);
          expect(f.minPitch).toBeCloseTo(need, 9);
          // One-line rails (N ≤ 10) never overflow: the full clearance holds.
          // A two-line N = 12 rail may compress the margin to fit the 1440
          // ledger (the veto), but two pedestals never touch.
          if (n <= LEDGER_TWO_LINE_OVER) expect(f.pitchOverflow).toBe(false);
          const margin = f.pitchOverflow ? 0.02 : TEAMS_PITCH_MARGIN_M - 0.05;
          for (const cls of ['front', 'back'] as const) {
            const row = f.slots.filter((s) => (cls === 'front' ? s.row === 'front' && !s.colossal : s.row === 'rear' || s.colossal));
            for (let i = 1; i < row.length; i += 1) {
              const d = Math.hypot(row[i].pedestal[0] - row[i - 1].pedestal[0], row[i].pedestal[2] - row[i - 1].pedestal[2]);
              if (cls === 'back' && Math.abs(row[i].pedestal[0] - row[i - 1].pedestal[0]) > 0.3) continue;
              const pair = Math.max(site.pedestal.half, aces[row[i].index].footprintM / 2) + Math.max(site.pedestal.half, aces[row[i - 1].index].footprintM / 2);
              expect(d, `${cls} ranks ${row[i - 1].rank}/${row[i].rank}`).toBeGreaterThanOrEqual(pair + margin);
            }
          }
        });

        it('keeps EVERY ace ≥ 70 % visible, own pedestal and every other pedestal as occluders (desktop)', () => {
          everyAceVisible(f, aces, 'nominal');
          expect(f.riserCapped).toBe(false);
          if (site.id !== 'clouds') {
            const giants = rosterWithGiants(n);
            const g = teamsFormation(site, giants);
            // At N = 12 the two-line ledger fit may squeeze the two
            // neighbouring giants' back-line gap (reported as overflow): they
            // may then interleave limbs, but no pedestal ever hides an ace and
            // every standing ace still clears.
            if (!g.pitchOverflow) everyAceVisible(g, giants, 'giants');
            else noPedestalHidesAnAce(g, giants, 'giants');
          }
        });

        it('aligns each ledger column under its ace: column order = projected x = standings', () => {
          const L = f.ledger;
          const colX = L.columns.map((c) => {
            const v = L.lines === 1 ? 0 : c.line === 0 ? (L.lineH + 0.01) / 2 : -(L.lineH + 0.01) / 2;
            const p: [number, number, number] = [
              L.center[0] + L.right[0] * c.across + L.up[0] * v,
              L.center[1] + L.right[1] * c.across + L.up[1] * v,
              L.center[2] + L.right[2] * c.across + L.up[2] * v,
            ];
            return projectPoint(p, site.camera, DESKTOP_ASPECT).ndcX;
          });
          const aceX = f.slots.map((s, i) => projectPoint([s.figure[0], s.figure[1] + aces[i].heightM / 2, s.figure[2]], site.camera, DESKTOP_ASPECT).ndcX);
          expect(L.columns.map((c) => c.id)).toEqual(aces.map((a) => a.id));
          colX.forEach((x, i) => expect(Math.abs(x - aceX[i])).toBeLessThan(0.01));
          const sorted = [...colX].sort((a, b) => a - b);
          expect(colX).toEqual(sorted);
        });

        it('fits every column and both bezel end caps inside [24, 1416] px at 1440', () => {
          for (const [label, fm] of [
            ['nominal', f],
            ['giants', teamsFormation(site, rosterWithGiants(n))],
          ] as const) {
            const L = fm.ledger;
            const px = (u: number, v = 0) => {
              const p: [number, number, number] = [
                L.center[0] + L.right[0] * u + L.up[0] * v,
                L.center[1] + L.right[1] * u + L.up[1] * v,
                L.center[2] + L.right[2] * u + L.up[2] * v,
              ];
              return ((projectPoint(p, site.camera, DESKTOP_ASPECT).ndcX + 1) / 2) * 1440;
            };
            for (const c of L.columns) {
              for (const v of [-L.height / 2, L.height / 2]) {
                expect(px(c.cellAcross - c.width / 2, v), `${label} rank ${c.rank} left`).toBeGreaterThanOrEqual(LEDGER_SCREEN_INSET_PX);
                expect(px(c.cellAcross + c.width / 2, v), `${label} rank ${c.rank} right`).toBeLessThanOrEqual(1440 - LEDGER_SCREEN_INSET_PX);
              }
              // The ace's own x (chip + chevron) lies inside its cell.
              expect(Math.abs(c.across - c.cellAcross)).toBeLessThanOrEqual(c.width / 2 + 1e-9);
            }
            // The cells tile each line: no overlap, no dead face between columns.
            for (const line of [0, 1] as const) {
              const cells = L.columns.filter((c) => c.line === line).sort((a, b) => a.across - b.across);
              for (let i = 1; i < cells.length; i += 1) {
                expect(cells[i].cellAcross - cells[i].width / 2).toBeCloseTo(cells[i - 1].cellAcross + cells[i - 1].width / 2, 9);
              }
            }
            for (const v of [-L.height / 2 - L.margin, L.height / 2 + L.margin]) {
              expect(px(-L.width / 2 - L.margin, v), `${label} left bezel`).toBeGreaterThanOrEqual(LEDGER_SCREEN_INSET_PX);
              expect(px(L.width / 2 + L.margin, v), `${label} right bezel`).toBeLessThanOrEqual(1440 - LEDGER_SCREEN_INSET_PX);
            }
          }
        });

        it('paints names and rank chips with a cap ≥ 14 px at 1440 (the painter floor never goes below it)', () => {
          expect(ledgerCapPx(f.ledger, LEDGER_LINE.nameFont * f.ledger.lineScale)).toBeGreaterThanOrEqual(LEDGER_CAP_MIN_PX);
          expect(ledgerCapPx(f.ledger, ledgerFontFloorM(f.ledger))).toBeGreaterThanOrEqual(LEDGER_CAP_MIN_PX - 1e-6);
          expect(ledgerCapPx(f.ledger, ledgerChipFontM(f.ledger))).toBeGreaterThanOrEqual(LEDGER_CAP_MIN_PX - 1e-6);
          // The chip fits its row plus the top pad (the chip is 1 / LEDGER_CHIP_FONT of its font tall).
          expect(ledgerChipFontM(f.ledger) / LEDGER_CHIP_FONT).toBeLessThanOrEqual((LEDGER_LINE.chipRow + LEDGER_LINE.padTop) * f.ledger.lineScale - 0.004 + 1e-9);
          // Each column is wide enough for a condensed 10-character name at the floor.
          const floorPx = ledgerFontFloorM(f.ledger) * f.ledger.pxPerM1440;
          for (const c of f.ledger.columns) expect(c.width * f.ledger.pxPerM1440).toBeGreaterThan(floorPx * 0.6 * 10 * 0.72);
        });

        it('switches the ledger to two lines only above 10 aces', () => {
          expect(f.ledger.lines).toBe(n > LEDGER_TWO_LINE_OVER ? 2 : 1);
          if (f.ledger.lines === 2) {
            expect(f.ledger.columns.filter((c) => c.line === 0).map((c) => c.rank)).toEqual(f.slots.filter((s) => s.row === 'front').map((s) => s.rank));
          }
        });

        it('keeps the ledger under the pedestals and above the HUD band, the formation in frame', () => {
          const L = f.ledger;
          const edge = (sign: number): [number, number, number] => [
            L.center[0] + L.up[0] * sign * (L.height / 2 + L.margin),
            L.center[1] + L.up[1] * sign * (L.height / 2 + L.margin),
            L.center[2] + L.up[2] * sign * (L.height / 2 + L.margin),
          ];
          const bottom = projectPoint(edge(-1), site.camera, DESKTOP_ASPECT).ndcY;
          expect(bottom).toBeGreaterThanOrEqual(LEDGER_BOTTOM_NDC - 1e-3);
          // The rail never reaches an ace: its top stays under every front ace's feet
          // (it may rise over the dataless pedestal bases when the HUD band binds).
          const top = projectPoint(edge(1), site.camera, DESKTOP_ASPECT).ndcY;
          const feet = f.slots.filter((s) => s.row === 'front').map((s) => projectPoint(s.figure, site.camera, DESKTOP_ASPECT).ndcY);
          expect(top).toBeLessThan(Math.min(...feet));
          for (const [i, s] of f.slots.entries()) {
            const mid: [number, number, number] = [s.figure[0], s.figure[1] + aces[i].heightM / 2, s.figure[2]];
            expect(Math.abs(projectPoint(mid, site.camera, DESKTOP_ASPECT).ndcX)).toBeLessThanOrEqual(0.95);
            if (!f.pitchOverflow) expect(Math.abs(projectPoint(mid, teamsLandedPose(site), MOBILE_390_ASPECT).ndcX)).toBeLessThanOrEqual(1);
          }
        });

        it('keeps the painted text band ≥ 16 px above the HUD band at 1440 and 768', () => {
          // Wave-2 r3 (TEAMS judge): the text band (the painted face; the
          // bezel margin carries no ink) must end at HUD top − 16 px across
          // its whole width — the corners and every column edge — for the
          // desktop and tablet station poses.
          const L = f.ledger;
          const index = world.stations.findIndex((s) => s.id === 'teams');
          for (const key of ['desktop', 'tablet'] as const) {
            const viewport = VIEWPORTS[key];
            const camera = routePoseAt(world.stations, index, viewport);
            const limit = viewport.height - HUD_BAND_PX - 16;
            const us = [-L.width / 2, L.width / 2, ...L.columns.flatMap((c) => [c.cellAcross - c.width / 2, c.cellAcross + c.width / 2])];
            for (const u of us) {
              const v = -L.height / 2;
              const p: Vec3 = [L.center[0] + L.right[0] * u + L.up[0] * v, L.center[1] + L.right[1] * u + L.up[1] * v, L.center[2] + L.right[2] * u + L.up[2] * v];
              const q = projectPoint(p, camera, viewport.width / viewport.height);
              const y = ((1 - q.ndcY) / 2) * viewport.height;
              expect(y, `${site.id} N=${n} ${key} u=${u.toFixed(2)}`).toBeLessThanOrEqual(limit);
            }
          }
        });

        it('stays inside the conservative ledger data face (the keep-out law judges that face)', () => {
          const face = teamsLedgerFace(site);
          expect(f.ledger.width + f.ledger.margin * 2).toBeLessThanOrEqual(face.size.w + 1e-6);
          expect(f.ledger.height + f.ledger.margin * 2).toBeLessThanOrEqual(face.size.h + 1e-6);
          const dx = Math.hypot(f.ledger.center[0] - face.center[0], f.ledger.center[2] - face.center[2]);
          expect(dx + f.ledger.width / 2).toBeLessThanOrEqual(face.size.w / 2 + 0.05);
        });

        it('keeps every teams prop out of the ace columns and the ledger at 1440 / 768 / 390', () => {
          for (const pose of stationPoses(world.stations)) {
            expect(intrusions(f, aces, world.props, pose), `${site.id} ${pose.id}`).toEqual([]);
          }
        });

        it('keeps every teams prop out of each `?team=` focus shot of its ace', () => {
          f.slots.forEach((slot, i) => {
            for (const pose of focusPoses(world, f, aces, i)) {
              expect(intrusions(f, aces, world.props, pose, i), `rank ${slot.rank} ${pose.id}`).toEqual([]);
            }
          });
        });
      });
    }

    if (site.id !== 'clouds') {
      it('never clamps a colossal ace: full stature on a low plinth on the back line, every ace ≥ 70 % visible', () => {
        const aces = rosterWithGiants(8);
        const f = teamsFormation(site, aces);
        const rearDepth = Math.max(...f.slots.filter((s) => s.row === 'rear' && !s.colossal).map((s) => s.pedestal[0]));
        for (const [i, slot] of f.slots.entries()) {
          expect(slot.heightM).toBe(aces[i].heightM);
          if (aces[i].heightM > TEAMS_COLOSSAL_M) {
            expect(slot.colossal).toBe(true);
            expect(slot.figure[0]).toBeGreaterThan(rearDepth);
            // No empty full-height pedestal between the eye and the giant: its
            // plinth is ≤ 0.3 m and stands under its own feet.
            expect(slot.pedestalH).toBe(TEAMS_COLOSSAL_PLINTH_M);
            expect(slot.pedestalH).toBeLessThanOrEqual(0.3);
            expect(slot.pedestal[0]).toBeCloseTo(slot.figure[0], 6);
            expect(slot.pedestal[2]).toBeCloseTo(slot.figure[2], 6);
            expect(slot.figure[1]).toBeCloseTo(site.groundY + f.riser.height + TEAMS_COLOSSAL_PLINTH_M, 6);
          } else {
            expect(slot.pedestalH).toBe(site.pedestal.capH);
          }
        }
        everyAceVisible(f, aces, 'giants');
      });

      it('keeps the r1 live-shaped roster (four giants, a 2.2 m-wide front ace) on the 1440 frame', () => {
        const aces = liveLikeRoster();
        const f = teamsFormation(site, aces);
        const L = f.ledger;
        const px = (u: number) => {
          const p: [number, number, number] = [L.center[0] + L.right[0] * u, L.center[1] + L.right[1] * u, L.center[2] + L.right[2] * u];
          return ((projectPoint(p, site.camera, DESKTOP_ASPECT).ndcX + 1) / 2) * 1440;
        };
        expect(px(-L.width / 2 - L.margin)).toBeGreaterThanOrEqual(LEDGER_SCREEN_INSET_PX);
        expect(px(L.width / 2 + L.margin)).toBeLessThanOrEqual(1440 - LEDGER_SCREEN_INSET_PX);
        // A giant is never behind a pedestal; every standing ace clears.
        if (f.pitchOverflow) noPedestalHidesAnAce(f, aces, 'live');
        else everyAceVisible(f, aces, 'live');
      });
    }

    it('is deterministic (the components mount exactly these seats)', () => {
      const a = teamsFormation(site, acesFor(site, 8));
      const b = teamsFormation(site, acesFor(site, 8));
      expect(a).toEqual(b);
    });
  });
}

describe('clouds riders at the rear cap', () => {
  it('keeps a 1.8 m rear rider clear too (the cap the riser law bounds)', () => {
    const site = SITES[3];
    const f = teamsFormation(site, alternatingAces(8, FLOAT_ROW.nominal.front, FLOAT_ROW.nominal.rear));
    const tall = alternatingAces(8, FLOAT_ROW.nominal.front, { heightM: FLOAT_ROW.riderMaxByRank[1], footprintM: 0.9 });
    const obstacles = formationObstacles(f, tall);
    f.slots.forEach((slot, i) => {
      if (slot.row !== 'rear') return;
      const r = figureVisibility(box(tall[i], slot.figure), { id: 'desktop', camera: site.camera, aspect: DESKTOP_ASPECT }, { obstacles }, [`figure:${tall[i].id}`]);
      expect(r.visibleFraction).toBeGreaterThanOrEqual(REAR_CLEAR_SHARE);
    });
  });
});

describe('plaza street lamps — one source of truth (wave-2 r3)', () => {
  it('mounts the east pair at PLAZA_TEAMS_LAMPS; the retired C-041 seats (12.2, ±2.6) are gone', () => {
    const east = PLAZA_LAMP_SEATS.filter(([x]) => x > 11);
    expect(east).toEqual(PLAZA_TEAMS_LAMPS);
    expect(PLAZA_LAMP_SEATS.some(([x, z]) => x === 12.2 && Math.abs(z) === 2.6)).toBe(false);
  });

  it('boxes exactly the seats the renderer mounts (data faces read PLAZA_LAMP_SEATS)', () => {
    const boxed = [...new Set(PLAZA_PROP_BOXES.filter((b) => b.id.startsWith('lamp:')).map((b) => b.id.split(':')[1]))];
    expect(boxed.sort()).toEqual(PLAZA_LAMP_SEATS.map(([x, z]) => `${x},${z}`).sort());
  });

  it('PlazaHall renders PLAZA_LAMP_SEATS, not a restated literal list', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/world/evoliga/route/plaza/PlazaHall.tsx'), 'utf8');
    expect(source).toMatch(/const LAMP_POSTS = PLAZA_LAMP_SEATS;/);
    expect(source).toMatch(/\{LAMP_POSTS\.map\(/);
    // No seat literal survives beside it (a parallel list is what let r2 drift).
    expect(source).not.toMatch(/\[\s*12\.2\s*,\s*-?\d/);
  });
});
