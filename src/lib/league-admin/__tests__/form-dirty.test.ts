import { describe, expect, it } from 'vitest';
import { phaseFormDirty, poolEditorDirty, tierLimitsDirty, type PhaseFormValues } from '../form-dirty';

const PHASE: PhaseFormValues = {
  name: 'Regular season',
  description: '',
  bracketType: 'round_robin',
  rulesetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  bestOf: 3,
  boOverrides: {},
  teamVisibility: 'hidden_until_match',
  advCount: 0,
  advPerGroup: false,
};

describe('phaseFormDirty', () => {
  it('is clean while every field equals the baseline', () => {
    expect(phaseFormDirty(PHASE, { ...PHASE })).toBe(false);
  });

  it.each<[string, Partial<PhaseFormValues>]>([
    ['name', { name: 'Playoffs' }],
    ['description', { description: 'x' }],
    ['bracket type', { bracketType: 'swiss' }],
    ['ruleset', { rulesetId: '' }],
    ['best of', { bestOf: 5 }],
    ['team visibility', { teamVisibility: 'always_public' }],
    ['advancement count', { advCount: 2 }],
    ['advancement per group', { advPerGroup: true }],
    ['a positive override', { boOverrides: { '3': 5 } }],
  ])('is dirty when the %s changes', (_label, change) => {
    expect(phaseFormDirty(PHASE, { ...PHASE, ...change })).toBe(true);
  });

  it('treats a zero override as no override, and ignores key order', () => {
    expect(phaseFormDirty(PHASE, { ...PHASE, boOverrides: { '2': 0 } })).toBe(false);
    expect(
      phaseFormDirty({ ...PHASE, boOverrides: { '1': 3, '2': 5 } }, { ...PHASE, boOverrides: { '2': 5, '1': 3 } }),
    ).toBe(false);
  });
});

describe('tierLimitsDirty', () => {
  const LOADED = { S: 1, A: 2, B: 0, C: 0 };

  it('is clean while the limits equal the loaded ones', () => {
    expect(tierLimitsDirty(LOADED, { ...LOADED })).toBe(false);
  });

  it('is dirty once a limit changes', () => {
    expect(tierLimitsDirty(LOADED, { ...LOADED, B: 3 })).toBe(true);
  });

  it('counts a missing tier as 0 (unlimited)', () => {
    expect(tierLimitsDirty({ S: 1 }, { S: 1, A: 0 })).toBe(false);
    expect(tierLimitsDirty({ S: 1 }, { S: 1, A: 2 })).toBe(true);
  });
});

describe('poolEditorDirty', () => {
  const CLEAN = { addFormOpen: false, searchQuery: '', selectedPokemon: null, addCost: '' as const, templateName: '' };

  it('is clean with nothing typed or chosen', () => {
    expect(poolEditorDirty(CLEAN)).toBe(false);
    expect(poolEditorDirty({ ...CLEAN, addFormOpen: true })).toBe(false);
    expect(poolEditorDirty({ ...CLEAN, addFormOpen: true, searchQuery: '   ' })).toBe(false);
  });

  it('is dirty while the open add form has a search, a chosen Pokémon or a cost', () => {
    expect(poolEditorDirty({ ...CLEAN, addFormOpen: true, searchQuery: 'gar' })).toBe(true);
    expect(poolEditorDirty({ ...CLEAN, addFormOpen: true, selectedPokemon: 'Garchomp' })).toBe(true);
    expect(poolEditorDirty({ ...CLEAN, addFormOpen: true, addCost: 0 })).toBe(true);
  });

  it('ignores add-form fields once the form is closed', () => {
    expect(poolEditorDirty({ ...CLEAN, searchQuery: 'gar', selectedPokemon: 'Garchomp', addCost: 4 })).toBe(false);
  });

  it('is dirty while a template name is typed', () => {
    expect(poolEditorDirty({ ...CLEAN, templateName: 'OU base' })).toBe(true);
  });
});
