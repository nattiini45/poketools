import { describe, expect, it } from 'vitest';
import { paintLedger, type LedgerColumnCopy, type LedgerContext } from '@/components/world/route/teams/ledger-painter';
import { CLOUDS_LEDGER_STYLE } from '@/components/world/route/teams/ledger-styles';
import { rollCallLights } from '@/lib/route-world/roll-call';
import { floatFormation, floatLedgerLayout } from '../AcesFloats';

/**
 * ROLLOUT-PLAN §3.2 E2 (the clouds P0): the Roll-Call Ledger painted a blank
 * face at every theme and width. `floatFormation` is cached per COUNT, so its
 * slots (and the ledger columns built from them) carry the seat ids
 * `float-0 … float-N` — while the ledger copy is keyed by the trainers'
 * player ids. `paintLedger` paints a column only when its id is in the copy,
 * so every column was dropped: the frame and end caps only. The columns are
 * now re-keyed to the trainer in their standings slot (`floatLedgerLayout`).
 */

function fakeContext(): LedgerContext & { texts: string[] } {
  const texts: string[] = [];
  let px = 10;
  return {
    texts,
    get font() {
      return `${px}px`;
    },
    set font(value: string) {
      const m = /(\d+(?:\.\d+)?)px/.exec(value);
      if (m) px = Number(m[1]);
    },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    measureText: (text: string) => ({ width: [...text].length * 0.6 * px }) as TextMetrics,
    fillText: (text: string) => {
      texts.push(text);
    },
    fillRect: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    arc: () => undefined,
  } as unknown as LedgerContext & { texts: string[] };
}

const NAMES = ['Wren Skye', 'Ari Bell', 'Dane Holt', 'Mika Rhee', 'Nele Brandt', 'Juno Vale', 'Tomas Ro', 'Sia Park'];

function copyFor(n: number): LedgerColumnCopy[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `player-${String(i + 1).padStart(4, '0')}`,
    rank: i + 1,
    name: NAMES[i % NAMES.length],
    species: null,
    heightM: null,
    band: '#3a6ea5',
    bandInk: '#ffffff',
  }));
}

describe('clouds Roll-Call Ledger columns', () => {
  it('the cached float formation is keyed by seat, not by trainer (the blank-face cause)', () => {
    const copy = copyFor(8);
    const seatIds = floatFormation(8).ledger.columns.map((c) => c.id);
    expect(seatIds.some((id) => copy.some((c) => c.id === id))).toBe(false);
  });

  for (const n of [1, 4, 8]) {
    it(`N = ${n}: every column names its trainer and paints`, () => {
      const copy = copyFor(n);
      const layout = floatLedgerLayout(floatFormation(n), copy.map((c) => c.id));
      expect(layout.columns.map((c) => c.id).sort()).toEqual(copy.map((c) => c.id).sort());
      // Standings slot i carries trainer i (the float and its rider stand there).
      for (const column of layout.columns) expect(column.id).toBe(copy[column.index].id);
      const ctx = fakeContext();
      const fits = paintLedger(ctx, layout.canvas.width, layout.canvas.height, layout, copy, rollCallLights(n, null), CLOUDS_LEDGER_STYLE, 'en');
      expect(fits).toHaveLength(n);
      for (const c of copy) expect(ctx.texts.join('|')).toContain(c.name);
    });
  }

  it('the formation cache itself is left untouched (shared with SkyFigures and the floats)', () => {
    const before = floatFormation(8).ledger.columns.map((c) => c.id);
    floatLedgerLayout(floatFormation(8), copyFor(8).map((c) => c.id));
    expect(floatFormation(8).ledger.columns.map((c) => c.id)).toEqual(before);
  });
});
