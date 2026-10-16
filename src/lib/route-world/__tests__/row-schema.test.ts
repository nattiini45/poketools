import { describe, expect, it } from 'vitest';
import { formatPack } from '@/lib/format-pack';
import type { PriceGroup } from '@/types/point-buy';

/** The active format pack's painted price-band word, upper-cased like the painters. */
const bandWord = (locale: 'en' | 'de', group: PriceGroup) =>
  formatPack.messages[locale].paint.priceBand[group].toLocaleUpperCase(locale);
import {
  autoFit,
  boardRowHeadline,
  boardRowTexts,
  dashedLineWidth,
  displayColor,
  EN_DASH_ASPECT,
  fitLinesCondensed,
  indexGutter,
  lineStep,
  linePillRect,
  measuredLeading,
  MIN_CONDENSE,
  MIN_LEADING,
  paintDashedLine,
  priceBandLabel,
  renderedContrast,
  rosterTapNote,
  signGlyphRects,
  signStrokePx,
  stackStep,
  TEXT_BOX_ASCENT_EM,
  TEXT_BOX_DESCENT_EM,
  umlautClears,
  UMLAUT_CAP_TOP_EM,
  type BoardRow,
  type LinePainter,
  type MatchRow,
  type StatRow,
  type TextMeasurer,
} from '../board-text';

/**
 * Fidelity wave 2 (seat 2E PAINT) — the painted-text law as units: the
 * MatchRow | StatRow schema split, the fixed index gutter, measured leading
 * ≥ 1.2, auto-fit then ellipsis, the ÄÖÜ glyph check, the dash that can
 * never read as `=`, the LIVE line pill, and the rendered-contrast model.
 */

/** Deterministic measurer: `em` × px per glyph (the tests' stand-in for a font). */
function measurer(px: () => number, em = 0.6): TextMeasurer {
  return { measureText: (text: string) => ({ width: Array.from(text).length * px() * em }) };
}

const VS = /(^|[\s ])vs([\s ]|$)/;

// ── Row schema ─────────────────────────────────────────────────────

describe('row schema: only a MatchRow is ever joined with "vs"', () => {
  const match: MatchRow = { home: 'WELLS', away: 'AY', detail: 'MD 2' };
  const stat: StatRow = { kind: 'stat', text: '8 TRAINERS', detail: '16 MATCHES PLAYED' };
  const standing: BoardRow = { kind: 'standing', rank: 1, name: 'WELLS', record: '4–1', detail: '12 PTS' };

  it('joins a match (explicit or legacy kind) with vs', () => {
    expect(boardRowHeadline(match)).toBe('WELLS vs AY');
    expect(boardRowHeadline({ ...match, kind: 'match' })).toBe('WELLS vs AY');
  });

  it('writes stat and standing rows whole — never a pairing, folded or not', () => {
    for (const row of [stat, standing]) {
      expect(boardRowHeadline(row)).not.toMatch(VS);
      for (const fits of [true, false]) {
        const texts = boardRowTexts(row, fits);
        expect(texts.headline).not.toMatch(VS);
        expect(texts.detail).not.toMatch(VS);
      }
    }
  });

  it('a stat row cannot carry fixture sides (compile-time schema split)', () => {
    // @ts-expect-error — `home`/`away` do not exist on a StatRow.
    const bad: StatRow = { kind: 'stat', text: '8 TRAINERS', detail: '', home: '8', away: 'TRAINERS' };
    expect(boardRowHeadline(bad)).toBe('8 TRAINERS');
  });
});

// ── Fixed index gutter ─────────────────────────────────────────────

describe('fixed index gutter', () => {
  it('starts every row on ONE column right of the widest painted index', () => {
    const px = 50;
    const ctx = measurer(() => px, 0.62);
    const labels = ['01', '02', '10', '99'];
    const gutter = indexGutter(ctx, labels, 16, 10, 62);
    for (const label of labels) expect(16 + ctx.measureText(label).width + 10).toBeLessThanOrEqual(gutter);
    expect(gutter).toBe(Math.ceil(16 + 2 * px * 0.62 + 10));
  });

  it('keeps the authored column when the measured one is narrower', () => {
    expect(indexGutter(measurer(() => 10), ['1'], 16, 10, 62)).toBe(62);
  });
});

// ── Measured leading ≥ 1.2 ─────────────────────────────────────────

describe('measured leading ≥ 1.2 × size', () => {
  it('holds for every px a floor can produce, same-size and stacked', () => {
    for (let px = 8; px <= 240; px += 1) {
      expect(measuredLeading(lineStep(px), px)).toBeGreaterThanOrEqual(MIN_LEADING);
      for (const below of [Math.round(px * 0.5), px, Math.round(px * 1.8)]) {
        // A stacked pair never steps less than the two line boxes need.
        expect(stackStep(px, below)).toBeGreaterThanOrEqual(
          Math.floor(px * TEXT_BOX_DESCENT_EM + below * TEXT_BOX_ASCENT_EM),
        );
      }
    }
  });
});

// ── ÄÖÜ glyph check ────────────────────────────────────────────────

describe('umlauts (the pack price-band words)', () => {
  it('German surfaces spell the price band with its umlaut; English never leaks the key', () => {
    for (const group of ['premium', 'hoch', 'mittel', 'guenstig', 'budget'] as const) {
      expect(priceBandLabel(group, 'de')).toBe(bandWord('de', group));
      expect(priceBandLabel(group.toUpperCase(), 'de')).toBe(bandWord('de', group));
    }
    expect(priceBandLabel('guenstig', 'en')).toBe(bandWord('en', 'guenstig'));
    for (const key of ['premium', 'hoch', 'mittel', 'guenstig', 'budget']) {
      expect(priceBandLabel(key, 'en')).not.toMatch(/Ü|GUENSTIG|MITTEL|HOCH/);
    }
  });

  it('a dotted capital under the line above keeps clear of its descenders at every px', () => {
    expect(TEXT_BOX_ASCENT_EM).toBeGreaterThanOrEqual(UMLAUT_CAP_TOP_EM - 0.03);
    for (let px = 8; px <= 240; px += 1) {
      expect(umlautClears(lineStep(px), px, px), `px ${px}`).toBe(true);
      expect(umlautClears(stackStep(px, Math.round(px * 0.7)), px, Math.round(px * 0.7))).toBe(true);
    }
    // The check has teeth: a 1.0 line step overprints the dots.
    expect(umlautClears(40, 40, 40)).toBe(false);
  });

  it('the plaza roster note is German with its umlaut', () => {
    expect(rosterTapNote(9, 30, 'de')).toBe('9 VON 30 · TIPPE FÜR ALLE 30 LINIEN');
    expect(rosterTapNote(30, 30, 'de')).toBe('TIPPE FÜR ALLE 30 LINIEN');
    expect(rosterTapNote(12, 30, 'en')).toBe('12 OF 30 LINES · TAP THE WALL FOR ALL 30');
    expect(rosterTapNote(9, 92, 'en', 'SAIL')).toBe('9 OF 92 LINES · TAP THE SAIL FOR ALL 92');
  });
});

// ── Auto-fit, then ellipsis ────────────────────────────────────────

describe('auto-fit, then ellipsis', () => {
  function fitter() {
    let px = 16;
    const ctx = measurer(() => px);
    return { ctx, setFont: (n: number) => (px = n) };
  }

  it('shrinks toward the floor before anything else', () => {
    const { ctx, setFont } = fitter();
    const fit = autoFit(ctx, setFont, 'MOUNTAIN PASS LEAGUE', 20 * 44 * 0.6, 52, 39);
    expect(fit).toEqual({ px: 44, squeeze: 1, text: 'MOUNTAIN PASS LEAGUE' });
  });

  it('then condenses at the floor, never below MIN_CONDENSE', () => {
    const { ctx, setFont } = fitter();
    const natural = 20 * 39 * 0.6;
    const fit = autoFit(ctx, setFont, 'MOUNTAIN PASS LEAGUE', natural * 0.8, 52, 39);
    expect(fit.px).toBe(39);
    expect(fit.text).toBe('MOUNTAIN PASS LEAGUE');
    expect(fit.squeeze).toBeCloseTo(0.8, 5);
  });

  it('only then cuts, keeping the distinguishing suffix', () => {
    const { ctx, setFont } = fitter();
    const fit = autoFit(ctx, setFont, 'GEODUDE-ALOLA', 13 * 40 * 0.6 * 0.5, 40, 40);
    expect(fit.squeeze).toBe(MIN_CONDENSE);
    expect(fit.text).toMatch(/…-ALOLA$/);
    expect(ctx.measureText(fit.text).width * fit.squeeze).toBeLessThanOrEqual(13 * 40 * 0.6 * 0.5);
  });

  it('never drops a word from a fixed-px brand band (the 390 "SAKURA / PARK" footer)', () => {
    const ctx = measurer(() => 40, 0.66);
    const width = (t: string) => ctx.measureText(t).width;
    // The 390 cloth: 264 px budget; "SAKURA PARK" alone overflows it.
    expect(width('SAKURA PARK')).toBeGreaterThan(264);
    const fit = fitLinesCondensed(ctx, 'SAKURA PARK LEAGUE', 264, 2);
    expect(fit.complete).toBe(true);
    expect(fit.lines.join(' ')).toBe('SAKURA PARK LEAGUE');
    fit.lines.forEach((line, i) => {
      expect(fit.squeeze[i]).toBeGreaterThanOrEqual(MIN_CONDENSE);
      expect(width(line) * fit.squeeze[i]).toBeLessThanOrEqual(264 + 1e-6);
    });
    // A band too narrow for two lines still returns every word (the caller grows).
    const tight = fitLinesCondensed(ctx, 'SAKURA PARK LEAGUE', 120, 2);
    expect(tight.complete).toBe(false);
    expect(tight.lines.join(' ')).toBe('SAKURA PARK LEAGUE');
  });
});

// ── The dash never reads as "=" ────────────────────────────────────

interface Op {
  readonly op: 'rect' | 'text';
  readonly style: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly text?: string;
}

function linePainter(ops: Op[], px: number): LinePainter {
  const ctx: LinePainter & { fillStyle: string } = {
    fillStyle: '#ink',
    measureText: (text: string) => ({ width: Array.from(text).length * px * 0.6 }),
    fillRect(x, y, w, h) {
      ops.push({ op: 'rect', style: String(this.fillStyle), x, y, w, h });
    },
    fillText(text, x, y) {
      ops.push({ op: 'text', style: String(this.fillStyle), x, y, w: 0, h: 0, text });
    },
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
  };
  return ctx;
}

describe('the rect dash is a bar, padded clear of the weave (W1 residual 2: `BELL = COLE`)', () => {
  it('is ≥ 3 strokes long and ≥ 2 shipped texels thick at the cloth floors', () => {
    for (const floor of [33, 35, 40, 41]) {
      const stroke = signStrokePx(floor, floor);
      const [bar] = signGlyphRects('–', 0, 100, floor, stroke).rects;
      expect(bar.w / bar.h).toBeGreaterThanOrEqual(EN_DASH_ASPECT - 0.01);
      // The cloths ship at 2× their painter space (640 × 1920 for 320 × 960).
      expect(bar.h * 2).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(bar.y) && Number.isInteger(bar.h)).toBe(true);
    }
  });

  it('clears a ground pad of one stroke above and below before the ink bar', () => {
    const ops: Op[] = [];
    const px = 40;
    const stroke = signStrokePx(px, px);
    paintDashedLine(linePainter(ops, px), '4–1', 28, 200, px, stroke, 500, { ground: '#cloth' });
    const rects = ops.filter((o) => o.op === 'rect');
    expect(rects).toHaveLength(2);
    const [pad, bar] = rects;
    expect(pad.style).toBe('#cloth');
    expect(bar.style).toBe('#ink');
    expect(pad.y).toBe(bar.y - stroke);
    expect(pad.h).toBe(bar.h + stroke * 2);
    // The ink is restored for the digits after the dash.
    expect(ops.filter((o) => o.op === 'text').every((o) => o.style === '#ink')).toBe(true);
  });

  it('minifies to ONE bar at the 390 density, with the weave painted under it', () => {
    // Coverage model: the woven cloth (2 px of 3.5 % ink every 6 px) with the
    // dash pad cleared, box-filtered at the landed-390 density at every phase.
    // The vertical profile through the bar must have a single peak — two
    // peaks is the `=` a visitor reported.
    const px = 40;
    const stroke = signStrokePx(px, px);
    const [bar] = signGlyphRects('–', 0, 100, px, stroke).rects;
    const H = 160;
    const ink = new Float64Array(H);
    for (let y = 0; y < H; y += 1) if (y % 6 < 2) ink[y] = 0.035;
    for (let y = bar.y - stroke; y < bar.y + bar.h + stroke; y += 1) ink[y] = 0;
    for (let y = bar.y; y < bar.y + bar.h; y += 1) ink[y] = 1;
    const factor = Math.round(px / 8);
    for (let phase = 0; phase < factor; phase += 1) {
      const profile: number[] = [];
      for (let s = phase; s + factor <= H; s += factor) {
        let sum = 0;
        for (let y = s; y < s + factor; y += 1) sum += ink[y];
        profile.push(sum / factor);
      }
      const peaks = profile.filter(
        (v, i) => v > 0.2 && v >= (profile[i - 1] ?? 0) && v > (profile[i + 1] ?? 0),
      );
      expect(peaks, `phase ${phase}`).toHaveLength(1);
    }
  });
});

// ── LIVE as a filled line pill ─────────────────────────────────────

describe('LIVE is a filled pill on a painted line', () => {
  const px = 40;
  const stroke = signStrokePx(px, px);
  const pill = { word: 'LIVE', fill: '#accent', ink: '#cloth' };

  it('paints a filled rect under the word in the pill ink, then restores the line ink', () => {
    const ops: Op[] = [];
    paintDashedLine(linePainter(ops, px), '18:00 · LIVE', 28, 300, px, stroke, 1000, { pill });
    const i = ops.findIndex((o) => o.text === 'LIVE');
    expect(i).toBeGreaterThan(0);
    expect(ops[i].style).toBe('#cloth');
    expect(ops[i - 1]).toMatchObject({ op: 'rect', style: '#accent' });
    // The pill is the separator: no stranded "·" before it.
    expect(ops.filter((o) => o.op === 'text').map((o) => o.text)).toEqual(['18:00 ', 'LIVE']);
    // The pill sits inside the line's own 1.2 box.
    const rect = ops[i - 1];
    expect(rect.y).toBeGreaterThanOrEqual(300 - px * TEXT_BOX_ASCENT_EM);
    expect(rect.y + rect.h).toBeLessThanOrEqual(300 + px * TEXT_BOX_DESCENT_EM);
  });

  it('counts the pill in the line width and matches only the whole word', () => {
    const ctx = linePainter([], px);
    const bare = dashedLineWidth(ctx, 'LIVE · WELLS vs AY', px, stroke);
    const dressed = dashedLineWidth(ctx, 'LIVE · WELLS vs AY', px, stroke, pill);
    const word = ctx.measureText('LIVE').width;
    expect(dressed).toBeGreaterThan(bare - ctx.measureText(' · ').width);
    expect(linePillRect(0, 100, word, px).w).toBeGreaterThan(word);
    const ops: Op[] = [];
    paintDashedLine(linePainter(ops, px), 'OLIVER vs LIVEN', 0, 100, px, stroke, 2000, { pill });
    expect(ops.some((o) => o.op === 'rect')).toBe(false);
  });
});

// ── Rendered contrast model ────────────────────────────────────────

describe('rendered-ground contrast model (self-lit face × AgX)', () => {
  it('reproduces the r5 measured white (201) and the failed footer (2.57:1)', () => {
    const white = displayColor('#ffffff', 0.95);
    expect(parseInt(white.slice(1, 3), 16)).toBeGreaterThanOrEqual(196);
    expect(parseInt(white.slice(1, 3), 16)).toBeLessThanOrEqual(206);
    const r5 = renderedContrast('#ffffff', '#c0392b', [0.95]);
    expect(r5).toBeGreaterThan(2.3);
    expect(r5).toBeLessThan(2.9);
  });

  it('is the worst case over the emissions and never passes an unparseable colour', () => {
    const both = renderedContrast('#000000', '#e04b38', [0.6, 0.95]);
    expect(both).toBeLessThanOrEqual(renderedContrast('#000000', '#e04b38', [0.95]));
    expect(renderedContrast('nope', '#ffffff', [1])).toBe(1);
  });
});
