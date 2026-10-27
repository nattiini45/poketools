import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PokemonSet, StatSpread, ValidationIssueCode } from '@/types/team';
import type { Ruleset } from '@/types/ruleset';
import { createTranslator } from '@/i18n/core';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

vi.mock('../dex', () => ({
  getSpecies: vi.fn(),
  getMove: vi.fn(),
  getItem: vi.fn(),
  getAbility: vi.fn(),
  isFullyEvolved: vi.fn().mockReturnValue(false),
  isLegendary: vi.fn().mockReturnValue(false),
}));

import { getSpecies, getMove, getItem, getAbility } from '../dex';
import { validateTeam } from '../validation';
import { makeRuleset as buildRuleset } from '@/test/ruleset-fixtures';

const EVS: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const IVS: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

function set(overrides?: Partial<PokemonSet>): PokemonSet {
  return {
    name: '',
    species: 'Garchomp',
    gender: '',
    item: 'Leftovers',
    ability: 'Rough Skin',
    evs: { ...EVS },
    ivs: { ...IVS },
    nature: 'Jolly',
    level: 100,
    moves: ['Earthquake'],
    ...overrides,
  };
}

function ruleset(overrides?: Partial<Ruleset>): Ruleset {
  return buildRuleset({
    id: 'r',
    name: 'Gen 9 OU',
    base_format: 'gen9ou',
    is_doubles: false,
    clauses: ['Species Clause', 'Item Clause'],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    created_by: null,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  });
}

const en = createTranslator(teambuilderMessages, 'en');
const de = createTranslator(teambuilderMessages, 'de');

beforeEach(() => {
  vi.mocked(getSpecies).mockImplementation(((name: string) =>
    ({
      Garchomp: { name: 'Garchomp', types: ['Dragon', 'Ground'] },
      'Rotom-Wash': { name: 'Rotom-Wash', types: ['Electric', 'Water'], baseSpecies: 'Rotom' },
      'Rotom-Heat': { name: 'Rotom-Heat', types: ['Electric', 'Fire'], baseSpecies: 'Rotom' },
    })[name]) as typeof getSpecies);
  vi.mocked(getMove).mockImplementation(((name: string) =>
    ({ Earthquake: { name: 'Earthquake' }, 'Baton Pass': { name: 'Baton Pass' } })[name]) as typeof getMove);
  vi.mocked(getItem).mockImplementation(((name: string) => ({ Leftovers: { name: 'Leftovers' } })[name]) as typeof getItem);
  vi.mocked(getAbility).mockImplementation(((name: string) =>
    ({ 'Rough Skin': { name: 'Rough Skin' } })[name]) as typeof getAbility);
});

describe('validation issue codes', () => {
  it('codes per-set issues with English @pkmn params, keeping the English text', () => {
    const result = validateTeam(
      [
        set({ species: 'Missingno' }),
        set({ moves: ['Baton Pass', 'Splashy'], item: 'Mystery Box', ability: 'Nope', evs: { ...EVS, atk: 300, spe: 252 } }),
      ],
      ruleset({ bans: { pokemon: [], moves: ['Baton Pass'], items: [], abilities: [] } }),
    );
    const byCode = new Map(result.issues.map((i) => [i.code, i]));

    expect(byCode.get('unknown_species')).toMatchObject({ issue: 'Unknown species: Missingno', params: { species: 'Missingno' } });
    expect(byCode.get('move_banned')).toMatchObject({ issue: 'Baton Pass is banned', params: { move: 'Baton Pass' } });
    expect(byCode.get('unknown_move')).toMatchObject({ params: { move: 'Splashy' } });
    expect(byCode.get('unknown_item')).toMatchObject({ params: { item: 'Mystery Box' }, severity: 'warning' });
    expect(byCode.get('unknown_ability')).toMatchObject({ params: { ability: 'Nope' } });
    expect(byCode.get('ev_total')).toMatchObject({ params: { total: 552 } });
    expect(byCode.get('ev_stat_cap')).toMatchObject({ params: { stat: 'atk', value: 300 } });
    expect(result.issues.every((i) => typeof i.issue === 'string' && i.code !== undefined)).toBe(true);
  });

  it('returns coded team issues aligned with the English team_issues', () => {
    const result = validateTeam(
      [set({ species: 'Rotom-Wash' }), set({ species: 'Rotom-Heat' })],
      ruleset(),
      ['Rotom-Wash'],
    );

    expect(result.team_issue_details?.map((d) => d.issue)).toEqual(result.team_issues);
    expect(result.team_issue_details?.map((d) => d.code)).toEqual(['species_clause', 'item_clause', 'not_in_roster']);
    expect(result.team_issue_details?.[0].params).toEqual({ species: 'Rotom', slotA: 1, slotB: 2 });
    expect(result.team_issue_details?.[1].params).toEqual({ item: 'Leftovers', slotA: 1, slotB: 2 });
    expect(result.team_issue_details?.[2].params).toEqual({ species: 'Rotom-Heat' });
  });

  it('codes the empty team', () => {
    const result = validateTeam([], ruleset());
    expect(result.team_issue_details).toEqual([{ issue: 'Team must have at least 1 Pokémon', code: 'team_empty' }]);
  });

  it('the English catalog text renders the same as the validator text', () => {
    const result = validateTeam(
      [set({ species: 'Rotom-Wash' }), set({ species: 'Rotom-Heat', moves: [] })],
      ruleset({ bans: { pokemon: ['Rotom-Wash'], moves: [], items: [], abilities: [] } }),
      ['Rotom-Wash'],
    );
    const all = [...result.issues, ...(result.team_issue_details ?? [])];
    expect(all.length).toBeGreaterThan(3);
    for (const issue of all) {
      expect(en.dynamic(`validation.issue.${issue.code}`, issue.params)).toBe(issue.issue);
    }
  });
});

describe('teambuilder.validation.issue catalog', () => {
  const codes: ValidationIssueCode[] = [
    'unknown_species', 'species_banned', 'species_not_allowed', 'min_moves', 'max_moves', 'unknown_move', 'move_banned',
    'move_not_allowed', 'unknown_item', 'item_banned', 'item_not_allowed', 'unknown_ability', 'ability_banned', 'ability_not_allowed', 'ev_total', 'ev_stat_cap',
    'tera_core_mismatch', 'tera_type_mismatch', 'legendary_phase', 'legendary', 'fe_tier_above_cap',
    'fe_no_tier', 'eviolite_tier_cap', 'epb_stage2_tera', 'epb_stage_tera', 'team_empty', 'team_too_large',
    'species_clause', 'item_clause', 'shared_type', 'type_quota_no_core', 'type_quota',
    'tera_match_no_core', 'evolution_stage_cap', 'not_in_roster',
  ];

  it('has an English and a distinct German message for every code', () => {
    expect(Object.keys(teambuilderMessages.en.validation.issue).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      const key = `validation.issue.${code}`;
      expect(en.has(key)).toBe(true);
      expect(de.dynamic(key)).not.toBe(en.dynamic(key));
    }
  });
});
