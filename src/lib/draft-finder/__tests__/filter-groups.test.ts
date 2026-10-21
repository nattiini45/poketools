import { describe, expect, it } from 'vitest';
// The public suite runs on the example pack (utility keys hazards / hazard_control / recovery / pivot / priority).
import { buildChips } from '../chips';
import { activeFilterCount, expandedUtility, filterGroupCounts, openFilterGroups, resetGroupFilters } from '../filter-groups';
import { EMPTY_FILTERS, FILTER_GROUP_KEYS, INITIAL_FILTER_SHEET, type FinderFilters } from '../filter-types';

const busy: FinderFilters = {
  ...EMPTY_FILTERS,
  text: 'gen',
  types: { ids: ['Water', 'Ghost'], match: 'all' },
  moves: { ids: ['uturn'], match: 'any' },
  abilities: { ids: ['levitate', 'regenerator'] },
  utility: [
    { key: 'pivot', members: ['uturn', 'voltswitch'] },
    { key: 'recovery', members: [] },
  ],
  stats: { spe: 80, bst: 500 },
  maxPrice: 20,
  defense: [{ relation: 'resists', type: 'Fire' }],
};

describe('filterGroupCounts', () => {
  it('counts the chips of each group; the search text belongs to none', () => {
    expect(filterGroupCounts(busy)).toEqual({ pokemon: 3, movesAbilities: 3, stats: 2, utility: 4, defense: 1 });
    expect(filterGroupCounts(EMPTY_FILTERS)).toEqual({ pokemon: 0, movesAbilities: 0, stats: 0, utility: 0, defense: 0 });
  });

  it('adds up to the chip count', () => {
    expect(activeFilterCount(busy)).toBe(buildChips(busy).length);
    expect(activeFilterCount({ ...EMPTY_FILTERS, text: 'x' })).toBe(0);
  });
});

describe('openFilterGroups', () => {
  it('untouched: Pokémon plus every group with an active filter, in sheet order', () => {
    expect(openFilterGroups(INITIAL_FILTER_SHEET, EMPTY_FILTERS)).toEqual(['pokemon']);
    expect(openFilterGroups(INITIAL_FILTER_SHEET, { ...EMPTY_FILTERS, stats: { spe: 80 }, defense: busy.defense })).toEqual([
      'pokemon',
      'stats',
      'defense',
    ]);
    expect(openFilterGroups(INITIAL_FILTER_SHEET, busy)).toEqual([...FILTER_GROUP_KEYS]);
  });

  it('touched: the stored list wins, even when a group has active filters', () => {
    expect(openFilterGroups({ ...INITIAL_FILTER_SHEET, openGroups: [] }, busy)).toEqual([]);
  });
});

describe('expandedUtility', () => {
  it('untouched: the categories with picked members', () => {
    expect(expandedUtility(INITIAL_FILTER_SHEET, busy)).toEqual(['pivot']);
    expect(expandedUtility({ ...INITIAL_FILTER_SHEET, utilityExpanded: ['hazards'] }, busy)).toEqual(['hazards']);
  });
});

describe('resetGroupFilters', () => {
  it('returns the same object when the group has nothing to clear', () => {
    for (const group of FILTER_GROUP_KEYS) expect(resetGroupFilters(EMPTY_FILTERS, group)).toBe(EMPTY_FILTERS);
  });

  it('puts a lone "Require all" back to "Any"', () => {
    const f = { ...EMPTY_FILTERS, moves: { ids: [], match: 'all' as const } };
    expect(resetGroupFilters(f, 'movesAbilities').moves).toEqual({ ids: [], match: 'any' });
  });

  it('a lone "Require all" is resettable (group count 0, Reset shown) on both groups that have the switch', () => {
    // Decided behaviour (round 3): the switch is not a chip, so the group counts 0, but it is not the default,
    // so the group offers its Reset; "Clear all" resets it too. "Count abilities" is a preference and is not.
    const types = { ...EMPTY_FILTERS, types: { ids: [], match: 'all' as const } };
    expect(filterGroupCounts(types).pokemon).toBe(0);
    expect(resetGroupFilters(types, 'pokemon')).not.toBe(types);
    expect(resetGroupFilters(types, 'pokemon').types).toEqual({ ids: [], match: 'any' });
    const moves = { ...EMPTY_FILTERS, moves: { ids: [], match: 'all' as const } };
    expect(filterGroupCounts(moves).movesAbilities).toBe(0);
    expect(resetGroupFilters(moves, 'movesAbilities')).not.toBe(moves);
    const prefOnly = { ...EMPTY_FILTERS, abilityDefense: false };
    for (const group of FILTER_GROUP_KEYS) expect(resetGroupFilters(prefOnly, group)).toBe(prefOnly);
  });

  it('after each reset that group counts 0 and the others are unchanged', () => {
    const before = filterGroupCounts(busy);
    for (const group of FILTER_GROUP_KEYS) {
      const after = filterGroupCounts(resetGroupFilters(busy, group));
      expect(after[group]).toBe(0);
      for (const other of FILTER_GROUP_KEYS) if (other !== group) expect(after[other]).toBe(before[other]);
    }
  });
});
