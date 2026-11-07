import { describe, expect, it } from 'vitest';
import { eventKey, unfiredRoundEnds } from '../events';

const round = (id: string, tournament_id: string, round_number: number, status = 'completed') => ({ id, tournament_id, round_number, status });
const stages = new Map([['t-1', 'main']]);

describe('eventKey of round_end', () => {
  it('is keyed per stage and round number, like round_start', () => {
    expect(eventKey({ event: 'round_end', stage: 'main', round: 2 })).toBe('round_end:main:2');
    expect(eventKey({ event: 'round_start', stage: 'main', round: 2 })).toBe('round_start:main:2');
  });
});

describe('unfiredRoundEnds', () => {
  it('lists the completed rounds whose event has not fired, earliest first', () => {
    const rounds = [round('r-3', 't-1', 3), round('r-1', 't-1', 1), round('r-2', 't-1', 2)];
    expect(unfiredRoundEnds(stages, rounds, ['round_end:main:2']).map((r) => r.id)).toEqual(['r-1', 'r-3']);
  });

  it('skips rounds that are not completed', () => {
    const rounds = [round('r-1', 't-1', 1, 'active'), round('r-2', 't-1', 2, 'pending'), round('r-3', 't-1', 3)];
    expect(unfiredRoundEnds(stages, rounds, []).map((r) => r.id)).toEqual(['r-3']);
  });

  it('is empty once every completed round fired', () => {
    expect(unfiredRoundEnds(stages, [round('r-1', 't-1', 1)], ['round_end:main:1'])).toEqual([]);
  });

  it('ignores rounds of tournaments that are no phase of the league', () => {
    expect(unfiredRoundEnds(stages, [round('r-9', 't-other', 1)], [])).toEqual([]);
  });

  it('counts a stage that repeats per group once, and only when every group completed that round', () => {
    const groups = new Map([
      ['t-1', 'groups'],
      ['t-2', 'groups'],
    ]);
    const open = [round('a-1', 't-1', 1), round('b-1', 't-2', 1, 'active')];
    expect(unfiredRoundEnds(groups, open, [])).toEqual([]);
    const done = [round('a-1', 't-1', 1), round('b-1', 't-2', 1)];
    expect(unfiredRoundEnds(groups, done, []).map((r) => r.id)).toEqual(['a-1']);
    expect(unfiredRoundEnds(groups, done, ['round_end:groups:1'])).toEqual([]);
  });

  it('keeps stages apart: the same round number of another stage has its own key', () => {
    const two = new Map([
      ['t-1', 'main'],
      ['t-2', 'finals'],
    ]);
    const rounds = [round('a-1', 't-1', 1), round('f-1', 't-2', 1)];
    expect(unfiredRoundEnds(two, rounds, ['round_end:main:1']).map((r) => r.id)).toEqual(['f-1']);
  });
});
