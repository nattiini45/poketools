import { describe, expect, it } from 'vitest';
import { foldedPoolEntryDuplicate } from '../pool-entry-names';

const entries = (...names: string[]) => names.map((pokemon_name) => ({ pokemon_name }));

describe('foldedPoolEntryDuplicate', () => {
  it('is null when every incoming name is new', () => {
    expect(foldedPoolEntryDuplicate(entries('Pikachu'), ['Eevee', 'Garchomp'])).toBeNull();
    expect(foldedPoolEntryDuplicate([], [])).toBeNull();
  });

  it('finds a name that differs from an existing entry only in case, spaces or punctuation', () => {
    expect(foldedPoolEntryDuplicate(entries('Mr. Mime'), ['mrmime'])).toBe('mrmime');
    expect(foldedPoolEntryDuplicate(entries('Garchomp'), ['GARCHOMP'])).toBe('GARCHOMP');
  });

  it('finds an exact duplicate of an existing entry', () => {
    expect(foldedPoolEntryDuplicate(entries('Eevee'), ['Eevee'])).toBe('Eevee');
  });

  it('finds the second of two equivalent names inside the incoming batch', () => {
    expect(foldedPoolEntryDuplicate([], ['Ho-Oh', 'Eevee', 'hooh'])).toBe('hooh');
  });
});
