import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CameraEndpoint, Vec3 } from '../chapters';
import { VIEWPORTS, routePoseAt, screenPoint, themeKeepOut, type DataFace, type KeepOutBox, type ViewportKey } from '../data-surfaces';
import type { ScreenRect } from '../evidence-probe';
import { ledSpecs, plazaBlockPlans } from '../haussmann';
import { PLAZA } from '../layout';
import { placeStationCard, subjectKeepOuts, type ProjectedSubject } from '../station-digest';
import {
  CREST_BANNER,
  CREST_RASTER,
  PLAZA_TEAMS_PLAN,
  makeTeamsSite,
  teamsFormation,
  type TeamsAce,
  type TeamsFormation,
} from '../teams-formation';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import { PLAZA_DATA_FACES, PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import {
  R5_MEASURED_ACE_RECTS,
  R5_ROSTER,
  ROSTER_COUNTS,
  aabbCorners,
  nominalRoster,
  projectPoints,
  rectsMeet,
  statueBounds,
} from './teams-r6.fixtures';

/**
 * LOOK r6 (C2) — the crest wall's words vs the formation standing in front of
 * it. The wall (HaussmannBlock `PictorialLed` on the east block) is a lit
 * screen BEHIND the teams rows; at r5 the rank-8 plinth and crown cut its
 * name line ('MARA FE…KAMP'). The slide's words now live in `CREST_BANNER`
 * (raster px; led-crest-wall.test.ts holds the painter to it), and this suite
 * projects that banner at the frozen #teams poses:
 *
 *  - it is on screen and whole at 1440, 768 and the landed 390 pose;
 *  - it ends ABOVE every crown whose screen span it shares — the r5 league's
 *    roster shape (analytic, and the r5 capture's measured ace rects) and the
 *    nominal rosters N = 4 … 12;
 *  - the Station Card, placed with its live ace keep-outs (C1), never covers it;
 *  - registering it as a `teams:crest` DataFace is NOT formation-neutral (the
 *    brief's gate), so it stays a layout law and is logged for the
 *    cross-world round.
 */

const TEAMS = PLAZA_STATIONS.findIndex((s) => s.id === 'teams');
const SITE = makeTeamsSite('plaza', PLAZA_STATIONS, PLAZA_TEAMS_PLAN);
const KEYS: readonly ViewportKey[] = ['desktop', 'tablet', 'mobile'];

// ── The wall, restated from HaussmannBlock.tsx `PictorialLed` (pinned below) ──

/** `(spec.w − 0.12) × (spec.h − 0.12)` plane at block-local `(spec.x, spec.y, frontZ − spec.recess + 0.14)`, facing +Z. */
const PLANE_INSET_M = 0.12;
const PLANE_PROUD_M = 0.14;

function crestWall() {
  const plan = plazaBlockPlans(PLAZA.half).find((p) => p.id === 'east');
  if (!plan) throw new Error('no east block');
  const [spec] = ledSpecs(plan);
  const c = Math.cos(plan.rotationY);
  const s = Math.sin(plan.rotationY);
  const lz = plan.depth / 2 - spec.recess + PLANE_PROUD_M;
  return {
    center: [plan.origin[0] + spec.x * c + lz * s, plan.origin[1] + spec.y, plan.origin[2] - spec.x * s + lz * c] as Vec3,
    right: [c, 0, -s] as Vec3,
    normal: [s, 0, c] as Vec3,
    width: spec.w - PLANE_INSET_M,
    height: spec.h - PLANE_INSET_M,
  };
}

const WALL = crestWall();

/** World point of raster pixel (u, v) — v down, the painter's frame. */
function rasterPoint(u: number, v: number): Vec3 {
  const a = (u / CREST_RASTER.w - 0.5) * WALL.width;
  const b = (0.5 - v / CREST_RASTER.h) * WALL.height;
  return [WALL.center[0] + WALL.right[0] * a, WALL.center[1] + b, WALL.center[2] + WALL.right[2] * a];
}

function camera(key: ViewportKey): CameraEndpoint {
  return routePoseAt(PLAZA_STATIONS, TEAMS, VIEWPORTS[key]);
}

function screen(p: Vec3, key: ViewportKey): { x: number; y: number } {
  const s = screenPoint(p, camera(key), VIEWPORTS[key]);
  if (!s) throw new Error('behind the eye');
  return s;
}

const { left, right, top, bottom } = CREST_BANNER;

/** The banner's projected rect (its four corners). */
function bannerRect(key: ViewportKey): ScreenRect {
  const pts = [rasterPoint(left, top), rasterPoint(right, top), rasterPoint(left, bottom), rasterPoint(right, bottom)].map((p) => screen(p, key));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** Screen y of the banner's bottom edge at column x (the edge is a straight segment on screen). */
function bannerBottomAt(key: ViewportKey, x: number): number {
  const a = screen(rasterPoint(left, bottom), key);
  const b = screen(rasterPoint(right, bottom), key);
  const t = Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
  return a.y + (b.y - a.y) * t;
}

/**
 * A crown: the top face of the ace's stature box, its half-extent the plan
 * half capped at CROWN_HALF_M — a relaxed idle pose's measured box (the r5
 * back-line colossal measured ≈ 1.6 m across; the manifest's T-pose extent is
 * 3.35 m). The nearest top corner is what projects highest: this model puts
 * that colossal's crown at y 137 px at 1440, where the capture measured 137.5.
 */
const CROWN_HALF_M = 0.8;

function crownRect(f: TeamsFormation, aces: readonly TeamsAce[], i: number, key: ViewportKey): ScreenRect {
  const slot = f.slots[i];
  const h = Math.min(CROWN_HALF_M, (aces[i].widthM ?? aces[i].footprintM) / 2);
  const crownY = slot.figure[1] + aces[i].heightM;
  const pts: { x: number; y: number }[] = [];
  for (const dx of [-h, h]) for (const dz of [-h, h]) pts.push(screen([slot.figure[0] + dx, crownY, slot.figure[2] + dz], key));
  const xs = pts.map((p) => p.x);
  return { x: Math.min(...xs), y: Math.min(...pts.map((p) => p.y)), w: Math.max(...xs) - Math.min(...xs), h: 0 };
}

/** Clearance (px) between the banner's bottom edge and a rect's top where their columns overlap; null when they do not. */
function clearanceUnder(key: ViewportKey, rect: ScreenRect): number | null {
  const banner = bannerRect(key);
  const x0 = Math.max(rect.x, banner.x);
  const x1 = Math.min(rect.x + rect.w, banner.x + banner.w);
  if (x1 <= x0) return null;
  return rect.y - Math.max(bannerBottomAt(key, x0), bannerBottomAt(key, x1));
}

/** Crowns in the banner's span that do not stay under it: `rank<n>:<clearance>`. */
function crownsInBanner(f: TeamsFormation, aces: readonly TeamsAce[], key: ViewportKey, margin: number): string[] {
  const out: string[] = [];
  f.slots.forEach((slot, i) => {
    const clear = clearanceUnder(key, crownRect(f, aces, i, key));
    if (clear !== null && clear < margin) out.push(`rank${slot.rank}:${clear.toFixed(1)}px`);
  });
  return out;
}

/** The live keep-outs StationCard would pass at #teams: the statues projected at the pose, padded. */
function liveKeepOuts(f: TeamsFormation, aces: readonly TeamsAce[], key: ViewportKey): ScreenRect[] {
  const projected: ProjectedSubject[] = f.slots.map((slot, i) => {
    const p = projectPoints(aabbCorners(statueBounds(f, aces, i)), camera(key), VIEWPORTS[key]);
    return { id: `team:${slot.id}`, kind: 'ace', rect: p?.rect ?? null, onScreenFraction: p?.onScreenFraction ?? 0 };
  });
  return subjectKeepOuts(projected, null);
}

describe('LOOK r6 (C2): the crest banner at the frozen #teams poses', () => {
  it('restates PictorialLed as the source mounts it (plane inset, proud offset)', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/world/evoliga/route/plaza/HaussmannBlock.tsx'), 'utf8');
    expect(source).toMatch(/const backZ = frontZ - spec\.recess \+ 0\.14;/);
    expect(source).toMatch(/<LedCrestWall width=\{spec\.w - 0\.12\} height=\{spec\.h - 0\.12\}/);
  });

  it('faces the #teams eye, unmirrored (raster +x runs left to right on screen)', () => {
    const eye = camera('desktop').position;
    const toEye = [eye[0] - WALL.center[0], eye[1] - WALL.center[1], eye[2] - WALL.center[2]];
    expect(toEye[0] * WALL.normal[0] + toEye[1] * WALL.normal[1] + toEye[2] * WALL.normal[2]).toBeGreaterThan(0);
    for (const key of KEYS) {
      expect(screen(rasterPoint(right, bottom), key).x).toBeGreaterThan(screen(rasterPoint(left, bottom), key).x);
      expect(screen(rasterPoint(left, bottom), key).y).toBeGreaterThan(screen(rasterPoint(left, top), key).y);
    }
  });

  for (const key of KEYS) {
    it(`is whole and on screen @ ${key} (the name is never cut by the frame edge)`, () => {
      const banner = bannerRect(key);
      const { width, height } = VIEWPORTS[key];
      expect(banner.x).toBeGreaterThanOrEqual(0);
      expect(banner.y).toBeGreaterThanOrEqual(0);
      // A small inset at the frame edge (the landed 390 frame cuts the wall at raster x ≈ 747).
      expect(banner.x + banner.w).toBeLessThanOrEqual(width - 4);
      expect(banner.y + banner.h).toBeLessThanOrEqual(height);
    });

    it(`stays above every r5 crown in its span @ ${key} (≥ 4 px clear)`, () => {
      const f = teamsFormation(SITE, R5_ROSTER);
      expect(crownsInBanner(f, R5_ROSTER, key, 4)).toEqual([]);
    });

    it(`stays above every crown of the nominal rosters N = 4 … 12 @ ${key}`, () => {
      for (const n of ROSTER_COUNTS) {
        const aces = nominalRoster(n);
        expect(crownsInBanner(teamsFormation(SITE, aces), aces, key, 4), `N = ${n}`).toEqual([]);
      }
    });
  }

  for (const key of ['desktop', 'mobile'] as const) {
    it(`stays above the r5 capture's own measured ace rects @ ${key}`, () => {
      const over = R5_MEASURED_ACE_RECTS[key]
        .map(({ id, rect }) => ({ id, clear: clearanceUnder(key, rect) }))
        .filter((row) => row.clear !== null && row.clear < 4);
      expect(over).toEqual([]);
    });
  }

  it('control: the r5 name band (raster y 250–330 at x ≥ 572) sat in the rear crowns at 1440', () => {
    // The pre-r6 layout set the name's cap at raster y ≈ 255–318: that band,
    // projected, meets the r5 measured rank-8 rect — the veto this fixes.
    const a = screen(rasterPoint(572, 255), 'desktop');
    const b = screen(rasterPoint(1000, 318), 'desktop');
    const band = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    const rank8 = R5_MEASURED_ACE_RECTS.desktop.find((r) => r.id === 'team:player-0006');
    expect(rank8 && rectsMeet(band, rank8.rect)).toBe(true);
  });

  for (const key of KEYS) {
    it(`is never under the Station Card placed with live ace keep-outs @ ${key}`, () => {
      const banner = bannerRect(key);
      const rosters: [string, TeamsAce[]][] = [['r5', [...R5_ROSTER]], ...ROSTER_COUNTS.map((n): [string, TeamsAce[]] => [`N=${n}`, nominalRoster(n)])];
      for (const [label, aces] of rosters) {
        const keepOuts = liveKeepOuts(teamsFormation(SITE, aces), aces, key);
        const placement = placeStationCard(PLAZA_DATA_SURFACES, TEAMS, VIEWPORTS[key], { keepOuts });
        expect(placement.clear, label).toBe(true);
        expect(rectsMeet(placement.rect, banner), `${label}: ${JSON.stringify(placement.rect)}`).toBe(false);
      }
      if (key !== 'tablet') {
        // With the capture's own (measured, narrower) ace rects too.
        const measured = subjectKeepOuts(
          R5_MEASURED_ACE_RECTS[key].map(({ id, rect }) => ({ id, kind: 'ace', rect, onScreenFraction: 1 })),
          null,
        );
        const placement = placeStationCard(PLAZA_DATA_SURFACES, TEAMS, VIEWPORTS[key], { keepOuts: measured });
        expect(rectsMeet(placement.rect, banner), JSON.stringify(placement.rect)).toBe(false);
      }
    });
  }
});

describe('LOOK r6 (C2): the teams:crest DataFace registration gate', () => {
  /** The banner as a text-rect data face (the brief's option). */
  const CREST_FACE: DataFace = {
    id: 'teams:crest',
    station: 'teams',
    kind: 'sign',
    center: rasterPoint((left + right) / 2, (top + bottom) / 2),
    normal: WALL.normal,
    size: { w: ((right - left) / CREST_RASTER.w) * WALL.width, h: ((bottom - top) / CREST_RASTER.h) * WALL.height },
  };

  it('is not formation-neutral: its padded wedge takes rear crowns, so it stays unregistered (logged for the cross-world round)', () => {
    const withCrest = themeKeepOut({ ...PLAZA_DATA_SURFACES, faces: [...PLAZA_DATA_FACES, CREST_FACE] });
    const f = teamsFormation(SITE, R5_ROSTER);
    const caught = f.slots.filter((slot, i) => {
      const ace = R5_ROSTER[i];
      const box: KeepOutBox = {
        id: slot.id,
        center: [slot.figure[0], slot.figure[1] + ace.heightM / 2, slot.figure[2]],
        half: [ace.footprintM / 2, ace.heightM / 2, ace.footprintM / 2],
      };
      return withCrest.boxHits(box).some((wedge) => wedge.faceId === 'teams:crest');
    });
    // The keep-out law pads a face by 0.3 m + 4 % of the frame; the crowns
    // stand ≈ 7 px under the banner, so registration would add NEW wedge
    // violators (data-surface-keepout.test.ts never allowlists new ones)
    // unless the formation moved — which the brief rules out this round.
    expect(caught.length).toBeGreaterThan(0);
    expect(PLAZA_DATA_FACES.some((face) => face.id === 'teams:crest')).toBe(false);
  });
});
