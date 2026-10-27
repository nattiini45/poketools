// Tests for scripts/ruleset/report-unknown-ids.mjs: the pre-flight gate of the Ruleset Studio migration. Small hand-made
// dex maps and rows; the real-dex test only checks the entries named in the migration notes.
import { describe, it, expect } from 'vitest';
import { analyze, loadDexNames } from '../report-unknown-ids.mjs';

const names = {
  pokemon: new Map([['garchomp', 'Garchomp'], ['mrmime', 'Mr. Mime'], ['tapukoko', 'Tapu Koko'], ['flabebe', 'Flabébé'], ['nidoranf', 'Nidoran-F']]),
  moves: new Map([['batonpass', 'Baton Pass']]),
  items: new Map([['kingsrock', "King's Rock"]]),
  abilities: new Map([['moody', 'Moody']]),
};

const row = (overrides) => ({
  name: 'Ruleset',
  banned_pokemon: [],
  banned_moves: [],
  banned_items: [],
  banned_abilities: [],
  added_pokemon: [],
  clauses: [],
  ...overrides,
});

describe('analyze', () => {
  it('an entry spelled exactly like the dex name is clean', () => {
    const report = analyze([row({ banned_pokemon: ['Garchomp', 'Tapu Koko'], banned_moves: ['Baton Pass'], banned_items: ["King's Rock"], banned_abilities: ['Moody'] })], names);
    expect(report).toEqual({ unmatched: [], foldedOnly: [], foldMismatch: [] });
  });

  it('lists a typo as unmatched, in its category and column', () => {
    const report = analyze([row({ name: 'Typos', banned_pokemon: ['Garchmop'], added_pokemon: ['Pikachuu'] })], names);
    expect(report.unmatched).toEqual([
      { ruleset: 'Typos', category: 'pokemon', column: 'banned_pokemon', entry: 'Garchmop', id: 'garchmop' },
      { ruleset: 'Typos', category: 'pokemon', column: 'added_pokemon', entry: 'Pikachuu', id: 'pikachuu' },
    ]);
    expect(report.foldedOnly).toEqual([]);
  });

  it('lists an entry that only matches after the fold, with the entity it will ban', () => {
    const report = analyze([row({ banned_pokemon: ['Mr Mime', 'Tapu-Koko'], banned_items: ['Kings Rock'] })], names);
    expect(report.foldedOnly.map((i) => [i.entry, i.entity])).toEqual([['Mr Mime', 'Mr. Mime'], ['Tapu-Koko', 'Tapu Koko'], ['Kings Rock', "King's Rock"]]);
    expect(report.unmatched).toEqual([]);
  });

  it('compares the SQL fold with the application fold and lists every drift once', () => {
    const report = analyze([], names, [
      { entry: 'Flabébé', sql_id: 'flabebe' },
      { entry: 'Flabébé', sql_id: 'flabb' },
      { entry: 'Nidoran♀', sql_id: 'nidoran' },
    ]);
    expect(report.foldMismatch).toEqual([{ entry: 'Nidoran♀', app_id: 'nidoranf', sql_id: 'nidoran' }]);
  });
});

describe('with the installed dex', () => {
  it('knows every generation\'s entities (past ones included) and the dex spelling of the awkward names', async () => {
    const dex = await loadDexNames();
    // Compared after Unicode normalisation: the dex may spell the accent as one character or as base plus mark, which is
    // exactly why an old exact-name compare of a typed 'Flabébé' could miss it.
    expect(dex.pokemon.get('flabebe')?.normalize('NFC')).toBe('Flabébé'.normalize('NFC'));
    expect(dex.pokemon.get('nidoranf')).toMatch(/^Nidoran/);
    expect(dex.pokemon.get('mewtwomegax')).toBe('Mewtwo-Mega-X');
    expect(dex.moves.get('pursuit')).toBe('Pursuit');
    expect(dex.items.get('leftovers')).toBe('Leftovers');
    expect(dex.abilities.get('moody')).toBe('Moody');
  });
});
