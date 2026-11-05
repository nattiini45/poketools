import { describe, expect, it } from 'vitest';
import { generateSwissRound } from '../swiss';

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const names = Object.fromEntries(ids.map((id) => [id, id.toUpperCase()]));
const pairKey = (p: { player_1_id: string; player_2_id: string }) => [p.player_1_id, p.player_2_id].sort().join('-');
const sameKey = (a: string, b: string) => [a, b].sort().join('-');

describe('generateSwissRound with allowPair', () => {
  it('pairs a round without a rejected pair when one exists', () => {
    const round = generateSwissRound(ids, names, [], 1, [], { allowPair: (a, b) => sameKey(a, b) !== 'a-b' });
    expect(round.forbidden).toBe(0);
    expect(round.pairings.map(pairKey)).not.toContain('a-b');
    expect(round.pairings).toHaveLength(3);
  });

  it('takes the pairing with the fewest rejected pairs when none avoids them', () => {
    // Only c-d may be paired with a or b is impossible: a and b may meet nobody but each other.
    const allow = (a: string, b: string) => {
      const key = sameKey(a, b);
      return key === 'a-b' || (!key.includes('a') && !key.includes('b'));
    };
    const round = generateSwissRound(['a', 'b', 'c', 'd'], { a: 'A', b: 'B', c: 'C', d: 'D' }, [], 1, [], { allowPair: allow });
    expect(round.forbidden).toBe(0);
    expect(round.pairings.map(pairKey).sort()).toEqual(['a-b', 'c-d']);
  });

  it('counts the rejected pairs of a round that cannot avoid them', () => {
    const round = generateSwissRound(ids, names, [], 1, [], { allowPair: () => false });
    expect(round.forbidden).toBe(3);
    expect(round.pairings).toHaveLength(3);
  });

  it('weighs a rejected pair above any number of rematches', () => {
    // a-b are the only players the filter lets meet each other, and they have already played.
    const allow = (a: string, b: string) => sameKey(a, b) === 'a-b' || (!sameKey(a, b).includes('a') && !sameKey(a, b).includes('b'));
    const history = [{ player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 }];
    const round = generateSwissRound(['a', 'b', 'c', 'd'], { a: 'A', b: 'B', c: 'C', d: 'D' }, history, 2, [], { allowPair: allow });
    expect(round.forbidden).toBe(0);
    expect(round.rematches).toBe(1);
    expect(round.pairings.map(pairKey).sort()).toEqual(['a-b', 'c-d']);
  });

  it('still avoids rematches when the filter allows the pairings', () => {
    const history = [
      { player_1_id: 'a', player_2_id: 'b', winner_id: 'a', round_number: 1 },
      { player_1_id: 'c', player_2_id: 'd', winner_id: 'c', round_number: 1 },
      { player_1_id: 'e', player_2_id: 'f', winner_id: 'e', round_number: 1 },
    ];
    const round = generateSwissRound(ids, names, history, 2, [], { allowPair: (a, b) => sameKey(a, b) !== 'a-c' });
    expect(round.rematches ?? 0).toBe(0);
    expect(round.forbidden).toBe(0);
    expect(round.pairings.map(pairKey)).not.toContain('a-c');
  });

  it('does not report forbidden without a filter', () => {
    const round = generateSwissRound(ids, names, [], 1, []);
    expect(round.forbidden).toBeUndefined();
  });
});
