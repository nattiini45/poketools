import { describe, expect, it } from 'vitest';
import { SPECIES_FLAG, type CatalogIndex, type SpeciesEntry, type SpeciesRow } from '@/lib/pkmn/catalog-index';
import { stateLookup } from '@/lib/ruleset-kit/entry-state';
import { buildEntryIndex, rootOf, wholeSpeciesIds } from '../../../editor/picker/entry-index';
import {
  EMPTY_FILTERS,
  UNTIERED,
  activeFilterCount,
  buildView,
  defaultSort,
  displayTier,
  fuzzyRank,
  hasAnyFilter,
  tierOf,
  tierRank,
  withinEdits,
  type PickerFilters,
  type ViewContext,
} from '../../../editor/picker/view';
import { buildSearchKeys } from '@/lib/pkmn/i18n/search';
import { SPECIES_ROWS, itemIndex, moveIndex, speciesIndex } from './fixtures';

function ctx(overrides: Partial<ViewContext> = {}): ViewContext {
  const lookup = stateLookup({ ban: ['garchomp'], unban: ['koraidon'], allow: null }, { mode: 'block', ids: ['koraidon', 'charizardmegax'] });
  return { index: speciesIndex(), doubles: false, national: true, stateOf: lookup.stateOf, ...overrides };
}

const filters = (patch: Partial<PickerFilters>): PickerFilters => ({ ...EMPTY_FILTERS, ...patch });
const names = (view: ReturnType<typeof buildView>) => view.entries.map((e) => e.name);

describe('typo-tolerant matching', () => {
  it('counts edits, including one adjacent swap', () => {
    expect(withinEdits('garchomp', 'garchomp', 0)).toBe(true);
    expect(withinEdits('garchmop', 'garchomp', 1)).toBe(true);
    expect(withinEdits('garchomp', 'garchop', 1)).toBe(true);
    expect(withinEdits('garchomp', 'garbage', 1)).toBe(false);
    expect(withinEdits('a', 'abcd', 2)).toBe(false);
  });

  it('ranks exact, prefix and word matches before a typo match, and tolerates typos only in longer queries', () => {
    const keys = buildSearchKeys(['Garchomp', 'Knakrack']);
    expect(fuzzyRank('garchomp', keys)).toBe(0);
    expect(fuzzyRank('garch', keys)).toBe(1);
    expect(fuzzyRank('garchmop', keys)).toBe(4);
    expect(fuzzyRank('gar', keys)).toBe(1);
    expect(fuzzyRank('grc', keys)).toBe(-1);
    expect(fuzzyRank('knakrak', keys)).toBe(4);
  });
});

describe('tiers', () => {
  it('folds the untiered markers and the parenthesised tiers', () => {
    expect(displayTier('Illegal', false)).toBe(UNTIERED);
    expect(displayTier('', false)).toBe(UNTIERED);
    expect(displayTier('(PU)', false)).toBe('ZU');
    expect(displayTier('(DUU)', true)).toBe('DPU');
    expect(displayTier('OU', false)).toBe('OU');
  });

  it('reads the doubles, National Dex or singles tier of a species', () => {
    const [garchomp] = speciesIndex().entries.filter((e): e is SpeciesEntry => e.id === 'garchomp');
    expect(tierOf(garchomp, false, false)).toBe('OU');
    expect(tierOf(garchomp, true, false)).toBe('DUU');
    const [mega] = speciesIndex().entries.filter((e): e is SpeciesEntry => e.id === 'charizardmegax');
    expect(tierOf(mega, false, true)).toBe('Uber');
    expect(tierOf(mega, false, false)).toBe(UNTIERED);
  });

  it('ranks the restricted tiers first and untiered last', () => {
    expect(tierRank('Uber')).toBeLessThan(tierRank('OU'));
    expect(tierRank('OU')).toBeLessThan(tierRank('UU'));
    expect(tierRank('LC')).toBeLessThan(tierRank('Something New'));
    expect(tierRank('Something New')).toBeLessThan(tierRank(UNTIERED));
  });
});

describe('buildView', () => {
  it('lists every entry grouped by tier with headers when sorted by tier', () => {
    const view = buildView(EMPTY_FILTERS, defaultSort('species'), ctx());
    expect(view.total).toBe(9);
    const headers = view.items.filter((i) => i.kind === 'header').map((h) => (h.kind === 'header' ? `${h.group}:${h.count}` : ''));
    expect(headers[0]).toBe('Uber:2');
    expect(headers[headers.length - 1]).toBe(`${UNTIERED}:2`);
    expect(view.items.filter((i) => i.kind === 'entry')).toHaveLength(9);
    expect(view.items[0].kind).toBe('header');
  });

  it('sorts by name without headers', () => {
    const view = buildView(EMPTY_FILTERS, { key: 'name', direction: 'asc' }, ctx());
    expect(names(view)[0]).toBe('Charizard');
    expect(view.items.every((i) => i.kind === 'entry')).toBe(true);
    const desc = buildView(EMPTY_FILTERS, { key: 'name', direction: 'desc' }, ctx());
    expect(names(desc)[0]).toBe('Rattata-Alola');
  });

  it('sorts by base stat total, highest first by default', () => {
    const view = buildView(EMPTY_FILTERS, { key: 'bst', direction: 'desc' }, ctx());
    expect(names(view)[0]).toBe('Koraidon');
  });

  it('finds entries by English or German name, ranked by match quality, ignoring the sort', () => {
    const view = buildView(filters({ query: 'glurak' }), defaultSort('species'), ctx());
    expect(names(view)).toContain('Charizard');
    const exactFirst = buildView(filters({ query: 'charizard' }), defaultSort('species'), ctx());
    expect(names(exactFirst)[0]).toBe('Charizard');
    expect(exactFirst.items.every((i) => i.kind === 'entry')).toBe(true);
    expect(names(buildView(filters({ query: 'garchmop' }), defaultSort('species'), ctx()))).toEqual(['Garchomp']);
    expect(names(buildView(filters({ query: 'zzzz' }), defaultSort('species'), ctx()))).toEqual([]);
  });

  it('filters by type, any or all', () => {
    const any = buildView(filters({ types: ['Fire', 'Dragon'] }), { key: 'name', direction: 'asc' }, ctx());
    expect(names(any)).toEqual(['Charizard', 'Charizard-Mega-X', 'Charizard-Mega-Y', 'Charmander', 'Garchomp', 'Koraidon']);
    const all = buildView(filters({ types: ['Fire', 'Dragon'], typeMatch: 'all' }), { key: 'name', direction: 'asc' }, ctx());
    expect(names(all)).toEqual(['Charizard-Mega-X']);
  });

  it('filters by tier group, stage, forme kind and base stat total', () => {
    const sort = { key: 'name', direction: 'asc' } as const;
    expect(names(buildView(filters({ tiers: ['Uber', 'OU'] }), sort, ctx()))).toEqual(['Charizard-Mega-Y', 'Garchomp', 'Koraidon', 'Charizard-Mega-X'].sort());
    expect(names(buildView(filters({ stages: ['not_fully_evolved'] }), sort, ctx()))).toEqual(['Charmander', 'Pikachu', 'Rattata', 'Rattata-Alola']);
    expect(names(buildView(filters({ formes: ['mega'] }), sort, ctx()))).toEqual(['Charizard-Mega-X', 'Charizard-Mega-Y']);
    expect(names(buildView(filters({ formes: ['forme'] }), sort, ctx()))).toEqual(['Rattata-Alola']);
    expect(names(buildView(filters({ bst: [600, 700] }), sort, ctx()))).toEqual(['Charizard-Mega-X', 'Charizard-Mega-Y', 'Garchomp', 'Koraidon']);
    expect(names(buildView(filters({ gens: [9] }), sort, ctx()))).toEqual(['Koraidon']);
  });

  it('filters by state: what the preset bans, what I changed, legal or not', () => {
    const sort = { key: 'name', direction: 'asc' } as const;
    expect(names(buildView(filters({ fromPreset: true }), sort, ctx()))).toEqual(['Charizard-Mega-X']);
    expect(names(buildView(filters({ changedByMe: true }), sort, ctx()))).toEqual(['Garchomp', 'Koraidon']);
    expect(names(buildView(filters({ states: ['you_banned'] }), sort, ctx()))).toEqual(['Garchomp']);
    expect(names(buildView(filters({ legal: false }), sort, ctx()))).toEqual(['Charizard-Mega-X', 'Garchomp']);
    expect(buildView(filters({ legal: true }), sort, ctx()).entries).toHaveLength(7);
  });

  it('every item carries the state under the document', () => {
    const view = buildView(filters({ query: 'koraidon' }), defaultSort('species'), ctx());
    expect(view.items[0]).toMatchObject({ kind: 'entry', state: 'you_unbanned' });
  });

  it('moves are filtered by type, category, power and accuracy; never-miss moves count as 101%', () => {
    const lookup = stateLookup({ ban: [], unban: [], allow: null }, null);
    const c: ViewContext = { index: moveIndex(), doubles: false, national: false, stateOf: lookup.stateOf };
    const sort = { key: 'name', direction: 'asc' } as const;
    expect(names(buildView(filters({ types: ['Ground', 'Fire'] }), sort, c))).toEqual(['Earthquake', 'Flamethrower']);
    expect(names(buildView(filters({ categories: ['Special'] }), sort, c))).toEqual(['Flamethrower', 'Swift']);
    expect(names(buildView(filters({ power: [80, 200] }), sort, c))).toEqual(['Earthquake', 'Flamethrower']);
    expect(names(buildView(filters({ accuracy: [101, 101] }), sort, c))).toEqual(['Swift']);
    const byType = buildView(EMPTY_FILTERS, defaultSort('moves'), c);
    expect(byType.items[0]).toMatchObject({ kind: 'header', group: 'Fire' });
  });

  it('items are filtered and grouped by category', () => {
    const lookup = stateLookup({ ban: [], unban: [], allow: null }, null);
    const c: ViewContext = { index: itemIndex(), doubles: false, national: false, stateOf: lookup.stateOf };
    expect(names(buildView(filters({ categories: ['Berry'] }), defaultSort('items'), c))).toEqual(['Aguav Berry', 'Oran Berry']);
    expect(buildView(EMPTY_FILTERS, defaultSort('items'), c).items.filter((i) => i.kind === 'header')).toHaveLength(3);
  });

  it('items sorted by name form one block per category, so a header never repeats', () => {
    const lookup = stateLookup({ ban: [], unban: [], allow: null }, null);
    const c: ViewContext = { index: itemIndex(), doubles: false, national: false, stateOf: lookup.stateOf };
    for (const direction of ['asc', 'desc'] as const) {
      const headers = buildView(EMPTY_FILTERS, { key: 'name', direction }, c).items.filter((i) => i.kind === 'header');
      expect(new Set(headers.map((h) => h.key)).size).toBe(headers.length);
    }
  });

  it('counts active facets, not the query', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount(filters({ query: 'x' }))).toBe(0);
    expect(hasAnyFilter(filters({ query: 'x' }))).toBe(true);
    expect(activeFilterCount(filters({ types: ['Fire'], bst: [1, 2], changedByMe: true, legal: false }))).toBe(4);
  });
});

describe('battle-only formes', () => {
  const rows: SpeciesRow[] = [
    ...SPECIES_ROWS,
    ['aegislashblade', 'Aegislash-Blade', ['Steel', 'Ghost'], 'Illegal', 'Illegal', 'Illegal', 'aegislash', [60, 140, 50, 140, 50, 60], 6, SPECIES_FLAG.FORME | SPECIES_FLAG.BATTLE_ONLY, null],
  ];
  const index = () => buildEntryIndex({ v: 1, kind: 'species', gen: 9, scope: 'national', preset: null, rows } as CatalogIndex<'species'>);

  it('stay in the index so the id sets match the server, but are hidden from the view', () => {
    expect(index().byId.get('aegislashblade')?.kind).toBe('species');
    const lookup = stateLookup({ ban: [], unban: [], allow: null }, null);
    const view = buildView(EMPTY_FILTERS, { key: 'name', direction: 'asc' }, { index: index(), doubles: false, national: true, stateOf: lookup.stateOf });
    expect(view.entries.some((e) => e.id === 'aegislashblade')).toBe(false);
    expect(view.total).toBe(rows.length);
  });

  it('show when the document already names them, so the ban can be reverted', () => {
    const lookup = stateLookup({ ban: ['aegislashblade'], unban: [], allow: null }, null);
    const view = buildView(EMPTY_FILTERS, { key: 'name', direction: 'asc' }, { index: index(), doubles: false, national: true, stateOf: lookup.stateOf });
    expect(view.entries.find((e) => e.id === 'aegislashblade')).toBeDefined();
  });
});

describe('forme families', () => {
  it('a whole-species action covers the base species and every forme, from any member', () => {
    const index = speciesIndex();
    expect(wholeSpeciesIds(index, ['charizardmegax']).sort()).toEqual(['charizard', 'charizardmegax', 'charizardmegay']);
    expect(wholeSpeciesIds(index, ['rattata']).sort()).toEqual(['rattata', 'rattataalola']);
    expect(wholeSpeciesIds(index, ['garchomp'])).toEqual(['garchomp']);
    expect(wholeSpeciesIds(index, ['unknownid'])).toEqual(['unknownid']);
    const mega = index.byId.get('charizardmegax') as SpeciesEntry;
    expect(rootOf(mega)).toBe('charizard');
  });
});
