import { describe, expect, it } from 'vitest';
// The public suite runs on the example pack (utility keys hazards / hazard_control / recovery / pivot / priority).
import { buildChips, chipId, parseChipId } from '../chips';
import { EMPTY_FILTERS, hasActiveFilters, initialFinderState, type FinderAction, type FinderViewState } from '../filter-types';
import { finderReducer } from '../reducer';

function apply(s: FinderViewState, ...actions: FinderAction[]): FinderViewState {
  return actions.reduce(finderReducer, s);
}

const pinned = apply(
  initialFinderState(),
  { type: 'pin', lineId: 'gastly--gengar' },
  { type: 'toggleCompare', lineId: 'monb--y' },
  { type: 'toggleCompare', lineId: 'mona--x' },
);

describe('finderReducer (draft-frontend §4.4)', () => {
  it('defaults: same Pokémon, all tab, default sort, drafted shown, count abilities on', () => {
    const s = initialFinderState();
    expect(s).toMatchObject({ stageMode: 'same_stage', tab: 'all', sort: 'default', showDrafted: true, pinnedLineId: null });
    expect(s.filters.abilityDefense).toBe(true);
    expect(initialFinderState({ stageMode: 'anywhere', sort: 'spe', showDrafted: false, pinnedLineId: 'x--y' })).toMatchObject({
      stageMode: 'anywhere',
      sort: 'spe',
      showDrafted: false,
      pinnedLineId: 'x--y',
    });
  });

  it.each<FinderAction>([
    { type: 'setTab', tab: '9-1' },
    { type: 'setSort', sort: 'alpha' },
    { type: 'clearAll' },
    { type: 'setText', text: 'gen' },
    { type: 'toggleType', id: 'Ground' },
    { type: 'toggleMove', id: 'uturn' },
    { type: 'setMoveMatch', match: 'all' },
    { type: 'toggleAbility', id: 'levitate' },
    { type: 'toggleUtilityCategory', key: 'recovery' },
    { type: 'toggleUtilityMember', key: 'recovery', id: 'roost' },
    { type: 'setStat', stat: 'spe', value: 100 },
    { type: 'setMaxPrice', value: 20 },
    { type: 'toggleDefense', relation: 'immune', t: 'Ground' },
    { type: 'setAbilityDefense', on: false },
    { type: 'removeChip', chipId: 'type:Ground' },
    { type: 'setStageMode', mode: 'anywhere' },
    { type: 'setShowDrafted', on: false },
  ])('%o never changes the pinned line or the compare list', (action) => {
    const next = finderReducer(pinned, action);
    expect(next.pinnedLineId).toBe('gastly--gengar');
    expect(next.compareLineIds).toEqual(['monb--y', 'mona--x']);
  });

  it('compare holds at most 3 lines; a 4th returns the same state', () => {
    const three = apply(pinned, { type: 'toggleCompare', lineId: 'dratini--dragonite' });
    expect(three.compareLineIds).toHaveLength(3);
    expect(finderReducer(three, { type: 'toggleCompare', lineId: 'oshawott--samurott' })).toBe(three);
    expect(finderReducer(three, { type: 'toggleCompare', lineId: 'monb--y' }).compareLineIds).toEqual([
      'mona--x',
      'dratini--dragonite',
    ]);
  });

  it('removing the last picked member keeps the category with members [] (= whole category)', () => {
    let s = apply(initialFinderState(), { type: 'toggleUtilityMember', key: 'recovery', id: 'recover' });
    expect(s.filters.utility).toEqual([{ key: 'recovery', members: ['recover'] }]);
    s = finderReducer(s, { type: 'toggleUtilityMember', key: 'recovery', id: 'recover' });
    expect(s.filters.utility).toEqual([{ key: 'recovery', members: [] }]);
    s = finderReducer(s, { type: 'toggleUtilityCategory', key: 'recovery' });
    expect(s.filters.utility).toEqual([]);
  });

  it('removes chips of every kind', () => {
    let s = apply(
      initialFinderState(),
      { type: 'toggleType', id: 'Ground' },
      { type: 'toggleMove', id: 'rapidspin' },
      { type: 'toggleAbility', id: 'levitate' },
      { type: 'toggleUtilityCategory', key: 'pivot' },
      { type: 'toggleUtilityMember', key: 'recovery', id: 'roost' },
      { type: 'setStat', stat: 'bst', value: 500 },
      { type: 'setMaxPrice', value: 15 },
      { type: 'toggleDefense', relation: 'resists', t: 'Fire' },
    );
    const chips = buildChips(s.filters);
    expect(chips.map((c) => c.id)).toEqual([
      'type:Ground',
      'move:rapidspin',
      'ability:levitate',
      'utility:pivot',
      'utility:recovery',
      'utility:recovery:roost',
      'stat:bst',
      'price',
      'def:resists:Fire',
    ]);
    for (const chip of chips) {
      expect(parseChipId(chip.id)).not.toBeNull();
      s = finderReducer(s, { type: 'removeChip', chipId: chip.id });
    }
    expect(hasActiveFilters(s.filters)).toBe(false);
  });

  it('ignores an unknown chip id', () => {
    const s = initialFinderState();
    expect(finderReducer(s, { type: 'removeChip', chipId: 'type:Shadow' })).toBe(s);
    expect(parseChipId('nonsense')).toBeNull();
  });

  it('clearAll resets filters and text but keeps the "count abilities" preference', () => {
    const s = apply(
      initialFinderState(),
      { type: 'setText', text: 'gengar' },
      { type: 'toggleType', id: 'Ghost' },
      { type: 'setAbilityDefense', on: false },
      { type: 'clearAll' },
    );
    expect(s.filters).toEqual({ ...EMPTY_FILTERS, abilityDefense: false });
    expect(finderReducer(s, { type: 'clearAll' })).toBe(s);
  });

  it('chip ids round-trip', () => {
    expect(parseChipId(chipId.defense('immune', 'Ground'))).toEqual({ kind: 'defense', relation: 'immune', type: 'Ground' });
    expect(parseChipId(chipId.utilityMember('pivot', 'uturn'))).toEqual({ kind: 'utilityMember', key: 'pivot', id: 'uturn' });
    expect(parseChipId(chipId.stat('spe'))).toEqual({ kind: 'stat', stat: 'spe' });
  });
});
