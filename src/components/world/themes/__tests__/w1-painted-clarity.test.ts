import { describe, expect, it } from 'vitest';
import { formatPack } from '@/lib/format-pack';
import type { PriceGroup } from '@/types/point-buy';

/** The active format pack's painted price-band word, upper-cased like the painters. */
const bandWord = (locale: 'en' | 'de', group: PriceGroup) =>
  formatPack.messages[locale].paint.priceBand[group].toLocaleUpperCase(locale);
import type { BoardContent, BoardTableRow } from '@/components/world/evoliga/route/plaza/board/board-content';
import {
  boardPages,
  paintPagePips,
  PAGE_PIPS,
  type BoardTheme,
} from '@/components/world/evoliga/route/plaza/board/board-painters';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  BOARD_TEX_H as MOUNTAIN_BOARD_H,
  BOARD_TEX_W as MOUNTAIN_BOARD_W,
  paintRegisterWall,
  paintSummitBoard,
  paintTrailSign,
  priceBandWord,
  registerNote,
  ROSTER_TEX_H as MOUNTAIN_ROSTER_H,
  ROSTER_TEX_W as MOUNTAIN_ROSTER_W,
  SIGN_TEX_H,
  SIGN_TEX_W,
} from '@/components/world/themes/mountain/content/paint';
import {
  SIGN_SEATS,
  SIGNS_ROW_YAW,
  signLocalToWorld,
  WILD_SPOTS,
} from '@/components/world/themes/mountain/furniture/layout';
import { MOUNTAIN_STATIONS } from '@/components/world/themes/mountain/theme';
import { rosterWallNote } from '@/components/world/themes/sakura/content/roster-note';
import {
  paintRosterWall as paintSakuraRosterWall,
  ROSTER_TEX_H as SAKURA_ROSTER_H,
  ROSTER_TEX_W as SAKURA_ROSTER_W,
} from '@/components/world/themes/sakura/content/paint';
import {
  BOARD_TEX_H as CLOUDS_BOARD_H,
  BOARD_TEX_W as CLOUDS_BOARD_W,
  paintFlagshipBoard,
  paintRegisterSail,
  registerSailNote,
  SAIL_TEX_H,
  SAIL_TEX_W,
} from '@/components/world/themes/clouds/content/paint';
import { scheduleLabelTop } from '@/components/world/evoliga/route/plaza/board/board-painters';
import { BOARD_FIXTURE_ROWS, BOARD_NEXT_ROWS } from '@/components/world/evoliga/route/plaza/board/board-content';
import { lineStep, stackStep } from '@/lib/route-world/board-text';
import { landedEndpoint } from '@/lib/route-world/legibility';
import type { CameraEndpoint, Vec3 } from '@/lib/route-world/chapters';
import { paintText } from '@/components/world/themes/paint-copy';

// English test expectations, read from the locale functions (sweep: no test-only constants in source).
const REGISTER_HEADING = paintText('en', 'heading.roster');
const SIGN_BAND_DEFAULT = paintText('en', 'heading.schedule');
const SAIL_HEADING = paintText('en', 'heading.roster');

/**
 * Fidelity W1 painted-content clarity guards: the plaza board pages are
 * de-duplicated and carry page pips, the mountain frieze leads with a title
 * and the signs' band names the station, the sakura roster note names a
 * real affordance, and the re-spaced mountain sign row fits the landed 390
 * frame far better than the C-103 row it replaces.
 */

// ── Recording 2D context ──────────────────────────────────────────

interface Recording {
  texts: string[];
  fonts: number[];
  positions: Array<[number, number]>;
  arcs: number;
}

function recordingContext(rec: Recording): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string, x: number, y: number) => {
      rec.texts.push(String(text));
      rec.fonts.push(px());
      rec.positions.push([x, y]);
    },
    measureText: (text: string) => ({ width: String(text).length * px() * 0.55 }),
    arc: () => {
      rec.arcs += 1;
    },
    fillRect: noop,
    strokeRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    stroke: noop,
    fill: noop,
    translate: noop,
    scale: noop,
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

function newRecording(): Recording {
  return { texts: [], fonts: [], positions: [], arcs: 0 };
}

function toolsAt(floorPx: number): BoardPaintTools {
  return { fontPx: (n: number) => Math.max(Math.ceil(n), floorPx), fontFloorPx: floorPx };
}

function content(table: BoardTableRow[]): BoardContent {
  return {
    league: 'EvoLiga',
    stage: 'Hinrunde',
    round: 2,
    participants: 12,
    completed: table.length > 0 ? 6 : 0,
    top: table.slice(0, 4),
    table,
    live: null,
    upcoming: [],
    later: [],
    results: [],
    lastMatchday: [],
    lastMatchdayLabel: null,
    next: null,
    locale: 'de',
  };
}

const TABLE: BoardTableRow[] = [
  { name: 'WELLS', points: 12, wins: 4, losses: 1, draws: 0, diff: 3, rankChange: 1 },
  { name: 'AY', points: 9, wins: 3, losses: 2, draws: 0, diff: 1, rankChange: -1 },
];

const THEME: BoardTheme = { kind: 'schedule', accent: '#ffb347', red: '#e3350d', live: '#3ddc84' };

// ── Plaza boards ──────────────────────────────────────────────────

describe('plaza board pages are de-duplicated', () => {
  it('gives every page to exactly one board', () => {
    const pulse = boardPages('pulse', content(TABLE)).map((page) => page.id);
    const schedule = boardPages('schedule', content(TABLE)).map((page) => page.id);
    expect(pulse).toEqual(['puls', 'tabelle']);
    expect(schedule).toEqual(['spielplan', 'ergebnisse']);
    expect(pulse.filter((id) => schedule.includes(id))).toEqual([]);
  });

  it('drops the pulse TABELLE on a data-less season; the schedule board keeps its authored empty states', () => {
    expect(boardPages('pulse', content([])).map((page) => page.id)).toEqual(['puls']);
    expect(boardPages('schedule', content([])).map((page) => page.id)).toEqual(['spielplan', 'ergebnisse']);
  });
});

describe('plaza board page pips', () => {
  it('paints nothing on a single-page board', () => {
    const rec = newRecording();
    paintPagePips(recordingContext(rec), 0, 1, THEME, toolsAt(29));
    expect(rec.texts).toEqual([]);
    expect(rec.arcs).toBe(0);
  });

  it('paints one dot per page and an N/M counter at the board floor', () => {
    const rec = newRecording();
    paintPagePips(recordingContext(rec), 1, 2, THEME, toolsAt(29));
    expect(rec.arcs).toBe(2);
    expect(rec.texts).toEqual(['2/2']);
    expect(rec.fonts[0]).toBeGreaterThanOrEqual(29);
  });

  it('stays in the masthead band, inside the corner-ticked frame', () => {
    const rec = newRecording();
    paintPagePips(recordingContext(rec), 0, 3, THEME, toolsAt(29));
    const [x, y] = rec.positions[0];
    // Right-aligned counter: its right edge sits left of the first dot.
    expect(x).toBeLessThan(PAGE_PIPS.right);
    // Counter at 29 px ≈ 48 px wide: starts right of the masthead kicker column.
    expect(x - '1/3'.length * 29 * 0.55).toBeGreaterThan(700);
    expect(y).toBeLessThan(80);
    expect(PAGE_PIPS.right + PAGE_PIPS.radius).toBeLessThan(1024 - 44);
  });
});

// ── Mountain painted content ──────────────────────────────────────

describe('mountain trail-sign band names the station', () => {
  const colors = { wood: '#8a6f4d', ink: '#3a2c1c', accent: '#e8862e' };

  it('paints the station word instead of the repeated world brand', () => {
    const rec = newRecording();
    paintTrailSign(
      recordingContext(rec),
      SIGN_TEX_W,
      SIGN_TEX_H,
      { heading: 'FIXTURES', rows: [], footer: null },
      colors,
      toolsAt(35),
    );
    expect(rec.texts).toContain(SIGN_BAND_DEFAULT);
    expect(rec.texts).not.toContain('MOUNTAIN PASS');
  });

  it('honours a caller-supplied band', () => {
    const rec = newRecording();
    paintTrailSign(
      recordingContext(rec),
      SIGN_TEX_W,
      SIGN_TEX_H,
      { heading: 'TABLE', rows: [], footer: null, band: 'SCHEDULE · 5/5' },
      colors,
      toolsAt(35),
    );
    expect(rec.texts).toContain('SCHEDULE · 5/5');
  });
});

describe('mountain register frieze leads with a title', () => {
  const colors = { stone: '#54504a', ink: '#f3efe6', accent: '#e8862e' };
  const tiles = [
    { id: 't1', line: 1, name: 'Geodude-Alola', price: 10, band: 'guenstig' },
    { id: 't2', line: 2, name: 'Charmander', price: 27, band: 'premium' },
  ];

  it('paints the ROSTER heading at the floor, then the note un-ellipsized', () => {
    const rec = newRecording();
    const note = registerNote(9, 30);
    paintRegisterWall(recordingContext(rec), MOUNTAIN_ROSTER_W, MOUNTAIN_ROSTER_H, tiles, colors, toolsAt(50), note);
    expect(rec.texts[0]).toBe(REGISTER_HEADING);
    expect(rec.fonts[0]).toBeGreaterThanOrEqual(50);
    expect(rec.texts[1]).toBe(note);
  });

  it('keeps the heading on an empty roster', () => {
    const rec = newRecording();
    paintRegisterWall(recordingContext(rec), MOUNTAIN_ROSTER_W, MOUNTAIN_ROSTER_H, [], colors, toolsAt(50));
    expect(rec.texts).toContain(REGISTER_HEADING);
    expect(rec.texts).toContain('NO LINES YET');
  });

  it('paints the price bands in English', () => {
    const rec = newRecording();
    paintRegisterWall(recordingContext(rec), MOUNTAIN_ROSTER_W, MOUNTAIN_ROSTER_H, tiles, colors, toolsAt(50));
    expect(rec.texts).toContain(`10 PTS ${bandWord('en', 'guenstig')}`);
    expect(rec.texts).toContain(`27 PTS ${bandWord('en', 'premium')}`);
    expect(rec.texts.join(' ')).not.toMatch(/GUENSTIG/);
    expect(priceBandWord('hoch')).toBe(bandWord('en', 'hoch'));
    expect(priceBandWord('fire')).toBe('FIRE');
  });
});

// ── Sakura roster note ────────────────────────────────────────────

describe('sakura roster note names a real affordance', () => {
  it('never points at the route-hidden section', () => {
    for (const note of [rosterWallNote(12, 30), rosterWallNote(12, 12), rosterWallNote(3, 3)]) {
      expect(note).not.toMatch(/SECTION|BELOW/);
      expect(note).toContain('TAP THE WALL');
    }
  });

  it('stays honest about the count and only promises the full list once a panel exists', () => {
    expect(rosterWallNote(12, 30)).toContain('12 OF 30 LINES');
    expect(rosterWallNote(12, 30)).toContain('UP CLOSE');
    expect(rosterWallNote(12, 30, true)).toContain('FOR ALL 30');
  });
});

// ── Mountain sign row at the landed 390 pose ──────────────────────

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

/** The five cloth corners, laid out exactly as TrailSigns mounts them (arced seats, row yaw). */
function signCorners(): Vec3[] {
  const out: Vec3[] = [];
  for (const seat of SIGN_SEATS) {
    for (const ex of [-1, 1]) {
      for (const y of [1.04, 7.04]) out.push(signLocalToWorld(seat, [ex, y, 0.075]));
    }
  }
  return out;
}

/** Each cloth's [min, max] ndcX span at a pose, west → east. */
function clothSpans(endpoint: CameraEndpoint, aspect: number): Array<[number, number]> {
  return SIGN_SEATS.map((seat) => {
    const xs = [-1, 1].flatMap((ex) => [1.04, 7.04].map((y) => ndcX(endpoint, aspect, signLocalToWorld(seat, [ex, y, 0.075]))));
    return [Math.min(...xs), Math.max(...xs)];
  });
}

describe('mountain sign row fits the frame (cameras frozen)', () => {
  const station = MOUNTAIN_STATIONS[3];

  it('keeps every cloth corner inside the landed 390 frame (the arc; flat row was ±1.036)', () => {
    const landed = landedEndpoint(station.cameraMobile);
    const xs = signCorners().map((p) => ndcX(landed, 390 / 844, p));
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(0.99);
    // Centred: neither outer sign sits closer to its frame edge.
    expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(0.01);
  });

  it('never lets a cloth hide more than its side margin behind a neighbour', () => {
    // 28/320 of the 2.0 m cloth is untexted margin (0.175 m ≈ 0.03 ndc at
    // the landed 390 pose); projected overlaps must stay well inside it.
    for (const [endpoint, aspect] of [
      [landedEndpoint(station.cameraMobile), 390 / 844],
      [station.camera, 1440 / 900],
    ] as const) {
      const spans = clothSpans(endpoint, aspect);
      for (let i = 0; i < spans.length - 1; i += 1) {
        expect(spans[i + 1][0] - spans[i][1]).toBeGreaterThan(-0.01);
      }
    }
  });

  it('keeps neighbouring cross-arms apart (the arc staggers them in depth)', () => {
    for (let i = 0; i < SIGN_SEATS.length - 1; i += 1) {
      let closest = Infinity;
      for (let a = -1.09; a <= 1.0901; a += 0.109) {
        for (let b = -1.09; b <= 1.0901; b += 0.109) {
          const p = signLocalToWorld(SIGN_SEATS[i], [a, 7.1, 0.06]);
          const q = signLocalToWorld(SIGN_SEATS[i + 1], [b, 7.1, 0.06]);
          closest = Math.min(closest, Math.hypot(p[0] - q[0], p[2] - q[2]));
        }
      }
      // Arm radius 0.03 each: ≥ 0.1 m centreline keeps ≥ 4 cm of air.
      expect(closest).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('stays well inside the 1440 frame', () => {
    const xs = signCorners().map((p) => ndcX(station.camera, 1440 / 900, p));
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(0.75);
  });

  it('keeps the schedule wilds clear of every cloth (behind its plane, or beside it)', () => {
    const c = Math.cos(SIGNS_ROW_YAW);
    const sn = Math.sin(SIGNS_ROW_YAW);
    for (const spot of WILD_SPOTS.filter((w) => w.station === 3)) {
      // Footprint half-width restated from the W4 audit's scene (manifest
      // stature × aspect): 0.7 m bounds Piloswine's 0.67, and
      // Mamoswine's 1.57 is covered by its 4.4 m standoff.
      const half = spot.species === 'Mamoswine' ? 1.6 : 0.7;
      for (const seat of SIGN_SEATS) {
        const [ox, , oz] = signLocalToWorld(seat, [0, 0, 0.075]);
        const dx = spot.x - ox;
        const dz = spot.z - oz;
        const lateral = dx * c - dz * sn;
        const toward = dx * sn + dz * c;
        const beside = Math.abs(lateral) - half - 1.0;
        const behind = -toward - half;
        expect(Math.max(beside, behind), `${spot.species} vs sign at ${seat.lx}`).toBeGreaterThan(0);
      }
    }
  });
});

// ── Round 1: register notes, sail heading, price bands ────────────

describe('register notes name a real affordance (round 1)', () => {
  it('never points at the route-hidden section on mountain or clouds', () => {
    for (const note of [registerNote(9, 30), registerNote(9, 9), registerSailNote(9, 30), registerSailNote(3, 3)]) {
      expect(note).not.toMatch(/SECTION|BELOW/);
      expect(note).toContain('TAP');
    }
    expect(registerNote(9, 30)).toContain('9 OF 30 LINES');
    expect(registerSailNote(9, 30)).toContain('9 OF 30 LINES');
  });
});

const ROSTER_TILES = [
  { id: 't1', line: 1, name: 'Bulbasaur', price: 10, band: 'guenstig' },
  { id: 't2', line: 2, name: 'Geodude-Alola', price: 18, band: 'mittel' },
  { id: 't3', line: 3, name: 'Charmander', price: 27, band: 'hoch' },
];

const SAIL_COLORS = { canvas: '#f4efe4', ink: '#16223a', accent: '#e8922e' };
const SAKURA_WALL_COLORS = { stone: '#5a5048', ink: '#f6efe6', accent: '#e87aa0' };
const MOUNTAIN_WALL_COLORS = { stone: '#54504a', ink: '#f3efe6', accent: '#e8862e' };

describe('clouds register sail leads with a title (round 1)', () => {
  it('paints the ROSTER heading first, then the note beside it', () => {
    const rec = newRecording();
    const note = registerSailNote(9, 30);
    paintRegisterSail(recordingContext(rec), SAIL_TEX_W, SAIL_TEX_H, ROSTER_TILES, SAIL_COLORS, toolsAt(50), note);
    expect(rec.texts[0]).toBe(SAIL_HEADING);
    expect(rec.texts[1]).toBe(note);
    expect(rec.positions[1][0]).toBeGreaterThan(rec.positions[0][0] + SAIL_HEADING.length * 50 * 0.55);
  });

  it('keeps the heading on an empty roster', () => {
    const rec = newRecording();
    paintRegisterSail(recordingContext(rec), SAIL_TEX_W, SAIL_TEX_H, [], SAIL_COLORS, toolsAt(50));
    expect(rec.texts).toContain(SAIL_HEADING);
  });
});

describe('English friezes translate the price bands (round 1)', () => {
  it('sakura and clouds paint the English band words, never the German keys', () => {
    const sak = newRecording();
    paintSakuraRosterWall(recordingContext(sak), SAKURA_ROSTER_W, SAKURA_ROSTER_H, ROSTER_TILES, SAKURA_WALL_COLORS, toolsAt(40));
    const clo = newRecording();
    paintRegisterSail(recordingContext(clo), SAIL_TEX_W, SAIL_TEX_H, ROSTER_TILES, SAIL_COLORS, toolsAt(50));
    for (const rec of [sak, clo]) {
      const all = rec.texts.join(' ');
      expect(all).toContain(`10 PTS · ${bandWord('en', 'guenstig')}`);
      expect(all).toContain(`18 PTS · ${bandWord('en', 'mittel')}`);
      expect(all).toContain(`27 PTS · ${bandWord('en', 'hoch')}`);
      expect(all).not.toMatch(/GUENSTIG|MITTEL|HOCH/);
    }
  });
});

// ── Round 1: the shared text law in the painters (audit issues 7 + 8) ──

/** Each two-digit index label and the first text painted after it on the same baseline. */
function indexNamePairs(rec: Recording): Array<{ indexX: number; indexW: number; nameX: number }> {
  const pairs: Array<{ indexX: number; indexW: number; nameX: number }> = [];
  rec.texts.forEach((text, i) => {
    if (!/^\d{2}$/.test(text)) return;
    const [ix, iy] = rec.positions[i];
    const next = rec.positions.findIndex(([, y], j) => j > i && y === iy);
    if (next < 0) return;
    pairs.push({ indexX: ix, indexW: text.length * rec.fonts[i] * 0.55, nameX: rec.positions[next][0] });
  });
  return pairs;
}

describe('roster friezes keep a fixed index gutter (no "01BULBASAUR")', () => {
  it('mountain, clouds and sakura start every name right of its measured index', () => {
    const mtn = newRecording();
    paintRegisterWall(recordingContext(mtn), MOUNTAIN_ROSTER_W, MOUNTAIN_ROSTER_H, ROSTER_TILES, MOUNTAIN_WALL_COLORS, toolsAt(50));
    const clo = newRecording();
    paintRegisterSail(recordingContext(clo), SAIL_TEX_W, SAIL_TEX_H, ROSTER_TILES, SAIL_COLORS, toolsAt(50));
    const sak = newRecording();
    paintSakuraRosterWall(recordingContext(sak), SAKURA_ROSTER_W, SAKURA_ROSTER_H, ROSTER_TILES, SAKURA_WALL_COLORS, toolsAt(40));
    for (const rec of [mtn, clo, sak]) {
      const pairs = indexNamePairs(rec);
      expect(pairs.length).toBe(ROSTER_TILES.length);
      const offsets = new Set<number>();
      for (const { indexX, indexW, nameX } of pairs) {
        expect(nameX).toBeGreaterThanOrEqual(indexX + indexW + 8);
        offsets.add(nameX - indexX);
      }
      // Fixed gutter: one offset for every tile on the face.
      expect(offsets.size).toBe(1);
    }
  });
});

interface ColumnLine {
  y: number;
  px: number;
  text: string;
}

/** Left-column baselines at `x`, top to bottom, with their px. */
function column(rec: Recording, x: number): ColumnLine[] {
  return rec.texts
    .map((text, i) => ({ text, y: rec.positions[i][1], px: rec.fonts[i], x: rec.positions[i][0] }))
    .filter((line) => line.x === x)
    .sort((a, b) => a.y - b.y);
}

function expectStacked(lines: readonly ColumnLine[]): void {
  for (let i = 1; i < lines.length; i += 1) {
    const step = lines[i].y - lines[i - 1].y;
    expect(step, `${lines[i - 1].text} → ${lines[i].text}`).toBeGreaterThanOrEqual(stackStep(lines[i - 1].px, lines[i].px));
  }
}

const STANDINGS: BoardTableRow[] = Array.from({ length: 8 }, (_, i) => ({
  name: `TRAINER ${i + 1}`,
  points: 20 - i * 2,
  wins: 6 - Math.floor(i / 2),
  losses: Math.floor(i / 2),
  draws: 0,
  diff: 4 - i,
  rankChange: i === 1 ? 1 : null,
}));

describe('pulse boards stack their masthead at measured leading ≥ 1.2', () => {
  const colors = { field: '#1c2430', accent: '#e8862e', ink: '#f0f6f4' };

  it('mountain summit board: kicker → league → header → rows, no subtitle collision', () => {
    const rec = newRecording();
    paintSummitBoard(recordingContext(rec), MOUNTAIN_BOARD_W, MOUNTAIN_BOARD_H, content(STANDINGS), colors, toolsAt(43));
    const col = column(rec, 56);
    expectStacked(col);
    // The stage line rides the kicker baseline now, not its own row.
    const stage = rec.texts.findIndex((text) => text.includes('MATCHDAY 2'));
    expect(stage).toBeGreaterThanOrEqual(0);
    // Fidelity W1 r4: the stack starts at 52 (was 74) so the footer clears the sill lip.
    expect(rec.positions[stage][1]).toBe(52);
    // All eight standings rows still fit above the footer strip (598 at 43 px).
    const rowYs = col.filter((line) => /^\d$/.test(line.text)).map((line) => line.y);
    expect(rowYs.length).toBe(8);
    expect(Math.max(...rowYs)).toBeLessThanOrEqual(583);
  });

  it('clouds flagship board: same law at the 40 px floor', () => {
    const rec = newRecording();
    paintFlagshipBoard(recordingContext(rec), CLOUDS_BOARD_W, CLOUDS_BOARD_H, content(STANDINGS), colors, toolsAt(40));
    const col = column(rec, 56);
    expectStacked(col);
    const rowYs = col.filter((line) => /^\d$/.test(line.text)).map((line) => line.y);
    expect(rowYs.length).toBe(8);
    expect(Math.max(...rowYs)).toBeLessThanOrEqual(CLOUDS_BOARD_H - 76 - 30);
  });

  it('never drops the stage line when a LIVE pill shares the band (r2: short form keeps the brand)', () => {
    const rec = newRecording();
    const live: BoardContent = { ...content(STANDINGS), live: { home: 'WELLS', away: 'AY' } };
    paintSummitBoard(recordingContext(rec), MOUNTAIN_BOARD_W, MOUNTAIN_BOARD_H, live, colors, toolsAt(43));
    // Fidelity W1 r2: the detail steps down to "MD 2 · <STAGE>" before the
    // SUMMIT STANDINGS brand is dropped; either way the matchday survives.
    expect(rec.texts.some((text) => text.includes('MATCHDAY 2') || text.includes('MD 2 ·'))).toBe(true);
  });
});

describe('trail signs: only fixtures say "vs", and rows keep their leading', () => {
  const colors = { wood: '#8a6f4d', ink: '#3a2c1c', accent: '#e8862e' };

  it('paints stat and standing rows without an injected "vs"', () => {
    const rec = newRecording();
    paintTrailSign(
      recordingContext(rec),
      SIGN_TEX_W,
      SIGN_TEX_H,
      {
        heading: 'PULSE',
        rows: [
          { kind: 'stat', text: '8 TRAINERS', detail: '3 MATCHES PLAYED' },
          { kind: 'standing', rank: 1, name: 'WELLS', record: '4–1', detail: '12 PTS' },
        ],
        footer: null,
      },
      colors,
      toolsAt(35),
    );
    expect(rec.texts.join(' ')).not.toMatch(/\bvs\b/);
    expect(rec.texts).toContain('8 TRAINERS');
  });

  it('still joins real fixtures with vs', () => {
    const rec = newRecording();
    paintTrailSign(
      recordingContext(rec),
      SIGN_TEX_W,
      SIGN_TEX_H,
      { heading: 'FIXTURES', rows: [{ home: 'WARREN', away: 'HOFFMAN', detail: 'MD 2 · 9/17 18:00 · OPEN' }], footer: null },
      colors,
      toolsAt(35),
    );
    expect(rec.texts.join(' ')).toMatch(/WARREN vs/);
  });

  it('stacks every row line at ≥ 1.2 (the 26 px date pitch overprinted 35 px glyphs)', () => {
    const rec = newRecording();
    const rows = Array.from({ length: 4 }, (_, i) => ({
      home: `HOME${i}`,
      away: `AWAY${i}`,
      detail: `MD ${i + 1} · 9/17 18:00 · OPEN`,
    }));
    paintTrailSign(
      recordingContext(rec),
      SIGN_TEX_W,
      SIGN_TEX_H,
      { heading: 'FIXTURES', rows, footer: 'SECOND HALF · MATCHDAY 2' },
      colors,
      toolsAt(35),
    );
    const lines = column(rec, 28).filter((line) => line.y > 150);
    expectStacked(lines);
    // Every line rides above the plain bottom band.
    expect(Math.max(...lines.map((line) => line.y))).toBeLessThanOrEqual(SIGN_TEX_H - 84 - 14);
  });

  it('counts the rows that no longer fit instead of dropping them silently', () => {
    const rec = newRecording();
    const rows = Array.from({ length: 6 }, (_, i) => ({ home: `HOME${i}`, away: `AWAY${i}`, detail: 'MD 2 · 9/17 18:00 · OPEN' }));
    paintTrailSign(recordingContext(rec), SIGN_TEX_W, SIGN_TEX_H, { heading: 'FIXTURES', rows, footer: null }, colors, toolsAt(35));
    const more = rec.texts.find((text) => /^\+\d+ MORE$/.test(text));
    expect(more).toBeDefined();
    const shown = rec.texts.filter((text) => /^HOME\d/.test(text)).length;
    expect(shown + Number(/\d+/.exec(more ?? '')?.[0])).toBe(rows.length);
  });
});

describe('plaza SPIELPLAN group label clears the title (audit: SPIELTAG 2 / SPIELPLAN)', () => {
  it('stacks the first label under the 78 px title at the board floor, and both groups still fit', () => {
    const tools = toolsAt(29);
    const top = scheduleLabelTop(78, tools);
    expect(top - 146).toBeGreaterThanOrEqual(stackStep(78, 29));
    expect(top - 146).toBeGreaterThan(32);
    // Full groups (current + next matchday) end above the 56 px ticker strip.
    const pitch = 50;
    const rowH = 46;
    const secondLabel = top + 10 + BOARD_FIXTURE_ROWS * pitch + 22;
    const lastRowBottom = secondLabel + 10 + (BOARD_NEXT_ROWS - 1) * pitch + rowH;
    expect(lastRowBottom).toBeLessThanOrEqual(592 - 56);
    // The inter-group label keeps a 1.2 line box to the row text above it.
    const rowTextBaseline = top + 10 + (BOARD_FIXTURE_ROWS - 1) * pitch + rowH - 15;
    expect(secondLabel - rowTextBaseline).toBeGreaterThanOrEqual(lineStep(29));
  });
});
