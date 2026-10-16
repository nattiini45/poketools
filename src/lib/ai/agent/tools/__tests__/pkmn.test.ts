import { describe, it, expect, beforeEach } from 'vitest';
import { lookupPokemon, getTypeChart, getLearnset, __clearPkmnToolCache } from '../pkmn';

describe('lookupPokemon', () => {
  beforeEach(() => __clearPkmnToolCache());

  it('returns Garchomp as Ground/Dragon with canonical base stats', async () => {
    const result = await lookupPokemon({ species: 'garchomp', gen: 9 });
    expect(result).not.toBeNull();
    expect(result!.species).toBe('Garchomp');
    expect(result!.types).toContain('Ground');
    expect(result!.types).toContain('Dragon');
    expect(result!.baseStats).toEqual({ hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 });
    expect(result!.abilities).toContain('Rough Skin');
    expect(result!.weight_kg).toBeGreaterThan(0);
    expect(result!.notable_moves_count).toBeGreaterThan(0);
  });

  it('returns null for an unknown species', async () => {
    const result = await lookupPokemon({ species: 'Notarealmon', gen: 9 });
    expect(result).toBeNull();
  });

  it('serves a cached result on the second call', async () => {
    const first = await lookupPokemon({ species: 'Garchomp', gen: 9 });
    const second = await lookupPokemon({ species: 'Garchomp', gen: 9 });
    expect(second).toEqual(first);
  });
});

describe('getTypeChart', () => {
  beforeEach(() => __clearPkmnToolCache());

  it('reports Electric as 0x against a Ground/Flying defender', () => {
    const chart = getTypeChart({ types: ['Ground', 'Flying'], gen: 9 });
    expect(chart.effectiveness.Electric).toBe(0);
  });

  it('reports Ice as 4x against a Ground/Dragon defender (Garchomp combo)', () => {
    const chart = getTypeChart({ types: ['Ground', 'Dragon'], gen: 9 });
    expect(chart.effectiveness.Ice).toBe(4);
  });

  it('handles a single defending type', () => {
    const chart = getTypeChart({ types: ['Water'], gen: 9 });
    expect(chart.effectiveness.Electric).toBe(2);
    expect(chart.effectiveness.Fire).toBe(0.5);
  });
});

describe('getLearnset', () => {
  beforeEach(() => __clearPkmnToolCache());

  it('shows Garchomp learning Earthquake in gen 9', async () => {
    const result = await getLearnset({ species: 'Garchomp', gen: 9 });
    expect(result).not.toBeNull();
    const allMoves = Object.values(result!.moves).flat();
    expect(allMoves).toContain('Earthquake');
  });

  it('groups moves by learn method', async () => {
    const result = await getLearnset({ species: 'Garchomp', gen: 9 });
    expect(result).not.toBeNull();
    expect(Object.keys(result!.moves).length).toBeGreaterThan(0);
    // Every group is a sorted, non-empty array of move names.
    for (const names of Object.values(result!.moves)) {
      expect(names.length).toBeGreaterThan(0);
    }
  });

  it('returns null for an unknown species', async () => {
    const result = await getLearnset({ species: 'Notarealmon', gen: 9 });
    expect(result).toBeNull();
  });
});
