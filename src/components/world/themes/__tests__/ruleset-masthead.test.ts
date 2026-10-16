import { describe, expect, it } from 'vitest';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import {
  paintPlaque as paintMountainPlaque,
  PLAQUE_TEX_W as MOUNTAIN_W,
  PLAQUE_TEX_H as MOUNTAIN_H,
} from '@/components/world/themes/mountain/content/paint';
import {
  paintGatePlaque as paintCloudsPlaque,
  PLAQUE_TEX_W as CLOUDS_W,
  PLAQUE_TEX_H as CLOUDS_H,
} from '@/components/world/themes/clouds/content/paint';

/**
 * The mountain and clouds rules plaques paint the ruleset of record on one
 * masthead line at 96 px. It had no width bound, so a 20-odd-character
 * ruleset name (the seeded 'Core Liga: Hinrunde (NFE Phase)' is 31) ran off
 * both texture edges (PR #65 test pass, 5A-7). The name now steps down to 80
 * and 64 px, then ellipsizes, always inside the inner frame — and a name that
 * fits paints exactly the old single 96 px call.
 *
 * Recording context: every 2D call is a no-op except `fillText` (recorded
 * with the px it was painted at) and `measureText` (0.55 em per glyph, so the
 * fit takes its real branches).
 */

interface Painted {
  text: string;
  px: number;
  x: number;
  y: number;
  maxWidth: number | undefined;
}

function recordingContext(out: Painted[]): CanvasRenderingContext2D {
  let px = 16;
  const state: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, key) {
      if (key === 'font') return `${px}px`;
      if (key === 'fillText')
        return (text: string, x: number, y: number, maxWidth?: number) =>
          out.push({ text: String(text), px, x, y, maxWidth });
      if (key === 'measureText') return (text: string) => ({ width: String(text).length * px * 0.55 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern')
        return () => ({ addColorStop: () => undefined });
      if (typeof key === 'string' && key in state) return state[key];
      return () => undefined;
    },
    set(_target, key, value) {
      if (key === 'font') px = Number(/(\d+(?:\.\d+)?)px/.exec(String(value))?.[1] ?? 16);
      else state[String(key)] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

/** The rules station's clamp at the plaque doc's 59 px floor. */
const TOOLS: BoardPaintTools = { fontPx: (n: number) => Math.max(Math.ceil(n), 59), fontFloorPx: 59 };
const COLORS = { ground: '#ddd5c2', ink: '#2b2f26', accent: '#e8862e' };

type Painter = typeof paintMountainPlaque;
const PAINTERS: [string, Painter, number, number][] = [
  ['mountain', paintMountainPlaque, MOUNTAIN_W, MOUNTAIN_H],
  ['clouds', paintCloudsPlaque, CLOUDS_W, CLOUDS_H],
];

function masthead(paint: Painter, w: number, h: number, rulesetName: string, locale: 'en' | 'de' = 'en'): Painted {
  const out: Painted[] = [];
  paint(
    recordingContext(out),
    w,
    h,
    { title: 'RULES', rulesetName, rows: [['Format', 'Singles']], note: null },
    COLORS,
    TOOLS,
    locale,
  );
  const line = out.find((call) => call.y === 196);
  if (!line) throw new Error('no masthead line painted');
  return line;
}

describe.each(PAINTERS)('%s rules plaque masthead', (_theme, paint, w, h) => {
  const inner = w - 120;

  it('a name that fits paints the one 96 px line, unchanged', () => {
    expect(masthead(paint, w, h, 'Gen 9 RU')).toStrictEqual({ text: 'GEN 9 RU', px: 96, x: w / 2, y: 196, maxWidth: undefined });
  });

  it('a longer name steps the size down and stays inside the inner frame', () => {
    const line = masthead(paint, w, h, 'Core Liga: Hinrunde (NFE Phase)');
    expect(line.text).toBe('CORE LIGA: HINRUNDE (NFE PHASE)');
    expect(line.px).toBeLessThan(96);
    expect(line.text.length * line.px * 0.55).toBeLessThanOrEqual(inner);
  });

  it('a German name paints its capitals with SS, never ẞ (i18n upperForPaint)', () => {
    expect(masthead(paint, w, h, 'Große Liga', 'de').text).toBe('GROSSE LIGA');
  });

  it('a name too long for every step is ellipsized at the smallest, never cut by the texture edge', () => {
    const line = masthead(paint, w, h, 'An extremely long ruleset name that no masthead line could ever hold');
    expect(line.px).toBe(64);
    expect(line.text.endsWith('…')).toBe(true);
    expect(line.text.length * line.px * 0.55).toBeLessThanOrEqual(inner);
  });
});
