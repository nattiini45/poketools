/**
 * Fidelity wave 2 (2B) acceptance: the Station Card never covers data.
 *
 * For every station of the four worlds, at the three capture viewports of
 * record (1440 × 900 desktop, 768 × 1024 tablet, 390 × 844 at the LANDED
 * pose), the card's placement rect lies outside every padded data face
 * (2A's `paddedFaceRect`: 0.3 m in the world, then 4 % of the viewport) and
 * above the 56 px HUD band. The card draws its box inside this rect
 * (`max-height` + overflow clip, StationCard.tsx), so a clear rect is a clear
 * card.
 */
import { describe, expect, it } from 'vitest';
import {
  HUD_BAND_PX,
  VIEWPORTS,
  paddedFaceRect,
  routePoseAt,
  type DataSurfaceTheme,
  type ViewportKey,
} from '@/lib/route-world/data-surfaces';
import type { ScreenRect } from '@/lib/route-world/evidence-probe';
import {
  CARD_BAND_INSET_PX,
  CARD_FULL_H,
  CARD_PILL_H,
  CARD_PILL_W,
  collapsedPillKeepOuts,
  dockedPanelRegion,
  pillPreferPoint,
  placeCollapsedPill,
  placeStationCard,
  subjectKeepOuts,
  type ProjectedSubject,
} from '@/lib/route-world/station-digest';
import { framingOptionsFor, frameSubject, orbitPose, panelFrameOffset } from '@/lib/route-world/focus';
import { PLAZA_TEAMS_PLAN, makeTeamsSite, teamsFormation, type TeamsAce } from '@/lib/route-world/teams-formation';
import type { CameraEndpoint } from '@/lib/route-world/chapters';
import { PLAZA_STATIONS } from '@/components/world/themes/plaza/theme';
import {
  R5_MEASURED_ACE_RECTS,
  R5_ROSTER,
  ROSTER_COUNTS,
  aabbCorners,
  nominalRoster,
  overlapShare,
  projectPoints,
  rectsMeet,
  statueBounds,
} from './teams-r6.fixtures';
import { PLAZA_DATA_SURFACES } from '@/components/world/evoliga/route/plaza/data-faces';
import { SAKURA_DATA_SURFACES } from '@/components/world/themes/sakura/furniture/data-faces';
import { MOUNTAIN_DATA_SURFACES } from '@/components/world/themes/mountain/furniture/data-faces';
import { CLOUDS_DATA_SURFACES } from '@/components/world/themes/clouds/furniture/data-faces';

const THEMES: readonly DataSurfaceTheme[] = [
  PLAZA_DATA_SURFACES,
  SAKURA_DATA_SURFACES,
  MOUNTAIN_DATA_SURFACES,
  CLOUDS_DATA_SURFACES,
];
const KEYS: readonly ViewportKey[] = ['desktop', 'tablet', 'mobile'];

function meets(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('Station Card placement (2B)', () => {
  it('covers 20 stations', () => {
    expect(THEMES.reduce((n, theme) => n + theme.stations.length, 0)).toBe(20);
  });

  for (const theme of THEMES) {
    theme.stations.forEach((station, index) => {
      for (const key of KEYS) {
        it(`${theme.id}/${station.id} @ ${key}: card rect clear of every padded face and the HUD band`, () => {
          const viewport = VIEWPORTS[key];
          const placement = placeStationCard(theme, index, viewport);
          expect(placement.clear).toBe(true);
          const { rect } = placement;
          // A usable box, inside the viewport, above the HUD band.
          expect(rect.w).toBeGreaterThanOrEqual(240);
          expect(rect.h).toBeGreaterThanOrEqual(56);
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.y).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.w).toBeLessThanOrEqual(viewport.width);
          expect(rect.y + rect.h).toBeLessThanOrEqual(viewport.height - HUD_BAND_PX);
          // Independent re-check against every face (own and neighbours).
          const camera = routePoseAt(theme.stations, index, viewport);
          for (const face of theme.faces) {
            const padded = paddedFaceRect(face, camera, viewport);
            if (padded) expect(meets(rect, padded), `${face.id} under the card`).toBe(false);
          }
        });
      }
    });
  }

  it('fills the phone caption band edge to edge (minus the inset)', () => {
    const placement = placeStationCard(PLAZA_DATA_SURFACES, 0, VIEWPORTS.mobile);
    expect(placement.side).toBe('full');
    expect(placement.rect.x).toBe(CARD_BAND_INSET_PX);
    expect(placement.rect.w).toBe(VIEWPORTS.mobile.width - 2 * CARD_BAND_INSET_PX);
  });

  it('keeps the plain 360-wide top corner (content-max CARD_FULL_H) wherever it is clear', () => {
    const placement = placeStationCard(PLAZA_DATA_SURFACES, 1, VIEWPORTS.desktop);
    expect(placement.variant).toBe('full');
    expect(placement.rect).toEqual({ x: 24, y: 24, w: 360, h: CARD_FULL_H });
  });

  it('negative control: a face over the whole frame leaves no clear placement', () => {
    const blanket: DataSurfaceTheme = {
      ...PLAZA_DATA_SURFACES,
      faces: [
        ...PLAZA_DATA_SURFACES.faces,
        {
          id: 'fixture:blanket',
          station: 'pulse',
          // A 60 m sheet 3 m in front of the pulse eye fills every viewport.
          center: [-2.1, 3.6, -8.2],
          normal: [0.27, -0.05, 0.96],
          size: { w: 60, h: 40 },
          kind: 'board',
        },
      ],
    };
    for (const key of KEYS) expect(placeStationCard(blanket, 0, VIEWPORTS[key]).clear).toBe(false);
  });
});

// ── LOOK r6 (C1): live ace keep-outs + the collapsed pill ───────────────────

/**
 * The r2–r5 residual "caption over the Sceptile ace" (team:player-0005, 0.07
 * at plaza #teams 1440, light and dark): `subjectKeepOuts` /
 * `placeCollapsedPill` existed and were tested, but StationCard never called
 * them. It now projects the registered subjects once the camera rests at the
 * settled station and places the card with those keep-outs. These cases hold
 * the placement to it with the ace rects StatueRow registers (projected from
 * the formation at the frozen poses) and with the r5 capture's own measured
 * rects — the rects the harness's `caption-over-face` check reads.
 */
const TEAMS = PLAZA_STATIONS.findIndex((s) => s.id === 'teams');
const SITE = makeTeamsSite('plaza', PLAZA_STATIONS, PLAZA_TEAMS_PLAN);

/** The statues (the `team:<id>` focus subjects) projected through `camera`. */
function projectAces(aces: readonly TeamsAce[], camera: CameraEndpoint, key: ViewportKey): ProjectedSubject[] {
  const f = teamsFormation(SITE, aces);
  return f.slots.map((slot, i) => {
    const p = projectPoints(aabbCorners(statueBounds(f, aces, i)), camera, VIEWPORTS[key]);
    return { id: `team:${slot.id}`, kind: 'ace', rect: p?.rect ?? null, onScreenFraction: p?.onScreenFraction ?? 0 };
  });
}

function measuredAces(key: 'desktop' | 'mobile'): ProjectedSubject[] {
  return R5_MEASURED_ACE_RECTS[key].map(({ id, rect }) => ({ id, kind: 'ace', rect, onScreenFraction: 1 }));
}

/** Largest caption-over-face share of `card` over any subject (the harness's `rectOverlapShare(card, face)`). */
function worstShare(card: ScreenRect, subjects: readonly ProjectedSubject[]): number {
  return Math.max(0, ...subjects.map((s) => (s.rect ? overlapShare(card, s.rect) : 0)));
}

const ROSTERS: readonly [string, TeamsAce[]][] = [
  ['r5 roster', [...R5_ROSTER]],
  ...ROSTER_COUNTS.map((n): [string, TeamsAce[]] => [`N = ${n}`, nominalRoster(n)]),
];

describe('LOOK r6 (C1): the Station Card clears every live ace at plaza #teams', () => {
  it('negative control: without keep-outs the r5 card reproduces caption-over-face 0.07 on player-0005', () => {
    const plain = placeStationCard(PLAZA_DATA_SURFACES, TEAMS, VIEWPORTS.desktop);
    expect(plain.rect).toEqual({ x: 24, y: 24, w: 360, h: CARD_FULL_H });
    // The r5 box hugged its content to 168.5 px inside that slot.
    const r5Box = { x: 24, y: 24, w: 360, h: 168.5 };
    const sceptile = R5_MEASURED_ACE_RECTS.desktop.find((r) => r.id === 'team:player-0005');
    expect(sceptile).toBeDefined();
    expect(overlapShare(r5Box, sceptile!.rect)).toBeCloseTo(0.07, 2);
  });

  for (const key of ['desktop', 'mobile'] as const) {
    it(`with the r5 capture's measured ace rects @ ${key}: caption-over-face 0, card still shown`, () => {
      const aces = measuredAces(key);
      const placement = placeStationCard(PLAZA_DATA_SURFACES, TEAMS, VIEWPORTS[key], { keepOuts: subjectKeepOuts(aces, null) });
      expect(placement.clear).toBe(true);
      expect(placement.keepOutClear).toBe(true);
      expect(worstShare(placement.rect, aces), JSON.stringify(placement.rect)).toBe(0);
      expect(placement.rect.w).toBeGreaterThanOrEqual(240);
    });
  }

  it('lands the 1440 card in the top strip above the crowns (both top corners meet a rear ace)', () => {
    const placement = placeStationCard(PLAZA_DATA_SURFACES, TEAMS, VIEWPORTS.desktop, {
      keepOuts: subjectKeepOuts(measuredAces('desktop'), null),
    });
    expect(placement.variant).toBe('strip');
    expect(placement.anchor).toBe('top');
    expect(placement.rect.y).toBe(24);
  });

  for (const [label, aces] of ROSTERS) {
    for (const key of ['desktop', 'tablet', 'mobile'] as const) {
      it(`${label} @ ${key}: the card is placed, clear of every padded face and every projected ace`, () => {
        const camera = routePoseAt(PLAZA_STATIONS, TEAMS, VIEWPORTS[key]);
        const projected = projectAces(aces, camera, key);
        const keepOuts = subjectKeepOuts(projected, null);
        const placement = placeStationCard(PLAZA_DATA_SURFACES, TEAMS, VIEWPORTS[key], { keepOuts });
        expect(placement.clear).toBe(true);
        expect(placement.keepOutClear, JSON.stringify(placement.rect)).toBe(true);
        expect(worstShare(placement.rect, projected)).toBe(0);
        for (const keepOut of keepOuts) expect(rectsMeet(placement.rect, keepOut)).toBe(false);
        expect(placement.rect.y + placement.rect.h).toBeLessThanOrEqual(VIEWPORTS[key].height - HUD_BAND_PX);
      });
    }
  }

  it('changes nothing at a station whose frame shows no ace (live keep-outs are the aces only)', () => {
    for (const key of ['desktop', 'tablet', 'mobile'] as const) {
      PLAZA_STATIONS.forEach((station, index) => {
        if (index === TEAMS) return;
        const camera = routePoseAt(PLAZA_STATIONS, index, VIEWPORTS[key]);
        const keepOuts = subjectKeepOuts(projectAces([...R5_ROSTER], camera, key), null);
        const plain = placeStationCard(PLAZA_DATA_SURFACES, index, VIEWPORTS[key]);
        const live = placeStationCard(PLAZA_DATA_SURFACES, index, VIEWPORTS[key], { keepOuts });
        expect(live.rect, `${station.id} @ ${key}`).toEqual(plain.rect);
      });
    }
  });
});

describe('LOOK r6 (C1): the collapsed pill at a `?team=` focus pose', () => {
  it('reserves the docked panel region: the 1440 right rail and the 390 bottom sheet', () => {
    expect(dockedPanelRegion(VIEWPORTS.desktop)).toEqual({ x: 1440 - 18 - 468, y: 74, w: 468, h: 900 - 18 - 74 });
    const sheet = dockedPanelRegion(VIEWPORTS.mobile);
    expect(sheet.x).toBeCloseTo(13.5, 9);
    expect(sheet.w).toBeCloseTo(390 - 27, 9);
    expect(sheet.y + sheet.h).toBeCloseTo(844 - 13.5, 9);
    expect(sheet.h).toBeCloseTo(0.46 * 844, 9);
  });

  for (const [label, aces] of ROSTERS) {
    it(`${label}: the pill never covers an ace, the focused ace or the docked panel (desktop rail, 390 sheet)`, () => {
      const f = teamsFormation(SITE, aces);
      let placed = 0;
      f.slots.forEach((slot, i) => {
        const bounds = statueBounds(f, aces, i);
        const facing: [number, number, number] = [Math.sin(slot.yaw), 0, Math.cos(slot.yaw)];
        const subject = { id: `team:${slot.id}`, kind: 'ace', label: slot.id, bounds, facing };
        for (const key of ['desktop', 'mobile'] as const) {
          const mobile = key === 'mobile';
          const viewport = VIEWPORTS[key];
          const fov = mobile ? SITE.cameraMobile.fov : SITE.camera.fov;
          const framing = frameSubject(subject, fov, viewport.width / viewport.height, framingOptionsFor('ace', panelFrameOffset(true, mobile)));
          const pose = orbitPose(framing);
          const camera: CameraEndpoint = { position: pose.position, target: pose.target, fov };
          const projected = projectAces(aces, camera, key);
          const keepOuts = collapsedPillKeepOuts(projected, subject.id, viewport, true);
          const card = placeStationCard(PLAZA_DATA_SURFACES, TEAMS, viewport);
          const pill = placeCollapsedPill({ w: CARD_PILL_W, h: CARD_PILL_H }, viewport, keepOuts, pillPreferPoint(card));
          if (!pill) continue; // yields: never drawn over a keep-out
          placed += 1;
          expect(worstShare(pill, projected), `rank ${slot.rank} @ ${key}`).toBe(0);
          expect(rectsMeet(pill, dockedPanelRegion(viewport))).toBe(false);
          expect(pill.x).toBeGreaterThanOrEqual(0);
          expect(pill.x + pill.w).toBeLessThanOrEqual(viewport.width);
          expect(pill.y + pill.h).toBeLessThanOrEqual(viewport.height - HUD_BAND_PX);
        }
      });
      // The pill is a place marker, not a must-show — but it must not vanish everywhere.
      expect(placed).toBeGreaterThan(0);
    });
  }
});
