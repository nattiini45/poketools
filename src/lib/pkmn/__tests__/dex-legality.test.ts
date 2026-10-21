import { describe, it, expect } from 'vitest';
import { listMovesForSpecies, searchMovesForSpecies, checkMoveLegality } from '../dex';

describe('dex move legality across generations', () => {
  it('does not include Gen 9-only moves in a Gen 8 move list', async () => {
    const moves = await listMovesForSpecies('Charizard', 8);
    const names = new Set(moves.map((m) => m.name));

    expect(names.has('Tera Blast')).toBe(false);
  });

  it('includes Gen 9-only moves in a Gen 9 move list', async () => {
    const moves = await listMovesForSpecies('Charizard', 9);
    const names = new Set(moves.map((m) => m.name));

    expect(names.has('Tera Blast')).toBe(true);
  });

  it('excludes old-source-only moves from Gen 9 move lists', async () => {
    const moves = await listMovesForSpecies('Charizard', 9);
    const names = new Set(moves.map((m) => m.name));

    expect(names.has('Attract')).toBe(false);
  });

  it('species move search respects generation legality', async () => {
    const gen8 = await searchMovesForSpecies('tera', 'Charizard', 8, 50);
    const gen9 = await searchMovesForSpecies('tera', 'Charizard', 9, 50);

    expect(gen8.some((m) => m.name === 'Tera Blast')).toBe(false);
    expect(gen9.some((m) => m.name === 'Tera Blast')).toBe(true);
  });

  it('checkMoveLegality marks future-gen moves as illegal in older gens', async () => {
    const gen8 = await checkMoveLegality('Charizard', ['Tera Blast'], 8);
    const gen9 = await checkMoveLegality('Charizard', ['Tera Blast'], 9);

    expect(gen8[0]).toEqual({ move: 'Tera Blast', legal: false });
    expect(gen9[0]).toEqual({ move: 'Tera Blast', legal: true });
  });

  it('checkMoveLegality rejects old-source-only moves in Gen 9', async () => {
    const gen9 = await checkMoveLegality('Charizard', ['Attract'], 9);
    expect(gen9[0]).toEqual({ move: 'Attract', legal: false });
  });
});
