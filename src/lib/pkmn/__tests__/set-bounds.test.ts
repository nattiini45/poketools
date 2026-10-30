/**
 * `set-bounds`: the producer side of the strict save boundary. Whatever the editor's inputs or an AI proposal hand in,
 * the result passes `pokemonSetSchema`.
 */
import { describe, expect, it } from 'vitest';
import { boundSet, toBoundedInt } from '../set-bounds';
import { pokemonSetSchema } from '@/lib/validation/schemas';
import { makeSet } from '@/test/team-fixtures';

describe('toBoundedInt (what the number inputs call)', () => {
  it.each([
    ['1.5', 0, 252, 0, 1],
    ['251.9', 0, 252, 0, 251],
    ['-0.5', 0, 252, 0, 0],
    ['-5', 0, 252, 0, 0],
    ['300', 0, 252, 0, 252],
    ['', 0, 252, 0, 0],
    ['abc', 1, 100, 100, 100],
    ['0', 1, 100, 100, 1],
    ['100.9', 1, 100, 100, 100],
    ['1e3', 0, 31, 0, 31],
    [Number.NaN, 0, 31, 31, 31],
    [Infinity, 0, 31, 31, 31],
    [null, 0, 31, 31, 31],
    [42.7, 0, 252, 0, 42],
  ])('%j within [%i, %i], fallback %i -> %i', (value, min, max, fallback, expected) => {
    expect(toBoundedInt(value, min, max, fallback)).toBe(expected);
  });
});

describe('boundSet', () => {
  it('rounds and clamps every number of a hostile proposal so the schema accepts it', () => {
    const hostile = {
      ...makeSet('Garchomp'),
      evs: { hp: -760, atk: 252.7, def: 9999, spa: Number.NaN, spd: 4, spe: 252 },
      ivs: { hp: 32, atk: -1, def: 30.5, spa: 31, spd: 31, spe: 31 },
      level: 150.4,
      happiness: 300,
      moves: ['a', 'b', 'c', 'd', 'e', 'f'],
      item: 'x'.repeat(500),
    };
    expect(pokemonSetSchema.safeParse(hostile).success).toBe(false);

    const bounded = boundSet(hostile);

    expect(bounded.evs).toEqual({ hp: 0, atk: 252, def: 252, spa: 0, spd: 4, spe: 252 });
    expect(bounded.ivs).toEqual({ hp: 31, atk: 0, def: 30, spa: 31, spd: 31, spe: 31 });
    expect(bounded.level).toBe(100);
    expect(bounded.happiness).toBe(255);
    expect(bounded.moves).toEqual(['a', 'b', 'c', 'd']);
    expect(bounded.item).toHaveLength(100);
    expect(pokemonSetSchema.safeParse(bounded).success).toBe(true);
  });

  it('touches only what a partial patch carries', () => {
    expect(boundSet({ evs: { atk: 300 } })).toEqual({ evs: { atk: 252 } });
    expect(boundSet({ item: 'Leftovers' })).toEqual({ item: 'Leftovers' });
  });

  it('leaves a set that is already in bounds unchanged', () => {
    const set = makeSet('Garchomp', { tera_type: 'Steel', shiny: true, happiness: 200 });
    expect(boundSet(set)).toEqual(set);
  });

  it('drops a gender outside M/F/N', () => {
    expect(boundSet({ gender: 'X' }).gender).toBe('');
    expect(boundSet({ gender: 'F' }).gender).toBe('F');
  });
});
