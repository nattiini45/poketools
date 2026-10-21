import { describe, expect, it } from 'vitest';
import type { BoardContent, BoardTableRow } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import { lineStep } from '@/lib/route-world/board-text';
import {
  BOARD_TEX_H as CLOUDS_H,
  BOARD_TEX_W as CLOUDS_W,
  paintFixturesBoard,
  paintRegisterSail,
  registerSailNote,
  SAIL_TEX_H,
  SAIL_TEX_W,
} from '../paint';
import {
  BOARD_TEX_H as SAKURA_H,
  BOARD_TEX_W as SAKURA_W,
  paintBoardPage as paintSakuraStandings,
} from '@/components/world/themes/sakura/content/paint';

/**
 * Fidelity W1 r2 — audit issue 8 carried to the two boards r1 missed: the
 * clouds FIXTURES board and the sakura STANDINGS board painted the
 * "Second Half · Matchday 2" subtitle on its own baseline, on top of the
 * table header. Both now share the kicker baseline and stack the rest from
 * the painted px (the mountain summit / clouds flagship treatment).
 */

const toolsAt = (floorPx: number): BoardPaintTools => ({
  fontPx: (n: number) => Math.max(Math.ceil(n), floorPx),
  fontFloorPx: floorPx,
});

interface Line {
  text: string;
  x: number;
  y: number;
  px: number;
}

function recordingContext(lines: Line[]): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string, x: number, y: number) => lines.push({ text: String(text), x, y, px: px() }),
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

const TABLE: BoardTableRow[] = ['WELLS', 'AY', 'KRAUS', 'MARSH', 'HOLT', 'OTT', 'BRANDT', 'LANG'].map((name, i) => ({
  name,
  points: 21 - i * 3,
  wins: 7 - i,
  losses: i,
  draws: 0,
  diff: 7 - i * 2,
  rankChange: null,
}));

const fixture = (home: string, away: string, matchday: number) => ({
  home,
  away,
  date: '9/17',
  time: '18:00',
  status: 'upcoming' as const,
  matchday,
});

function content(overrides: Partial<BoardContent> = {}): BoardContent {
  return {
    league: 'Skyisle League',
    stage: 'Second Half',
    round: 2,
    participants: 8,
    completed: 16,
    top: TABLE.slice(0, 4),
    table: TABLE,
    live: null,
    upcoming: [fixture('A1', 'B1', 2), fixture('A2', 'B2', 2), fixture('A3', 'B3', 2), fixture('A4', 'B4', 2)],
    later: [fixture('A5', 'B5', 3), fixture('A6', 'B6', 3), fixture('A7', 'B7', 3)],
    results: [],
    lastMatchday: [],
    lastMatchdayLabel: null,
    next: null,
    locale: 'en',
    ...overrides,
  };
}

/** Each line's baseline clears the previous line's descent + its own ascent at ≥ 1.2 boxes. */
function expectStackedColumn(lines: Line[], x: number): void {
  const col = lines.filter((line) => line.x === x).sort((a, b) => a.y - b.y);
  const baselines = [...new Map(col.map((line) => [line.y, line])).values()];
  for (let i = 1; i < baselines.length; i += 1) {
    const above = baselines[i - 1];
    const below = baselines[i];
    const need = Math.ceil(above.px * 0.3 + below.px * 0.9);
    expect(below.y - above.y, `${above.text} → ${below.text}`).toBeGreaterThanOrEqual(need - 1);
  }
}

const COLORS = { field: '#0e1624', accent: '#e8922e', ink: '#eef6ff' };

describe('clouds FIXTURES board: subtitle on the kicker line, header stacked below', () => {
  it('at the 41 px schedule floor', () => {
    const lines: Line[] = [];
    paintFixturesBoard(recordingContext(lines), CLOUDS_W, CLOUDS_H, content(), COLORS, toolsAt(41));
    const stage = lines.find((line) => line.text === 'SECOND HALF · MATCHDAY 2');
    expect(stage?.y).toBe(74);
    expect(lines.some((line) => line.text === 'SKYISLE FIXTURES · ')).toBe(true);
    const header = lines.find((line) => line.text === 'MATCH');
    const league = lines.find((line) => line.text === 'SKYISLE LEAGUE');
    expect(header && league).toBeTruthy();
    // Header clears the league line (and the accent rule between them).
    expect(header!.y - league!.y).toBeGreaterThanOrEqual(lineStep(41));
    expectStackedColumn(lines, 56);
    // Seven rows, the last clear of the 72 px footer strip.
    const rows = lines.filter((line) => /^A\d vs B\d$/.test(line.text));
    expect(rows).toHaveLength(7);
    expect(Math.max(...rows.map((row) => row.y)) + 18).toBeLessThanOrEqual(CLOUDS_H - 72);
  });
});

describe('sakura STANDINGS board: subtitle on the kicker line, header stacked below', () => {
  it('at the 39 px pulse floor', () => {
    const lines: Line[] = [];
    paintSakuraStandings(recordingContext(lines), SAKURA_W, SAKURA_H, content(), COLORS, toolsAt(39));
    const stage = lines.find((line) => line.text === 'SECOND HALF · MATCHDAY 2');
    expect(stage?.y).toBe(74);
    expect(lines.some((line) => line.text === 'STANDINGS · ')).toBe(true);
    const header = lines.find((line) => line.text === '#');
    const league = lines.find((line) => line.text === 'SKYISLE LEAGUE');
    expect(header!.y - league!.y).toBeGreaterThanOrEqual(lineStep(39) - 1);
    expectStackedColumn(lines, 56);
    const rows = lines.filter((line) => line.x === 56 && /^\d$/.test(line.text));
    expect(rows).toHaveLength(8);
    expect(Math.max(...rows.map((row) => row.y))).toBeLessThanOrEqual(SAKURA_H - 76 - 30);
  });
});

describe('clouds register sail note (r1 regression: truncated "…FULL ROS…")', () => {
  it('the painter-side note never points at the route-hidden section', () => {
    for (const [shown, total] of [
      [9, 92],
      [9, 9],
      [3, 3],
      [9, 10],
    ] as const) {
      expect(registerSailNote(shown, total)).not.toMatch(/BELOW/);
    }
    // Fidelity wave 2: the full-list panel lands in the same train — the note
    // promises every line; the close-up copy stays behind `fullListOnTap = false`.
    expect(registerSailNote(9, 92)).toBe('9 OF 92 LINES · TAP THE SAIL FOR ALL 92');
    expect(registerSailNote(9, 92, false)).toBe('9 OF 92 LINES · TAP TO READ UP CLOSE');
  });

  it('fits beside the ROSTER heading whole (no ellipsis) at the sail floors', () => {
    for (const floor of [26, 40, 50]) {
      const lines: Line[] = [];
      paintRegisterSail(
        recordingContext(lines),
        SAIL_TEX_W,
        SAIL_TEX_H,
        [],
        { canvas: '#f4efe4', ink: '#16223a', accent: '#e8922e' },
        toolsAt(floor),
        registerSailNote(9, 92),
      );
      const note = lines.find((line) => line.text.includes('LINES'));
      expect(note?.text, `floor ${floor}`).toBe('9 OF 92 LINES · TAP THE SAIL FOR ALL 92');
    }
  });
});
