import { describe, expect, it } from 'vitest';
import {
  accentRowTarget,
  contrastRatio,
  fitKeepingSuffix,
  liveUnderline,
  lineStep,
  paintDashPair,
  paintSignedNumber,
  readableAccent,
  SIGN_STROKE_SCREEN_PX,
  signGlyphRects,
  signStrokePx,
  stackStep,
  TEXT_BOX_ASCENT_EM,
  type GlyphPainter,
  type GlyphRect,
} from '../board-text';
import { READABLE_LINE_PX } from '../legibility';
import type { WorldPalette } from '../palette';
import { mountainPaletteExtension } from '@/components/world/themes/mountain/theme-palette';
import { sakuraPaletteExtension } from '@/components/world/themes/sakura/theme-palette';

/**
 * Fidelity W1 r4 — the shared sign-glyph law, the accent contrast guard and
 * the suffix-keeping fit.
 */

// ── Sign glyphs survive the 390 minification ──────────────────────

/** Rasterize rects into a painter-px coverage grid (1 = fully covered). */
function rasterize(rects: readonly GlyphRect[], w: number, h: number): Float64Array {
  const grid = new Float64Array(w * h);
  for (const r of rects) {
    for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(h, Math.ceil(r.y + r.h)); y += 1) {
      for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(w, Math.ceil(r.x + r.w)); x += 1) {
        const cx = Math.min(x + 1, r.x + r.w) - Math.max(x, r.x);
        const cy = Math.min(y + 1, r.y + r.h) - Math.max(y, r.y);
        grid[y * w + x] = Math.min(1, grid[y * w + x] + Math.max(0, cx) * Math.max(0, cy));
      }
    }
  }
  return grid;
}

/**
 * Box-filter the grid down to screen px (`factor` painter px per screen px,
 * sampled from phase `ox, oy`) — what the mip chain does to the face at the
 * landed 390 camera — and return a coverage lookup in painter coordinates.
 */
function minify(grid: Float64Array, w: number, h: number, factor: number, ox: number, oy: number) {
  return (px: number, py: number): number => {
    const sx = Math.floor((px - ox) / factor);
    const sy = Math.floor((py - oy) / factor);
    let sum = 0;
    let n = 0;
    for (let y = oy + sy * factor; y < oy + (sy + 1) * factor; y += 1) {
      for (let x = ox + sx * factor; x < ox + (sx + 1) * factor; x += 1) {
        n += 1;
        if (x >= 0 && y >= 0 && x < w && y < h) sum += grid[y * w + x];
      }
    }
    return n > 0 ? sum / n : 0;
  };
}

describe('sign glyphs are rects at the sign-stroke floor (r3: `+2` read `−2` at 390)', () => {
  it('the stroke floor renders ≥ 1.5 screen px wherever the font floor renders ≥ 8', () => {
    for (const floor of [29, 33, 39, 40, 43, 50]) {
      const stroke = signStrokePx(floor, floor);
      expect((stroke * READABLE_LINE_PX) / floor).toBeGreaterThanOrEqual(SIGN_STROKE_SCREEN_PX);
    }
  });

  it('both bars of `+` share one stroke and one length; `−` and `–` are the bar alone', () => {
    const plus = signGlyphRects('+', 0, 100, 40, 8).rects;
    expect(plus).toHaveLength(2);
    const [bar, stem] = plus;
    expect(bar.h).toBe(8);
    expect(stem.w).toBe(8);
    expect(stem.h).toBe(bar.w);
    // The stem is centred on the bar.
    expect(Math.abs(stem.x + stem.w / 2 - (bar.x + bar.w / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(stem.y + stem.h / 2 - (bar.y + bar.h / 2))).toBeLessThanOrEqual(1);
    expect(signGlyphRects('−', 0, 100, 40, 8).rects).toHaveLength(1);
    expect(signGlyphRects('–', 0, 100, 40, 8).rects).toHaveLength(1);
  });

  it('at the 390 floor the plus stem keeps ≥ 80 % of the bar coverage after minification, at every phase', () => {
    for (const floor of [33, 39, 40, 43]) {
      const px = floor; // the DIFF cell paints at the floor (28 requested → floored)
      const stroke = signStrokePx(px, floor);
      const { rects } = signGlyphRects('+', 8, px + 8, px, stroke);
      const [bar, stem] = rects;
      const W = Math.ceil(px * 2);
      const H = Math.ceil(px * 2);
      const grid = rasterize(rects, W, H);
      // Screen density at the binding pose: the floor renders READABLE_LINE_PX.
      const factor = Math.round(floor / READABLE_LINE_PX);
      for (let ox = 0; ox < factor; ox += 1) {
        for (let oy = 0; oy < factor; oy += 1) {
          const cov = minify(grid, W, H, factor, ox, oy);
          // Horizontal bar: peak over the bar's rows, left of the stem.
          let barPeak = 0;
          for (let y = bar.y; y < bar.y + bar.h; y += 1) {
            for (let x = bar.x; x < stem.x - factor; x += 1) barPeak = Math.max(barPeak, cov(x, y));
          }
          // Vertical stem: peak over the stem's columns, ABOVE the bar.
          let stemPeak = 0;
          for (let y = stem.y; y < bar.y - factor; y += 1) {
            for (let x = stem.x; x < stem.x + stem.w; x += 1) stemPeak = Math.max(stemPeak, cov(x, y));
          }
          expect(barPeak).toBeGreaterThan(0.5);
          expect(stemPeak).toBeGreaterThanOrEqual(0.8 * barPeak);
        }
      }
    }
  });

  function recorder() {
    const ops: string[] = [];
    const ctx: GlyphPainter = {
      measureText: (text: string) => ({ width: text.length * 20 }),
      fillRect: (x, y, w, h) => ops.push(`rect ${x},${y},${w},${h}`),
      fillText: (text, x) => ops.push(`text ${text}@${x}`),
    };
    return { ops, ctx };
  }

  it('paintSignedNumber paints the sign as rects and the digits as text', () => {
    const plus = recorder();
    paintSignedNumber(plus.ctx, 2, 100, 200, 40, 8);
    expect(plus.ops.filter((op) => op.startsWith('rect'))).toHaveLength(2);
    expect(plus.ops.filter((op) => op.startsWith('text'))).toEqual([expect.stringMatching(/^text 2@/)]);
    const minus = recorder();
    paintSignedNumber(minus.ctx, -3, 100, 200, 40, 8);
    expect(minus.ops.filter((op) => op.startsWith('rect'))).toHaveLength(1);
    expect(minus.ops).toContain('text 3@' + String(signGlyphRects('−', 100, 200, 40, 8).advance));
    const zero = recorder();
    paintSignedNumber(zero.ctx, 0, 100, 200, 40, 8);
    expect(zero.ops).toEqual(['text 0@100']);
    // No font sign glyph is ever painted.
    for (const op of [...plus.ops, ...minus.ops]) expect(op).not.toMatch(/[+−-]\d/);
  });

  it('paintDashPair paints `4–1` as text · rect · text, never a font dash', () => {
    const { ops, ctx } = recorder();
    paintDashPair(ctx, '4', '1', 50, 200, 40, 8);
    expect(ops[0]).toBe('text 4@50');
    expect(ops[1]).toMatch(/^rect /);
    expect(ops[2]).toMatch(/^text 1@/);
    expect(ops.join(' ')).not.toContain('–');
  });
});

// ── Accent rows read on light cloth ───────────────────────────────

function palettes() {
  return (['light', 'dark'] as const).map((theme) => {
    const core = { ground: theme === 'light' ? '#ffffff' : '#000000' } as unknown as WorldPalette;
    return {
      theme,
      mountain: mountainPaletteExtension(core, theme === 'dark'),
      sakura: sakuraPaletteExtension(core, theme === 'dark'),
    };
  });
}

describe('accent rows clear the cloth contrast target (r3: salmon on tan / cream)', () => {
  for (const { theme, mountain, sakura } of palettes()) {
    // TrailSigns.tsx: wood #8a6f4d, ink #3a2c1c; FestivalBanners.tsx: cloth/ink/toriiRed.
    const pairs = [
      { name: `mountain ${theme} trail sign`, accent: mountain.boardAccent, ground: '#8a6f4d', ink: '#3a2c1c' },
      { name: `sakura ${theme} banner`, accent: sakura.toriiRed, ground: sakura.bannerCloth, ink: sakura.bannerInk },
    ];
    for (const pair of pairs) {
      it(`${pair.name}: the accent row reads at least as well as the body ink (≤ AAA)`, () => {
        const ink = readableAccent(pair.accent, pair.ground, pair.ink);
        const target = accentRowTarget(pair.ground, pair.ink);
        expect(contrastRatio(ink, pair.ground)).toBeGreaterThanOrEqual(target);
        // Whenever the body ink clears AA, the accent row clears AA too.
        if (contrastRatio(pair.ink, pair.ground) >= 4.5) {
          expect(contrastRatio(ink, pair.ground)).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it('an accent that already passes is untouched; the shift keeps the hue family', () => {
    expect(readableAccent('#1a1a1a', '#ffffff', '#000000')).toBe('#1a1a1a');
    const shifted = readableAccent('#e8862e', '#8a6f4d', '#3a2c1c');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(shifted.slice(i, i + 2), 16));
    // Still orange-family: red > green > blue.
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('unparseable colours fall back to the body ink', () => {
    expect(readableAccent('rgb(1, 2, 3)', '#ffffff', '#222222')).toBe('#222222');
  });

  it('the live underline sits under the pair line and clear of the next line box', () => {
    for (const px of [33, 35, 38]) {
      const stroke = signStrokePx(px, px);
      const rule = liveUnderline(28, 300, 200, px, stroke);
      expect(rule.y).toBeGreaterThan(300);
      // Next line (detail at the same px, stacked by the text law): its glyph
      // tops sit 0.8 em above its baseline.
      const nextGlyphTop = 300 + stackStep(px, px) - Math.ceil(px * 0.8);
      expect(rule.y + rule.h).toBeLessThanOrEqual(nextGlyphTop);
      expect(lineStep(px)).toBeGreaterThan(rule.y + rule.h - 300);
      expect(TEXT_BOX_ASCENT_EM).toBeGreaterThan(0.8);
    }
  });
});

// ── Suffix-keeping fit ────────────────────────────────────────────

describe('fitKeepingSuffix (r3: `09 GEODUDE-A…` hid what told it from `08 GEODUDE`)', () => {
  const measure = { measureText: (text: string) => ({ width: text.length * 10 }) };

  it('returns a fitting name unchanged', () => {
    expect(fitKeepingSuffix(measure, 'GEODUDE', 100)).toBe('GEODUDE');
  });

  it('keeps the form suffix whole and cuts the head', () => {
    const fitted = fitKeepingSuffix(measure, 'GEODUDE-ALOLA', 110);
    expect(fitted.endsWith('-ALOLA')).toBe(true);
    expect(fitted).toContain('…');
    expect(fitted.length * 10).toBeLessThanOrEqual(110);
    expect(fitted).not.toBe('GEODUDE');
  });

  it('derives the suffix from the data (the last hyphen), for any name', () => {
    const fitted = fitKeepingSuffix(measure, 'ABCDEFGHIJ-XYZ', 90);
    expect(fitted.endsWith('-XYZ')).toBe(true);
  });

  it('falls back to the end ellipsis without a hyphen or when the tail alone overflows', () => {
    expect(fitKeepingSuffix(measure, 'ABCDEFGHIJKL', 60)).toMatch(/^ABCDE…$/);
    expect(fitKeepingSuffix(measure, 'AB-CDEFGHIJKLMN', 60).endsWith('…')).toBe(true);
  });
});
