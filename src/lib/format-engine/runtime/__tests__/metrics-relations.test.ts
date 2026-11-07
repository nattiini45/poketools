import { describe, expect, it } from 'vitest';
import type { Expr } from '@/lib/format-kit/expr/ast';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { computeStageStandings } from '../../standings';
import { stageHasCustomMetrics, stageMetricsFor } from '../metrics';
import { link, SEED, stateFor, wichtelDef } from './helpers';

const text = (en: string) => ({ en: { v: en, s: 'human' as const }, base: 'en' as const });

const santaOfB: Expr = {
  k: 'if',
  cond: { k: 'rel', relation: 'santa', a: { k: 'ref', name: 'player', t: 'text' }, b: { k: 'str', v: 'b' } },
  then: { k: 'num', v: 1 },
  else: { k: 'num', v: 0 },
};

function defWith(visibility: { from: 'all' | 'own' | 'hidden'; to: 'all' | 'own' | 'hidden' }): FormatDefinition {
  const def = wichtelDef();
  return {
    ...def,
    relations: [{ key: 'santa', label: text('Santa'), shape: 'derangement', visibility }],
    metrics: [{ kind: 'metric.define', of: 'player', key: 'gives_to_b', label: text('Gives to b'), expr: santaOfB }],
  };
}

describe('stageMetricsFor with rel()', () => {
  const links = [link('a', 'b'), link('b', 'c'), link('c', 'a')];

  it('hands over only the links the public sees whole', () => {
    const open = stageMetricsFor(defWith({ from: 'all', to: 'all' }), stateFor(wichtelDef(), { links }), SEED, 'swiss', ['a', 'b', 'c']);
    expect(open?.relations).toEqual({ santa: [['a', 'b'], ['b', 'c'], ['c', 'a']] });
    const secret = stageMetricsFor(defWith({ from: 'hidden', to: 'all' }), stateFor(wichtelDef(), { links }), SEED, 'swiss', ['a', 'b', 'c']);
    expect(secret?.relations).toBeUndefined();
    expect(JSON.stringify(secret)).not.toContain('"c","a"');
  });

  it('carries nothing for a revealed link with a hidden side before the reveal', () => {
    const revealed = [link('a', 'b', 'santa', true), link('b', 'c')];
    const metrics = stageMetricsFor(defWith({ from: 'hidden', to: 'own' }), stateFor(wichtelDef(), { links: revealed }), SEED, 'swiss', ['a', 'b', 'c']);
    expect(metrics?.relations).toEqual({ santa: [['a', 'b']] });
  });

  it('makes the table agree with the open links', () => {
    const metrics = stageMetricsFor(defWith({ from: 'all', to: 'all' }), stateFor(wichtelDef(), { links }), SEED, 'swiss', ['a', 'b', 'c']);
    const rows = computeStageStandings({
      stage: { key: 'swiss', scoring: { win: 1, loss: 0, bye: 0 }, rank: [] },
      participantIds: ['a', 'b', 'c'],
      participantNames: {},
      matches: [],
      metricDefs: metrics?.defs,
      relations: metrics?.relations,
    });
    expect(Object.fromEntries(rows.map((r) => [r.player_id, r.metrics?.gives_to_b]))).toEqual({ a: 1, b: 0, c: 0 });
  });
});

describe('stageHasCustomMetrics', () => {
  it('is true for a player metric on any stage, and for a placement on its own stage only', () => {
    expect(stageHasCustomMetrics(defWith({ from: 'all', to: 'all' }), 'swiss')).toBe(true);
    expect(stageHasCustomMetrics(wichtelDef(), 'swiss')).toBe(false);
    const placed: FormatDefinition = {
      ...wichtelDef(),
      metrics: [{ kind: 'score.placement', key: 'place_points', label: text('Place'), stage: 'finals', points: [3, 2, 1] }],
    };
    expect(stageHasCustomMetrics(placed, 'finals')).toBe(true);
    expect(stageHasCustomMetrics(placed, 'swiss')).toBe(false);
  });
});
