import { describe, expect, it } from 'vitest';
import type { BoardContent, BoardTableRow } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import { boardRowHeadline, liveMatchPair } from '@/lib/route-world/board-text';
import { BANNER_TEX_H, BANNER_TEX_W, buildFestivalBannerPayloads, paintBanner, sakuraKickoffStamp } from '../paint';

/**
 * Fidelity W1 r2 (audit issue 7 in sakura): only the fixture and result
 * banners may pair names with "vs" — the PULSE and TABLE banners painted
 * "8 vs TRAINERS", "2 vs MATCHDAY" and "1. WELLS vs 4–1".
 */

const toolsAt = (floorPx: number): BoardPaintTools => ({
  fontPx: (n: number) => Math.max(Math.ceil(n), floorPx),
  fontFloorPx: floorPx,
});

function recordingContext(texts: string[]): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string) => texts.push(String(text)),
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
    bezierCurveTo: noop,
    stroke: noop,
    fill: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setLineDash: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
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

const TABLE: BoardTableRow[] = ['WELLS', 'AY', 'KRAUS', 'MARSH'].map((name, i) => ({
  name,
  points: 12 - i * 3,
  wins: 4 - i,
  losses: i,
  draws: 0,
  diff: 3 - i,
  rankChange: i === 1 ? 1 : null,
}));

const CONTENT: BoardContent = {
  league: 'Sakura League',
  stage: 'Second Half',
  round: 2,
  participants: 8,
  completed: 16,
  top: TABLE,
  table: TABLE,
  live: { home: 'WELLS', away: 'AY' },
  upcoming: [{ home: 'HOFSTETTER', away: 'WELLS', date: '9/17', time: '18:00', status: 'live', matchday: 2 }],
  later: [{ home: 'WELLS', away: 'AY', date: '9/24', time: '18:00', status: 'upcoming', matchday: 3 }],
  results: [{ home: 'MARSH', away: 'HOLT', score: '2:1', date: '9/10', winner: 'home' }],
  lastMatchday: [],
  lastMatchdayLabel: 'Second Half · Matchday 1',
  next: { date: '9/17', time: '18:00', iso: '2026-09-17T18:00:00Z' },
  locale: 'en',
};

const PAIRING_BANNERS = new Set(['FIXTURES', 'UP NEXT', 'RESULTS']);

describe('sakura festival banners: "vs" only on fixture/result banners', () => {
  const payloads = buildFestivalBannerPayloads(CONTENT);

  it('builds the five banners, pulse as stats and the table as standings', () => {
    expect(payloads.map((payload) => payload.heading)).toEqual(['FIXTURES', 'UP NEXT', 'RESULTS', 'PULSE', 'TABLE']);
    const pulse = payloads[3].rows.map(boardRowHeadline);
    expect(pulse).toEqual(['8 TRAINERS', 'MATCHDAY 2']);
    expect(payloads[4].rows.map(boardRowHeadline)[0]).toBe('1. WELLS · 4–0');
  });

  it('no row outside the fixture/result banners contains " vs " — as built and as painted', () => {
    for (const payload of payloads) {
      const texts: string[] = [];
      paintBanner(
        recordingContext(texts),
        BANNER_TEX_W,
        BANNER_TEX_H,
        payload,
        { cloth: '#f6ecd9', ink: '#3a2a22', accent: '#c8323c' },
        toolsAt(40),
      );
      if (PAIRING_BANNERS.has(payload.heading)) continue;
      for (const row of payload.rows) expect(boardRowHeadline(row)).not.toContain(' vs ');
      for (const text of texts) expect(text, payload.heading).not.toMatch(/(^|\s)vs(\s|$)/);
    }
  });
});

// ── Round 3: no orphaned separators, live-aware tails ─────────────

describe('sakura banners never start or end a painted line with "·" (W1 r3)', () => {
  const afterKickoff = Date.parse('2026-09-17T18:30:00Z');
  const wide: BoardContent = {
    ...CONTENT,
    upcoming: [
      { home: 'HOFSTETTER', away: 'WELLS', date: '9/17', time: '18:00', status: 'live', matchday: 2 },
      { home: 'AY', away: 'OSMAN', date: '9/17', time: '18:00', status: 'upcoming', matchday: 2 },
    ],
    top: TABLE.map((row, i) => ({ ...row, name: i === 3 ? 'WARREN' : row.name })),
  };

  for (const floor of [33, 40, 46]) {
    it(`@${floor} px`, () => {
      for (const payload of buildFestivalBannerPayloads(wide, afterKickoff)) {
        const texts: string[] = [];
        paintBanner(
          recordingContext(texts),
          BANNER_TEX_W,
          BANNER_TEX_H,
          payload,
          { cloth: '#f6ecd9', ink: '#3a2a22', accent: '#c8323c' },
          toolsAt(floor),
        );
        for (const text of texts) expect(text, `${payload.heading}: "${text}"`).not.toMatch(/^\s*·|·\s*$/);
      }
    });
  }

  it('the FIXTURES tail names the live match after its kickoff (r2: NEXT 9/17 18:00 under · LIVE)', () => {
    const [fixtures] = buildFestivalBannerPayloads(CONTENT, afterKickoff);
    // Fidelity wave 2: the FIXTURES (pairing) cloth's live tail says `vs` like its rows —
    // the rect dash between two names read as `=` at 390 (W1 residual 2).
    expect(fixtures.footer).toBe(`LIVE · ${liveMatchPair('WELLS', 'AY')}`);
    const [before] = buildFestivalBannerPayloads(CONTENT, Date.parse('2026-09-16T00:00:00Z'));
    expect(before.footer).toBe('NEXT KICKOFF · 9/17 18:00');
    const [ahead] = buildFestivalBannerPayloads(
      {
        ...CONTENT,
        live: null,
        kickoffs: [CONTENT.next!, { date: '9/24', time: '18:00', iso: '2026-09-24T18:00:00Z' }],
      },
      afterKickoff,
    );
    expect(ahead.footer).toBe('NEXT KICKOFF · 9/24 18:00');
  });

  it('the jumbotron stamp follows the same order', () => {
    expect(sakuraKickoffStamp(CONTENT, afterKickoff)).toBe('LIVE · WELLS – AY · 8 TRAINERS');
    expect(sakuraKickoffStamp({ ...CONTENT, live: null }, afterKickoff)).toBe('16 MATCHES PLAYED · 8 TRAINERS');
  });
});
