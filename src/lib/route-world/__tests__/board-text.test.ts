import { describe, expect, it } from 'vitest';
import { formatPack } from '@/lib/format-pack';
import type { PriceGroup } from '@/types/point-buy';

/** The active format pack's painted price-band word, upper-cased like the painters. */
const bandWord = (locale: 'en' | 'de', group: PriceGroup) =>
  formatPack.messages[locale].paint.priceBand[group].toLocaleUpperCase(locale);
import {
  bestInk,
  boardRowHeadline,
  contrastRatio,
  englishKickoffLine,
  indexGutter,
  kickoffTickerState,
  wrapFields,
  lineStep,
  measuredLeading,
  MIN_LEADING,
  priceBandLabel,
  stackStep,
  type BoardRow,
} from '../board-text';

/** Width model shared with the painter guards: 0.55 em per glyph. */
function measurer(px: number) {
  return { measureText: (text: string) => ({ width: text.length * px * 0.55 }) };
}

describe('board-text vertical rhythm', () => {
  it('steps repeated lines by at least the 1.2 line box', () => {
    for (const px of [22, 29, 35, 40, 43, 50, 140]) {
      expect(measuredLeading(lineStep(px), px)).toBeGreaterThanOrEqual(MIN_LEADING);
      expect(lineStep(px)).toBe(Math.ceil(px * MIN_LEADING));
    }
  });

  it('never lets a caller ask for less than the minimum leading', () => {
    expect(lineStep(35, 1.0)).toBe(lineStep(35));
    expect(lineStep(35, 1.5)).toBeGreaterThan(lineStep(35));
  });

  it('stacks mixed sizes by descent box above + ascent box below', () => {
    // The pulse boards' measured defect: a 43 px subtitle 34 px above a
    // 43 px header. The law demands 52.
    expect(stackStep(43, 43)).toBe(52);
    expect(34).toBeLessThan(stackStep(43, 43));
    // A small line under a large title clears the title's descent box...
    expect(stackStep(78, 29)).toBe(50);
    // ...and a large title under a small kicker clears its own ascent box.
    expect(stackStep(29, 78)).toBeGreaterThan(78 * 0.8);
    // Every step keeps at least the lower line's own 1.2 box when it is the larger.
    expect(stackStep(20, 60)).toBeGreaterThanOrEqual(Math.ceil(60 * 0.9));
  });
});

describe('board-text index gutter', () => {
  it('starts the text right of the widest measured index plus the gap', () => {
    const ctx = measurer(50);
    // "01" at 50 px measures 55 — the authored 44 px column overprinted it.
    const x = indexGutter(ctx, ['01', '02', '10'], 16, 10, 62);
    expect(x).toBe(Math.ceil(16 + 55 + 10));
    expect(x).toBeGreaterThan(62);
  });

  it('keeps the authored column when the measured one is narrower', () => {
    expect(indexGutter(measurer(24), ['01'], 18, 8, 70)).toBe(70);
  });

  it('is fixed per face (same gutter for every row)', () => {
    const ctx = measurer(40);
    const labels = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
    expect(indexGutter(ctx, labels, 18, 8)).toBe(indexGutter(ctx, ['10'], 18, 8));
  });

  it('handles an empty roster', () => {
    expect(indexGutter(measurer(40), [], 18, 8, 70)).toBe(70);
  });
});

describe('board-text row schemas (only fixtures say "vs")', () => {
  it('joins match rows — including legacy rows without a kind — with vs', () => {
    expect(boardRowHeadline({ home: 'WARREN', away: 'HOFFMAN', detail: '' })).toBe('WARREN vs HOFFMAN');
    expect(boardRowHeadline({ kind: 'match', home: 'A', away: 'B', detail: '' })).toBe('A vs B');
  });

  it('never injects vs into stat or standing rows', () => {
    const rows: BoardRow[] = [
      { kind: 'stat', text: '8 TRAINERS', detail: '3 MATCHES PLAYED' },
      { kind: 'stat', text: 'MATCHDAY 2', detail: 'FIRST HALF' },
      { kind: 'standing', rank: 1, name: 'WELLS', record: '4–1', detail: '12 PTS' },
    ];
    const headlines = rows.map(boardRowHeadline);
    expect(headlines).toEqual(['8 TRAINERS', 'MATCHDAY 2', '1. WELLS · 4–1']);
    headlines.forEach((line) => expect(line).not.toMatch(/\bvs\b/i));
  });
});

describe('board-text price-band words', () => {
  it('paints English worlds in English', () => {
    expect(priceBandLabel('guenstig', 'en')).toBe(bandWord('en', 'guenstig'));
    expect(priceBandLabel('hoch', 'en')).toBe(bandWord('en', 'hoch'));
    expect(priceBandLabel('mittel', 'en')).toBe(bandWord('en', 'mittel'));
    expect(priceBandLabel('Premium', 'en')).toBe(bandWord('en', 'premium'));
  });

  it('spells German surfaces with their umlaut', () => {
    for (const group of ['guenstig', 'hoch', 'mittel', 'premium', 'budget'] as const) {
      expect(priceBandLabel(group, 'de')).toBe(bandWord('de', group));
    }
  });

  it('passes an unknown key through upper-cased, never dropped', () => {
    expect(priceBandLabel('fire', 'en')).toBe('FIRE');
    expect(priceBandLabel('fire', 'de')).toBe('FIRE');
  });
});

// ── Round 3 (fidelity W1): kickoff ticker state, separator wrap, contrast ──

describe('kickoffTickerState (shared by the plaza and the English isles)', () => {
  const k = (iso: string) => ({ iso, date: iso.slice(5, 10), time: iso.slice(11, 16) });
  const past = k('2026-09-17T18:00:00Z');
  const future = k('2026-09-24T18:00:00Z');
  const after = Date.parse('2026-09-17T18:30:00Z');

  it('a future next wins', () => {
    expect(kickoffTickerState({ next: future, live: { home: 'A', away: 'B' } }, after)).toEqual({
      kind: 'next',
      iso: future.iso,
      kickoff: future,
    });
  });
  it('a past next yields to the live match', () => {
    expect(kickoffTickerState({ next: past, live: { home: 'SKYE', away: 'TIDE' } }, after)).toEqual({
      kind: 'live',
      home: 'SKYE',
      away: 'TIDE',
    });
    expect(englishKickoffLine({ next: past, live: { home: 'SKYE', away: 'TIDE' } }, after)).toBe('LIVE · SKYE – TIDE');
  });
  it('no live match: the first FUTURE kickoff, else null (never a past stamp)', () => {
    expect(kickoffTickerState({ next: past, live: null, kickoffs: [past, future] }, after)).toMatchObject({ kind: 'next', iso: future.iso });
    expect(englishKickoffLine({ next: past, live: null, kickoffs: [past, future] }, after)).toBe('NEXT KICKOFF · 09-24 18:00');
    expect(kickoffTickerState({ next: past, live: null, kickoffs: [past] }, after)).toBeNull();
    expect(kickoffTickerState({ next: null, live: null }, after)).toBeNull();
  });
});

describe('wrapFields never leaves a separator at a line edge', () => {
  const m = { measureText: (t: string) => ({ width: t.length * 10 }) };
  it('breaks inside a field rather than orphaning the dot', () => {
    expect(wrapFields(m, 'MD 2 · 9/17 18:00 · LIVE', 170, 2)).toEqual(['MD 2 · 9/17 18:00', 'LIVE']);
    expect(wrapFields(m, 'MD 2 · 9/17 18:00 · LIVE', 120, 2)).toEqual(['MD 2 · 9/17', '18:00 · LIVE']);
    expect(wrapFields(m, '4. WARREN · 2–1', 110, 2)).toEqual(['4. WARREN', '2–1']);
  });
  it('never strands the dash of a glued live pairing', () => {
    expect(wrapFields(m, englishKickoffLine({ next: null, live: { home: 'BELL', away: 'COLE' } }, 0)!, 120, 2)).toEqual([
      'LIVE',
      'BELL – COLE',
    ]);
  });
  it('keeps a line that fits whole, and honours maxLines', () => {
    expect(wrapFields(m, 'LIVE · A – B', 400, 2)).toEqual(['LIVE · A – B']);
    expect(wrapFields(m, 'a · b · c · d', 10, 2)).toEqual(['a', 'b']);
  });
});

describe('contrast helpers', () => {
  it('WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  it('bestInk picks the most legible candidate', () => {
    expect(bestInk('#e8862e', ['#8a6f4d', '#3a2c1c', '#ffffff'])).toBe('#3a2c1c');
    expect(bestInk('#101010', ['#3a2c1c', '#ffffff'])).toBe('#ffffff');
  });
});
