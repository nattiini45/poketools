import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcupDoc } from '@/lib/format-kit/__tests__/fixtures/docs';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { SEED, stateFor } from './helpers';
import { envBaseOf } from '../load';
import { evaluateEndWhen, roundsBoundReached, stageFactsOf } from '../stage-end';

const rounds = [
  { id: 'r1', round_number: 1, status: 'completed' },
  { id: 'r2', round_number: 2, status: 'active' },
  { id: 'r3', round_number: 3, status: 'active' },
];

describe('stageFactsOf', () => {
  it('counts a round complete by its status or by all of its matches', () => {
    const matches = [
      { round_id: 'r1', status: 'completed' },
      { round_id: 'r2', status: 'completed' },
      { round_id: 'r2', status: 'completed' },
      { round_id: 'r3', status: 'scheduled' },
    ];
    expect(stageFactsOf(rounds, matches, 6)).toEqual({ round: 2, rounds_played: 2, open_matches: 1, participants: 6 });
  });

  it('has no completed round before any match is done', () => {
    expect(stageFactsOf(rounds.slice(1), [{ round_id: 'r2', status: 'scheduled' }], 4)).toEqual({
      round: 0,
      rounds_played: 0,
      open_matches: 1,
      participants: 4,
    });
  });
});

describe('evaluateEndWhen', () => {
  const compiled = compile(wichtelcupDoc());
  const def = compiled.definition as FormatDefinition;
  const base = envBaseOf({ def, state: stateFor(def), seed: SEED }, 'stage_end:cup');
  const facts = (rounds_played: number) => ({ round: rounds_played, rounds_played, open_matches: 0, participants: 6 });

  it('a rounds bound holds from that many complete rounds', () => {
    expect(evaluateEndWhen({ kind: 'rounds', rounds: 3 }, facts(2), base).met).toBe(false);
    expect(evaluateEndWhen({ kind: 'rounds', rounds: 3 }, facts(3), base).met).toBe(true);
  });

  it('evaluates the expression over the stage env', () => {
    const cup = def.stages.find((stage) => stage.end_when?.kind === 'expr');
    const endWhen = cup?.end_when;
    expect(endWhen).toBeDefined();
    if (endWhen === undefined) return;
    expect(evaluateEndWhen(endWhen, facts(3), base)).toEqual({ met: false });
    expect(evaluateEndWhen(endWhen, facts(4), base)).toEqual({ met: true });
  });
});

describe('roundsBoundReached', () => {
  it('only a rounds bound blocks another round, once the counter got there', () => {
    expect(roundsBoundReached({ kind: 'rounds', rounds: 3 }, 2)).toBe(false);
    expect(roundsBoundReached({ kind: 'rounds', rounds: 3 }, 3)).toBe(true);
    expect(roundsBoundReached(undefined, 9)).toBe(false);
  });
});
