import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import type { TiebreakerStep } from '@/types/format-rules';
import {
  ROUND_ROBIN_MATCH_POINTS,
  effectiveMatchPoints,
  effectiveTiebreakerChain,
  isUsableTiebreakerChain,
  roundRobinMatchPoints,
} from '../standings-rules';

const PACK_CHAIN: TiebreakerStep[] = [...epbPack.tiebreakerChain];

/** A pack that differs from the example pack in both values, so a test sees which one a helper read. */
const OTHER_PACK = {
  matchPoints: { win: 5, draw: 2 },
  tiebreakerChain: ['head_to_head', 'match_points'] as const,
};

describe('isUsableTiebreakerChain', () => {
  it.each([
    ['one ranking step', ['match_points']],
    ['every step, decision match last', ['head_to_head', 'kill_difference', 'evolution_points', 'match_points', 'decision_match']],
    ['any order of the ranking steps', ['evolution_points', 'head_to_head']],
  ])('accepts %s', (_label, chain) => {
    expect(isUsableTiebreakerChain(chain)).toBe(true);
  });

  it.each([
    ['an empty list', []],
    ['a missing value', undefined],
    ['null', null],
    ['a string', 'match_points'],
    ['an object', { 0: 'match_points' }],
    ['an unknown step', ['match_points', 'coin_flip']],
    ['a non-string step', ['match_points', 3]],
    ['a repeated step', ['match_points', 'match_points']],
    ['a decision match that is not last', ['decision_match', 'match_points']],
    ['a decision match alone: nothing to rank by', ['decision_match']],
  ])('rejects %s', (_label, chain) => {
    expect(isUsableTiebreakerChain(chain)).toBe(false);
  });
});

describe('effectiveTiebreakerChain', () => {
  it('uses the stored order when it is usable', () => {
    const stored: TiebreakerStep[] = ['head_to_head', 'evolution_points', 'match_points'];
    expect(effectiveTiebreakerChain({ tiebreaker_order: stored })).toEqual(stored);
  });

  it('returns a copy: the caller can never change the stored row or the pack through it', () => {
    const stored: TiebreakerStep[] = ['match_points'];
    const chain = effectiveTiebreakerChain({ tiebreaker_order: stored });
    expect(chain).not.toBe(stored);
    const fromPack = effectiveTiebreakerChain(null);
    expect(fromPack).not.toBe(epbPack.tiebreakerChain);
  });

  it.each([
    ['no rules row', null],
    ['an undefined row', undefined],
    ['a row without the field', {}],
    ['an empty list', { tiebreaker_order: [] }],
    ['an unknown step', { tiebreaker_order: ['match_points', 'coin_flip'] }],
    ['a repeated step', { tiebreaker_order: ['match_points', 'match_points'] }],
    ['a misplaced decision match', { tiebreaker_order: ['decision_match', 'match_points'] }],
    ['a value that is no list', { tiebreaker_order: 'match_points' }],
    ['null', { tiebreaker_order: null }],
  ])('falls back to the pack chain for %s, never throwing', (_label, rules) => {
    expect(effectiveTiebreakerChain(rules)).toEqual(PACK_CHAIN);
  });

  it('reads the pack it is handed', () => {
    expect(effectiveTiebreakerChain(null, OTHER_PACK)).toEqual(['head_to_head', 'match_points']);
    expect(effectiveTiebreakerChain({ tiebreaker_order: ['match_points'] }, OTHER_PACK)).toEqual(['match_points']);
  });
});

describe('effectiveMatchPoints', () => {
  it('scores the pack points for an Evolution Point Buy season, whatever the caller asked for', () => {
    const expected = { pointsPerWin: epbPack.matchPoints.win, pointsPerDraw: epbPack.matchPoints.draw };
    expect(effectiveMatchPoints('evolution_point_buy')).toEqual(expected);
    expect(effectiveMatchPoints('evolution_point_buy', { pointsPerWin: 3, pointsPerDraw: 0 })).toEqual(expected);
    expect(effectiveMatchPoints('evolution_point_buy', { pointsPerWin: 99 })).toEqual(expected);
  });

  it('follows the pack: a pack with other points changes the table, the caller does not', () => {
    expect(effectiveMatchPoints('evolution_point_buy', { pointsPerWin: 3, pointsPerDraw: 0 }, OTHER_PACK)).toEqual({
      pointsPerWin: 5,
      pointsPerDraw: 2,
    });
  });

  it.each(['singles', 'doubles', 'draft', 'standard', null, undefined])(
    'hands the requested points back unchanged for %s',
    (format) => {
      expect(effectiveMatchPoints(format, { pointsPerWin: 3, pointsPerDraw: 0 }, OTHER_PACK)).toEqual({
        pointsPerWin: 3,
        pointsPerDraw: 0,
      });
      expect(effectiveMatchPoints(format, {}, OTHER_PACK)).toEqual({});
    },
  );
});

describe('roundRobinMatchPoints', () => {
  it('keeps 3 a win and 0 a draw for every league type except Evolution Point Buy', () => {
    for (const format of ['singles', 'doubles', 'draft', 'standard', null, undefined]) {
      expect(roundRobinMatchPoints(format, OTHER_PACK)).toEqual({ pointsPerWin: 3, pointsPerDraw: 0 });
    }
    expect(ROUND_ROBIN_MATCH_POINTS).toEqual({ pointsPerWin: 3, pointsPerDraw: 0 });
  });

  it('uses the pack points for Evolution Point Buy', () => {
    expect(roundRobinMatchPoints('evolution_point_buy', OTHER_PACK)).toEqual({ pointsPerWin: 5, pointsPerDraw: 2 });
    expect(roundRobinMatchPoints('evolution_point_buy')).toEqual({
      pointsPerWin: epbPack.matchPoints.win,
      pointsPerDraw: epbPack.matchPoints.draw,
    });
  });
});
