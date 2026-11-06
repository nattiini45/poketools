import { describe, expect, it } from 'vitest';
import { validateTeam } from '../validation';
import { makeRuleset } from '@/test/ruleset-fixtures';
import type { LevelRules } from '@/lib/ruleset-kit/types';
import type { PokemonSet } from '@/types/team';

function set(level: number): PokemonSet {
  return {
    name: '', species: 'Pikachu', gender: '', item: '', ability: 'Static',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Serious', level, moves: ['Thunder Shock'],
  };
}

function result(level: number, levels: LevelRules) {
  return validateTeam([set(level)], makeRuleset({ rules: { levels } }));
}

describe('ruleset level enforcement', () => {
  it('requires an approved exact level and treats an absent level as 100', () => {
    const levels: LevelRules = { policy: 'exact', default: 100, entries: [{ id: 'pikachu', level: 90, status: 'approved' }] };
    expect(result(90, levels).issues.filter((issue) => issue.code === 'level_exact')).toHaveLength(0);
    expect(result(100, levels).issues).toContainEqual(expect.objectContaining({ code: 'level_exact', params: { level: 90, value: 100 } }));
    const missing = set(100);
    delete (missing as { level?: number }).level;
    const unchecked = validateTeam([missing], makeRuleset({ rules: { levels: { ...levels, default: 90, entries: [] } } }));
    expect(unchecked.issues).toContainEqual(expect.objectContaining({ code: 'level_exact', params: { level: 90, value: 100 } }));
  });

  it('enforces a maximum but ignores experimental entries', () => {
    const max: LevelRules = { policy: 'max', default: 100, entries: [{ id: 'pikachu', level: 90, status: 'approved' }] };
    expect(result(90, max).issues.filter((issue) => issue.code === 'level_max')).toHaveLength(0);
    expect(result(100, max).issues).toContainEqual(expect.objectContaining({ code: 'level_max' }));
    const experimental: LevelRules = { ...max, entries: [{ id: 'pikachu', level: 90, status: 'experimental' }] };
    expect(result(100, experimental).issues.filter((issue) => issue.code === 'level_max' || issue.code === 'level_exact')).toHaveLength(0);
  });

  it('returns the requirements for the teambuilder', () => {
    const levels: LevelRules = { policy: 'max', default: 100, entries: [] };
    expect(result(100, levels).level_rules).toEqual(levels);
  });
});
