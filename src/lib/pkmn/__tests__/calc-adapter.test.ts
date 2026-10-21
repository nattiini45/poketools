import { describe, it, expect } from 'vitest';
import { pokemonSetToCalcPokemon, calcPokemonToPartialSet } from '../calc-adapter';
import type { PokemonSet, StatSpread } from '@/types/team';
import type { CalcPokemon } from '@/types/calc';

// ── Helpers ─────────────────────────────────────────────────────────

const fullEvs: StatSpread = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
const fullIvs: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function makeSet(overrides?: Partial<PokemonSet>): PokemonSet {
  return {
    name: 'Chomp',
    species: 'Garchomp',
    gender: 'M',
    item: 'Life Orb',
    ability: 'Rough Skin',
    evs: fullEvs,
    ivs: fullIvs,
    nature: 'Jolly',
    level: 100,
    moves: ['Earthquake', 'Outrage', 'Swords Dance', 'Stone Edge'],
    tera_type: 'Ground',
    ...overrides,
  };
}

// ── pokemonSetToCalcPokemon ─────────────────────────────────────────

describe('pokemonSetToCalcPokemon', () => {
  it('converts a full PokemonSet to CalcPokemon', () => {
    const set = makeSet();
    const calc = pokemonSetToCalcPokemon(set);

    expect(calc.species).toBe('Garchomp');
    expect(calc.item).toBe('Life Orb');
    expect(calc.ability).toBe('Rough Skin');
    expect(calc.nature).toBe('Jolly');
    expect(calc.evs).toEqual(fullEvs);
    expect(calc.ivs).toEqual(fullIvs);
    expect(calc.level).toBe(100);
    expect(calc.moves).toEqual(['Earthquake', 'Outrage', 'Swords Dance', 'Stone Edge']);
    expect(calc.tera_type).toBe('Ground');
  });

  it('converts empty item to undefined', () => {
    const set = makeSet({ item: '' });
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.item).toBeUndefined();
  });

  it('converts empty ability to undefined', () => {
    const set = makeSet({ ability: '' });
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.ability).toBeUndefined();
  });

  it('converts empty nature to undefined', () => {
    const set = makeSet({ nature: '' });
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.nature).toBeUndefined();
  });

  it('defaults level to 100 when set.level is null-ish', () => {
    const set = makeSet();
    // Simulate undefined level via nullish coalescing path
    (set as unknown as unknown as Record<string, unknown>).level = undefined;
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.level).toBe(100);
  });

  it('defaults level to 100 when set.level is null', () => {
    const set = makeSet();
    (set as unknown as unknown as Record<string, unknown>).level = null;
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.level).toBe(100);
  });

  it('preserves explicit level 50', () => {
    const set = makeSet({ level: 50 });
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.level).toBe(50);
  });

  it('filters falsy moves from the moves array', () => {
    const set = makeSet({ moves: ['Earthquake', '', 'Outrage', ''] });
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.moves).toEqual(['Earthquake', 'Outrage']);
  });

  it('handles undefined moves array', () => {
    const set = makeSet();
    (set as unknown as unknown as Record<string, unknown>).moves = undefined;
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.moves).toEqual([]);
  });

  it('handles null moves array', () => {
    const set = makeSet();
    (set as unknown as unknown as Record<string, unknown>).moves = null;
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.moves).toEqual([]);
  });

  it('applies overrides on top of converted values', () => {
    const set = makeSet();
    const calc = pokemonSetToCalcPokemon(set, { level: 50, item: 'Choice Scarf' });
    expect(calc.level).toBe(50);
    expect(calc.item).toBe('Choice Scarf');
    expect(calc.species).toBe('Garchomp');
  });

  it('overrides can add fields not in PokemonSet', () => {
    const set = makeSet();
    const calc = pokemonSetToCalcPokemon(set, { boosts: { atk: 2, def: 0, spa: 0, spd: 0, spe: 0 } });
    expect(calc.boosts).toEqual({ atk: 2, def: 0, spa: 0, spd: 0, spe: 0 });
  });

  it('passes tera_type through even when undefined', () => {
    const set = makeSet({ tera_type: undefined });
    const calc = pokemonSetToCalcPokemon(set);
    expect(calc.tera_type).toBeUndefined();
  });
});

// ── calcPokemonToPartialSet ─────────────────────────────────────────

describe('calcPokemonToPartialSet', () => {
  it('converts a full CalcPokemon to partial PokemonSet', () => {
    const calc: CalcPokemon = {
      species: 'Garchomp',
      item: 'Life Orb',
      ability: 'Rough Skin',
      nature: 'Jolly',
      evs: fullEvs,
      ivs: fullIvs,
      level: 100,
      moves: ['Earthquake', 'Outrage'],
      tera_type: 'Ground',
    };
    const partial = calcPokemonToPartialSet(calc);

    expect(partial.species).toBe('Garchomp');
    expect(partial.item).toBe('Life Orb');
    expect(partial.ability).toBe('Rough Skin');
    expect(partial.nature).toBe('Jolly');
    expect(partial.evs).toEqual(fullEvs);
    expect(partial.ivs).toEqual(fullIvs);
    expect(partial.level).toBe(100);
    expect(partial.moves).toEqual(['Earthquake', 'Outrage']);
    expect(partial.tera_type).toBe('Ground');
  });

  it('defaults item to empty string when undefined', () => {
    const calc: CalcPokemon = { species: 'Pikachu' };
    const partial = calcPokemonToPartialSet(calc);
    expect(partial.item).toBe('');
  });

  it('defaults ability to empty string when undefined', () => {
    const calc: CalcPokemon = { species: 'Pikachu' };
    const partial = calcPokemonToPartialSet(calc);
    expect(partial.ability).toBe('');
  });

  it('defaults nature to Hardy when undefined', () => {
    const calc: CalcPokemon = { species: 'Pikachu' };
    const partial = calcPokemonToPartialSet(calc);
    expect(partial.nature).toBe('Hardy');
  });

  it('defaults level to 100 when undefined', () => {
    const calc: CalcPokemon = { species: 'Pikachu' };
    const partial = calcPokemonToPartialSet(calc);
    expect(partial.level).toBe(100);
  });

  it('defaults moves to empty array when undefined', () => {
    const calc: CalcPokemon = { species: 'Pikachu' };
    const partial = calcPokemonToPartialSet(calc);
    expect(partial.moves).toEqual([]);
  });

  it('passes through tera_type undefined', () => {
    const calc: CalcPokemon = { species: 'Pikachu' };
    const partial = calcPokemonToPartialSet(calc);
    expect(partial.tera_type).toBeUndefined();
  });
});
