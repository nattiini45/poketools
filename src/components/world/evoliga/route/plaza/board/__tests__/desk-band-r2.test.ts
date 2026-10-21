import { describe, expect, it } from 'vitest';
import { formatPack } from '@/lib/format-pack';
import type { PriceGroup } from '@/types/point-buy';
import {
  paintHoloBoard,
  paintRosterGrid,
  ROSTER_TEX_H,
  ROSTER_TEX_W,
  HOLO_FIELD_H,
  HOLO_FIELD_W,
  type RosterTile,
} from '../../desk-painters';

/**
 * Fidelity W1 r2: the plaza desk is a German surface. Price-less tiles and
 * rows print their band, and the league stores the band as an ASCII key
 * ('guenstig'), so painting it raw read "GUENSTIG". Both paint sites now go
 * through `priceBandLabel(band, 'de')`.
 */

function recordingContext(texts: string[]): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string) => texts.push(String(text)),
    measureText: (text: string) => ({ width: String(text).length * px() * 0.55 }),
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
    rect: noop,
    clip: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    stroke: noop,
    fill: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    drawImage: noop,
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


/** The active format pack's painted price-band word, upper-cased like the painters. */
const bandWord = (locale: 'en' | 'de', group: PriceGroup) =>
  formatPack.messages[locale].paint.priceBand[group].toLocaleUpperCase(locale);
/** Every band, so the pack's words with umlauts are among them. */
const BANDS: PriceGroup[] = ['guenstig', 'mittel', 'hoch', 'premium', 'budget'];
const TRANSLITERATION = /UE|OE|AE/;

describe('plaza desk paints German price bands, never ASCII transliterations', () => {
  it('kiosk roster grid', () => {
    const tiles: RosterTile[] = BANDS.map((group, i) => ({
      id: `t${i}`,
      line: i + 1,
      name: `LINE ${i + 1}`,
      price: null,
      group,
      sprite: null,
    }));
    const texts: string[] = [];
    paintRosterGrid(recordingContext(texts), ROSTER_TEX_W, ROSTER_TEX_H, {
      tiles,
      total: tiles.length,
      open: 0,
      accent: '#35e0c8',
      red: '#e8322e',
      selected: 0,
      locale: 'de',
    });
    for (const band of BANDS) expect(texts).toContain(bandWord('de', band));
    for (const text of texts) expect(text, text).not.toMatch(TRANSLITERATION);
  });

  it('holo roster board', () => {
    const texts: string[] = [];
    paintHoloBoard(recordingContext(texts), HOLO_FIELD_W, HOLO_FIELD_H, {
      rows: BANDS.map((band, i) => ({ line: i + 1, name: `LINE ${i + 1}`, price: null, band })),
      total: 3,
      open: 0,
      accent: '#35e0c8',
      locale: 'de',
    });
    for (const band of BANDS) expect(texts.some((text) => text.includes(bandWord('de', band)))).toBe(true);
    for (const text of texts) expect(text, text).not.toMatch(TRANSLITERATION);
  });
});
