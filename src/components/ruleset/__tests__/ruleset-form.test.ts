import { describe, expect, it } from 'vitest';
import type { FormatDefaults } from '@/lib/pkmn/format-catalog';
import type { RulesetFormData } from '@/types/ruleset';
import {
  EMPTY_RULESET_FORM,
  applyDefaults,
  defaultsToLists,
  formatSwitchImpact,
  isRuleless,
  keepLists,
  listsOf,
  toSavePayload,
} from '../ruleset-form';

const OU: FormatDefaults = {
  name: 'Gen 9 OU',
  gen: 9,
  tier: 'OU',
  is_doubles: false,
  clauses: ['Species Clause', 'Sleep Clause Mod'],
  banned_pokemon: ['Koraidon', 'Miraidon'],
  banned_moves: ['Baton Pass'],
  banned_items: ['King’s Rock'],
};

const VGC: FormatDefaults = {
  name: 'Gen 9 VGC',
  gen: 9,
  tier: 'VGC',
  is_doubles: true,
  clauses: ['Species Clause', 'Item Clause'],
  banned_pokemon: [],
  banned_moves: [],
  banned_items: [],
};

function form(overrides: Partial<RulesetFormData> = {}): RulesetFormData {
  return {
    name: 'Test',
    base_format: 'gen9ou',
    is_doubles: false,
    clauses: [],
    banned_pokemon: [],
    banned_moves: [],
    banned_items: [],
    banned_abilities: [],
    added_pokemon: [],
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    ...overrides,
  };
}

const BASELINE = defaultsToLists(OU);

describe('formatSwitchImpact', () => {
  it('is not customised when the lists equal the baseline (order and case ignored)', () => {
    const current = listsOf(
      applyDefaults(form(), 'gen9ou', {
        ...OU,
        clauses: ['sleep clause mod', ' Species Clause '],
        banned_pokemon: ['MIRAIDON', 'koraidon'],
      }),
    );
    const impact = formatSwitchImpact(current, BASELINE);
    expect(impact).toEqual({ customised: false, doublesDiffers: false, baselineKnown: true, changes: [] });
  });

  it('counts added and removed entries per list', () => {
    const current = listsOf(
      applyDefaults(form(), 'gen9ou', OU),
    );
    current.banned_pokemon = ['Koraidon', 'Mewtwo', 'Lugia'];
    current.clauses = ['Species Clause'];
    current.added_pokemon = ['Pikachu'];
    const impact = formatSwitchImpact(current, BASELINE);
    expect(impact.customised).toBe(true);
    expect(impact.changes).toEqual([
      { key: 'clauses', added: 0, removed: 1, total: 1 },
      { key: 'banned_pokemon', added: 2, removed: 1, total: 3 },
      { key: 'added_pokemon', added: 1, removed: 0, total: 1 },
    ]);
  });

  it('flags a doubles flag that differs from the current format', () => {
    const current = { ...listsOf(applyDefaults(form(), 'gen9ou', OU)), is_doubles: true };
    const impact = formatSwitchImpact(current, BASELINE);
    expect(impact.doublesDiffers).toBe(true);
    expect(impact.customised).toBe(true);
    expect(impact.changes).toEqual([]);
  });

  it('treats a null baseline as every non-empty list customised', () => {
    const current = listsOf(form({ clauses: ['Species Clause'], banned_moves: ['Baton Pass', 'Spore'] }));
    const impact = formatSwitchImpact(current, null);
    expect(impact.baselineKnown).toBe(false);
    expect(impact.customised).toBe(true);
    expect(impact.changes).toEqual([
      { key: 'clauses', added: 1, removed: 0, total: 1 },
      { key: 'banned_moves', added: 2, removed: 0, total: 2 },
    ]);
  });

  it('is not customised for empty lists and a null baseline', () => {
    expect(formatSwitchImpact(listsOf(form()), null).customised).toBe(false);
  });
});

describe('applyDefaults', () => {
  it('replaces the lists, resets abilities and additions, and copies the arrays', () => {
    const before = form({
      name: 'Keep me',
      banned_abilities: ['Moody'],
      added_pokemon: ['Pikachu'],
      custom_rules_string: 'x',
    });
    const after = applyDefaults(before, 'gen9vgc', VGC);
    expect(after.base_format).toBe('gen9vgc');
    expect(after.is_doubles).toBe(true);
    expect(after.clauses).toEqual(['Species Clause', 'Item Clause']);
    expect(after.banned_abilities).toEqual([]);
    expect(after.added_pokemon).toEqual([]);
    expect(after.name).toBe('Keep me');
    expect(after.custom_rules_string).toBe('x');
    expect(after.clauses).not.toBe(VGC.clauses);
  });
});

describe('keepLists', () => {
  it('changes only the base format', () => {
    const before = form({ clauses: ['Species Clause'], banned_abilities: ['Moody'], is_doubles: true });
    expect(keepLists(before, 'gen9vgc')).toEqual({ ...before, base_format: 'gen9vgc' });
  });
});

describe('isRuleless', () => {
  it('is true for an empty OU form', () => {
    expect(isRuleless(form())).toBe(true);
  });

  it('is false for the blank format', () => {
    expect(isRuleless(form({ base_format: 'blank' }))).toBe(false);
  });

  it('is false as soon as any list has an entry', () => {
    for (const key of [
      'clauses',
      'banned_pokemon',
      'banned_moves',
      'banned_items',
      'banned_abilities',
      'added_pokemon',
    ] as const) {
      expect(isRuleless(form({ [key]: ['x'] }))).toBe(false);
    }
  });
});

describe('toSavePayload', () => {
  it('sends null for a new ruleset with null or empty constraints', () => {
    expect(toSavePayload(form({ team_constraints: null })).team_constraints).toBeNull();
    expect(toSavePayload(form({ team_constraints: {} })).team_constraints).toBeNull();
    expect(toSavePayload(form({ team_constraints: {} }), null).team_constraints).toBeNull();
  });

  it('keeps real constraints and drops undefined keys', () => {
    const payload = toSavePayload(form({ team_constraints: { tera_match: 'player_core', eviolite_tier_cap: undefined } }));
    expect(payload.team_constraints).toEqual({ tera_match: 'player_core' });
  });

  it('keeps an untouched stored empty object as an empty object', () => {
    expect(toSavePayload(form({ team_constraints: {} }), {}).team_constraints).toEqual({});
  });

  it('sends null when the toggle was turned off on a stored empty object', () => {
    expect(toSavePayload(form({ team_constraints: null }), {}).team_constraints).toBeNull();
  });

  it('normalises an emptied block when the stored value held rules', () => {
    expect(toSavePayload(form({ team_constraints: {} }), { tera_match: 'none' }).team_constraints).toBeNull();
  });

  it('does not change the other fields', () => {
    const f = form({ name: 'Spring', clauses: ['Species Clause'] });
    expect(toSavePayload(f)).toEqual(f);
  });
});

describe('EMPTY_RULESET_FORM', () => {
  it('is a ruleless Gen 9 OU form, and applyDefaults fills it from a format without touching it', () => {
    expect(isRuleless(EMPTY_RULESET_FORM)).toBe(true);
    expect(EMPTY_RULESET_FORM).toMatchObject({ name: '', base_format: 'gen9ou', team_constraints: null, min_shared_type_pct: 0 });
    const snapshot = structuredClone(EMPTY_RULESET_FORM);
    const filled = applyDefaults({ ...EMPTY_RULESET_FORM, name: 'League' }, 'gen9ou', OU);
    expect(filled).toMatchObject({ name: 'League', base_format: 'gen9ou', clauses: OU.clauses, banned_pokemon: OU.banned_pokemon });
    expect(filled.clauses).not.toBe(OU.clauses);
    expect(EMPTY_RULESET_FORM).toEqual(snapshot);
  });
});
