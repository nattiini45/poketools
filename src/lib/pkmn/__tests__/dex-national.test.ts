import { describe, expect, it } from 'vitest';
import { getGeneration, listNationalAbilities, listNationalItems, listNationalMoves, listNationalSpecies } from '../dex';
import { getBannedPokemonForTier } from '../tiers';

// Real-dex tests (no mocks): the National Dex universe reads the raw generation data, where the Generations wrapper
// hides every past entity.

const ids = (list: readonly { id: string }[]) => new Set(list.map((entry) => entry.id));

describe('the National Dex universe of a generation', () => {
  it('has the species the generation dropped, which the Generations wrapper does not list', () => {
    const wrapped = ids(Array.from(getGeneration(9).species));
    const national = ids(listNationalSpecies(9));
    for (const past of ['genesect', 'tapukoko', 'kartana', 'xerneas', 'charizardmegax', 'groudonprimal']) {
      expect(wrapped.has(past), past).toBe(false);
      expect(national.has(past), past).toBe(true);
    }
    for (const id of wrapped) expect(national.has(id), id).toBe(true);
  });

  it('leaves out what is not part of the National Dex: CAP, future and Let\'s Go species', () => {
    const national = listNationalSpecies(9);
    expect(national.every((s) => s.exists)).toBe(true);
    expect(national.some((s) => s.isNonstandard === 'CAP')).toBe(false);
    expect(national.some((s) => s.isNonstandard === 'Future')).toBe(false);
    expect(national.some((s) => s.isNonstandard === 'LGPE')).toBe(false);
    expect(ids(national).has('syclant')).toBe(false);
  });

  it('has the past moves, items and abilities too', () => {
    expect(ids(listNationalMoves(9)).has('hiddenpower')).toBe(true);
    expect(ids(listNationalMoves(9)).has('pursuit')).toBe(true);
    expect(ids(Array.from(getGeneration(9).moves)).has('hiddenpower')).toBe(false);
    expect(ids(listNationalItems(9)).has('normaliumz')).toBe(true);
    expect(ids(listNationalItems(9)).has('berserkgene')).toBe(true);
    expect(ids(listNationalAbilities(9)).has('intimidate')).toBe(true);
  });

  it('is what the tier-derived bans of a National Dex format read: 102 Uber and AG species against 73 visible without it', () => {
    expect(getBannedPokemonForTier('OU', 9, 'natDexTier', 'national')).toHaveLength(102);
    expect(getBannedPokemonForTier('OU', 9, 'natDexTier')).toHaveLength(73);
    expect(getBannedPokemonForTier('OU', 9, 'natDexTier', 'national')).toEqual(expect.arrayContaining(['Mewtwo-Mega-X', 'Mewtwo-Mega-Y', 'Genesect']));
  });

  it('reads the same fields from the same objects: the standard universe is unchanged', () => {
    const standard = getBannedPokemonForTier('OU', 9);
    expect(standard).toEqual(getBannedPokemonForTier('OU', 9, 'tier', 'standard'));
    expect(standard).toContain('Koraidon');
  });
});
