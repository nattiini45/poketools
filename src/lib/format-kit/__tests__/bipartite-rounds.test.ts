/**
 * The `bipartite_rounds_short` warning: a bipartite stage whose rounds cannot reach every player of the larger side.
 * It is reported only when the side sizes are knowable at compile time (see `checkBipartiteRounds`).
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../compile';
import type { CompileEnv } from '../engine/env';
import { mutate, rosterEnv } from './fixtures/negative';
import { wichtelcupDoc } from './fixtures/docs';
import type { FormatDefinition } from '../types';

/** The Wichtelcup document: stage 1 `houses` pairs houses (ember vs tide and grove) for 3 rounds. */
const base = (): FormatDefinition => {
  const { definition } = compile(wichtelcupDoc());
  if (definition === null) throw new Error('the Wichtelcup fixture must compile');
  return definition;
};

function shortRounds(input: unknown, env?: CompileEnv) {
  return compile(input, env).diagnostics.filter((d) => d.code === 'bipartite_rounds_short');
}

describe('bipartite_rounds_short', () => {
  it('is a warning at the rounds field, with the numbers it was judged by', () => {
    const found = shortRounds(base(), rosterEnv(16));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      severity: 'warning',
      json_pointer: '/stages/1/pairing/rounds',
      params: { stage: 'houses', attr: 'house', rounds: 3, needed: 8, players: 16 },
    });
  });

  it('does not make the format invalid', () => {
    expect(compile(base(), rosterEnv(16)).ok).toBe(true);
  });

  it('holds exactly when the rounds reach ceil(players / 2)', () => {
    // 6 players: the larger side has at least 3, and 3 rounds are played.
    expect(shortRounds(base(), rosterEnv(6))).toEqual([]);
    // 7 players: at least 4.
    expect(shortRounds(base(), rosterEnv(7))).toHaveLength(1);
    const more = mutate(base(), [{ op: 'replace', path: '/stages/1/pairing/rounds', value: 8 }]);
    expect(shortRounds(more, rosterEnv(16))).toEqual([]);
  });

  it('says nothing when the player count is unknown', () => {
    expect(shortRounds(base())).toEqual([]);
  });

  it('says nothing when a hand-assigned attribute leaves the side sizes open', () => {
    const manual = mutate(base(), [{ op: 'replace', path: '/attributes/0/assign', value: { kind: 'manual' } }]);
    expect(shortRounds(manual, rosterEnv(16))).toEqual([]);
  });

  it('says nothing when a value of the attribute is on no side (those players play no round)', () => {
    const left = mutate(base(), [{ op: 'replace', path: '/stages/1/pairing/side_b', value: ['tide'] }]);
    expect(shortRounds(left, rosterEnv(16))).toEqual([]);
  });

  it('judges a stage with groups by the size of one group', () => {
    const grouped = mutate(base(), [{ op: 'add', path: '/stages/1/groups', value: { count: 4, method: 'serpentine' } }]) as FormatDefinition;
    // 16 players in 4 groups of 4: the larger side of a group has at least 2, and 3 rounds are played.
    expect(shortRounds(grouped, rosterEnv(16))).toEqual([]);
    const tight = mutate(grouped, [{ op: 'replace', path: '/stages/1/pairing/rounds', value: 1 }]);
    expect(shortRounds(tight, rosterEnv(16))).toMatchObject([{ params: { needed: 2, players: 4 } }]);
  });
});
