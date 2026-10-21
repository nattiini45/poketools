import { describe, expect, it } from 'vitest';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  BOARD_FIXTURE_ROWS,
  nextKickoffTicker,
  type BoardContent,
  type BoardFixture,
} from '../board-content';
import {
  BOARD_TEX_H,
  BOARD_TEX_W,
  paintPulseBoard,
  paintScheduleBoard,
  paintTableBoard,
  SCHEDULE_LABEL_AIR_EM,
  scheduleLayout,
  SPIELPLAN_NEXT_ROWS,
  TICKER_STRIP_H,
  type BoardTheme,
} from '../board-painters';

/** Fidelity W1 r2: plaza footer/ticker copy and the SPIELPLAN group air. */

const toolsAt = (floorPx: number): BoardPaintTools => ({
  fontPx: (n: number) => Math.max(Math.ceil(n), floorPx),
  fontFloorPx: floorPx,
});

interface Recording {
  texts: string[];
  positions: [number, number][];
}

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
    fill: noop,
    clip: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setLineDash: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
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
    top: [{ name: 'WELLS', points: 12, wins: 4, losses: 1, draws: 0, diff: 3, rankChange: null }],
    table: [{ name: 'WELLS', points: 12, wins: 4, losses: 1, draws: 0, diff: 3, rankChange: null }],
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

const PAST = { date: '17.9.', time: '18:00', iso: '2026-09-17T18:00:00Z' };
const FUTURE = { date: '24.9.', time: '18:00', iso: '2026-09-24T18:00:00Z' };
const NOW = Date.parse('2026-09-17T18:30:00Z');

describe('nextKickoffTicker never pairs JETZT with a past kickoff', () => {
  it('a live match past the stale next kickoff reads LÄUFT with the pairing', () => {
    const text = nextKickoffTicker(
      content({ next: PAST, kickoffs: [PAST, FUTURE], live: { home: 'HOFSTETTER', away: 'WELLS' } }),
      NOW,
    );
    expect(text).toBe('LÄUFT · HOFSTETTER — WELLS');
    expect(text).not.toContain('JETZT');
  });

  it('without a live match it counts down to the first kickoff still in the future', () => {
    const text = nextKickoffTicker(content({ next: PAST, kickoffs: [PAST, FUTURE] }), NOW);
    expect(text).toMatch(/^NÄCHSTER ANPFIFF IN 6 T \d\d:\d\d:\d\d · 24\.9\. 18:00 UHR$/);
    expect(text).not.toContain('17.9.');
  });

  it('with every kickoff past and nothing live it paints the season line, no stamp', () => {
    const text = nextKickoffTicker(content({ next: PAST, kickoffs: [PAST] }), NOW);
    expect(text).toBe('16 SPIELE GESPIELT · 8 TEILNEHMER');
  });

  it('a future next kickoff still counts down', () => {
    const text = nextKickoffTicker(content({ next: FUTURE, kickoffs: [FUTURE] }), Date.parse('2026-09-24T17:00:00Z'));
    expect(text).toBe('NÄCHSTER ANPFIFF IN 01:00:00 · 24.9. 18:00 UHR');
  });

  it('hand-built content without the kickoff list stays valid', () => {
    expect(nextKickoffTicker(content({ next: PAST }), NOW)).not.toContain('JETZT');
  });
});

const THEME: BoardTheme = { kind: 'pulse', accent: '#f5b400', red: '#e3350d', live: '#e3350d' };
/** A bare RUNDE word (never the tail of RÜCKRUNDE / HINRUNDE). */
const BARE_RUNDE = /(^|[\s·])RUNDE(\s|$)/;

describe('plaza copy uses SPIELTAG and never repeats the matchday', () => {
  it('PULS: kicker says SPIELTAG 2, the footer adds only the stage', () => {
    const rec: Recording = { texts: [], positions: [] };
    paintPulseBoard(recordingContext(rec), BOARD_TEX_W, BOARD_TEX_H, content(), THEME, toolsAt(29));
    expect(rec.texts).toContain('EVOLIGA · SPIELTAG 2');
    expect(rec.texts).toContain('16 SPIELE GESPIELT · 8 TEILNEHMER · RÜCKRUNDE');
    for (const text of rec.texts) expect(text).not.toMatch(BARE_RUNDE);
    expect(rec.texts.filter((text) => text.includes('SPIELTAG 2'))).toHaveLength(1);
  });

  it('TABELLE: the footer says SPIELTAG, not RUNDE (with and without a table)', () => {
    for (const c of [content(), content({ table: [], top: [] })]) {
      const rec: Recording = { texts: [], positions: [] };
      paintTableBoard(recordingContext(rec), BOARD_TEX_W, BOARD_TEX_H, c, { ...THEME, kind: 'schedule' }, toolsAt(29));
      for (const text of rec.texts) expect(text).not.toMatch(BARE_RUNDE);
      expect(rec.texts.some((text) => text.endsWith('SPIELTAG 2'))).toBe(true);
    }
  });
});

describe('SPIELPLAN group labels keep at least 0.6 em of air (r1: 22 px gap, label on the row above)', () => {
  for (const floor of [22, 26, 29]) {
    it(`at a ${floor} px floor both groups fit and the second label clears the row box above`, () => {
      const tools = toolsAt(floor);
      const labelPx = tools.fontPx(22);
      const { groups, rowHeight } = scheduleLayout(78, tools, [BOARD_FIXTURE_ROWS, SPIELPLAN_NEXT_ROWS]);
      const [first, second] = groups;
      const rowAboveBottom = first.rowTops[first.rowTops.length - 1] + rowHeight;
      const labelAscentTop = second.labelY - labelPx * 0.8;
      expect(labelAscentTop - rowAboveBottom).toBeGreaterThanOrEqual(labelPx * SCHEDULE_LABEL_AIR_EM - 1e-9);
      const lastBottom = second.rowTops[second.rowTops.length - 1] + rowHeight;
      expect(lastBottom).toBeLessThanOrEqual(BOARD_TEX_H - TICKER_STRIP_H);
    });
  }

  it('the painted page shows the whole current matchday and one DANACH row', () => {
    const rec: Recording = { texts: [], positions: [] };
    const upcoming = [
      fixture('HOFSTETTER', 'WELLS', 'live', 2),
      fixture('AY', 'KRAUS', 'upcoming', 2),
      fixture('MARSH', 'HOLT', 'upcoming', 2),
      fixture('BRANDT', 'OTT', 'upcoming', 2),
    ];
    const later = [fixture('WELLS', 'AY', 'upcoming', 3), fixture('KRAUS', 'MARSH', 'upcoming', 3)];
    paintScheduleBoard(
      recordingContext(rec),
      BOARD_TEX_W,
      BOARD_TEX_H,
      content({ upcoming, later }),
      { ...THEME, kind: 'schedule' },
      toolsAt(29),
    );
    expect(rec.texts).toContain('SPIELTAG 2 · AKTUELL');
    // Fidelity W1 r4: the hidden second pairing is counted on the label.
    expect(rec.texts).toContain('SPIELTAG 3 · DANACH · +1 WEITERE');
    expect(rec.texts).toContain('WELLS — AY');
    expect(rec.texts).not.toContain('KRAUS — MARSH');
    for (const text of rec.texts) expect(text).not.toMatch(BARE_RUNDE);
  });
});
