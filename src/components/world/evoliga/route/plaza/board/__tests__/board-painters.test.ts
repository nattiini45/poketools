import { describe, expect, it } from 'vitest';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { BoardContent, BoardFixture } from '../board-content';
import {
  BOARD_TEX_H,
  BOARD_TEX_W,
  hiddenFixtures,
  paintScheduleBoard,
  pillContrast,
  scheduleGroupLabel,
  SPIELPLAN_NEXT_ROWS,
  statusPillInk,
  type BoardTheme,
} from '../board-painters';
import {
  FIELD_TEX_H,
  FIELD_TEX_W,
  friezeContrast,
  friezeInk,
  FRIEZE_MIN_CONTRAST,
  LEAD_ROW_INK,
  LEAD_ROW_LABEL_WEIGHT,
  paintFieldBoard,
} from '../../gate-painters';

/**
 * Fidelity W1 r4 — the LÄUFT pill's label contrast, the SPIELPLAN overflow
 * tail and the rules frieze inscription.
 */

/** The plaza `--poke-live` token per theme (globals.css). */
const LIVE_TOKENS = { light: '#166534', dark: '#4ADE80' } as const;

const toolsAt = (floorPx: number): BoardPaintTools => ({
  fontPx: (n: number) => Math.max(Math.ceil(n), floorPx),
  fontFloorPx: floorPx,
});

interface Op {
  kind: 'text' | 'fill';
  text?: string;
  style: string;
}

function recordingContext(ops: Op[]): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    measureText: (text: string) => ({ width: String(text).length * px() * 0.55 }),
    arc: noop,
    fillRect: noop,
    strokeRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    quadraticCurveTo: noop,
    rect: noop,
    roundRect: noop,
    stroke: noop,
    clip: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setLineDash: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '',
  };
  ctx.fillText = (text: string) => ops.push({ kind: 'text', text: String(text), style: String(ctx.fillStyle) });
  ctx.fill = () => ops.push({ kind: 'fill', style: String(ctx.fillStyle) });
  Object.defineProperty(ctx, 'font', {
    get: () => font,
    set: (value: string) => {
      font = value;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

const fixture = (home: string, away: string, status: BoardFixture['status'], matchday: number): BoardFixture => ({
  home,
  away,
  date: '17.9.',
  time: '18:00',
  status,
  matchday,
});

function content(overrides: Partial<BoardContent> = {}): BoardContent {
  return {
    league: 'EvoLiga',
    stage: 'Rückrunde',
    round: 2,
    participants: 8,
    completed: 16,
    top: [],
    table: [],
    live: null,
    upcoming: [],
    later: [],
    results: [],
    lastMatchday: [],
    lastMatchdayLabel: null,
    next: null,
    locale: 'de',
    ...overrides,
  };
}

describe('LÄUFT pill label contrast (r3: white on pale green ≈ 1.9:1 in the dark theme)', () => {
  for (const [theme, live] of Object.entries(LIVE_TOKENS)) {
    it(`${theme} theme: the pill label clears 4.5:1 against the pill fill`, () => {
      expect(pillContrast(statusPillInk(live), live)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the dark theme really was the defect, and the light theme keeps white', () => {
    expect(pillContrast('#ffffff', LIVE_TOKENS.dark)).toBeLessThan(4.5);
    expect(statusPillInk(LIVE_TOKENS.light)).toBe('#ffffff');
  });

  it('rgb() live tokens are measured too', () => {
    expect(pillContrast(statusPillInk('rgb(74, 222, 128)'), 'rgb(74, 222, 128)')).toBeGreaterThanOrEqual(4.5);
  });

  it('the painted SPIELPLAN pill label uses that ink on the live fill (dark theme)', () => {
    const ops: Op[] = [];
    const theme: BoardTheme = { kind: 'schedule', accent: '#f5b400', red: '#e3350d', live: LIVE_TOKENS.dark };
    paintScheduleBoard(
      recordingContext(ops),
      BOARD_TEX_W,
      BOARD_TEX_H,
      content({ upcoming: [fixture('BELL', 'COLE', 'live', 2)] }),
      theme,
      toolsAt(29),
    );
    const label = ops.find((op) => op.kind === 'text' && op.text === 'LÄUFT');
    expect(label).toBeDefined();
    expect(pillContrast(label?.style ?? '#ffffff', LIVE_TOKENS.dark)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('SPIELPLAN says when it hides fixtures (r3: the second SPIELTAG 3 pairing vanished)', () => {
  it('counts hidden rows from the uncapped total, else from the array', () => {
    expect(hiddenFixtures(4, 2, 1)).toBe(3);
    expect(hiddenFixtures(undefined, 2, 1)).toBe(1);
    expect(hiddenFixtures(1, 1, 1)).toBe(0);
  });

  it('labels the tail in the surface locale', () => {
    expect(scheduleGroupLabel('SPIELTAG', 3, 'DANACH', 1, 'de')).toBe('SPIELTAG 3 · DANACH · +1 WEITERE');
    expect(scheduleGroupLabel('SPIELTAG', 3, 'DANACH', 0, 'de')).toBe('SPIELTAG 3 · DANACH');
    expect(scheduleGroupLabel('MATCHDAY', 3, 'NEXT', 2, 'en')).toBe('MATCHDAY 3 · NEXT · +2 MORE');
  });

  it('the painted DANACH group carries +N WEITERE whenever later outruns SPIELPLAN_NEXT_ROWS', () => {
    const ops: Op[] = [];
    const later = [fixture('AYVAZ', 'ÖZDEMIR', 'upcoming', 3), fixture('BELL', 'COLE', 'upcoming', 3)];
    expect(later.length).toBeGreaterThan(SPIELPLAN_NEXT_ROWS);
    paintScheduleBoard(
      recordingContext(ops),
      BOARD_TEX_W,
      BOARD_TEX_H,
      content({ upcoming: [fixture('WELLS', 'REED', 'upcoming', 2)], later, laterTotal: 3 }),
      { kind: 'schedule', accent: '#f5b400', red: '#e3350d', live: LIVE_TOKENS.light },
      toolsAt(29),
    );
    const texts = ops.filter((op) => op.kind === 'text').map((op) => op.text);
    expect(texts).toContain(`SPIELTAG 3 · DANACH · +${3 - SPIELPLAN_NEXT_ROWS} WEITERE`);
    expect(texts).toContain('SPIELTAG 2 · AKTUELL');
  });
});

describe('rules frieze inscription reads on its stone (r3 light: white on pale stone ≈ 1.2:1)', () => {
  // ChallengeGate.tsx tone.dressed per theme, and the letter it hands the painter.
  const THEMES = [
    { theme: 'light', stone: '#e6dac4', letter: '#fffaf0' },
    { theme: 'dark', stone: '#9a938b', letter: '#f4ecd8' },
  ] as const;
  for (const { theme, stone, letter } of THEMES) {
    it(`${theme} theme: the inscription clears ${FRIEZE_MIN_CONTRAST}:1`, () => {
      expect(friezeContrast(friezeInk(stone, letter).letter, stone)).toBeGreaterThanOrEqual(FRIEZE_MIN_CONTRAST);
    });
  }

  it('the light theme was the defect; the dark theme keeps a pale letter', () => {
    expect(friezeContrast('#fffaf0', '#e6dac4')).toBeLessThan(2);
    const dark = friezeInk('#9a938b', '#f4ecd8');
    expect(friezeContrast(dark.letter, '#000000')).toBeGreaterThan(friezeContrast(dark.letter, '#ffffff'));
  });
});

describe('Regelwerk selected row: label in the value ink (wave-2 r3: "Draft-Budget" pale gold on gold)', () => {
  // ChallengeGate.tsx tone.brass per theme — the selected row's fill.
  const BRASS = { light: '#c99a45', dark: '#a8823f' } as const;

  for (const [theme, brass] of Object.entries(BRASS)) {
    it(`${theme} theme: the lead-row ink clears 4.5:1 on its brass`, () => {
      expect(friezeContrast(LEAD_ROW_INK, brass)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('paintFieldBoard draws the lead label and value in one dark ink at a heavy weight', () => {
    const calls: { text: string; fill: string; font: string }[] = [];
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      arcTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      measureText: (t: string) => ({ width: t.length * 10 }),
      fillText(text: string) {
        calls.push({ text, fill: String(this.fillStyle), font: this.font });
      },
    };
    const rows = [
      { label: 'Draft-Budget', value: '180 Punkte' },
      { label: 'Entwicklungslinien', value: '9' },
    ];
    paintFieldBoard('REGELWERK', 'Standard', rows, 'Draft-Budget', 'FOOT', BRASS.light)(
      ctx as unknown as CanvasRenderingContext2D,
      FIELD_TEX_W,
      FIELD_TEX_H,
    );
    const label = calls.find((c) => c.text === 'Draft-Budget');
    const value = calls.find((c) => c.text === '180 Punkte');
    expect(label?.fill).toBe(LEAD_ROW_INK);
    expect(value?.fill).toBe(LEAD_ROW_INK);
    expect(label?.font.startsWith(`${LEAD_ROW_LABEL_WEIGHT} `)).toBe(true);
    // Unselected rows keep the pale ink on the dark glass.
    expect(calls.find((c) => c.text === 'Entwicklungslinien')?.fill).not.toBe(LEAD_ROW_INK);
  });
});
