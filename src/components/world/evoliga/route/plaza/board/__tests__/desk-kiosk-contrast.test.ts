import { describe, expect, it } from 'vitest';
import { pillContrast, SCORE_CHIP_ALPHA } from '../board-painters';
import {
  KIOSK_GROUND,
  KIOSK_INK,
  KIOSK_SCANLINE_ALPHA,
  KIOSK_SELECTED_INK,
  KIOSK_SUB_LIFT,
  KIOSK_TILE_FILL,
  mixHex,
  paintRosterGrid,
  ROSTER_TEX_H,
  ROSTER_TEX_W,
  type RosterTile,
} from '../../desk-painters';

/**
 * Fidelity wave 2 r2 (W1 contrast). The kiosk KADERLISTE measured min 2.3–2.5
 * (median 3.9) on the RENDERED w2 r1 frame; after the near-black ground and
 * light inks it measured min 5.05 (median 5.8) on the live frame. Ink choice
 * was verified on rendered pixels (PROGRESS "Failed Approaches": never choose
 * ink by texture-space luminance); these texture-space checks are only a
 * regression floor so a later edit cannot quietly walk the palette back.
 */

const DAY_ACCENT = '#2ee6a4';
const NIGHT_ACCENT = '#4ADE80';
const DAY_RED = '#e23b3b';
const NIGHT_RED = '#ff2a3a';

interface FillText {
  text: string;
  fill: string;
}

function recordingContext(out: FillText[]): CanvasRenderingContext2D {
  let fill = '#000000';
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string) => out.push({ text: String(text), fill }),
    measureText: (text: string) => ({ width: String(text).length * 12 }),
    fillRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    stroke: noop,
    fill: noop,
    save: noop,
    restore: noop,
    drawImage: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    strokeStyle: '',
    lineWidth: 1,
    font: '16px sans-serif',
    textAlign: 'left',
  };
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fill,
    set: (value: string) => {
      fill = value;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

function tiles(n: number): RosterTile[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    line: i + 1,
    name: `LINE ${i + 1}`,
    price: 10 + i,
    group: 'mittel',
    sprite: null,
  }));
}

describe('mixHex', () => {
  it('mixes in sRGB and clamps the share', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#102030', '#ffffff', 0)).toBe('#102030');
    expect(mixHex('#102030', '#ffffff', 2)).toBe('#ffffff');
  });
});

describe('kiosk KADERLISTE contrast floor (regression guard; verified on rendered pixels)', () => {
  it('every glyph is painted with a solid ink — never alpha-thinned', () => {
    for (const [accent, red] of [
      [DAY_ACCENT, DAY_RED],
      [NIGHT_ACCENT, NIGHT_RED],
    ]) {
      const out: FillText[] = [];
      paintRosterGrid(recordingContext(out), ROSTER_TEX_W, ROSTER_TEX_H, {
        tiles: tiles(9),
        total: 92,
        open: 20,
        accent,
        red,
        selected: 0,
        locale: 'de',
      });
      expect(out.length).toBeGreaterThan(20);
      for (const { text, fill } of out) expect(fill, text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('light inks hold ≥ 7:1 over the lightest ground stop, both palettes', () => {
    const lightestGround = KIOSK_GROUND[0];
    for (const hex of [DAY_ACCENT, NIGHT_ACCENT, DAY_RED, NIGHT_RED]) {
      const ink = mixHex(hex, '#ffffff', KIOSK_SUB_LIFT);
      expect(pillContrast(ink, lightestGround), `${hex} → ${ink}`).toBeGreaterThanOrEqual(7);
    }
    expect(pillContrast(KIOSK_INK, lightestGround)).toBeGreaterThanOrEqual(15);
  });

  it('the selected tile ink holds ≥ 7:1 on the accent fill', () => {
    for (const accent of [DAY_ACCENT, NIGHT_ACCENT]) {
      expect(pillContrast(KIOSK_SELECTED_INK, accent)).toBeGreaterThanOrEqual(7);
    }
  });

  it('ground, tile fill and scanlines stay dark / faint', () => {
    expect(pillContrast('#000000', KIOSK_GROUND[0])).toBeLessThan(1.25);
    const alpha = Number(/,\s*([\d.]+)\)$/.exec(KIOSK_TILE_FILL)?.[1]);
    expect(alpha).toBeLessThanOrEqual(0.04);
    expect(KIOSK_SCANLINE_ALPHA).toBeLessThanOrEqual(0.1);
  });
});

describe('ERGEBNISSE score chip', () => {
  it('stays a faint accent wash so the score keeps its ground dark', () => {
    expect(SCORE_CHIP_ALPHA).toBeLessThanOrEqual(0.12);
  });
});
