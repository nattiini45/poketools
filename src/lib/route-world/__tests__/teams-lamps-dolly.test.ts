import { describe, expect, it } from 'vitest';
import type { CameraEndpoint, Vec3 } from '../chapters';
import {
  DOLLY_PROP_SAMPLES,
  DOLLY_SAMPLES,
  VIEWPORTS,
  cameraBasis,
  routePoseAt,
  type KeepOutBox,
  type ViewportKey,
} from '../data-surfaces';
import type { ScreenRect } from '../evidence-probe';
import { PLAZA_LAMP_SEATS, PLAZA_TEAMS_LAMPS, PLAZA_TEAMS_PLAN, makeTeamsSite, teamsFormation, type TeamsAce } from '../teams-formation';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import { PLAZA_PROP_BOXES } from '@/components/world/evoliga/route/plaza/data-faces';
import { R5_ROSTER, ROSTER_COUNTS, aabbCorners, nominalRoster, projectPoints, rectsMeet, statueBounds } from './teams-r6.fixtures';

/**
 * LOOK r6 (C4) — the plaza street lamps vs the teams aces along every dolly
 * crossing. r4's dolly film caught a teams lamp over the Ivysaur / Golem
 * group at s ≈ 3.64 (between the quarter points the keep-out corridor
 * samples); r5's film had no frame there. `DOLLY_PROP_SAMPLES` (0.25, 0.5,
 * 0.6, 0.65, 0.7, 0.75 of every crossing) is the prop tests' own denser list —
 * the shared `DOLLY_SAMPLES` corridor (wedges, calm boxes, the baked ground
 * mask) is untouched. At every sample, at 1440 / 768 / 390, no lamp stands
 * nearer the eye than an ace while their screen boxes meet.
 */

const SITE = makeTeamsSite('plaza', PLAZA_STATIONS, PLAZA_TEAMS_PLAN);
const KEYS: readonly ViewportKey[] = ['desktop', 'tablet', 'mobile'];
/** The street lamps, as the data faces box them from the renderer's own seats. */
const LAMPS: readonly KeepOutBox[] = PLAZA_PROP_BOXES.filter((box) => box.id.startsWith('lamp:'));
/** The rig's near plane (CameraRig `near={0.5}`). */
const NEAR_M = 0.5;

function depth(p: Vec3, camera: CameraEndpoint): number {
  const { forward } = cameraBasis(camera);
  return (p[0] - camera.position[0]) * forward[0] + (p[1] - camera.position[1]) * forward[1] + (p[2] - camera.position[2]) * forward[2];
}

function boxCorners(box: KeepOutBox): Vec3[] {
  return aabbCorners({
    min: [box.center[0] - box.half[0], box.center[1] - box.half[1], box.center[2] - box.half[2]],
    max: [box.center[0] + box.half[0], box.center[1] + box.half[1], box.center[2] + box.half[2]],
  });
}

/** Lamps standing over an ace at crossing position `s` for one viewport: `<lamp>@rank<n>`. */
function lampsOverAces(aces: readonly TeamsAce[], s: number, key: ViewportKey, lamps: readonly KeepOutBox[] = LAMPS): string[] {
  const viewport = VIEWPORTS[key];
  const camera = routePoseAt(PLAZA_STATIONS, s, viewport);
  const f = teamsFormation(SITE, aces);
  const out: string[] = [];
  f.slots.forEach((slot, i) => {
    const corners = aabbCorners(statueBounds(f, aces, i));
    if (corners.some((p) => depth(p, camera) < NEAR_M)) return;
    const ace = projectPoints(corners, camera, viewport);
    if (!ace) return;
    const aceDepth = depth([slot.figure[0], slot.figure[1] + aces[i].heightM / 2, slot.figure[2]], camera);
    for (const lamp of lamps) {
      if (depth(lamp.center, camera) >= aceDepth) continue;
      // A lamp straddling the eye plane is judged by its in-front part.
      const front = boxCorners(lamp).filter((p) => depth(p, camera) > NEAR_M);
      if (front.length === 0) continue;
      const lampRect = projectPoints(front, camera, viewport)?.rect;
      if (lampRect && meetsBy(lampRect, ace.rect, 0.5)) out.push(`${lamp.id}@rank${slot.rank}`);
    }
  });
  return out;
}

function meetsBy(a: ScreenRect, b: ScreenRect, px: number): boolean {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > px && h > px;
}

describe('LOOK r6 (C4): no plaza lamp over a teams ace on the dolly', () => {
  it('samples the approach densely without touching the keep-out corridor', () => {
    expect(DOLLY_SAMPLES).toEqual([0.25, 0.5, 0.75]);
    for (const t of DOLLY_SAMPLES) expect(DOLLY_PROP_SAMPLES).toContain(t);
    for (const t of [0.6, 0.65, 0.7]) expect(DOLLY_PROP_SAMPLES).toContain(t);
    expect([...DOLLY_PROP_SAMPLES].sort((a, b) => a - b)).toEqual([...DOLLY_PROP_SAMPLES]);
  });

  it('judges the renderer seats (PLAZA_LAMP_SEATS, teams pair included)', () => {
    const seats = [...new Set(LAMPS.map((box) => box.id.split(':')[1]))].sort();
    expect(seats).toEqual(PLAZA_LAMP_SEATS.map(([x, z]) => `${x},${z}`).sort());
    for (const [x, z] of PLAZA_TEAMS_LAMPS) expect(seats).toContain(`${x},${z}`);
  });

  const rosters: [string, TeamsAce[]][] = [['r5 roster', [...R5_ROSTER]], ...ROSTER_COUNTS.map((n): [string, TeamsAce[]] => [`N = ${n}`, nominalRoster(n)])];
  for (const [label, aces] of rosters) {
    it(`${label}: every crossing × DOLLY_PROP_SAMPLES × 1440 / 768 / 390`, () => {
      const hits: string[] = [];
      for (let crossing = 0; crossing < PLAZA_STATIONS.length - 1; crossing += 1) {
        for (const t of DOLLY_PROP_SAMPLES) {
          for (const key of KEYS) {
            for (const hit of lampsOverAces(aces, crossing + t, key)) hits.push(`${PLAZA_STATIONS[crossing].id}>${PLAZA_STATIONS[crossing + 1].id}@${t}:${key}:${hit}`);
          }
        }
      }
      expect(hits).toEqual([]);
    });
  }

  it('the teams pair stands outside the #teams frame (1440 / 768 / 390): lamp heads and halos never enter the tableau', () => {
    const teams = PLAZA_STATIONS.findIndex((s) => s.id === 'teams');
    const heads = LAMPS.filter((box) => box.id.endsWith(':head') && PLAZA_TEAMS_LAMPS.some(([x, z]) => box.id === `lamp:${x},${z}:head`));
    expect(heads.length).toBe(PLAZA_TEAMS_LAMPS.length);
    for (const key of KEYS) {
      const camera = routePoseAt(PLAZA_STATIONS, teams, VIEWPORTS[key]);
      for (const head of heads) {
        const rect = projectPoints(boxCorners(head), camera, VIEWPORTS[key])?.rect ?? null;
        expect(rect, `${head.id} @ ${key}`).toBeNull();
      }
    }
  });

  it('negative control: a lamp seated on the eye ray 2 m before the rank-1 ace is caught', () => {
    const aces = [...R5_ROSTER];
    const f = teamsFormation(SITE, aces);
    const [x, , z] = f.slots[0].figure;
    const eye = SITE.camera.position;
    const d = Math.hypot(eye[0] - x, eye[2] - z);
    const seat: Vec3 = [x + ((eye[0] - x) / d) * 2, 1.9, z + ((eye[2] - z) / d) * 2];
    const probe: KeepOutBox = { id: 'lamp:probe:shaft', center: seat, half: [0.1, 1.9, 0.1] };
    const teams = PLAZA_STATIONS.findIndex((s) => s.id === 'teams');
    expect(lampsOverAces(aces, teams, 'desktop', [probe])).toContain('lamp:probe:shaft@rank1');
    // …and the same seat judged by the plain rect test agrees.
    const camera = routePoseAt(PLAZA_STATIONS, teams, VIEWPORTS.desktop);
    const lamp = projectPoints(boxCorners(probe), camera, VIEWPORTS.desktop)?.rect;
    const ace = projectPoints(aabbCorners(statueBounds(f, aces, 0)), camera, VIEWPORTS.desktop)?.rect;
    expect(lamp && ace && rectsMeet(lamp, ace)).toBe(true);
  });
});
