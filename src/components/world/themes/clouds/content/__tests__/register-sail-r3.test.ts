import { describe, expect, it } from 'vitest';
import type { BoardContent } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import { contrastRatio, TEXT_BOX_ASCENT_EM, TEXT_BOX_DESCENT_EM } from '@/lib/route-world/board-text';
import type { WorldRosterTile } from '@/lib/worlds/route-data';
import { cloudsKickoffStamp, paintRegisterSail, SAIL_TEX_H, SAIL_TEX_W } from '../paint';

/**
 * Fidelity W1 r3 — the clouds register sail. r2 painted each tile's name at
 * the top and its stat at the cell bottom, directly over the next row's name,
 * so the stat read as belonging to the tile below; a two-line hyphen wrap
 * put "ALOLA" on its own stat, and the stat ink was 62 %.
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
  fill: string;
}

function recordingContext(lines: Line[]): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    measureText: (text: string) => ({ width: String(text).length * px() * 0.55 }),
    fillRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    stroke: noop,
    fill: noop,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textAlign: 'left',
  };
  ctx.fillText = (text: string, x: number, y: number) =>
    lines.push({ text: String(text), x, y, px: px(), fill: String(ctx.fillStyle) });
  Object.defineProperty(ctx, 'font', {
    get: () => font,
    set: (value: string) => {
      font = value;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

const NAMES = ['Bulbasaur', 'Oddish', 'Geodude-Alola', 'Charmander', 'Squirtle', 'Tauros-Paldea-Aqua', 'Pikachu', 'Eevee', 'Mew'];
const TILES: WorldRosterTile[] = NAMES.map((name, i) => ({
  id: `t${i}`,
  line: i + 1,
  name,
  price: 10 + i * 2,
  band: i % 2 ? 'premium' : 'guenstig',
})) as WorldRosterTile[];

const INK = '#16223a';

function paintAt(floor: number): Line[] {
  const lines: Line[] = [];
  paintRegisterSail(
    recordingContext(lines),
    SAIL_TEX_W,
    SAIL_TEX_H,
    TILES,
    { canvas: '#f1e9d6', ink: INK, accent: '#e8922e' },
    toolsAt(floor),
    '9 OF 30 LINES · TAP TO READ UP CLOSE',
  );
  return lines.filter((line) => line.y > 60); // the tiles (the heading band paints at y 44)
}

describe('clouds register sail tiles are one block each (W1 r3)', () => {
  for (const floor of [40, 50]) {
    it(`@${floor} px: no line box overlaps another; the gap inside a tile is smaller than between tiles`, () => {
      const lines = paintAt(floor);
      // Group into tile columns by x (tiles start at 40 + col · 488).
      const columns = new Map<number, Line[]>();
      for (const line of lines) {
        const col = Math.floor((line.x - 40) / 488);
        columns.set(col, [...(columns.get(col) ?? []), line]);
      }
      expect(columns.size).toBe(3);
      for (const col of columns.values()) {
        // One line box per baseline (the index shares the name's baseline).
        const rows = [...new Map(col.map((line) => [line.y, line])).values()].sort((a, b) => a.y - b.y);
        expect(rows.length).toBe(6); // 3 tiles × (name, stat)
        const boxes = rows.map((line) => ({
          top: line.y - line.px * TEXT_BOX_ASCENT_EM,
          bottom: line.y + line.px * TEXT_BOX_DESCENT_EM,
          text: line.text,
        }));
        const gaps: number[] = [];
        for (let i = 1; i < boxes.length; i += 1) {
          const gap = boxes[i].top - boxes[i - 1].bottom;
          expect(gap, `${boxes[i - 1].text} → ${boxes[i].text}`).toBeGreaterThanOrEqual(-0.5);
          gaps.push(gap);
        }
        // Alternating: name→stat (inside), stat→name (between).
        const inside = gaps.filter((_, i) => i % 2 === 0);
        const between = gaps.filter((_, i) => i % 2 === 1);
        expect(Math.max(...inside)).toBeLessThanOrEqual(0.25 * floor);
        expect(Math.min(...between)).toBeGreaterThan(Math.max(...inside) + 20);
      }
    });
  }

  it('every name paints on ONE line (a long form is cut in the middle, never wrapped into its stat)', () => {
    const lines = paintAt(50);
    const stats = lines.filter((line) => / PTS · /.test(line.text));
    expect(stats).toHaveLength(9);
    for (const name of NAMES.map((n) => n.toUpperCase())) {
      // Fidelity W1 r4: an over-wide name keeps its form suffix (`HEAD…-TAIL`).
      const painted = lines.filter((line) => {
        if (line.text === name) return true;
        const [head, tail] = line.text.split('…');
        return tail !== undefined && head.length > 0 && name.startsWith(head) && name.endsWith(tail);
      });
      expect(painted.length, name).toBe(1);
      if (painted[0].text !== name && name.includes('-')) {
        expect(painted[0].text.endsWith(name.slice(name.lastIndexOf('-'))), name).toBe(true);
      }
    }
    expect(lines.some((line) => line.text === 'ALOLA')).toBe(false);
  });

  it('stat and name ink clear 4.5:1 on the tile in both themes', () => {
    const lines = paintAt(50);
    for (const line of lines) expect(line.fill).toBe(INK);
    // The tile is 50 % white over the sail canvas (light #f1e9d6, dark #42536e).
    const over = (hex: string) => {
      const c = [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) + 255) / 2));
      return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };
    for (const canvas of ['#f1e9d6', '#42536e']) expect(contrastRatio(INK, over(canvas))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('clouds kickoff stamp follows the live ticker (W1 r3)', () => {
  const base = {
    participants: 12,
    completed: 20,
    live: { home: 'SKYE', away: 'TIDE' },
    next: { date: '9/17', time: '18:00', iso: '2026-09-17T18:00:00Z' },
  } as unknown as BoardContent;
  const after = Date.parse('2026-09-17T18:40:00Z');

  it('after the live kickoff it names the live match, not the past stamp', () => {
    expect(cloudsKickoffStamp(base, after)).toBe('LIVE · SKYE – TIDE · 12 TRAINERS');
  });
  it('before the kickoff it still counts to it', () => {
    expect(cloudsKickoffStamp(base, Date.parse('2026-09-16T00:00:00Z'))).toBe('NEXT KICKOFF · 9/17 18:00 · 12 TRAINERS');
  });
  it('nothing live, nothing ahead: the season line, never a past kickoff', () => {
    expect(cloudsKickoffStamp({ ...base, live: null } as BoardContent, after)).toBe('20 MATCHES FLOWN · 12 TRAINERS');
  });
});
