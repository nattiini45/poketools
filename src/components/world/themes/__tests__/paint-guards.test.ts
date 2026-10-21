import { describe, expect, it } from 'vitest';
import type { BoardContent, BoardTableRow } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  paintFlagshipBoard,
  BOARD_TEX_W as CLOUDS_W,
  BOARD_TEX_H as CLOUDS_H,
} from '@/components/world/themes/clouds/content/paint';
import {
  paintPlaque,
  PLAQUE_TEX_W as MOUNTAIN_PLAQUE_W,
  PLAQUE_TEX_H as MOUNTAIN_PLAQUE_H,
} from '@/components/world/themes/mountain/content/paint';

/**
 * Paint-module geometry guards beyond the empty-state copy (that discipline
 * lives in `hero-empty-states.test.ts`, whose recording-context pattern this
 * file reuses): the clouds LIVE-pill masthead cap (pill law — the
 * cap must be measured at the px the masthead is PAINTED at, and the final
 * width clamped to a real rect) and the mountain rule plaque's totality on
 * an empty rule list. The plaque test pins OUTPUT TOTALITY (masthead paints,
 * no columns, finite coordinates) — it cannot detect a regression of the
 * guarded divide itself, because with zero rows `colW` is never read on
 * either the guarded or the unguarded painter.
 */

// ── Recording 2D context ──────────────────────────────────────────

interface Recording {
  texts: string[];
  /** Font px each `fillText` was painted at, parallel to `texts`. */
  fonts: number[];
  /** [x, y] each `fillText` was painted at, parallel to `texts`. */
  positions: Array<[number, number]>;
  /** Args of each `arcTo` — the `roundRect` helper draws a pill with four. */
  arcs: number[][];
}

/**
 * A stub that records every painted string, its px and position, plus the
 * roundRect corner arcs. `measureText` is proportional to length (× 0.55 em)
 * so `fillTextFitted` / `wrapWords` take their real branches.
 */
function recordingContext(rec: Recording): CanvasRenderingContext2D {
  let fontPx = 16;
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string, x: number, y: number) => {
      rec.texts.push(String(text));
      rec.fonts.push(fontPx);
      rec.positions.push([x, y]);
    },
    strokeText: noop,
    measureText: (text: string) => ({ width: String(text).length * fontPx * 0.55 }),
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: (...args: number[]) => {
      rec.arcs.push(args);
    },
    stroke: noop,
    fill: noop,
    setLineDash: noop,
    translate: noop,
    scale: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  Object.defineProperty(ctx, 'font', {
    get: () => `${fontPx}px`,
    set: (value: string) => {
      fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(String(value))?.[1] ?? 16);
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

/** The station font clamp, at each painter's own pose-derived floor. */
function toolsAt(floorPx: number): BoardPaintTools {
  return { fontPx: (n: number) => Math.max(Math.ceil(n), floorPx), fontFloorPx: floorPx };
}

// ── Clouds LIVE pill ──────────────────────────────────────────────

function row(name: string, points: number): BoardTableRow {
  return { name, points, wins: points, losses: 1, draws: 0, diff: 2, rankChange: null };
}

function contentWithLive(league: string, home: string, away: string): BoardContent {
  const table = [row('WELLS', 12), row('AY', 10), row('HART', 9)];
  return {
    league,
    stage: 'Second Half',
    round: 2,
    participants: 12,
    completed: 75,
    top: table.slice(0, 4),
    table,
    live: { home, away },
    upcoming: [],
    later: [],
    results: [],
    lastMatchday: [],
    lastMatchdayLabel: null,
    next: null,
    locale: 'en',
  };
}

const CLOUDS_COLORS = { field: '#132a3d', accent: '#f0c46a', ink: '#eef6ff' };
/** The flagship station's painter floor (hero-empty-states pins the same). */
const CLOUDS_FLOOR = 40;

function paintClouds(content: BoardContent, rec: Recording): void {
  paintFlagshipBoard(recordingContext(rec), CLOUDS_W, CLOUDS_H, content, CLOUDS_COLORS, toolsAt(CLOUDS_FLOOR));
}

/**
 * The pill rect from the roundRect arcTo signature: the first corner arc
 * starts at the right edge, the second ends at the left edge. With a
 * populated table the pill is the only roundRect on the board.
 */
function pillRect(rec: Recording): { x: number; w: number } {
  const right = rec.arcs[0][0];
  const left = rec.arcs[1][2];
  return { x: left, w: right - left };
}

describe('clouds LIVE pill cap law', () => {
  it('caps the pill at the masthead end measured at the PAINTED 52 px', () => {
    const league = 'SKYISLE LONGHAUL CIRCUIT';
    const rec: Recording = { texts: [], fonts: [], positions: [], arcs: [] };
    paintClouds(contentWithLive(league, 'FEATHERSTONE', 'WINTERBOURNE'), rec);

    const pill = pillRect(rec);
    // The stub measures length × px × 0.55; the masthead paints at
    // fontPx(52) = 52 at this floor. A cap measured at the 26 px label font
    // (floored to 40) under-measures the end and lets the pill cross it.
    const mastheadEnd = 56 + league.toUpperCase().length * 52 * 0.55;
    expect(pill.x).toBeGreaterThanOrEqual(mastheadEnd + 8 - 0.01);
    expect(pill.w).toBeGreaterThanOrEqual(120);
  });

  it('clamps the pill to a real rect when a long league name eats the cap', () => {
    const league = 'CUMULONIMBUS INTER-ISLES LONGHAUL FREIGHT CIRCUIT CONFERENCE';
    const rec: Recording = { texts: [], fonts: [], positions: [], arcs: [] };
    paintClouds(contentWithLive(league, 'FEATHERSTONE', 'WINTERBOURNE'), rec);

    const pill = pillRect(rec);
    // Without the sakura-law 120 px floor the collapsed cap goes negative
    // here and the pill paints as an inverted rect off the canvas.
    expect(pill.w).toBeGreaterThanOrEqual(120);
    expect(Number.isFinite(pill.x)).toBe(true);
    expect(pill.x).toBeLessThanOrEqual(CLOUDS_W - 56);
  });

  it('paints the fitted label at the floored px', () => {
    const rec: Recording = { texts: [], fonts: [], positions: [], arcs: [] };
    paintClouds(contentWithLive('SKYISLE STANDINGS', 'FEATHERSTONE', 'WINTERBOURNE'), rec);

    const idx = rec.texts.findIndex((t) => t.startsWith('LIVE'));
    expect(idx).toBeGreaterThan(-1);
    expect(rec.fonts[idx]).toBeGreaterThanOrEqual(CLOUDS_FLOOR);
  });
});

// ── Mountain rule plaque, empty rows ──────────────────────────────

const MOUNTAIN_COLORS = { ground: '#ddd5c2', ink: '#2b2f26', accent: '#e8862e' };
/** The rules station's painter floor (the plaque doc's 59 px). */
const MOUNTAIN_FLOOR = 59;

function plaqueCopyWith(rows: [string, string][]): {
  title: string;
  rulesetName: string;
  rows: [string, string][];
  note: string | null;
} {
  return { title: 'RULES OF THE PASS', rulesetName: 'League Standard', rows, note: null };
}

describe('mountain rule plaque with an empty rule list', () => {
  it('paints the masthead, no columns, and only finite coordinates', () => {
    // Pins output totality only: with `rows: []` both colW consumers (the
    // hairline loop and the row forEach) are zero-iteration, so the guarded
    // divide is unobservable through this recording — removing the guard in
    // `mountain/content/paint.ts` keeps this green (PR #63 review).
    const rec: Recording = { texts: [], fonts: [], positions: [], arcs: [] };
    paintPlaque(
      recordingContext(rec),
      MOUNTAIN_PLAQUE_W,
      MOUNTAIN_PLAQUE_H,
      plaqueCopyWith([]),
      MOUNTAIN_COLORS,
      toolsAt(MOUNTAIN_FLOOR),
    );

    // trackedText paints the title glyph by glyph (spaces included); the
    // ruleset name is one call.
    expect(rec.texts.join('')).toContain('RULES OF THE PASS');
    expect(rec.texts).toContain('LEAGUE STANDARD');
    expect(rec.texts.some((t) => t.includes('Draft'))).toBe(false);
    for (const [x, y] of rec.positions) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  it('still paints one carved column per row when rows exist', () => {
    const rec: Recording = { texts: [], fonts: [], positions: [], arcs: [] };
    paintPlaque(
      recordingContext(rec),
      MOUNTAIN_PLAQUE_W,
      MOUNTAIN_PLAQUE_H,
      plaqueCopyWith([
        ['Draft budget', '180 pts'],
        ['Lines each', '9'],
        ['Tera — stage 1', 'Free Tera'],
        ['Banned moves', '5'],
      ]),
      MOUNTAIN_COLORS,
      toolsAt(MOUNTAIN_FLOOR),
    );

    // Labels wrap at the floored px, so match on the value column and a
    // label word rather than the full label string.
    expect(rec.texts).toContain('180 pts');
    expect(rec.texts).toContain('Free Tera');
    expect(rec.texts.some((t) => t.includes('Draft'))).toBe(true);
  });
});
