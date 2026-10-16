import { describe, expect, it } from 'vitest';
import type { BoardContent, BoardFixture, BoardTableRow } from '@/components/world/evoliga/route/plaza/board/board-content';
import { paintPulseBoard, type BoardTheme } from '@/components/world/evoliga/route/plaza/board/board-painters';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  compositeOver,
  MIN_TEXT_CONTRAST,
  readableAccent,
  renderedContrast,
} from '@/lib/route-world/board-text';
import type { WorldPalette } from '@/lib/route-world/palette';
import { cloudsPaletteExtension } from '@/components/world/themes/clouds/theme-palette';
import { mountainPaletteExtension } from '@/components/world/themes/mountain/theme-palette';
import { sakuraPaletteExtension } from '@/components/world/themes/sakura/theme-palette';
import {
  BANNER_EMISSION,
  BANNER_TEX_H,
  BANNER_TEX_W,
  BOARD_TEX_H as SAKURA_BOARD_H,
  BOARD_TEX_W as SAKURA_BOARD_W,
  bannerBand,
  buildFestivalBannerPayloads,
  JUMBOTRON_EMISSION,
  paintBanner,
  paintBoardPage as paintJumbotron,
} from '@/components/world/themes/sakura/content/paint';
import {
  BOARD_TEX_H as MOUNTAIN_BOARD_H,
  BOARD_TEX_W as MOUNTAIN_BOARD_W,
  buildTrailSignPayloads,
  paintRegisterWall,
  paintSummitBoard,
  paintTrailSign,
  REGISTER_EMISSION,
  REGISTER_LABEL_INK,
  registerNote,
  ROSTER_TEX_H as MOUNTAIN_ROSTER_H,
  ROSTER_TEX_W as MOUNTAIN_ROSTER_W,
  SIGN_EMISSION,
  SIGN_TEX_H,
  SIGN_TEX_W,
  signBand,
  SUMMIT_EMISSION,
  TRAIL_SIGN_INK,
  TRAIL_SIGN_WOOD,
} from '@/components/world/themes/mountain/content/paint';
import {
  AIRSHIP_EMISSION,
  BOARD_TEX_H as CLOUDS_BOARD_H,
  BOARD_TEX_W as CLOUDS_BOARD_W,
  paintFixturesBoard,
  paintFlagshipBoard,
  paintRegisterSail,
  registerSailNote,
  SAIL_TEX_H,
  SAIL_TEX_W,
} from '@/components/world/themes/clouds/content/paint';

/**
 * Fidelity wave 2 (seat 2E PAINT) — the painted faces of all four worlds
 * against the wave-2 text law: every text ink clears 4.5:1 on its RENDERED
 * ground (self-lit black-base faces × their emissions × AgX, the model in
 * board-text.ts), LIVE is a filled pill in all four worlds, the roster notes
 * promise the full list the 2D panel opens, and the 390 cloth band never
 * drops a word.
 */

// ── A recording context that logs fills with the style they used ──

interface Op {
  readonly op: 'rect' | 'fill' | 'text';
  readonly style: string;
  readonly text?: string;
  readonly font?: number;
}

function recorder(ops: Op[], em = 0.6): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '16px sans-serif',
    textAlign: 'left',
    globalAlpha: 1,
    lineWidth: 1,
  };
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 16);
  const methods: Record<string, unknown> = {
    fillRect: () => ops.push({ op: 'rect', style: String(state.fillStyle) }),
    fill: () => ops.push({ op: 'fill', style: String(state.fillStyle) }),
    fillText: (text: string) => ops.push({ op: 'text', style: String(state.fillStyle), text: String(text), font: px() }),
    measureText: (text: string) => ({ width: Array.from(String(text)).length * px() * em }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  };
  return new Proxy(state, {
    get: (target, key: string) => (key in methods ? methods[key] : key in target ? target[key] : () => undefined),
    set: (target, key: string, value: unknown) => {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const toolsAt = (floor: number): BoardPaintTools => ({
  fontPx: (n: number) => Math.max(Math.ceil(n), floor),
  fontFloorPx: floor,
});

const core = (dark: boolean) => ({ ground: dark ? '#000000' : '#ffffff' }) as unknown as WorldPalette;
const THEMES = [false, true] as const;

const LIVE_FIXTURE: BoardFixture = { home: 'WELLS', away: 'AY', date: '9/17', time: '18:00', status: 'live', matchday: 2 };
const TABLE: BoardTableRow[] = [
  { name: 'WELLS', points: 12, wins: 4, losses: 1, draws: 0, diff: 3, rankChange: 1 },
  { name: 'AY', points: 9, wins: 3, losses: 2, draws: 0, diff: 1, rankChange: -1 },
];

function content(live: boolean): BoardContent {
  return {
    league: 'EvoLiga',
    stage: 'Second Half',
    round: 2,
    participants: 8,
    completed: 16,
    top: TABLE,
    table: TABLE,
    live: live ? { home: 'WELLS', away: 'AY' } : null,
    upcoming: [live ? LIVE_FIXTURE : { ...LIVE_FIXTURE, status: 'upcoming' }],
    later: [],
    results: [],
    lastMatchday: [],
    lastMatchdayLabel: null,
    next: null,
    locale: 'en',
  };
}

const AFTER_KICKOFF = Date.parse('2026-09-17T19:00:00Z');

/** The ground a painter laid first (its full-face fill). */
function firstGround(ops: readonly Op[]): string {
  return ops.find((o) => o.op === 'rect')?.style ?? '';
}

/** True when the op at `i` is a LIVE label sitting on a filled pill of another colour. */
function isFilledPill(ops: readonly Op[], i: number): boolean {
  const label = ops[i];
  for (let j = i - 1; j >= Math.max(0, i - 4); j -= 1) {
    const o = ops[j];
    if ((o.op === 'fill' || o.op === 'rect') && o.style !== label.style) return true;
  }
  return false;
}

function liveLabels(ops: readonly Op[]): number[] {
  return ops.flatMap((o, i) => (o.op === 'text' && /^LIVE(\s|$)/.test(o.text ?? '') ? [i] : []));
}

// ── Rendered contrast lint ────────────────────────────────────────

describe('contrast lint: every data ink ≥ 4.5:1 on its rendered ground (both themes)', () => {
  for (const dark of THEMES) {
    const theme = dark ? 'dark' : 'light';

    it(`sakura cloths (${theme}): body ink, band word, accent rows, LIVE pill`, () => {
      const p = sakuraPaletteExtension(core(dark), dark);
      const colors = { cloth: p.bannerCloth, ink: p.bannerInk, accent: p.toriiRed };
      expect(renderedContrast(colors.ink, colors.cloth, BANNER_EMISSION)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      const band = bannerBand(colors);
      expect(renderedContrast(band.ink, band.band, BANNER_EMISSION)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      const accent = readableAccent(colors.accent, colors.cloth, colors.ink, BANNER_EMISSION);
      expect(renderedContrast(accent, colors.cloth, BANNER_EMISSION)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      // The pill: cloth-coloured word on the accent fill.
      expect(renderedContrast(colors.cloth, accent, BANNER_EMISSION)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    });

    it(`mountain trail signs (${theme}): the painted wood carries ink, band and accent rows`, () => {
      const p = mountainPaletteExtension(core(dark), dark);
      const ops: Op[] = [];
      const [fixtures] = buildTrailSignPayloads(content(true), AFTER_KICKOFF);
      const colors = { wood: TRAIL_SIGN_WOOD, ink: TRAIL_SIGN_INK, accent: p.boardAccent };
      paintTrailSign(recorder(ops), SIGN_TEX_W, SIGN_TEX_H, fixtures, colors, toolsAt(35));
      const wood = firstGround(ops);
      expect(renderedContrast(TRAIL_SIGN_INK, wood, SIGN_EMISSION)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      const band = signBand({ ...colors, wood });
      expect(renderedContrast(band.ink, band.band, SIGN_EMISSION)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      const accent = readableAccent(p.boardAccent, wood, TRAIL_SIGN_INK, SIGN_EMISSION);
      expect(renderedContrast(accent, wood, SIGN_EMISSION)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    });

    it(`dark LED boards (${theme}): field vs every text ink, and the accent`, () => {
      const sak = sakuraPaletteExtension(core(dark), dark);
      const mtn = mountainPaletteExtension(core(dark), dark);
      const cl = cloudsPaletteExtension(core(dark), dark);
      const boards: Array<{
        name: string;
        paint: (ctx: CanvasRenderingContext2D) => void;
        ink: string;
        emissions: readonly number[];
      }> = [
        {
          name: 'sakura jumbotron',
          ink: '#eafcff',
          emissions: JUMBOTRON_EMISSION,
          paint: (ctx) =>
            paintJumbotron(ctx, SAKURA_BOARD_W, SAKURA_BOARD_H, content(true), { field: sak.boardField, accent: sak.boardAccent, ink: '#eafcff' }, toolsAt(39)),
        },
        {
          name: 'mountain summit',
          ink: '#eef4f2',
          emissions: SUMMIT_EMISSION,
          paint: (ctx) =>
            paintSummitBoard(ctx, MOUNTAIN_BOARD_W, MOUNTAIN_BOARD_H, content(true), { field: mtn.boardField, accent: mtn.boardAccent, ink: '#eef4f2' }, toolsAt(43)),
        },
        {
          name: 'clouds fixtures',
          ink: '#eef6ff',
          emissions: AIRSHIP_EMISSION,
          paint: (ctx) =>
            paintFixturesBoard(ctx, CLOUDS_BOARD_W, CLOUDS_BOARD_H, content(true), { field: cl.boardField, accent: cl.boardAccent, ink: '#eef6ff' }, toolsAt(41)),
        },
      ];
      for (const board of boards) {
        const ops: Op[] = [];
        board.paint(recorder(ops));
        const field = firstGround(ops);
        // Every text painted in the body ink or a translucent light ink,
        // flattened over the field, clears AA on the rendered face.
        const lightTexts = ops.filter(
          (o) => o.op === 'text' && (o.style === board.ink || /^rgba\(2[34]\d, 24\d, 2\d\d, 0\.\d+\)$/.test(o.style)),
        );
        expect(lightTexts.length, board.name).toBeGreaterThan(3);
        for (const t of lightTexts) {
          expect(
            renderedContrast(compositeOver(t.style, field), field, board.emissions),
            `${board.name} "${t.text}" ${t.style} on ${field}`,
          ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        }
      }
    });

    it(`mountain register + clouds sail (${theme}): note and labels on the rendered ground`, () => {
      const mtn = mountainPaletteExtension(core(dark), dark);
      const tiles = [{ id: 't1', line: 1, name: 'Bulbasaur', price: 10, band: 'guenstig' }];
      const ops: Op[] = [];
      paintRegisterWall(
        recorder(ops),
        MOUNTAIN_ROSTER_W,
        MOUNTAIN_ROSTER_H,
        tiles,
        { stone: '#54504a', ink: '#f3efe6', accent: mtn.boardAccent },
        toolsAt(50),
        registerNote(1, 30),
      );
      const stone = firstGround(ops);
      for (const ink of ['#f3efe6', REGISTER_LABEL_INK]) {
        expect(renderedContrast(compositeOver(ink, stone), stone, REGISTER_EMISSION)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
      expect(ops.some((o) => o.op === 'text' && o.style === REGISTER_LABEL_INK && o.text === '01')).toBe(true);

      const cl = cloudsPaletteExtension(core(dark), dark);
      const sail: Op[] = [];
      paintRegisterSail(
        recorder(sail),
        SAIL_TEX_W,
        SAIL_TEX_H,
        tiles,
        { canvas: cl.sailCanvas, ink: '#16223a', accent: cl.boardAccent },
        toolsAt(50),
        registerSailNote(1, 30),
      );
      const canvas = firstGround(sail);
      const note = sail.find((o) => o.op === 'text' && (o.text ?? '').includes('TAP THE SAIL'));
      const heading = sail.find((o) => o.op === 'text' && o.text === 'ROSTER');
      expect(note && heading).toBeTruthy();
      for (const t of [note!, heading!]) {
        expect(
          renderedContrast(compositeOver(t.style, canvas), canvas, AIRSHIP_EMISSION),
          `sail ${t.text} ${t.style} on ${canvas}`,
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    });
  }
});

// ── LIVE is a filled pill in all four worlds ──────────────────────

describe('LIVE is a filled pill in all four worlds', () => {
  const sak = sakuraPaletteExtension(core(false), false);
  const mtn = mountainPaletteExtension(core(false), false);
  const cl = cloudsPaletteExtension(core(false), false);
  const PLAZA: BoardTheme = { kind: 'pulse', accent: '#ffb347', red: '#e3350d', live: '#3ddc84' };

  const faces: Array<[string, (ctx: CanvasRenderingContext2D) => void]> = [
    [
      'plaza PULS',
      (ctx) => paintPulseBoard(ctx, 1024, 592, { ...content(true), locale: 'de' }, PLAZA, toolsAt(29)),
    ],
    [
      'sakura jumbotron',
      (ctx) =>
        paintJumbotron(ctx, SAKURA_BOARD_W, SAKURA_BOARD_H, content(true), { field: sak.boardField, accent: sak.boardAccent, ink: '#eafcff' }, toolsAt(39)),
    ],
    [
      'sakura FIXTURES cloth',
      (ctx) =>
        paintBanner(
          ctx,
          BANNER_TEX_W,
          BANNER_TEX_H,
          buildFestivalBannerPayloads(content(true), AFTER_KICKOFF)[0],
          { cloth: sak.bannerCloth, ink: sak.bannerInk, accent: sak.toriiRed },
          toolsAt(40),
        ),
    ],
    [
      'mountain summit',
      (ctx) =>
        paintSummitBoard(ctx, MOUNTAIN_BOARD_W, MOUNTAIN_BOARD_H, content(true), { field: mtn.boardField, accent: mtn.boardAccent, ink: '#eef4f2' }, toolsAt(43)),
    ],
    [
      'mountain FIXTURES sign',
      (ctx) =>
        paintTrailSign(
          ctx,
          SIGN_TEX_W,
          SIGN_TEX_H,
          buildTrailSignPayloads(content(true), AFTER_KICKOFF)[0],
          { wood: TRAIL_SIGN_WOOD, ink: TRAIL_SIGN_INK, accent: mtn.boardAccent },
          toolsAt(41),
        ),
    ],
    [
      'clouds flagship',
      (ctx) =>
        paintFlagshipBoard(ctx, CLOUDS_BOARD_W, CLOUDS_BOARD_H, content(true), { field: '#000000', accent: cl.boardAccent, ink: '#eef6ff' }, toolsAt(40)),
    ],
    [
      'clouds fixtures',
      (ctx) =>
        paintFixturesBoard(ctx, CLOUDS_BOARD_W, CLOUDS_BOARD_H, content(true), { field: cl.boardField, accent: cl.boardAccent, ink: '#eef6ff' }, toolsAt(41)),
    ],
  ];

  for (const [name, paint] of faces) {
    it(name, () => {
      const ops: Op[] = [];
      paint(recorder(ops));
      const labels = liveLabels(ops);
      expect(labels.length, `${name}: a LIVE label`).toBeGreaterThan(0);
      for (const i of labels) expect(isFilledPill(ops, i), `${name}: "${ops[i].text}" on a filled pill`).toBe(true);
    });
  }

  it('the plaza shows no LIVE pill when nothing is live', () => {
    const ops: Op[] = [];
    paintPulseBoard(recorder(ops), 1024, 592, { ...content(false), locale: 'de' }, PLAZA, toolsAt(29));
    expect(liveLabels(ops)).toEqual([]);
    expect(ops.some((o) => o.text === 'Kein Spiel im Gange')).toBe(true);
  });
});

// ── Roster notes promise the full list (2D's panel, same train) ───

describe('roster notes name the full-list tap', () => {
  it('mountain wall and clouds sail promise every line', () => {
    expect(registerNote(9, 30)).toBe('9 OF 30 LINES · TAP THE WALL FOR ALL 30');
    expect(registerSailNote(9, 30)).toBe('9 OF 30 LINES · TAP THE SAIL FOR ALL 30');
    expect(registerNote(9, 30, false)).toContain('UP CLOSE');
  });

  it('paints the note whole beside the heading at the roster floors (auto-fit before ellipsis)', () => {
    for (const floor of [40, 50]) {
      const ops: Op[] = [];
      paintRegisterWall(
        recorder(ops, 0.62),
        MOUNTAIN_ROSTER_W,
        MOUNTAIN_ROSTER_H,
        [],
        { stone: '#54504a', ink: '#f3efe6', accent: '#e8862e' },
        toolsAt(floor),
        registerNote(9, 30),
      );
      expect(ops.find((o) => (o.text ?? '').includes('TAP THE WALL'))?.text, `floor ${floor}`).toBe(
        '9 OF 30 LINES · TAP THE WALL FOR ALL 30',
      );
    }
  });
});

// ── The 390 cloth band keeps every word ───────────────────────────

describe('sakura cloth band at the 390 floor never drops a word', () => {
  for (const dark of THEMES) {
    it(dark ? 'dark' : 'light', () => {
      const p = sakuraPaletteExtension(core(dark), dark);
      const ops: Op[] = [];
      // 0.66 em: a heavy system-ui cap width, where "SAKURA PARK" alone
      // overflows the 264 px line at the 40 px mobile floor (the r5 still).
      paintBanner(
        recorder(ops, 0.66),
        BANNER_TEX_W,
        BANNER_TEX_H,
        buildFestivalBannerPayloads(content(true), AFTER_KICKOFF)[3],
        { cloth: p.bannerCloth, ink: p.bannerInk, accent: p.toriiRed },
        toolsAt(40),
      );
      const band = bannerBand({ cloth: p.bannerCloth, ink: p.bannerInk, accent: p.toriiRed });
      const words = ops.filter((o) => o.op === 'text' && o.style === band.ink && /SAKURA|PARK|LEAGUE/.test(o.text ?? ''));
      expect(words.map((o) => o.text).join(' ')).toBe('SAKURA PARK LEAGUE');
    });
  }
});
