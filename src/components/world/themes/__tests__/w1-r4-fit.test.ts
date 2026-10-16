import { describe, expect, it } from 'vitest';
import type { CameraEndpoint, Vec3 } from '@/lib/route-world/chapters';
import { landedEndpoint } from '@/lib/route-world/legibility';
import {
  accentRowTarget,
  contrastRatio,
  glueShortTokens,
  lineStep,
  readableAccent,
  relativeLuminance,
  stackStep,
  TEXT_BOX_DESCENT_EM,
} from '@/lib/route-world/board-text';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { WorldPalette } from '@/lib/route-world/palette';
import type { BoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import { mountainPaletteExtension } from '@/components/world/themes/mountain/theme-palette';
import { sakuraPaletteExtension } from '@/components/world/themes/sakura/theme-palette';
import {
  BANNER_TEX_H,
  BANNER_TEX_W,
  bannerBandInk,
  buildFestivalBannerPayloads,
  paintBanner,
} from '@/components/world/themes/sakura/content/paint';
import { SAKURA_STATIONS } from '@/components/world/themes/sakura/theme';
import { BANNERS, bannerRowFor } from '@/components/world/themes/sakura/furniture/layout';
import {
  BOARD_TEX_W,
  buildTrailSignPayloads,
  paintSummitBoard,
  paintTrailSign,
  SUMMIT_FOOTER_AIR_EM,
  SUMMIT_KICKER_Y,
  SUMMIT_PILL_TITLE_GAP,
  SUMMIT_SILL_LIP_Y,
  summitFooterLayout,
  summitMastheadLayout,
  TRAIL_SIGN_INK,
  TRAIL_SIGN_WOOD,
} from '@/components/world/themes/mountain/content/paint';

/** Fidelity W1 r4 — the sakura banner row at the landed 390 frame; the summit footer's air. */

function ndcX(endpoint: CameraEndpoint, aspect: number, p: Vec3): number {
  const [ex, ey, ez] = endpoint.position;
  const f = [endpoint.target[0] - ex, endpoint.target[1] - ey, endpoint.target[2] - ez];
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fw = [f[0] / fl, f[1] / fl, f[2] / fl];
  const rl = Math.hypot(fw[0], fw[2]);
  const rw = [-fw[2] / rl, 0, fw[0] / rl];
  const d = [p[0] - ex, p[1] - ey, p[2] - ez];
  const depth = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
  return (d[0] * rw[0] + d[2] * rw[2]) / depth / (Math.tan((endpoint.fov * Math.PI) / 360) * aspect);
}

/** FestivalBanners.tsx's mount: row yaw, arm height, cloth z, 1:3 cloth hung from the arm. */
const ROW_YAW = Math.atan2(1.2 - BANNERS.x, -3.4 - BANNERS.z);
const ARM_Y = 6.5;
const CLOTH_Z = 0.075;

function rowPoint(lx: number, y: number): Vec3 {
  const c = Math.cos(ROW_YAW);
  const s = Math.sin(ROW_YAW);
  return [BANNERS.x + lx * c + CLOTH_Z * s, y, BANNERS.z - lx * s + CLOTH_Z * c];
}

/** Each cloth's projected [left, right] ndcX span, west → east. */
function clothSpans(mobile: boolean, endpoint: CameraEndpoint, aspect: number): Array<[number, number]> {
  const { clothW, pitch } = bannerRowFor(mobile);
  return Array.from({ length: BANNERS.count }, (_, i) => {
    const cx = (i - (BANNERS.count - 1) / 2) * pitch;
    const xs = [-clothW / 2, clothW / 2].flatMap((ex) =>
      [ARM_Y - 0.06, ARM_Y - 0.06 - clothW * 3].map((y) => ndcX(endpoint, aspect, rowPoint(cx + ex, y))),
    );
    return [Math.min(...xs), Math.max(...xs)];
  });
}

describe('sakura schedule banners fit the landed 390 frame (r3: FIXTURES / TABLE cut at the edges)', () => {
  const station = SAKURA_STATIONS[3];
  const landed = landedEndpoint(station.cameraMobile);
  const aspect = 390 / 844;
  const pxPerNdc = 390 / 2;

  it('the desktop row really overflowed the landed frame', () => {
    const spans = clothSpans(false, landed, aspect);
    expect(spans[0][0]).toBeLessThan(-1);
    expect(spans[spans.length - 1][1]).toBeGreaterThan(1);
  });

  it('the mobile row keeps ≥ 12 px of margin on both sides', () => {
    const spans = clothSpans(true, landed, aspect);
    expect((spans[0][0] + 1) * pxPerNdc).toBeGreaterThanOrEqual(12);
    expect((1 - spans[spans.length - 1][1]) * pxPerNdc).toBeGreaterThanOrEqual(12);
  });

  it('every mobile seam keeps ≥ 5 px of air (the cloths never merge into one sheet)', () => {
    const spans = clothSpans(true, landed, aspect);
    for (let i = 1; i < spans.length; i += 1) {
      expect((spans[i][0] - spans[i - 1][1]) * pxPerNdc).toBeGreaterThanOrEqual(5);
    }
  });

  it('the desktop row is unchanged (2.0 m cloths at the 2.3 m pitch)', () => {
    expect(bannerRowFor(false)).toEqual({ clothW: 2.0, pitch: BANNERS.spacing });
  });
});

describe('summit footer keeps ≥ 0.6 em above the sill lip (r3: descenders on the bezel)', () => {
  for (const floor of [26, 35, 43, 48]) {
    it(`floor ${floor}: descenders clear the lip by ${SUMMIT_FOOTER_AIR_EM} em`, () => {
      const { baseline, stripTop } = summitFooterLayout(floor);
      expect(SUMMIT_SILL_LIP_Y - (baseline + floor * 0.2)).toBeGreaterThanOrEqual(floor * SUMMIT_FOOTER_AIR_EM - 1);
      expect(stripTop).toBeLessThan(baseline - floor * 0.8);
    });
  }

  it('at the 43 px pulse floor all eight standings rows still fit above the strip', () => {
    const px = 43;
    const kickerY = 52;
    const leagueY = Math.max(112, kickerY + stackStep(px, 52));
    const headerY = leagueY + stackStep(52, px);
    const rowH = Math.max(50, lineStep(px));
    const rowStart = headerY + stackStep(px, px);
    const rowLimit = summitFooterLayout(px).stripTop - Math.ceil(px * TEXT_BOX_DESCENT_EM) - 2;
    expect(rowStart + 7 * rowH).toBeLessThanOrEqual(rowLimit);
  });
});

// ── Fidelity W1 r5 ────────────────────────────────────────────────

/** A 2D context stand-in: records every text run and rect, measures 0.6 em per glyph. */
interface Painted {
  texts: { text: string; x: number; y: number; squeeze: number; font: string }[];
  rects: number;
}

function recordingContext(out: Painted): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  let squeeze = 1;
  const stack: number[] = [];
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string, x: number, y: number) => out.texts.push({ text: String(text), x, y, squeeze, font }),
    measureText: (text: string) => ({ width: Array.from(String(text)).length * px() * 0.6 }),
    fillRect: () => {
      out.rects += 1;
    },
    save: () => stack.push(squeeze),
    restore: () => {
      squeeze = stack.pop() ?? 1;
    },
    scale: (sx: number) => {
      squeeze *= sx;
    },
    translate: noop,
    setLineDash: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    quadraticCurveTo: noop,
    stroke: noop,
    fill: noop,
    fillStyle: '',
    strokeStyle: '',
    textAlign: 'left',
    globalAlpha: 1,
    lineWidth: 1,
  };
  Object.defineProperty(ctx, 'font', {
    get: () => font,
    set: (value: string) => {
      font = value;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

const toolsAt = (floorPx: number): BoardPaintTools => ({
  fontPx: (n: number) => Math.max(Math.ceil(n), floorPx),
  fontFloorPx: floorPx,
});

describe('summit masthead: the LIVE pill never touches the league title (r4: ")" on the pill)', () => {
  const title = 'MOUNTAIN PASS LEAGUE (PREVIEW)';
  // Desktop px (no floor) and the pose-derived floors the pulse station ships.
  for (const floor of [0, 43, 48]) {
    for (const pair of ['LIVE BELL–COLE', 'LIVE HOFSTETTER–WARRENBERG']) {
      it(`floor ${floor || 'none'} · "${pair}"`, () => {
        const kickerPx = Math.max(30, floor);
        const leaguePx = Math.max(52, floor);
        const labelPx = Math.max(26, floor);
        const m = summitMastheadLayout(BOARD_TEX_W, kickerPx, leaguePx, labelPx, pair.length * labelPx * 0.6);
        const pill = m.pill!;
        expect(pill.y).toBeGreaterThanOrEqual(4);
        const titleW = Math.min(title.length * leaguePx * 0.6, m.titleMaxW);
        const titleBox = { x: 56, y: m.leagueY - leaguePx * 0.8, w: titleW, h: leaguePx };
        const overlapsX = titleBox.x < pill.x + pill.w && pill.x < titleBox.x + titleBox.w;
        const overlapsY = titleBox.y < pill.y + pill.h + SUMMIT_PILL_TITLE_GAP && pill.y < titleBox.y + titleBox.h;
        expect(overlapsX && overlapsY).toBe(false);
        // The label's glyph box sits inside the pill.
        expect(pill.baseline - labelPx * 0.8).toBeGreaterThanOrEqual(pill.y);
        expect(pill.baseline + labelPx * 0.2).toBeLessThanOrEqual(pill.y + pill.h);
      });
    }
  }

  it('at desktop px and the 43 px floor the title keeps its full width (the pill is derived, not the title cut)', () => {
    for (const floor of [0, 43]) {
      const m = summitMastheadLayout(BOARD_TEX_W, Math.max(30, floor), Math.max(52, floor), Math.max(26, floor), 400);
      expect(m.titleMaxW).toBe(BOARD_TEX_W - 112);
      // The pill rides the kicker row: its baseline within 4 px of the kicker's.
      expect(Math.abs(m.pill!.baseline - SUMMIT_KICKER_Y)).toBeLessThanOrEqual(4);
    }
  });

  it('the painted board puts the pill label on the layout baseline', () => {
    const out: Painted = { texts: [], rects: 0 };
    const content = {
      league: 'Mountain Pass League (Preview)',
      stage: 'Second Half',
      round: 2,
      participants: 8,
      completed: 16,
      top: [],
      table: [],
      live: { home: 'BELL', away: 'COLE' },
      upcoming: [],
      later: [],
      results: [],
      lastMatchday: [],
      lastMatchdayLabel: null,
      next: null,
      locale: 'en',
    } as unknown as BoardContent;
    paintSummitBoard(
      recordingContext(out),
      BOARD_TEX_W,
      720,
      content,
      { field: '#1a2226', accent: '#e8862e', ink: '#f0f6f4' },
      toolsAt(43),
    );
    const label = out.texts.find((t) => t.text.startsWith('LIVE BELL'));
    const m = summitMastheadLayout(BOARD_TEX_W, 43, 52, 43, 'LIVE BELL–COLE'.length * 43 * 0.6);
    expect(label?.y).toBe(m.pill!.baseline);
  });
});

describe('trail-sign rows read on the re-toned, self-lit cloth (r4: cream accent ≈ 1.8:1)', () => {
  for (const dark of [false, true]) {
    const core = { ground: dark ? '#000000' : '#ffffff' } as unknown as WorldPalette;
    const accent = mountainPaletteExtension(core, dark).boardAccent;
    it(`${dark ? 'dark' : 'light'}: plain ink and accent rows ≥ 4.5:1 on the wood, accent darker than the wood`, () => {
      expect(contrastRatio(TRAIL_SIGN_INK, TRAIL_SIGN_WOOD)).toBeGreaterThanOrEqual(4.5);
      const row = readableAccent(accent, TRAIL_SIGN_WOOD, TRAIL_SIGN_INK);
      expect(contrastRatio(row, TRAIL_SIGN_WOOD)).toBeGreaterThanOrEqual(4.5);
      expect(relativeLuminance(row)).toBeLessThan(relativeLuminance(TRAIL_SIGN_WOOD));
    });
  }

  it('readableAccent never returns a colour lighter than a ground above 0.3 luminance (dark body ink)', () => {
    const grounds = ['#b1947a', '#c8b08a', '#e8dcc4', '#f6ecd9', '#a5a5a5', '#d0c090'];
    const accents = ['#e8862e', '#f0876f', '#ffd27a', '#c8323c', '#ffffff', '#ff9f80'];
    for (const ground of grounds) {
      expect(relativeLuminance(ground)).toBeGreaterThan(0.3);
      for (const accent of accents) {
        const row = readableAccent(accent, ground, '#1e160c');
        if (row !== accent) {
          expect(relativeLuminance(row), `${accent} on ${ground}`).toBeLessThan(relativeLuminance(ground));
        } else {
          expect(contrastRatio(row, ground)).toBeGreaterThanOrEqual(accentRowTarget(ground, '#1e160c'));
        }
      }
    }
  });
});

describe('sakura banner footer band ink (r4: grey on salmon ≈ 1.8:1 / 2.5:1)', () => {
  for (const dark of [false, true]) {
    it(`${dark ? 'dark' : 'light'}: "SAKURA PARK LEAGUE" clears 4.5:1 on the band`, () => {
      const core = { ground: dark ? '#000000' : '#ffffff' } as unknown as WorldPalette;
      const p = sakuraPaletteExtension(core, dark);
      const colors = { cloth: p.bannerCloth, ink: p.bannerInk, accent: p.toriiRed };
      const ink = bannerBandInk(colors);
      expect(contrastRatio(ink, colors.accent)).toBeGreaterThanOrEqual(4.5);
      // r4 painted the cloth colour on the band.
      expect(contrastRatio(ink, colors.accent)).toBeGreaterThan(contrastRatio(colors.cloth, colors.accent));
    });
  }
});

describe('mobile cloths: dashes as rects, no orphan tokens, no stranded records (r4 390 crops)', () => {
  const TABLE = ['WELLS', 'AY', 'KRAUS', 'HOFSTETTER'].map((name, i) => ({
    name,
    points: 12 - i * 3,
    wins: 4 - i,
    losses: i,
    draws: 0,
    diff: 3 - i,
    rankChange: i === 1 ? 1 : null,
  }));
  const content = {
    league: 'Sakura League',
    stage: 'Second Half',
    round: 2,
    participants: 8,
    completed: 16,
    top: TABLE,
    table: TABLE,
    live: { home: 'WELLS', away: 'AY' },
    upcoming: [{ home: 'HOFSTETTER', away: 'AY', date: '9/17', time: '18:00', status: 'live', matchday: 2 }],
    later: [{ home: 'WELLS', away: 'AY', date: '9/24', time: '18:00', status: 'upcoming', matchday: 3 }],
    results: [{ home: 'MARSH', away: 'HOLT', score: '2–1', date: '9/10', winner: 'home' }],
    lastMatchday: [],
    lastMatchdayLabel: 'Second Half · Matchday 1',
    next: { date: '9/17', time: '18:00', iso: '2026-09-17T18:00:00Z' },
    locale: 'en',
  } as unknown as BoardContent;
  const duringKickoff = Date.parse('2026-09-17T18:30:00Z');
  const bannerColors = { cloth: '#f6ecd9', ink: '#3a2a22', accent: '#c8323c' };
  const signColors = { wood: TRAIL_SIGN_WOOD, ink: TRAIL_SIGN_INK, accent: '#e8862e' };

  /**
   * The runs painted on one baseline, joined with the rect dash between them
   * (a dashed line paints its parts as separate runs around each dash rect).
   * `weight` keeps only runs of that font weight (800 = pair/headline lines).
   */
  function linesOf(out: Painted, weight?: string): string[] {
    const byY = new Map<number, string>();
    for (const t of out.texts) {
      if (weight && !t.font.startsWith(weight)) continue;
      const prev = byY.get(t.y);
      byY.set(t.y, prev === undefined ? t.text : `${prev}–${t.text}`);
    }
    return [...byY.values()];
  }

  for (const floor of [33, 38, 42, 46]) {
    it(`@${floor} px: sakura banners and mountain signs`, () => {
      const cloths: { name: string; out: Painted }[] = [];
      for (const payload of buildFestivalBannerPayloads(content, duringKickoff)) {
        const out: Painted = { texts: [], rects: 0 };
        paintBanner(recordingContext(out), BANNER_TEX_W, BANNER_TEX_H, payload, bannerColors, toolsAt(floor));
        cloths.push({ name: `sakura ${payload.heading}`, out });
      }
      for (const payload of buildTrailSignPayloads(content, duringKickoff)) {
        const out: Painted = { texts: [], rects: 0 };
        paintTrailSign(recordingContext(out), 320, 960, payload, signColors, toolsAt(floor));
        cloths.push({ name: `mountain ${payload.heading}`, out });
      }
      for (const { name, out } of cloths) {
        for (const t of out.texts) {
          // Every en dash is a rect — the font's glyph never ships.
          expect(t.text, name).not.toContain('–');
          // Condensation stays modest (a glued unit, never a crushed line).
          expect(t.squeeze, `${name}: ${t.text}`).toBeGreaterThanOrEqual(0.72);
        }
        for (const line of linesOf(out)) {
          const tokens = line.trim().split(/[  ]+/).filter(Boolean);
          // No line is a stranded short token ("2", "vs").
          if (tokens.length === 1) expect(Array.from(tokens[0]).length, `${name}: "${line}"`).toBeGreaterThan(2);
        }
      }
      // The table cloths never strand a W–L record on a headline line (r4
      // "1. WELLS" / "4–1"): a wrapping standing folds its record into the detail.
      for (const { name, out } of cloths.filter((c) => /TABLE/.test(c.name))) {
        for (const line of linesOf(out, '800')) expect(line.trim(), name).not.toMatch(/^\d+–\d+$/);
      }
    });
  }

  it('the PULSE footer keeps the live pairing whole on one baseline', () => {
    const pulse = buildFestivalBannerPayloads(content, duringKickoff).find((p) => p.heading === 'PULSE')!;
    const out: Painted = { texts: [], rects: 0 };
    paintBanner(recordingContext(out), BANNER_TEX_W, BANNER_TEX_H, pulse, bannerColors, toolsAt(42));
    const lines = linesOf(out);
    expect(lines.some((l) => l.includes('WELLS') && l.includes('AY'))).toBe(true);
    expect(lines.some((l) => /^MATCHDAY$/.test(l.trim()))).toBe(false);
  });

  it('glueShortTokens: the no-orphan units', () => {
    expect(glueShortTokens(['MATCHDAY', '2'])).toEqual(['MATCHDAY 2']);
    expect(glueShortTokens(['MD', '2', '·', '9/17', '18:00', '·', 'LIVE'])).toEqual([
      'MD 2',
      '·',
      '9/17',
      '18:00',
      '·',
      'LIVE',
    ]);
    expect(glueShortTokens(['HOFSTETTER', 'vs', 'AY'])).toEqual(['HOFSTETTER', 'vs AY']);
    // A short name leading a pairing chains through "vs" (r5 capture: "AY vs" / "OSMAN").
    expect(glueShortTokens(['AY', 'vs', 'OSMAN'])).toEqual(['AY vs OSMAN']);
    expect(glueShortTokens(['1.', 'WELLS', '·', '4–1'])).toEqual(['1. WELLS', '·', '4–1']);
    expect(glueShortTokens(['10', 'PTS', '▲1'])).toEqual(['10 PTS ▲1']);
  });
});
