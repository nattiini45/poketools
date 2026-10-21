import { describe, expect, it } from 'vitest';
import type { BoardContent, BoardTableRow } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  paintBoardPage as paintSakuraBoard,
  paintBanner as paintSakuraBanner,
  standingsEmptyState as sakuraEmptyState,
  BOARD_TEX_W as SAKURA_W,
  BOARD_TEX_H as SAKURA_H,
  BANNER_TEX_W as SAKURA_BANNER_W,
  BANNER_TEX_H as SAKURA_BANNER_H,
  type BannerPayload,
} from '@/components/world/themes/sakura/content/paint';
import {
  paintSummitBoard,
  paintTrailSign,
  standingsEmptyState as mountainEmptyState,
  BOARD_TEX_W as MOUNTAIN_W,
  BOARD_TEX_H as MOUNTAIN_H,
  SIGN_TEX_W as MOUNTAIN_SIGN_W,
  SIGN_TEX_H as MOUNTAIN_SIGN_H,
  type SignPayload,
} from '@/components/world/themes/mountain/content/paint';
import {
  paintFlagshipBoard,
  standingsEmptyState as cloudsEmptyState,
  BOARD_TEX_W as CLOUDS_W,
  BOARD_TEX_H as CLOUDS_H,
} from '@/components/world/themes/clouds/content/paint';
import { paintText } from '@/components/world/themes/paint-copy';

// English test expectations, read from the locale functions (sweep: no test-only constants in source).
const SAKURA_PAYLOAD_EMPTY_LINE = paintText('en', 'empty.nothingPosted');
const MOUNTAIN_PAYLOAD_EMPTY_LINE = paintText('en', 'empty.nothingPosted');

/**
 * The painted hero screens must never go blank (the plaza `paintEmptyState`
 * discipline, C3): a season with no results yet paints an authored stand-in
 * that says what the league is waiting for, and a season WITH results paints
 * the table and no placeholder. These tests drive the real painters through a
 * recording context, so they prove the wiring — not just the copy shaper.
 */

// ── Recording 2D context ──────────────────────────────────────────

interface Recording {
  texts: string[];
  /** Font px each `fillText` was painted at, parallel to `texts`. */
  fonts: number[];
}

/**
 * A stub that records every painted string and the px it was painted at.
 * `measureText` is proportional to length so `fillTextFitted` / `wrapWords`
 * take their real branches instead of degenerating.
 */
function recordingContext(rec: Recording): CanvasRenderingContext2D {
  let fontPx = 16;
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string) => {
      rec.texts.push(String(text));
      rec.fonts.push(fontPx);
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
    arcTo: noop,
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

/** The station font clamp, at each theme's own pose-derived painter floor. */
function toolsAt(floorPx: number): BoardPaintTools {
  return { fontPx: (n: number) => Math.max(Math.ceil(n), floorPx), fontFloorPx: floorPx };
}

// ── Fixtures ──────────────────────────────────────────────────────

function row(name: string, points: number, rankChange: number | null): BoardTableRow {
  return { name, points, wins: points, losses: 1, draws: 0, diff: 2, rankChange };
}

function content(table: BoardTableRow[], participants = 12): BoardContent {
  return {
    league: 'Type Triangle League',
    stage: 'Second Half',
    round: 2,
    participants,
    completed: table.length > 0 ? 75 : 0,
    top: table.slice(0, 4),
    table,
    live: null,
    upcoming: [],
    later: [],
    results: [],
    lastMatchday: [],
    lastMatchdayLabel: null,
    next: null,
    locale: 'en',
  };
}

const POPULATED = [row('WELLS', 12, 1), row('AY', 10, -1), row('HART', 9, null)];
const EMPTY = content([]);

const HEADLINE = 'NO TABLE YET';
/** The standings column header — painted only when there are rows to head. */
const TABLE_HEADER = 'TRAINER';

// ── The copy shaper ───────────────────────────────────────────────

describe('standingsEmptyState', () => {
  const shapers = { sakura: sakuraEmptyState, mountain: mountainEmptyState, clouds: cloudsEmptyState };

  it.each(Object.entries(shapers))('%s returns null once the table has a row', (_theme, shape) => {
    expect(shape(content(POPULATED))).toBeNull();
  });

  it.each(Object.entries(shapers))('%s names the waiting league', (_theme, shape) => {
    const state = shape(EMPTY);
    expect(state).not.toBeNull();
    expect(state?.headline).toBe(HEADLINE);
    expect(state?.copy).toMatch(/FIRST RESULTS$/);
  });

  it('keeps the headline identical across themes so the parity is testable', () => {
    expect(sakuraEmptyState(EMPTY)?.headline).toBe(mountainEmptyState(EMPTY)?.headline);
    expect(mountainEmptyState(EMPTY)?.headline).toBe(cloudsEmptyState(EMPTY)?.headline);
  });

  it('keeps the copy diegetic per theme rather than shared', () => {
    const copies = new Set(
      [sakuraEmptyState, mountainEmptyState, cloudsEmptyState].map((shape) => shape(EMPTY)?.copy),
    );
    expect(copies.size).toBe(3);
  });

  /**
   * The copy is painted through `fillTextFitted` inside a fixed box, so a
   * longer sentence silently ellipsizes at the station's font floor. Pin the
   * length against the narrowest box (1280 − 2×120 − 80 = 960 px) at the
   * highest floor (43 px, mountain) using the same 0.55 em average the
   * recording context measures with.
   */
  it.each(Object.entries(shapers))('%s copy fits the placeholder box at its floor', (_theme, shape) => {
    const copy = shape(EMPTY)?.copy ?? '';
    expect(copy.length * 43 * 0.55).toBeLessThanOrEqual(960);
  });
});

// ── The painters ──────────────────────────────────────────────────

interface HeroCase {
  theme: string;
  floorPx: number;
  paint: (content: BoardContent, rec: Recording) => void;
}

const HEROES: HeroCase[] = [
  {
    theme: 'sakura jumbotron rock',
    floorPx: 39,
    paint: (c, rec) =>
      paintSakuraBoard(
        recordingContext(rec),
        SAKURA_W,
        SAKURA_H,
        c,
        { field: '#0d2b33', accent: '#e8627a', ink: '#eafcff' },
        toolsAt(39),
      ),
  },
  {
    theme: 'mountain summit board',
    floorPx: 43,
    paint: (c, rec) =>
      paintSummitBoard(
        recordingContext(rec),
        MOUNTAIN_W,
        MOUNTAIN_H,
        c,
        { field: '#1d2a26', accent: '#e8862e', ink: '#f0f6f4' },
        toolsAt(43),
      ),
  },
  {
    theme: 'clouds flagship board',
    floorPx: 40,
    paint: (c, rec) =>
      paintFlagshipBoard(
        recordingContext(rec),
        CLOUDS_W,
        CLOUDS_H,
        c,
        { field: '#132a3d', accent: '#f0c46a', ink: '#eef6ff' },
        toolsAt(40),
      ),
  },
];

describe('hero standings screens never go blank', () => {
  it.each(HEROES)('$theme paints the authored stand-in on an empty season', ({ theme, floorPx, paint }) => {
    const rec: Recording = { texts: [], fonts: [] };
    paint(EMPTY, rec);

    expect(rec.texts, theme).toContain(HEADLINE);
    expect(rec.texts, `${theme} must not head an empty table`).not.toContain(TABLE_HEADER);
    // The placeholder is painted text on a board read from the station pose,
    // so it carries the same floor as real rows — nothing sub-floor ships.
    const headlinePx = rec.fonts[rec.texts.indexOf(HEADLINE)];
    expect(headlinePx, `${theme} headline below the ${floorPx} px floor`).toBeGreaterThanOrEqual(floorPx);
    const copyIndex = rec.texts.findIndex((t) => t.includes('FIRST RESULTS'));
    expect(copyIndex, `${theme} did not paint its waiting-for copy`).toBeGreaterThan(-1);
    expect(rec.fonts[copyIndex], `${theme} copy below the ${floorPx} px floor`).toBeGreaterThanOrEqual(floorPx);
    // `fillTextFitted` ellipsizes rather than overflowing — a truncated
    // placeholder would read as a bug, not as an authored empty state.
    expect(rec.texts[copyIndex], `${theme} copy ellipsized`).not.toContain('…');
  });

  it.each(HEROES)('$theme paints the table and no placeholder once results exist', ({ theme, paint }) => {
    const rec: Recording = { texts: [], fonts: [] };
    paint(content(POPULATED), rec);

    expect(rec.texts, theme).toContain(TABLE_HEADER);
    expect(rec.texts, `${theme} must not keep the placeholder`).not.toContain(HEADLINE);
    for (const row of POPULATED) expect(rec.texts, `${theme} missing ${row.name}`).toContain(row.name);
  });

  it.each(HEROES)('$theme still paints its footer stamp on an empty season', ({ paint }) => {
    const rec: Recording = { texts: [], fonts: [] };
    paint(EMPTY, rec);
    expect(rec.texts.some((t) => t.includes('MATCHES'))).toBe(true);
  });
});

// ── The schedule surfaces ─────────────────────────────────────────

describe('schedule surfaces say when they have nothing to post', () => {
  it('sakura banners paint the placeholder for an empty payload only', () => {
    const colors = { cloth: '#f6eadf', ink: '#3a2333', accent: '#e8627a' };
    const empty: BannerPayload = { heading: 'FIXTURES', rows: [], footer: null };
    const full: BannerPayload = {
      heading: 'FIXTURES',
      rows: [{ home: 'WELLS', away: 'AY', detail: '9/24 18:00' }],
      footer: null,
    };

    const emptyRec: Recording = { texts: [], fonts: [] };
    paintSakuraBanner(recordingContext(emptyRec), SAKURA_BANNER_W, SAKURA_BANNER_H, empty, colors, toolsAt(33));
    // The cloth is 320 px wide, so the placeholder wraps — rejoin on spaces
    // (every wrap point is a space) before matching.
    expect(emptyRec.texts.join(' ')).toContain(SAKURA_PAYLOAD_EMPTY_LINE);

    const fullRec: Recording = { texts: [], fonts: [] };
    paintSakuraBanner(recordingContext(fullRec), SAKURA_BANNER_W, SAKURA_BANNER_H, full, colors, toolsAt(33));
    expect(fullRec.texts).not.toContain(SAKURA_PAYLOAD_EMPTY_LINE);
    expect(fullRec.texts.join(' ')).toContain('WELLS');
  });

  it('mountain trail signs paint the placeholder for an empty payload only', () => {
    const colors = { wood: '#ddd5c2', ink: '#2b2f26', accent: '#e8862e' };
    const empty: SignPayload = { heading: 'FIXTURES', rows: [], footer: null };
    const full: SignPayload = {
      heading: 'FIXTURES',
      rows: [{ home: 'HART', away: 'AY', detail: '9/24 18:00' }],
      footer: null,
    };

    const emptyRec: Recording = { texts: [], fonts: [] };
    paintTrailSign(recordingContext(emptyRec), MOUNTAIN_SIGN_W, MOUNTAIN_SIGN_H, empty, colors, toolsAt(34));
    expect(emptyRec.texts.join(' ')).toContain(MOUNTAIN_PAYLOAD_EMPTY_LINE);

    const fullRec: Recording = { texts: [], fonts: [] };
    paintTrailSign(recordingContext(fullRec), MOUNTAIN_SIGN_W, MOUNTAIN_SIGN_H, full, colors, toolsAt(34));
    expect(fullRec.texts).not.toContain(MOUNTAIN_PAYLOAD_EMPTY_LINE);
    expect(fullRec.texts.join(' ')).toContain('HART');
  });

  it('both themes share the placeholder wording', () => {
    expect(SAKURA_PAYLOAD_EMPTY_LINE).toBe(MOUNTAIN_PAYLOAD_EMPTY_LINE);
  });
});
