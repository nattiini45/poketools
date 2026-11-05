import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcupDoc } from '@/lib/format-kit/__tests__/fixtures/docs';
import type { Expr } from '@/lib/format-kit/expr/ast';
import type { FormatDefinition, TeamConstraint } from '@/lib/format-kit/types';
import { createTranslator } from '@/i18n/core';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import type { TeamValidationResult } from '@/types/team';
import {
  constraintIssueText,
  evaluateConstraints,
  mergeConstraintIssues,
  type ConstraintInput,
  type ConstraintIssue,
  type TeamMember,
} from '../team';
import type { DomainAmendment } from '../types';
import { item, stateFor } from './helpers';

function wichtelDef(): FormatDefinition {
  const result = compile(wichtelcupDoc());
  if (result.definition === null) throw new Error('the Wichtelcup fixture does not compile');
  return result.definition as FormatDefinition;
}

const DEF = wichtelDef();
const stage = (key: string) => DEF.stages.find((s) => s.key === key)?.constraints ?? [];
const CUP = stage('cup');

function member(species: string, over: Partial<TeamMember> = {}): TeamMember {
  return {
    name: species,
    species,
    baseName: species,
    baseSpecies: species,
    types: ['Normal'],
    item: `held-${species}`,
    itemName: `Held ${species}`,
    teraType: null,
    evolution: 'fe',
    ...over,
  };
}

/** The normal pool grows to six entries so that a whole team can come from it. */
const POOL: DomainAmendment = {
  domain: 'normal',
  add: ['toxapex', 'ferrothorn', 'gengar', 'dragonite'].map((id) => ({ id, attrs: [] })),
};
const NEW_YEAR: DomainAmendment = { domain: 'new_year', add: ['dragapult', 'gholdengo'].map((id) => ({ id, attrs: [] })) };
const UNLOCKED = { 'domain:new_year': 'unlocked' } as const;

const normals = (...species: string[]) => species.map((s) => member(s));
const NORMAL_FIVE = ['garchomp', 'blissey', 'toxapex', 'ferrothorn', 'gengar'];

function input(over: Partial<ConstraintInput> & Pick<ConstraintInput, 'members'>): ConstraintInput {
  return {
    constraints: CUP,
    def: DEF,
    state: stateFor(DEF, { amendments: [POOL, NEW_YEAR] }),
    seed: 'seed-0123456789',
    playerId: 'p1',
    round: 1,
    ...over,
  };
}

const codes = (issues: ConstraintIssue[]) => issues.map((i) => `${i.code}#${i.constraint_index}`);

describe('evaluateConstraints: the Wichtelcup reading', () => {
  it('accepts a round 1 team of five normal Pokémon and one junk gift', () => {
    const state = stateFor(DEF, { amendments: [POOL, NEW_YEAR], items: [item({ resource: 'gifts_junk', player_id: 'p1', item_id: 'wobbuffet' })] });
    expect(evaluateConstraints(input({ round: 1, state, members: [...normals(...NORMAL_FIVE), member('wobbuffet')] }))).toEqual([]);
  });

  it('asks for the junk gift in round 1', () => {
    const issues = evaluateConstraints(input({ round: 1, members: normals(...NORMAL_FIVE, 'dragonite') }));
    expect(issues).toEqual([{ code: 'kit_count_min', constraint_index: 5, params: { source: 'resource gifts_junk', min: 1, have: 0 } }]);
  });

  it('does not count the gifts of other players', () => {
    const state = stateFor(DEF, { amendments: [POOL], items: [item({ resource: 'gifts_junk', player_id: 'p2', item_id: 'wobbuffet' })] });
    const issues = evaluateConstraints(input({ round: 1, state, members: [...normals(...NORMAL_FIVE), member('wobbuffet')] }));
    expect(codes(issues)).toEqual(['kit_count_max#4', 'kit_count_min#5']);
    expect(issues[0].pokemon_indexes).toEqual([5]);
  });

  it('allows one junk gift in round 1 and no more', () => {
    const state = stateFor(DEF, {
      amendments: [POOL],
      items: ['wobbuffet', 'smeargle'].map((id) => item({ resource: 'gifts_junk', player_id: 'p1', item_id: id })),
    });
    const issues = evaluateConstraints(input({ round: 1, state, members: [...normals(...NORMAL_FIVE.slice(0, 4)), member('wobbuffet'), member('smeargle')] }));
    expect(issues).toEqual([
      { code: 'kit_count_max', constraint_index: 5, pokemon_indexes: [4, 5], params: { source: 'resource gifts_junk', max: 1, have: 2 } },
    ]);
  });

  it('forbids premium gifts in rounds 1 and 2 and asks for two junk gifts in round 2', () => {
    const state = stateFor(DEF, {
      amendments: [POOL, NEW_YEAR],
      items: [
        item({ resource: 'gifts_junk', player_id: 'p1', item_id: 'wobbuffet' }),
        item({ resource: 'gifts_premium', player_id: 'p1', item_id: 'corviknight' }),
      ],
    });
    const members = [...normals('garchomp', 'blissey', 'toxapex', 'ferrothorn'), member('wobbuffet'), member('corviknight')];
    expect(codes(evaluateConstraints(input({ round: 2, state, members })))).toEqual(['kit_count_max#6', 'kit_count_min#7']);
    expect(codes(evaluateConstraints(input({ round: 1, state, members })))).toEqual(['kit_count_max#6']);
  });

  it('accepts two junk gifts and one premium gift in round 3', () => {
    const state = stateFor(DEF, {
      amendments: [POOL, NEW_YEAR],
      items: [
        item({ resource: 'gifts_junk', player_id: 'p1', item_id: 'wobbuffet' }),
        item({ resource: 'gifts_junk', player_id: 'p1', item_id: 'smeargle' }),
        item({ resource: 'gifts_premium', player_id: 'p1', item_id: 'corviknight' }),
        item({ resource: 'gifts_junk', player_id: 'p2', item_id: 'ditto' }),
      ],
    });
    const members = [...normals('garchomp', 'blissey', 'toxapex'), member('wobbuffet'), member('smeargle'), member('corviknight')];
    expect(evaluateConstraints(input({ round: 3, state, members }))).toEqual([]);
    expect(codes(evaluateConstraints(input({ round: 3, state, members: members.slice(0, 5).concat(member('gengar')) })))).toEqual([
      'kit_count_min#8',
    ]);
  });

  it('refuses a Pokémon outside every allowed source while the New Year pool is locked, and admits it once unlocked', () => {
    const members = normals(...NORMAL_FIVE, 'dragapult');
    const base = { amendments: [POOL, NEW_YEAR], items: [item({ resource: 'gifts_junk', player_id: 'p1', item_id: 'wobbuffet' })] };
    const locked = evaluateConstraints(input({ round: 4, state: stateFor(DEF, base), members }));
    expect(codes(locked)).toContain('kit_count_max#4');
    expect(locked.find((i) => i.constraint_index === 4)?.pokemon_indexes).toEqual([5]);

    const unlocked = evaluateConstraints(input({ round: 4, state: stateFor(DEF, { ...base, flags: UNLOCKED }), members }));
    expect(codes(unlocked)).not.toContain('kit_count_max#4');
  });

  it('caps the New Year picks at two in round 4', () => {
    const state = stateFor(DEF, { amendments: [POOL, NEW_YEAR], flags: UNLOCKED });
    const members = [...normals('garchomp', 'blissey', 'toxapex'), member('dragapult'), member('gholdengo'), member('corviknight')];
    const issues = evaluateConstraints(input({ round: 4, state, members }));
    expect(issues.filter((i) => i.constraint_index === 9)).toEqual([
      { code: 'kit_count_max', constraint_index: 9, pokemon_indexes: [3, 4, 5], params: { source: 'domain new_year', max: 2, have: 3 } },
    ]);
    expect(evaluateConstraints(input({ round: 3, state, members })).some((i) => i.constraint_index === 9)).toBe(false);
  });

  it('checks the size, a repeated base species, a repeated item and Tera', () => {
    const rotoms = [
      member('rotomwash', { baseSpecies: 'rotom', baseName: 'Rotom', name: 'Rotom-Wash', item: 'leftovers', itemName: 'Leftovers' }),
      member('rotomheat', { baseSpecies: 'rotom', baseName: 'Rotom', name: 'Rotom-Heat', item: 'leftovers', itemName: 'Leftovers' }),
    ];
    const state = stateFor(DEF, { amendments: [POOL, { domain: 'normal', add: [{ id: 'rotom', attrs: [] }] }] });
    const issues = evaluateConstraints(
      input({ round: 2, state, members: [...rotoms, member('garchomp', { teraType: 'Ground' })] }),
    );
    expect(issues.filter((i) => i.constraint_index < 4)).toEqual([
      { code: 'kit_roster_size', constraint_index: 0, params: { min: 6, max: 6, have: 3 } },
      { code: 'kit_distinct', constraint_index: 1, pokemon_indexes: [0, 1], params: { by: 'base species', value: 'Rotom', max: 1, have: 2 } },
      { code: 'kit_distinct', constraint_index: 2, pokemon_indexes: [0, 1], params: { by: 'item', value: 'Leftovers', max: 1, have: 2 } },
      { code: 'kit_tera_banned', constraint_index: 3, pokemon_indexes: [2], params: {} },
    ]);
    // `rotom` in the pool covers its formes, so neither Rotom is an outsider.
    expect(issues.some((i) => i.constraint_index === 4 && i.pokemon_indexes?.some((n) => n < 2))).toBe(false);
  });
});

describe('species matching', () => {
  const countMax0 = (source: Extract<TeamConstraint, { kind: 'count' }>['source']): TeamConstraint[] => [{ kind: 'count', source, max: 0 }];
  const deerlingWinter = member('deerlingwinter', { baseSpecies: 'deerling' });

  it('matches an entry on the base species id only when the entry is the base', () => {
    const baseEntry = evaluateConstraints(input({ constraints: countMax0({ kind: 'species', ids: ['deerling'] }), members: [deerlingWinter] }));
    expect(codes(baseEntry)).toEqual(['kit_count_max#0']);

    const formeEntry = evaluateConstraints(input({ constraints: countMax0({ kind: 'species', ids: ['deerlingwinter'] }), members: [member('deerling')] }));
    expect(formeEntry).toEqual([]);
    const sameForme = evaluateConstraints(input({ constraints: countMax0({ kind: 'species', ids: ['deerlingwinter'] }), members: [deerlingWinter] }));
    expect(codes(sameForme)).toEqual(['kit_count_max#0']);
  });

  it('combines sources with any_of and not', () => {
    const anyOf: TeamConstraint[] = [
      { kind: 'count', source: { kind: 'any_of', sources: [{ kind: 'species', ids: ['garchomp'] }, { kind: 'species', ids: ['blissey'] }] }, min: 2 },
    ];
    expect(evaluateConstraints(input({ constraints: anyOf, members: normals('garchomp', 'blissey') }))).toEqual([]);
    expect(codes(evaluateConstraints(input({ constraints: anyOf, members: normals('garchomp', 'gengar') })))).toEqual(['kit_count_min#0']);

    const notSpecies: TeamConstraint[] = [{ kind: 'count', source: { kind: 'not', source: { kind: 'species', ids: ['garchomp'] } }, max: 1 }];
    expect(evaluateConstraints(input({ constraints: notSpecies, members: normals('garchomp', 'blissey') }))).toEqual([]);
    expect(codes(evaluateConstraints(input({ constraints: notSpecies, members: normals('garchomp', 'blissey', 'gengar') })))).toEqual(['kit_count_max#0']);
  });

  it('matches a domain after its amendments and honours unlocked_only', () => {
    const domain = (unlocked_only: boolean): TeamConstraint[] => [{ kind: 'count', source: { kind: 'domain', domain: 'new_year', unlocked_only }, max: 0 }];
    const members = normals('corviknight');
    expect(codes(evaluateConstraints(input({ constraints: domain(false), members })))).toEqual(['kit_count_max#0']);
    expect(evaluateConstraints(input({ constraints: domain(true), members }))).toEqual([]);
    const state = stateFor(DEF, { flags: UNLOCKED });
    expect(codes(evaluateConstraints(input({ constraints: domain(true), members, state })))).toEqual(['kit_count_max#0']);

    const removed = stateFor(DEF, { amendments: [{ domain: 'new_year', remove: ['corviknight'] }] });
    expect(evaluateConstraints(input({ constraints: domain(false), members, state: removed }))).toEqual([]);
  });
});

describe('when', () => {
  const ref = (name: string, t: 'number' | 'boolean' | 'text'): Expr => ({ k: 'ref', name, t }) as Expr;
  const sizeOne = (when: Expr): TeamConstraint[] => [{ kind: 'roster_size', min: 1, max: 1, when }];

  it('skips a constraint whose condition is false and reads unlocked.<domain>', () => {
    const constraints = sizeOne(ref('unlocked.new_year', 'boolean'));
    const members = normals('garchomp', 'blissey');
    expect(evaluateConstraints(input({ constraints, members }))).toEqual([]);
    const state = stateFor(DEF, { flags: UNLOCKED });
    expect(codes(evaluateConstraints(input({ constraints, members, state })))).toEqual(['kit_roster_size#0']);
  });

  it('reports a condition that cannot be evaluated and does not apply the constraint', () => {
    const issues = evaluateConstraints(input({ constraints: sizeOne(ref('nope', 'boolean')), members: normals('garchomp', 'blissey') }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'kit_constraint_expr', constraint_index: 0, params: { index: 1 } });
  });
});

describe('type quota, Tera, evolution stage, distinct', () => {
  const houses = stage('houses');
  const ladder = stage('ladder');
  const fire = member('charizard', { types: ['Fire', 'Flying'] });
  const water = member('gyarados', { types: ['Water', 'Flying'] });
  const grass = member('venusaur', { types: ['Grass', 'Poison'] });

  it('needs every listed type once (ignoring case)', () => {
    expect(evaluateConstraints(input({ constraints: houses.slice(0, 1), members: [fire, water, grass] }))).toEqual([]);
    expect(evaluateConstraints(input({ constraints: houses.slice(0, 1), members: [fire, water] }))).toEqual([
      { code: 'kit_type_quota', constraint_index: 0, params: { type: 'grass', min: 1, have: 0 } },
    ]);
  });

  it('counts the secondary type only with allow_multi_count', () => {
    const quota = (allow_multi_count: boolean): TeamConstraint[] => [
      { kind: 'type_quota', types: { source: 'fixed', types: ['Flying'] }, min_per_type: 1, allow_multi_count },
    ];
    expect(evaluateConstraints(input({ constraints: quota(true), members: [fire] }))).toEqual([]);
    expect(codes(evaluateConstraints(input({ constraints: quota(false), members: [fire] })))).toEqual(['kit_type_quota#0']);
  });

  it('reads the types of a quota from a player attribute', () => {
    const def: FormatDefinition = {
      ...DEF,
      attributes: DEF.attributes?.map((a) => (a.key === 'house' ? { ...a, values: ['fire', 'water', 'grass'] } : a)),
    };
    const quota: TeamConstraint[] = [{ kind: 'type_quota', types: { source: 'player_attr', attr: 'house' }, min_per_type: 2, allow_multi_count: true }];
    const state = stateFor(def, { attrs: { p1: { house: 'water' } } });
    const issues = evaluateConstraints(input({ def, state, constraints: quota, members: [water, fire] }));
    expect(issues).toEqual([{ code: 'kit_type_quota', constraint_index: 0, params: { type: 'water', min: 2, have: 1 } }]);
  });

  it('limits shared types (distinct by type)', () => {
    const flyers = [fire, water, member('pidgeot', { types: ['Normal', 'Flying'] }), member('talonflame', { types: ['Fire', 'Flying'] })];
    const issues = evaluateConstraints(input({ constraints: houses.slice(2), members: flyers }));
    expect(issues).toEqual([
      { code: 'kit_distinct', constraint_index: 0, pokemon_indexes: [0, 1, 2, 3], params: { by: 'type', value: 'Flying', max: 3, have: 4 } },
    ]);
  });

  it('checks Tera against the stab types and the assigned type', () => {
    const stab: TeamConstraint[] = [{ kind: 'tera', mode: 'stab' }];
    const members = [member('charizard', { name: 'Charizard', types: ['Fire', 'Flying'], teraType: 'Water' }), member('gyarados', { types: ['Water'], teraType: 'water' }), fire];
    expect(evaluateConstraints(input({ constraints: stab, members }))).toEqual([
      { code: 'kit_tera_stab', constraint_index: 0, pokemon_indexes: [0], params: { type: 'Water', species: 'Charizard', types: 'Fire/Flying' } },
    ]);
    expect(evaluateConstraints(input({ constraints: [{ kind: 'tera', mode: 'any' }], members }))).toEqual([]);

    const def: FormatDefinition = {
      ...DEF,
      attributes: DEF.attributes?.map((a) => (a.key === 'house' ? { ...a, values: ['fire', 'water', 'grass'] } : a)),
    };
    const state = stateFor(def, { attrs: { p1: { house: 'water' } } });
    const assigned = [member('charizard', { teraType: 'Fire' }), member('gyarados', { teraType: 'Water' })];
    const issues = evaluateConstraints(input({ def, state, constraints: houses.slice(1, 2), members: assigned }));
    expect(issues).toEqual([{ code: 'kit_tera_attr', constraint_index: 0, pokemon_indexes: [0], params: { type: 'Fire', types: 'water' } }]);
  });

  it('caps the evolution classes independently', () => {
    const lc = (id: string) => member(id, { evolution: 'lc' });
    const team = [member('a'), member('b'), member('c'), member('d'), member('e'), lc('f'), lc('g'), member('h', { evolution: 'nfe' })];
    const issues = evaluateConstraints(input({ constraints: ladder.slice(0, 1), members: team }));
    expect(issues.map((i) => [i.params.stage, i.params.max, i.params.have])).toEqual([
      ['fe', 4, 5],
      ['lc', 1, 2],
    ]);
  });

  it('limits a shared entry attribute (distinct by attr) and repeated species', () => {
    const state = stateFor(DEF, { amendments: [{ domain: 'normal', add: [{ id: 'dragonite', attrs: [{ key: 'role', value: 'attacker' }] }] }] });
    const attackers = ['garchomp', 'dragonite', 'blissey'].map((s) => member(s));
    expect(evaluateConstraints(input({ state, constraints: ladder.slice(2, 3), members: attackers }))).toEqual([]);
    const three = [member('garchomp'), member('dragonite'), member('garchomp', { name: 'Garchomp' })];
    const issues = evaluateConstraints(input({ state, constraints: ladder.slice(2, 4), members: three }));
    expect(issues.map((i) => [i.code, i.params.by, i.params.have])).toEqual([
      ['kit_distinct', 'attribute role', 3],
      ['kit_distinct', 'species', 2],
    ]);
  });
});

describe('the team verdict', () => {
  const base: TeamValidationResult = { valid: true, issues: [], team_issues: [], team_issue_details: [] };
  const members = [member('garchomp', { name: 'Garchomp' })];

  it('returns the base verdict when nothing is violated', () => {
    expect(mergeConstraintIssues(base, [], members)).toBe(base);
  });

  it('turns Tera issues into errors of their set and the rest into team issues', () => {
    const issues: ConstraintIssue[] = [
      { code: 'kit_tera_banned', constraint_index: 3, pokemon_indexes: [0], params: {} },
      { code: 'kit_roster_size', constraint_index: 0, params: { min: 6, max: 6, have: 1 } },
    ];
    const merged = mergeConstraintIssues(base, issues, members);
    expect(merged.valid).toBe(false);
    expect(merged.issues).toEqual([
      { pokemon_index: 0, species: 'Garchomp', issue: 'Terastallization is not allowed in this league', severity: 'error', code: 'kit_tera_banned', params: {} },
    ]);
    expect(merged.team_issues).toEqual(['Team size: this league needs 6 to 6 Pokémon, found 1']);
    expect(merged.team_issue_details).toEqual([
      { issue: 'Team size: this league needs 6 to 6 Pokémon, found 1', code: 'kit_roster_size', params: { min: 6, max: 6, have: 1 } },
    ]);
  });

  it('keeps the issues of the ruleset check', () => {
    const withRuleset: TeamValidationResult = {
      valid: false,
      issues: [],
      team_issues: ['Species Clause'],
      team_issue_details: [{ issue: 'Species Clause', code: 'species_clause' }],
    };
    const merged = mergeConstraintIssues(withRuleset, [{ code: 'kit_roster_size', constraint_index: 0, params: { min: 1, max: 2, have: 3 } }], members);
    expect(merged.team_issues).toHaveLength(2);
    expect(merged.team_issue_details?.[0].code).toBe('species_clause');
  });

  it('has an English text equal to the catalog and a distinct German one for every code', () => {
    const en = createTranslator(teambuilderMessages, 'en');
    const de = createTranslator(teambuilderMessages, 'de');
    const params = { min: 1, max: 2, have: 3, source: 'domain x', by: 'item', value: 'Leftovers', type: 'Fire', species: 'Garchomp', types: 'Fire/Flying', stage: 'fe', index: 2, reason: 'expr_unknown_ref' };
    for (const code of [
      'kit_roster_size', 'kit_count_min', 'kit_count_max', 'kit_distinct', 'kit_type_quota', 'kit_tera_banned',
      'kit_tera_stab', 'kit_tera_attr', 'kit_evolution_stage', 'kit_constraint_expr',
    ] as const) {
      expect(constraintIssueText(code, params)).toBe(en.dynamic(`validation.issue.${code}`, params));
      expect(de.dynamic(`validation.issue.${code}`, params)).not.toBe(en.dynamic(`validation.issue.${code}`, params));
    }
  });
});
