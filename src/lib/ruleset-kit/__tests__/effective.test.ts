import { describe, expect, it } from 'vitest';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { blankFormatKey, computeEffective, diffResolved, rulesFromBans } from '../effective';
import type { RulesetDocument } from '../types';

const PRESET: PresetRules = {
  id: 'gen9ou',
  name: 'Gen 9 OU',
  gen: 9,
  mod: 'gen9',
  universe: 'standard',
  doubles: false,
  source: 'showdown',
  clauses: ['speciesclause', 'sleepclausemod'],
  pokemon: { mode: 'block', ids: ['koraidon', 'miraidon'] },
  moves: { mode: 'block', ids: ['lastrespects'] },
  items: { mode: 'block', ids: [] },
  abilities: { mode: 'block', ids: ['moody'] },
  facts: {} as PresetRules['facts'],
  combination_bans: [],
  catalog_version: 'test',
};

const ROSTER: PresetRules = {
  ...PRESET,
  id: 'gen9championsdraft',
  mod: 'champions',
  pokemon: { mode: 'allow', ids: ['charizard', 'garchomp', 'pikachu'] },
};

function doc(patch: Partial<RulesetDocument> = {}, preset = 'gen9ou'): RulesetDocument {
  return { ...newRulesetDocument('Test', 'en', preset), ...patch };
}

describe('computeEffective', () => {
  it('is the preset when the document changes nothing', () => {
    const rules = computeEffective(doc(), PRESET);
    expect(rules).toMatchObject({
      v: 1,
      gen: 9,
      format_key: 'gen9ou',
      universe: 'standard',
      doubles: false,
      clauses: ['sleepclausemod', 'speciesclause'],
      pokemon: { mode: 'block', ids: ['koraidon', 'miraidon'] },
      abilities: { mode: 'block', ids: ['moody'] },
      added_pokemon: [],
    });
  });

  it('adds bans, removes unbans and keeps every list sorted and unique', () => {
    const rules = computeEffective(
      doc({
        pokemon: { ban: ['garchomp', 'garchomp', 'azumarill'], unban: ['miraidon'], allow: null },
        moves: { ban: ['dragondance'], unban: ['lastrespects'], allow: null },
      }),
      PRESET,
    );
    expect(rules.pokemon.ids).toEqual(['azumarill', 'garchomp', 'koraidon']);
    expect(rules.moves.ids).toEqual(['dragondance']);
    expect(rules.added_pokemon).toEqual(['miraidon']);
  });

  it('an unban wins over the base, and over a ban of the same id in the document', () => {
    const rules = computeEffective(doc({ pokemon: { ban: ['koraidon'], unban: ['koraidon'], allow: null } }), PRESET);
    expect(rules.pokemon.ids).toEqual(['miraidon']);
  });

  it('an allowlist replaces the base list and ignores it', () => {
    const rules = computeEffective(doc({ pokemon: { ban: [], unban: [], allow: ['pikachu', 'eevee'] } }), PRESET);
    expect(rules.pokemon).toEqual({ mode: 'allow', ids: ['eevee', 'pikachu'] });
  });

  it('a preset that is itself a roster keeps allow mode: unban adds, ban removes', () => {
    const rules = computeEffective(doc({ pokemon: { ban: ['garchomp'], unban: ['eevee'], allow: null } }, 'gen9championsdraft'), ROSTER);
    expect(rules.pokemon).toEqual({ mode: 'allow', ids: ['charizard', 'eevee', 'pikachu'] });
  });

  it('clauses are (preset + add) minus remove', () => {
    const rules = computeEffective(doc({ clauses: { add: ['itemclause'], remove: ['sleepclausemod'] } }), PRESET);
    expect(rules.clauses).toEqual(['itemclause', 'speciesclause']);
  });

  it('a blank base takes generation, game type and universe from the document and has no bans', () => {
    const blank = doc({ base: { kind: 'blank', gen: 4, doubles: true, universe: 'national' }, identity: { name: doc().identity.name } });
    const rules = computeEffective(blank, null);
    expect(rules).toMatchObject({ gen: 4, doubles: true, universe: 'national', format_key: 'gen4doublesou', pokemon: { mode: 'block', ids: [] } });
  });

  it('the format key of a blank base follows based_on when it is a catalog id', () => {
    expect(blankFormatKey('gen8ou', 7, false)).toBe('gen8ou');
    expect(blankFormatKey('slug-of-a-ruleset', 7, false)).toBe('gen7ou');
    expect(blankFormatKey(undefined, 9, true)).toBe('gen9doublesou');
  });

  it('is a programming error to resolve a preset base without the preset', () => {
    expect(() => computeEffective(doc(), null)).toThrow('not resolved');
  });

  it('carries the shared-type percentage, the team constraints and the notes unchanged', () => {
    const rules = computeEffective(doc({ min_shared_type_pct: 50, team_constraints: { tera_match: 'none' }, custom_rules: 'No legends.' }), PRESET);
    expect(rules).toMatchObject({ min_shared_type_pct: 50, team_constraints: { tera_match: 'none' }, custom_rules: 'No legends.' });
  });

  it('does not mutate the document or the preset', () => {
    const d = doc({ pokemon: { ban: ['b', 'a'], unban: [], allow: null } });
    const before = JSON.stringify([d, PRESET]);
    computeEffective(d, PRESET);
    expect(JSON.stringify([d, PRESET])).toBe(before);
  });
});

describe('rulesFromBans', () => {
  it('folds names to ids and defaults the format key to the generation OU', () => {
    const rules = rulesFromBans({ gen: 9, clauses: ['Species Clause'], bans: { pokemon: ['Tapu Koko', 'Nidoran♀'], moves: ['Baton Pass'] } });
    expect(rules).toMatchObject({
      format_key: 'gen9ou',
      clauses: ['speciesclause'],
      pokemon: { mode: 'block', ids: ['nidoranf', 'tapukoko'] },
      moves: { mode: 'block', ids: ['batonpass'] },
    });
  });

  it('an allowlist category is allow mode', () => {
    expect(rulesFromBans({ gen: 9, allow: { items: ['Leftovers'] } }).items).toEqual({ mode: 'allow', ids: ['leftovers'] });
  });
});

describe('diffResolved', () => {
  it('lists what a pin move adds and removes, and notices a catalog-only republish', () => {
    const a = computeEffective(doc(), PRESET);
    const b = computeEffective(doc({ pokemon: { ban: ['garchomp'], unban: ['koraidon'], allow: null } }), PRESET);
    const diff = diffResolved(a, b);
    expect(diff.pokemon).toEqual({ modeChanged: false, added: ['garchomp'], removed: ['koraidon'] });
    expect(diff.moves.added).toEqual([]);
    // Two versions with the same document but a corrected preset differ in `resolved` only.
    const corrected = computeEffective(doc(), { ...PRESET, pokemon: { mode: 'block', ids: ['koraidon', 'miraidon', 'calyrexshadow'] } });
    expect(diffResolved(a, corrected).pokemon.added).toEqual(['calyrexshadow']);
  });
});
