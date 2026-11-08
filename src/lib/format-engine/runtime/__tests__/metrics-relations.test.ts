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

describe('stageMetricsFor ships what the metric reads, and nothing else', () => {
  const attrRef: Expr = { k: 'ref', name: 'attr.team', t: 'number' };
  const defReading = (expr: Expr): FormatDefinition => {
    const def = wichtelDef();
    return {
      ...def,
      attributes: [
        { key: 'team', label: text('Team'), on: 'player', type: 'number', assign: { kind: 'random_seeded', min: 1, max: 9 } },
        { key: 'secret_team', label: text('Secret team'), on: 'player', type: 'number', assign: { kind: 'random_seeded', min: 1, max: 9 } },
      ] as unknown as FormatDefinition['attributes'],
      metrics: [{ kind: 'metric.define', of: 'player', key: 'm', label: text('M'), expr }],
    };
  };

  it('puts only the refs the expressions name into the public player refs', () => {
    const def = defReading({ k: 'arith', op: '+', a: attrRef, b: { k: 'ref', name: 'points', t: 'number' } });
    const metrics = stageMetricsFor(def, stateFor(def), SEED, 'swiss', ['a', 'b']);
    const names = Object.values(metrics?.playerRefs ?? {}).flatMap((refs) => Object.keys(refs));
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names)).toEqual(new Set(['attr.team']));
    expect(JSON.stringify(metrics)).not.toContain('secret_team');
  });

  it('ships no refs for a metric that reads none', () => {
    const def = defReading({ k: 'ref', name: 'points', t: 'number' });
    const metrics = stageMetricsFor(def, stateFor(def), SEED, 'swiss', ['a']);
    expect(metrics?.playerRefs).toEqual({ a: {} });
  });
});

describe('stageMetricsFor turns a seeded draw into a per-player value', () => {
  const draw: Expr = { k: 'rand', key: 'luck' };
  const defDrawing = (): FormatDefinition => ({
    ...wichtelDef(),
    metrics: [{ kind: 'metric.define', of: 'player', key: 'luck', label: text('Luck'), expr: draw }],
  });
  const rank = [{ kind: 'metric' as const, metric: 'luck', direction: 'desc' as const }];
  const players = ['a', 'b', 'c', 'd'];

  it('ranks the public table (no seed) like the server (with the seed), and ships no rand node', () => {
    const def = defDrawing();
    const metrics = stageMetricsFor(def, stateFor(def), SEED, 'swiss', players);
    expect(JSON.stringify(metrics?.defs)).not.toContain('"rand"');
    const base = { stage: { key: 'swiss', scoring: { win: 1, loss: 0, bye: 0 }, rank }, participantIds: players, participantNames: {}, matches: [], metricDefs: metrics?.defs, playerRefs: metrics?.playerRefs };
    const publicTable = computeStageStandings(base);
    const serverTable = computeStageStandings({ ...base, seed: SEED });
    expect(publicTable.map((r) => [r.player_id, r.metrics?.luck])).toEqual(serverTable.map((r) => [r.player_id, r.metrics?.luck]));
    // The draws are the seeded ones, not the seedless fallback: they differ per player and per season seed.
    const other = stageMetricsFor(def, stateFor(def), 'another-seed-0123456789', 'swiss', players);
    expect(computeStageStandings({ ...base, playerRefs: other?.playerRefs }).map((r) => r.metrics?.luck)).not.toEqual(publicTable.map((r) => r.metrics?.luck));
    expect(new Set(publicTable.map((r) => r.metrics?.luck)).size).toBe(players.length);
  });
});
