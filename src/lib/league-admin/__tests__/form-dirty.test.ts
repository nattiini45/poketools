import { describe, expect, it } from 'vitest';
import {
  adoptStoredLeagueSettings,
  leagueSettingsDirty,
  phaseFormDirty,
  poolEditorDirty,
  tierLimitsDirty,
  type PhaseFormValues,
} from '../form-dirty';
import type { LeagueSettingsValues } from '../settings-patch';

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

describe('leagueSettingsDirty', () => {
  const LEAGUE: LeagueSettingsValues = {
    name: 'Spring League',
    formatType: 'singles',
    rulesetId: 'rs-1',
    startDate: '2026-03-01',
    endDate: '2026-06-01',
  };

  it('is clean while every field equals the baseline', () => {
    expect(leagueSettingsDirty(LEAGUE, { ...LEAGUE })).toBe(false);
  });

  it('ignores whitespace around the name, which the save trims', () => {
    expect(leagueSettingsDirty(LEAGUE, { ...LEAGUE, name: '  Spring League ' })).toBe(false);
  });

  it.each<[string, Partial<LeagueSettingsValues>]>([
    ['name', { name: 'Autumn League' }],
    ['league type', { formatType: 'doubles' }],
    ['ruleset', { rulesetId: '' }],
    ['start date', { startDate: '2026-03-02' }],
    ['end date', { endDate: '' }],
  ])('is dirty when the %s changes', (_label, change) => {
    expect(leagueSettingsDirty(LEAGUE, { ...LEAGUE, ...change })).toBe(true);
  });
});

describe('adoptStoredLeagueSettings', () => {
  const STORED: LeagueSettingsValues = {
    name: 'Spring League',
    formatType: 'singles',
    rulesetId: 'rs-1',
    startDate: '2026-03-01',
    endDate: '2026-06-01',
  };
  const state = (values: LeagueSettingsValues, baseline = STORED) => ({ seen: STORED, baseline, values });

  it('returns the same state while the stored values are unchanged', () => {
    const current = state({ ...STORED, name: 'Typed' });

    expect(adoptStoredLeagueSettings(current, { ...STORED })).toBe(current);
  });

  it('takes new stored values over as baseline and input when nothing is unsaved', () => {
    const next = { ...STORED, name: 'Autumn League' };

    expect(adoptStoredLeagueSettings(state(STORED), next)).toEqual({ seen: next, baseline: next, values: next });
  });

  it('keeps input typed after a save (unsaved against the saved baseline) and moves the baseline', () => {
    const saved = { ...STORED, name: 'Autumn League' };
    const typed = { ...saved, endDate: '2026-07-01' };

    const next = adoptStoredLeagueSettings({ seen: STORED, baseline: saved, values: typed }, saved);

    expect(next.values).toBe(typed);
    expect(next.baseline).toBe(saved);
    expect(leagueSettingsDirty(next.baseline, next.values)).toBe(true);
  });

  it('adopts the trimmed stored name after a save without losing the clean state', () => {
    const saved = { ...STORED, name: 'Autumn League' };
    const submittedWithSpaces = { ...saved, name: ' Autumn League ' };

    const next = adoptStoredLeagueSettings({ seen: STORED, baseline: saved, values: submittedWithSpaces }, saved);

    expect(leagueSettingsDirty(next.baseline, next.values)).toBe(false);
  });
});
