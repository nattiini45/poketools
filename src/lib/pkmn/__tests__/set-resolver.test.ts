import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getSpecies: vi.fn(),
}));

import { resolveMoveset } from '../set-resolver';
import { getSpecies } from '@/lib/pkmn/dex';
import type { SmogonMoveset } from '@/types/sample-sets';

const mockGetSpecies = vi.mocked(getSpecies);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSpecies.mockReturnValue({
    abilities: { '0': 'Static', '1': 'Lightning Rod', H: 'Volt Absorb' },
  } as never);
});

// ─── resolveMoveset ───────────────────────────────────────────────

describe('resolveMoveset', () => {
  const baseMoveset: SmogonMoveset = {
    moves: ['Thunderbolt', 'Volt Switch', 'Hidden Power Ice', 'Roost'],
    ability: 'Static',
    item: 'Light Ball',
    nature: 'Timid',
    evs: { spa: 252, spe: 252, def: 4 },
    ivs: { atk: 0 },
    level: 100,
  };

  it('resolves a simple moveset with scalar values', () => {
    const result = resolveMoveset('Pikachu', baseMoveset, 9);
    expect(result.species).toBe('Pikachu');
    expect(result.name).toBe('');
    expect(result.gender).toBe('');
    expect(result.item).toBe('Light Ball');
    expect(result.ability).toBe('Static');
    expect(result.nature).toBe('Timid');
    expect(result.level).toBe(100);
    expect(result.moves).toEqual(['Thunderbolt', 'Volt Switch', 'Hidden Power Ice', 'Roost']);
  });

  it('picks the first element from slash arrays (item)', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      item: ['Choice Specs', 'Life Orb'],
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.item).toBe('Choice Specs');
  });

  it('picks the first element from slash arrays (ability)', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      ability: ['Lightning Rod', 'Static'],
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.ability).toBe('Lightning Rod');
  });

  it('picks the first element from slash arrays (nature)', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      nature: ['Modest', 'Timid'],
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.nature).toBe('Modest');
  });

  it('picks the first element from slash arrays (moves)', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      moves: [
        ['Thunderbolt', 'Thunder'],
        ['Volt Switch', 'U-turn'],
        'Hidden Power Ice',
        'Roost',
      ],
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.moves).toEqual(['Thunderbolt', 'Volt Switch', 'Hidden Power Ice', 'Roost']);
  });

  it('fills default EVs (0) for missing stats', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      evs: { spe: 252 },
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.evs).toEqual({
      hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 252,
    });
  });

  it('fills default IVs (31) for missing stats', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      ivs: { atk: 0 },
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.ivs).toEqual({
      hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31,
    });
  });

  it('fills all-zero EVs when evs is undefined', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      evs: undefined,
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.evs).toEqual({
      hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0,
    });
  });

  it('fills all-31 IVs when ivs is undefined', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      ivs: undefined,
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.ivs).toEqual({
      hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31,
    });
  });

  it('falls back to dex ability if ability resolves to empty', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      ability: '',
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.ability).toBe('Static');
  });

  it('falls back to Hardy if nature resolves to empty', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      nature: '',
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.nature).toBe('Hardy');
  });

  it('falls back to empty string if item resolves to empty', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      item: '',
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.item).toBe('');
  });

  it('includes tera_type from teratypes array', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      teratypes: ['Fairy', 'Electric'],
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.tera_type).toBe('Fairy');
  });

  it('tera_type is undefined when teratypes is absent', () => {
    const result = resolveMoveset('Pikachu', baseMoveset, 9);
    expect(result.tera_type).toBeUndefined();
  });

  it('defaults level to 100 when not specified', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      level: undefined,
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.level).toBe(100);
  });

  it('uses specified level', () => {
    const moveset: SmogonMoveset = {
      ...baseMoveset,
      level: 50,
    };
    const result = resolveMoveset('Pikachu', moveset, 9);
    expect(result.level).toBe(50);
  });
});
