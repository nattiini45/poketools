import { describe, expect, it } from 'vitest';
import {
  ACTIVATION,
  handoffProgress,
  HANDOFF_SEMANTIC_EDGE,
  measureScrollMap,
  plateauAt,
  plateauEase,
  progressFromScroll,
  scrollFromProgress,
  START_ALIGN_EPS_PX,
  stationScrollTarget,
  type StationGeometry,
} from '../scroll-map';
import { NEAREST_STATION_BAND, seedStationLatch, stepStationLatch } from '../direction-latch';

const VIEWPORT = 900;
const MARGIN = 96; // SectionShell scroll-mt-24
/** Five sections, 1400 px apart, pulse at the top (the four themes' shape). */
const TOPS = [0, 1400, 2800, 4200, 5600];
const HOLDS = [true, false, false, true, false]; // pulse, schedule
const DOC = 5600 + 1600;

function stations(holds: readonly boolean[] = HOLDS, tops: readonly (number | null)[] = TOPS): StationGeometry[] {
  return tops.map((top, i) => ({ top, scrollMarginTop: MARGIN, hold: holds[i] ?? false }));
}

function legacyAnchors(tops: readonly number[], viewport: number, doc: number): number[] {
  const maxScroll = Math.max(1, doc - viewport);
  const anchors = tops.map((top) => Math.min(Math.max(top - viewport * ACTIVATION, 0), maxScroll));
  anchors[0] = 0;
  for (let i = 1; i < anchors.length; i += 1) if (anchors[i] <= anchors[i - 1]) anchors[i] = anchors[i - 1] + 1;
  return anchors;
}

function legacyProgress(anchors: readonly number[], scrollY: number): number {
  const count = anchors.length;
  if (count < 2) return 0;
  if (scrollY <= anchors[0]) return 0;
  if (scrollY >= anchors[count - 1]) return count - 1;
  let i = 0;
  while (i < count - 2 && scrollY >= anchors[i + 1]) i += 1;
  return i + (scrollY - anchors[i]) / (anchors[i + 1] - anchors[i]);
}

describe('plateauEase', () => {
  it('is the identity without plateaus and monotone with them', () => {
    for (const [a, b] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      let prev = -1;
      for (let i = 0; i <= 1000; i += 1) {
        const u = i / 1000;
        const f = plateauEase(u, a, b);
        if (!a && !b) expect(f).toBe(u);
        expect(f).toBeGreaterThanOrEqual(prev);
        prev = f;
      }
      expect(plateauEase(0, a, b)).toBe(0);
      expect(plateauEase(1, a, b)).toBeCloseTo(1, 12);
    }
  });

  it('has zero slope at an eased end (C1 against the plateau)', () => {
    const h = 1e-6;
    expect(plateauEase(h, true, false) / h).toBeLessThan(1e-4);
    expect((1 - plateauEase(1 - h, false, true)) / h).toBeLessThan(1e-4);
    // and is C1 across the ramp joins
    for (const [a, b] of [[true, false], [false, true], [true, true]] as const) {
      for (const k of [0.2, 0.8]) {
        const left = (plateauEase(k, a, b) - plateauEase(k - h, a, b)) / h;
        const right = (plateauEase(k + h, a, b) - plateauEase(k, a, b)) / h;
        expect(Math.abs(left - right)).toBeLessThan(1e-3);
      }
    }
  });
});

describe('measureScrollMap / progressFromScroll', () => {
  it('matches the legacy map exactly when no station holds', () => {
    const none = [false, false, false, false, false];
    const map = measureScrollMap({ stations: stations(none), viewport: VIEWPORT, documentHeight: DOC });
    const anchors = legacyAnchors(TOPS, VIEWPORT, DOC);
    expect(map.anchors).toEqual(anchors);
    for (let y = -50; y <= DOC; y += 7) {
      expect(progressFromScroll(map, y)).toBe(legacyProgress(anchors, y));
    }
  });

  it('is continuous and monotone non-decreasing in scrollY (no backward snap)', () => {
    const map = measureScrollMap({ stations: stations(), viewport: VIEWPORT, documentHeight: DOC });
    let prev = progressFromScroll(map, 0);
    for (let y = 0; y <= DOC; y += 0.5) {
      const p = progressFromScroll(map, y);
      expect(p).toBeGreaterThanOrEqual(prev);
      // 0.5 px never moves progress by more than a small fraction of a station.
      expect(p - prev).toBeLessThan(0.005);
      prev = p;
    }
  });

  it('sits exactly on the integer across a hold plateau, including start-alignment', () => {
    const map = measureScrollMap({ stations: stations(), viewport: VIEWPORT, documentHeight: DOC });
    const align = TOPS[3] - MARGIN; // schedule start-aligned
    expect(map.hi[3]).toBe(align + START_ALIGN_EPS_PX);
    expect(map.lo[3]).toBe(map.anchors[3]);
    for (let y = map.lo[3]; y <= map.hi[3]; y += 1) {
      expect(progressFromScroll(map, y)).toBe(3);
      expect(plateauAt(map, y)).toBe(3);
    }
    expect(progressFromScroll(map, align)).toBe(3);
    expect(progressFromScroll(map, map.hi[3] + 1)).toBeGreaterThan(3);
    expect(progressFromScroll(map, map.lo[3] - 1)).toBeLessThan(3);
    expect(plateauAt(map, map.hi[3] + 1)).toBeNull();
  });

  it('reports no pin for non-hold stations', () => {
    const map = measureScrollMap({ stations: stations(), viewport: VIEWPORT, documentHeight: DOC });
    for (const i of [1, 2, 4]) expect(plateauAt(map, map.anchors[i])).toBeNull();
    expect(plateauAt(map, 0)).toBe(0);
  });

  it('lands non-hold stations on their integer at the anchor', () => {
    const map = measureScrollMap({ stations: stations(), viewport: VIEWPORT, documentHeight: DOC });
    expect(progressFromScroll(map, map.anchors[1])).toBe(1);
    expect(progressFromScroll(map, map.anchors[2])).toBe(2);
    expect(progressFromScroll(map, map.anchors[4])).toBe(4);
  });

  it('bands stay strictly ordered and never swallow a crossing', () => {
    // Pathological: huge scroll margin and short sections.
    const tops = [0, 300, 600, 900, 1200];
    const input = tops.map((top, i) => ({ top, scrollMarginTop: 400, hold: i % 2 === 0 }));
    const map = measureScrollMap({ stations: input, viewport: 900, documentHeight: 2400 });
    for (let i = 0; i < tops.length - 1; i += 1) {
      expect(map.hi[i]).toBeGreaterThanOrEqual(map.lo[i]);
      expect(map.lo[i + 1]).toBeGreaterThan(map.hi[i]);
    }
    let prev = 0;
    for (let y = 0; y <= 1500; y += 0.5) {
      const p = progressFromScroll(map, y);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('rescales onto a short page so every station stays reachable', () => {
    const map = measureScrollMap({ stations: stations(), viewport: VIEWPORT, documentHeight: 3000 });
    const maxScroll = 3000 - VIEWPORT;
    expect(map.anchors[map.anchors.length - 1]).toBeLessThanOrEqual(maxScroll);
    expect(progressFromScroll(map, maxScroll)).toBe(4);
  });

  it('handles missing sections and tiny routes', () => {
    const map = measureScrollMap({
      stations: stations(HOLDS, [0, null, 2800, 4200, 5600]),
      viewport: VIEWPORT,
      documentHeight: DOC,
    });
    expect(map.anchors[1]).toBe(1);
    expect(progressFromScroll(measureScrollMap({ stations: [], viewport: 900, documentHeight: 900 }), 50)).toBe(0);
    expect(progressFromScroll(measureScrollMap({ stations: stations([true], [0]), viewport: 900, documentHeight: 900 }), 50)).toBe(0);
  });
});

describe('scrollFromProgress (layout-flip inverse)', () => {
  /** The 390-wide semantic page: tall DOM tables (teams ≈ 6.3k px in). */
  const SEMANTIC_VIEW = 844;
  const SEMANTIC_TOPS = [0, 2100, 4200, 6304, 11800];
  const SEMANTIC_DOC = 13800;
  /** The same five stations under `world-route-live`: one viewport each. */
  const ROUTE_TOPS = SEMANTIC_TOPS.map((_, i) => i * SEMANTIC_VIEW);
  const ROUTE_DOC = SEMANTIC_TOPS.length * SEMANTIC_VIEW;

  const layouts = {
    semantic: measureScrollMap({ stations: stations(HOLDS, SEMANTIC_TOPS), viewport: SEMANTIC_VIEW, documentHeight: SEMANTIC_DOC }),
    route: measureScrollMap({ stations: stations(HOLDS, ROUTE_TOPS), viewport: SEMANTIC_VIEW, documentHeight: ROUTE_DOC }),
    fixture: measureScrollMap({ stations: stations(), viewport: VIEWPORT, documentHeight: DOC }),
    noHolds: measureScrollMap({ stations: stations([false, false, false, false, false]), viewport: VIEWPORT, documentHeight: DOC }),
    allHolds: measureScrollMap({ stations: stations([true, true, true, true, true]), viewport: VIEWPORT, documentHeight: DOC }),
  };

  for (const [name, map] of Object.entries(layouts)) {
    it(`round-trips every progress in the ${name} layout (plateau and eased segments)`, () => {
      const last = map.lo.length - 1;
      for (let k = 0; k <= last * 1000; k += 1) {
        const p = k / 1000;
        const y = scrollFromProgress(map, p);
        expect(Number.isFinite(y)).toBe(true);
        expect(progressFromScroll(map, y)).toBeCloseTo(p, 9);
      }
      // Irrational-ish fractions and the ease joins themselves.
      for (let i = 0; i < last; i += 1) {
        for (const f of [1e-9, 0.02, 0.1999, 0.2, 0.2001, Math.SQRT1_2, 0.8, 0.999999]) {
          expect(progressFromScroll(map, scrollFromProgress(map, i + f))).toBeCloseTo(i + f, 9);
        }
      }
    });
  }

  it('lands an integer inside its band — start-aligned for holds, on the anchor otherwise', () => {
    for (const map of [layouts.fixture, layouts.semantic, layouts.route]) {
      for (let i = 0; i < map.lo.length; i += 1) {
        const y = scrollFromProgress(map, i);
        expect(y).toBeGreaterThanOrEqual(map.lo[i]);
        expect(y).toBeLessThanOrEqual(map.hi[i]);
        if (!map.holds[i]) expect(y).toBe(map.anchors[i]);
      }
    }
    const map = layouts.fixture;
    expect(plateauAt(map, scrollFromProgress(map, 3))).toBe(3);
    // Schedule rests exactly where its nav chip / scrollIntoView lands, with
    // at least START_ALIGN_EPS_PX of plateau past it for a later remeasure.
    expect(scrollFromProgress(map, 3)).toBe(TOPS[3] - MARGIN);
    expect(map.hi[3] - scrollFromProgress(map, 3)).toBeGreaterThanOrEqual(START_ALIGN_EPS_PX);
    expect(scrollFromProgress(layouts.route, 3)).toBe(3 * SEMANTIC_VIEW - MARGIN);
    expect(scrollFromProgress(layouts.semantic, 3)).toBe(SEMANTIC_TOPS[3] - MARGIN);
  });

  it('clamps out-of-range and degenerate input', () => {
    const map = layouts.fixture;
    expect(scrollFromProgress(map, -3)).toBe(scrollFromProgress(map, 0));
    expect(scrollFromProgress(map, 99)).toBe(scrollFromProgress(map, 4));
    expect(scrollFromProgress(map, Number.NaN)).toBe(map.lo[0]);
    expect(scrollFromProgress(measureScrollMap({ stations: [], viewport: 900, documentHeight: 900 }), 2)).toBe(0);
  });

  it('carries a semantic reader to the same station and fraction in the route layout and back', () => {
    // Visitor reading the top of #teams at 390 (scrollY ≈ 6304 − margin).
    const yBefore = SEMANTIC_TOPS[3] - MARGIN + 150;
    const exact = progressFromScroll(layouts.semantic, yBefore);
    expect(Math.floor(exact)).toBe(3);
    const target = handoffProgress(exact, Math.floor(exact), 5, 'route');
    const yRoute = scrollFromProgress(layouts.route, target);
    const routeExact = progressFromScroll(layouts.route, yRoute);
    expect(stepStationLatch(3, routeExact, 5)).toBe(3);
    // A naive keep-scrollY flip (the browser clamp) would have landed on the
    // last station instead.
    expect(progressFromScroll(layouts.route, Math.min(yBefore, ROUTE_DOC - SEMANTIC_VIEW))).toBe(4);
    // And back to the semantic page: the same section.
    const back = handoffProgress(routeExact, 3, 5, 'semantic');
    expect(Math.floor(progressFromScroll(layouts.semantic, scrollFromProgress(layouts.semantic, back)))).toBe(3);
  });
});

describe('handoffProgress', () => {
  it('keeps exact progress wherever both layouts already agree on the station', () => {
    for (const exact of [0, 0.2, 1.3, 3, 3.34]) {
      const s = Math.floor(exact);
      expect(handoffProgress(exact, s, 5, 'route')).toBe(exact);
    }
    for (const [exact, nearest] of [[3.3, 3], [3, 3], [4, 4], [3.1, 3]] as const) {
      expect(handoffProgress(exact, nearest, 5, 'semantic')).toBe(exact);
    }
  });

  it('never lets the new layout read a different station than the old one', () => {
    for (let k = 0; k <= 4000; k += 1) {
      const exact = k / 1000;
      const floorStation = Math.min(4, Math.floor(exact));
      const toRoute = handoffProgress(exact, floorStation, 5, 'route');
      // A plain round (no history) reads the reader's station, and so does
      // the latch once the conductor re-seats it there on the flip (a stale
      // prior can sit on the band edge, which is why the conductor re-seats).
      expect(seedStationLatch(toRoute, 5)).toBe(floorStation);
      expect(stepStationLatch(floorStation, toRoute, 5)).toBe(floorStation);
      const nearest = stepStationLatch(floorStation, exact, 5);
      const toSemantic = handoffProgress(exact, nearest, 5, 'semantic');
      expect(Math.min(4, Math.floor(toSemantic))).toBe(nearest);
      expect(toSemantic).toBeLessThanOrEqual(nearest === 4 ? 4 : nearest + 1 - HANDOFF_SEMANTIC_EDGE);
    }
  });

  it('pulls the lower half of a tall semantic section back to its own station', () => {
    expect(handoffProgress(3.8, 3, 5, 'route')).toBeCloseTo(3.5 - NEAREST_STATION_BAND, 12);
    expect(handoffProgress(3.7, 4, 5, 'semantic')).toBe(4);
    expect(handoffProgress(Number.NaN, 2, 5, 'route')).toBe(2);
    expect(handoffProgress(2, 2, 1, 'route')).toBe(0);
  });
});

describe('stationScrollTarget (nav chip landing, W6 round 3)', () => {
  // Route layout (one viewport per section) at the two judged viewports; the
  // 390 activation line (0.35 × 844 = 295.4 px) makes every plain anchor
  // fractional, which is what the ceil guards.
  const viewports = [
    { name: '390', viewport: 844 },
    { name: '1440', viewport: 900 },
  ];
  for (const { name, viewport } of viewports) {
    const tops = [0, 1, 2, 3, 4].map((i) => i * viewport + 37);
    const map = measureScrollMap({
      stations: tops.map((top, i) => ({ top, scrollMarginTop: MARGIN, hold: HOLDS[i] })),
      viewport,
      documentHeight: tops[4] + viewport,
    });
    it(`lands every station on its integer at ${name}`, () => {
      for (let i = 0; i < tops.length; i += 1) {
        const y = stationScrollTarget(map, i);
        expect(Math.abs(y - scrollFromProgress(map, i))).toBeLessThanOrEqual(1);
        const exact = progressFromScroll(map, y);
        expect(Math.floor(exact)).toBe(i);
        expect(exact - i).toBeLessThan(0.005);
      }
    });
    it(`documents why the fragment offset was wrong for plain stations at ${name}`, () => {
      for (let i = 1; i < tops.length - 1; i += 1) {
        const fragment = tops[i] - MARGIN; // the browser fragment landing (the last station clamps to the end)
        const exact = progressFromScroll(map, fragment);
        if (HOLDS[i]) expect(exact).toBe(i);
        else expect(exact - i).toBeGreaterThan(0.1);
      }
    });
  }
});
