import { describe, expect, it } from 'vitest';
import type { BoardContent, BoardTableRow } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { CameraEndpoint, Vec3 } from '@/lib/route-world/chapters';
import { landedEndpoint } from '@/lib/route-world/legibility';
import { MOUNTAIN_STATIONS } from '../../theme';
import { mountainPaletteExtension } from '../../theme-palette';
import type { WorldPalette } from '@/lib/route-world/palette';
import { contrastRatio, liveMatchPair, wrapFields } from '@/lib/route-world/board-text';
import {
  SIGN_SEATS,
  SIGN_SEATS_WIDE,
  SIGN_WIDE_PITCH,
  SIGN_CLOTH_W_MOBILE,
  signClothWidthFor,
  signLocalToWorld,
  signSeatsFor,
  type SignSeat,
} from '../../furniture/layout';
import {
  BOARD_TEX_H,
  BOARD_TEX_W,
  buildTrailSignPayloads,
  mountainKickoffStamp,
  paintSummitBoard,
  paintTrailSign,
  shortStageLabel,
  signBandInk,
  TRAIL_SIGN_INK,
  TRAIL_SIGN_WOOD,
} from '../paint';
import { paintText } from '@/components/world/themes/paint-copy';

// English test expectations, read from the locale functions (sweep: no test-only constants in source).
const SIGN_BAND_DEFAULT = paintText('en', 'heading.schedule');
const SUMMIT_KICKER_BRAND = paintText('en', 'brand.summit');
const SUMMIT_KICKER_BRAND_SHORT = paintText('en', 'brand.summitShort');

/** Fidelity W1 r2 — mountain sign row craft + summit kicker brand. */

const toolsAt = (floorPx: number): BoardPaintTools => ({
  fontPx: (n: number) => Math.max(Math.ceil(n), floorPx),
  fontFloorPx: floorPx,
});

interface Recording {
  texts: string[];
  positions: [number, number][];
}

/** A recording 2D context; text measures at 0.55 em per glyph (the W1 suite's model). */
function recordingContext(rec: Recording): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string, x: number, y: number) => {
      rec.texts.push(String(text));
      rec.positions.push([x, y]);
    },
    measureText: (text: string) => ({ width: String(text).length * px() * 0.55 }),
    fillRect: noop,
    strokeRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    quadraticCurveTo: noop,
    stroke: noop,
    fill: noop,
    translate: noop,
    scale: noop,
    setLineDash: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  Object.defineProperty(ctx, 'font', {
    get: () => font,
    set: (value: string) => {
      font = value;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

const TABLE: BoardTableRow[] = ['WELLS', 'AY', 'KRAUS', 'MARSH'].map((name, i) => ({
  name,
  points: 12 - i * 3,
  wins: 4 - i,
  losses: i,
  draws: 0,
  diff: 3 - i,
  rankChange: null,
}));

function content(overrides: Partial<BoardContent> = {}): BoardContent {
  return {
    league: 'Mountain Pass League (Preview)',
    stage: 'Second Half',
    round: 2,
    participants: 8,
    completed: 16,
    top: TABLE,
    table: TABLE,
    live: null,
    upcoming: [
      { home: 'HOFSTETTER', away: 'WELLS', date: '9/17', time: '18:00', status: 'live', matchday: 2 },
      { home: 'AY', away: 'KRAUS', date: '9/17', time: '18:00', status: 'upcoming', matchday: 2 },
    ],
    later: [{ home: 'WELLS', away: 'AY', date: '9/24', time: '18:00', status: 'upcoming', matchday: 3 }],
    results: [{ home: 'MARSH', away: 'HOLT', score: '2:1', date: '9/10', winner: 'home' }],
    lastMatchday: [],
    lastMatchdayLabel: 'Second Half · Matchday 1',
    next: { date: '9/17', time: '18:00', iso: '2026-09-17T18:00:00Z' },
    locale: 'en',
    ...overrides,
  };
}

describe('trail-sign bands are unique per sign (r1: five identical SCHEDULE kickers)', () => {
  it('every band differs, none repeats the station word, and each stays inside the band budget', () => {
    const payloads = buildTrailSignPayloads(content());
    const bands = payloads.map((payload) => payload.band ?? SIGN_BAND_DEFAULT);
    expect(bands).toEqual(['MATCHDAY 2', 'MATCHDAY 3', 'LATEST', 'SEASON', 'TOP 4']);
    expect(new Set(bands).size).toBe(bands.length);
    // "MOUNTAIN PASS" (13 glyphs) measured 305 px against the 288 px budget
    // at the 35 px floor; ≤ 11 glyphs stays inside it.
    for (const band of bands) expect(band.length).toBeLessThanOrEqual(11);
  });

  it('only fixture rows are pairings; fixture details drop the band-named matchday', () => {
    const [fixtures, upNext, results, pulse, table] = buildTrailSignPayloads(content());
    for (const payload of [fixtures, upNext, results]) {
      for (const row of payload.rows) expect(row.kind ?? 'match').toBe('match');
    }
    for (const row of [...pulse.rows, ...table.rows]) expect(row.kind).not.toBe('match');
    for (const row of [...fixtures.rows, ...upNext.rows]) expect(row.detail).not.toMatch(/\bMD \d/);
  });
});

describe('summit kicker keeps its brand with a LIVE pill (r1 lost SUMMIT STANDINGS)', () => {
  it('short stage form', () => {
    expect(shortStageLabel('Second Half')).toBe('2ND HALF');
    expect(shortStageLabel('first half')).toBe('1ST HALF');
    expect(shortStageLabel('Playoffs')).toBe('PLAYOFFS');
  });

  it('keeps a brand + "MD 2 · 2ND HALF" when the full line no longer fits beside the pill', () => {
    const rec: Recording = { texts: [], positions: [] };
    const colors = { field: '#1c2430', accent: '#e8862e', ink: '#f0f6f4' };
    paintSummitBoard(
      recordingContext(rec),
      BOARD_TEX_W,
      BOARD_TEX_H,
      content({ live: { home: 'LOFTY', away: 'MISTY' } }),
      colors,
      toolsAt(43),
    );
    expect(
      rec.texts.includes(`${SUMMIT_KICKER_BRAND} · `) || rec.texts.includes(`${SUMMIT_KICKER_BRAND_SHORT} · `),
    ).toBe(true);
    expect(rec.texts).toContain('MD 2 · 2ND HALF');
  });

  it('a short pill keeps the full brand with the short detail', () => {
    const rec: Recording = { texts: [], positions: [] };
    const colors = { field: '#1c2430', accent: '#e8862e', ink: '#f0f6f4' };
    paintSummitBoard(
      recordingContext(rec),
      BOARD_TEX_W,
      BOARD_TEX_H,
      content({ live: { home: 'WELLS', away: 'AY' } }),
      colors,
      toolsAt(43),
    );
    expect(rec.texts).toContain(`${SUMMIT_KICKER_BRAND} · `);
    expect(rec.texts).toContain('MD 2 · 2ND HALF');
  });

  it('keeps the full stage line when there is room', () => {
    const rec: Recording = { texts: [], positions: [] };
    const colors = { field: '#1c2430', accent: '#e8862e', ink: '#f0f6f4' };
    paintSummitBoard(recordingContext(rec), BOARD_TEX_W, BOARD_TEX_H, content(), colors, toolsAt(43));
    expect(rec.texts).toContain(`${SUMMIT_KICKER_BRAND} · `);
    expect(rec.texts).toContain('SECOND HALF · MATCHDAY 2');
  });

  it('paints the kicker in German for a German viewer (i18n D11)', () => {
    const rec: Recording = { texts: [], positions: [] };
    const colors = { field: '#1c2430', accent: '#e8862e', ink: '#f0f6f4' };
    paintSummitBoard(recordingContext(rec), BOARD_TEX_W, BOARD_TEX_H, content(), colors, toolsAt(43), 'de');
    expect(rec.texts).toContain('GIPFELTABELLE · ');
    // Sweep (T21): the stored English stage reads in the viewer's language.
    expect(rec.texts).toContain('RÜCKRUNDE · SPIELTAG 2');
    expect(shortStageLabel('Second Half', 'de')).toBe('RÜCKRUNDE');
  });
});

/** NDC x of a world point from an endpoint at an aspect (the rig's look-at frame). */
function ndcX(endpoint: CameraEndpoint, aspect: number, point: Vec3): number {
  const [ex, ey, ez] = endpoint.position;
  const f = [endpoint.target[0] - ex, endpoint.target[1] - ey, endpoint.target[2] - ez];
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fw = [f[0] / fl, f[1] / fl, f[2] / fl];
  const rl = Math.hypot(fw[2], fw[0]);
  const rw = [-fw[2] / rl, 0, fw[0] / rl];
  const d = [point[0] - ex, point[1] - ey, point[2] - ez];
  const depth = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
  const t = Math.tan((endpoint.fov * Math.PI) / 360);
  return (d[0] * rw[0] + d[2] * rw[2]) / depth / (t * aspect);
}

/** Each cloth's projected [min, max] ndcX (cloth corners at its top and bottom). */
function clothSpans(seats: readonly SignSeat[], endpoint: CameraEndpoint, aspect: number): [number, number][] {
  return seats.map((seat) => {
    const xs = [-1, 1].flatMap((ex) =>
      [1.04, 7.04].map((y) => ndcX(endpoint, aspect, signLocalToWorld(seat, [ex, y, 0.075]))),
    );
    return [Math.min(...xs), Math.max(...xs)];
  });
}

describe('sign seats per viewport (r1: the arc cost the 1440 row its air gaps)', () => {
  const schedule = MOUNTAIN_STATIONS.find((station) => station.id === 'schedule');

  it('desktop gets the flat 2.2 m row, mobile the arc', () => {
    expect(signSeatsFor(false)).toBe(SIGN_SEATS_WIDE);
    expect(signSeatsFor(true)).toBe(SIGN_SEATS);
    for (const seat of SIGN_SEATS_WIDE) expect(seat.lz).toBe(0);
    for (let i = 1; i < SIGN_SEATS_WIDE.length; i += 1) {
      expect(SIGN_SEATS_WIDE[i].lx - SIGN_SEATS_WIDE[i - 1].lx).toBeCloseTo(SIGN_WIDE_PITCH, 9);
    }
    expect(SIGN_WIDE_PITCH).toBeGreaterThanOrEqual(2.2);
  });

  it('at 1440 × 900 the flat row fits the frame and every neighbour pair keeps visible air', () => {
    expect(schedule).toBeDefined();
    const spans = clothSpans(SIGN_SEATS_WIDE, schedule!.camera, 1440 / 900);
    for (const [lo, hi] of spans) {
      expect(lo).toBeGreaterThan(-0.8);
      expect(hi).toBeLessThan(0.8);
    }
    const sorted = [...spans].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i += 1) expect(sorted[i][0] - sorted[i - 1][1]).toBeGreaterThan(0);
  });

  it('at the landed 390 pose the arc keeps every cloth in frame', () => {
    const spans = clothSpans(SIGN_SEATS, landedEndpoint(schedule!.cameraMobile), 390 / 844);
    for (const [lo, hi] of spans) {
      expect(lo).toBeGreaterThan(-1);
      expect(hi).toBeLessThan(1);
    }
  });
});

// ── Round 3: band ink contrast, 390 seams, live-aware tails ───────

describe('trail-sign band words read on the accent band (r2: wood on orange ≈ 1.5:1)', () => {
  // TrailSigns.tsx colours: TRAIL_SIGN_WOOD / TRAIL_SIGN_INK (r5 re-tone), accent = palette.boardAccent.
  for (const [theme, ground] of [
    ['light', '#ffffff'],
    ['dark', '#000000'],
  ] as const) {
    it(`${theme} theme: the band ink clears 4.5:1 against the accent`, () => {
      const accent = mountainPaletteExtension({ ground } as unknown as WorldPalette, theme === 'dark').boardAccent;
      const colors = { wood: TRAIL_SIGN_WOOD, ink: TRAIL_SIGN_INK, accent };
      const ink = signBandInk(colors);
      expect(contrastRatio(ink, accent)).toBeGreaterThanOrEqual(4.5);
      // The r2 colour (wood #8a6f4d on the band) really was the defect.
      expect(contrastRatio('#8a6f4d', accent)).toBeLessThan(3);
    });
  }

  it('the painted band word uses that ink', () => {
    const fills: string[] = [];
    const rec: Recording = { texts: [], positions: [] };
    const ctx = recordingContext(rec);
    const fillText = ctx.fillText.bind(ctx);
    ctx.fillText = ((text: string, x: number, y: number) => {
      fills.push(`${String(ctx.fillStyle)}|${text}`);
      fillText(text, x, y);
    }) as CanvasRenderingContext2D['fillText'];
    const colors = { wood: '#8a6f4d', ink: '#3a2c1c', accent: '#e8862e' };
    const [fixtures] = buildTrailSignPayloads(content());
    paintTrailSign(ctx, 320, 960, fixtures, colors, toolsAt(35));
    expect(fills).toContain(`${signBandInk(colors)}|MATCHDAY 2`);
  });
});

describe('mobile sign seams (r2: RESULTS and PULSE merged into one sheet at 390)', () => {
  it('every neighbour pair keeps a ≥ 4 px seam at the landed 390 pose and the row stays in frame', () => {
    const schedule = MOUNTAIN_STATIONS.find((station) => station.id === 'schedule')!;
    const endpoint = landedEndpoint(schedule.cameraMobile);
    const half = signClothWidthFor(true) / 2;
    const height = signClothWidthFor(true) * 3;
    expect(signClothWidthFor(true)).toBe(SIGN_CLOTH_W_MOBILE);
    const spans = SIGN_SEATS.map((seat) => {
      const xs = [-half, half].flatMap((x) =>
        [7.04 - height, 7.04].map((y) => ndcX(endpoint, 390 / 844, signLocalToWorld(seat, [x, y, 0.075]))),
      );
      return [Math.min(...xs), Math.max(...xs)] as const;
    });
    for (let i = 1; i < spans.length; i += 1) {
      // 390 CSS px span 2 NDC → 1 px = 2 / 390 NDC.
      expect((spans[i][0] - spans[i - 1][1]) * (390 / 2)).toBeGreaterThanOrEqual(4);
    }
    for (const [lo, hi] of spans) {
      expect(lo).toBeGreaterThan(-0.99);
      expect(hi).toBeLessThan(0.99);
    }
  });

  it('desktop keeps the 2.0 m cloth', () => {
    expect(signClothWidthFor(false)).toBe(2.0);
  });
});

describe('trail-sign tails follow the live ticker (r2: NEXT 9/17 18:00 under a LIVE row)', () => {
  const afterKickoff = Date.parse('2026-09-17T18:30:00Z');

  it('a live match after the kickoff: the fixtures tail names it, never the past stamp', () => {
    const [fixtures] = buildTrailSignPayloads(content({ live: { home: 'HOFSTETTER', away: 'WELLS' } }), afterKickoff);
    // Fidelity wave 2: the pairing sign's live tail says `vs` like its rows
    // (the rect dash between names read as `BELL = COLE` at 390).
    expect(fixtures.footer).toBe(`LIVE · ${liveMatchPair('HOFSTETTER', 'WELLS')}`);
  });

  it('no live match: the first FUTURE kickoff, or no tail at all', () => {
    const later = { date: '9/24', time: '18:00', iso: '2026-09-24T18:00:00Z' };
    const [withLater] = buildTrailSignPayloads(
      content({ kickoffs: [{ date: '9/17', time: '18:00', iso: '2026-09-17T18:00:00Z' }, later] }),
      afterKickoff,
    );
    expect(withLater.footer).toBe('NEXT KICKOFF · 9/24 18:00');
    const [none] = buildTrailSignPayloads(content(), afterKickoff);
    expect(none.footer).toBeNull();
  });

  it('before the kickoff the tail still says NEXT KICKOFF', () => {
    const [fixtures] = buildTrailSignPayloads(content(), Date.parse('2026-09-16T12:00:00Z'));
    expect(fixtures.footer).toBe('NEXT KICKOFF · 9/17 18:00');
  });

  it('the summit footer stamp follows the same order', () => {
    expect(mountainKickoffStamp(content({ live: { home: 'HOFSTETTER', away: 'WELLS' } }), afterKickoff)).toMatch(
      /^LIVE · HOFSTETTER – WELLS · /,
    );
    expect(mountainKickoffStamp(content(), afterKickoff)).not.toMatch(/9\/17 18:00/);
  });

  it('no sign line starts or ends with the field separator', () => {
    const measure = { measureText: (t: string) => ({ width: t.length * 35 * 0.55 }) };
    for (const payload of buildTrailSignPayloads(content(), afterKickoff)) {
      for (const text of [payload.footer ?? '', ...payload.rows.map((row) => row.detail)]) {
        for (const line of wrapFields(measure, text, 264, 2)) expect(line).not.toMatch(/^·|·$/);
      }
    }
  });
});
