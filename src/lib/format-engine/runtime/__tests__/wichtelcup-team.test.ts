import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcup } from '@/lib/format-kit/presets/wichtelcup';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { evaluateConstraints, type ConstraintIssue, type TeamMember } from '../team';
import { item, stateFor } from './helpers';

// The shipped Wichtelcup example through the team constraints of its `cup` stage: the allowlist, the weekly gift
// obligations, the New Year pool and the team size, per week and per player. Species are the real pool entries.

const compiled = compile(wichtelcup);
if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
const DEF = compiled.definition as FormatDefinition;
const CUP = DEF.stages.find((stage) => stage.key === 'cup')?.constraints ?? [];

// Indexes into the constraint list (document order).
const SIZE = 0;
const TERA = 1;
const ALLOWLIST = 2;
const JUNK_WEEK_1 = 3;
const JUNK_WEEKS_2_3 = 4;
const NO_PREMIUM = 5;
const PREMIUM_REQUIRED = 6;
const NEW_YEAR_CLOSED = 7;
const NEW_YEAR_CAP = 8;

const pool = (key: string): string[] => (DEF.domains?.find((d) => d.key === key)?.entries ?? []).map((e) => e.id);
const NORMAL = pool('normal');
const JUNK = pool('junk');
const PREMIUM = pool('premium');
const NEW_YEAR = pool('new_year');

function member(id: string, over: Partial<TeamMember> = {}): TeamMember {
  return { name: id, species: id, baseName: id, baseSpecies: id, types: ['Ice'], item: `held-${id}`, itemName: `Held ${id}`, teraType: null, evolution: 'fe', ...over };
}

const gift = (resource: 'junk_gifts' | 'premium_gift', itemId: string, player = 'p1') => item({ resource, player_id: player, item_id: itemId });

/** Player p1 holds junk gifts `bergmite` (hazard removal) and `delibird` (hazard setter) and the premium gift `glastrier`. */
const OWN = [gift('junk_gifts', 'bergmite'), gift('junk_gifts', 'delibird'), gift('premium_gift', 'glastrier')];
const J1 = 'bergmite';
const J2 = 'delibird';
const P = 'glastrier';

function check(round: number, ids: string[], opts: { items?: ReturnType<typeof item>[]; flags?: Record<string, string>; members?: TeamMember[] } = {}): ConstraintIssue[] {
  return evaluateConstraints({
    constraints: CUP,
    def: DEF,
    state: stateFor(DEF, { items: opts.items ?? OWN, flags: opts.flags ?? {} }),
    seed: 'seed-0123456789',
    playerId: 'p1',
    round,
    members: opts.members ?? ids.map((id) => member(id)),
  });
}

const codes = (issues: ConstraintIssue[]) => issues.map((i) => `${i.code}#${i.constraint_index}`);
const normals = (n: number, from = 0) => NORMAL.slice(from, from + n);

describe('the Wichtelcup example data', () => {
  it('has the constraint order this file reads', () => {
    expect(CUP.map((c) => c.kind)).toEqual(['roster_size', 'tera', 'count', 'count', 'count', 'count', 'count', 'count', 'count']);
    expect(NORMAL).toHaveLength(64);
    expect(JUNK).toHaveLength(30);
    expect(PREMIUM).toHaveLength(23);
    expect(NEW_YEAR).toHaveLength(24);
    expect(JUNK).toContain(J1);
    expect(JUNK).toContain(J2);
    expect(PREMIUM).toContain(P);
  });
});

describe('week 1', () => {
  it('accepts one own junk gift and five normal Pokémon', () => {
    expect(check(1, [J1, ...normals(5)])).toEqual([]);
  });

  it('asks for a junk gift when there is none', () => {
    expect(codes(check(1, normals(6)))).toEqual([`kit_count_min#${JUNK_WEEK_1}`]);
  });

  it('allows only one of the two junk gifts', () => {
    const issues = check(1, [J1, J2, ...normals(4)]);
    expect(codes(issues)).toEqual([`kit_count_max#${JUNK_WEEK_1}`]);
    expect(issues[0].pokemon_indexes).toEqual([0, 1]);
  });

  it('refuses the premium gift', () => {
    const issues = check(1, [J1, P, ...normals(4)]);
    expect(codes(issues)).toEqual([`kit_count_max#${NO_PREMIUM}`]);
    expect(issues[0].pokemon_indexes).toEqual([1]);
  });

  it('refuses the New Year pool even when its flag says unlocked', () => {
    const open = check(1, [J1, 'necrozma', ...normals(4)], { flags: { 'domain:new_year': 'unlocked' } });
    expect(codes(open)).toEqual([`kit_count_max#${NEW_YEAR_CLOSED}`]);
    expect(open[0].pokemon_indexes).toEqual([1]);
    expect(codes(check(1, [J1, 'necrozma', ...normals(4)]))).toEqual([`kit_count_max#${NEW_YEAR_CLOSED}`]);
  });
});

describe('week 2', () => {
  it('accepts both junk gifts and four normal Pokémon', () => {
    expect(check(2, [J1, J2, ...normals(4)])).toEqual([]);
  });

  it('asks for both junk gifts', () => {
    expect(codes(check(2, [J1, ...normals(5)]))).toEqual([`kit_count_min#${JUNK_WEEKS_2_3}`]);
  });

  it('refuses the premium gift', () => {
    expect(codes(check(2, [J1, J2, P, ...normals(3)]))).toEqual([`kit_count_max#${NO_PREMIUM}`]);
  });
});

describe('week 3', () => {
  it('accepts both junk gifts, the premium gift and three normal Pokémon', () => {
    expect(check(3, [J1, J2, P, ...normals(3)])).toEqual([]);
  });

  it('asks for the premium gift', () => {
    expect(codes(check(3, [J1, J2, ...normals(4)]))).toEqual([`kit_count_min#${PREMIUM_REQUIRED}`]);
  });

  it('asks for both junk gifts', () => {
    expect(codes(check(3, [J1, P, ...normals(4)]))).toEqual([`kit_count_min#${JUNK_WEEKS_2_3}`]);
  });

  it('keeps the New Year pool closed', () => {
    expect(codes(check(3, [J1, J2, P, 'jirachi', ...normals(2)]))).toEqual([`kit_count_max#${NEW_YEAR_CLOSED}`]);
  });
});

describe('week 4', () => {
  it('keeps the premium gift mandatory', () => {
    expect(codes(check(4, normals(6)))).toEqual([`kit_count_min#${PREMIUM_REQUIRED}`]);
    expect(check(4, [P, ...normals(5)])).toEqual([]);
  });

  it('makes the junk gifts optional', () => {
    expect(check(4, [P, J1, ...normals(4)])).toEqual([]);
    expect(check(4, [P, J1, J2, ...normals(3)])).toEqual([]);
  });

  it('admits zero, one or two New Year Pokémon and refuses three', () => {
    expect(check(4, [P, ...normals(5)])).toEqual([]);
    expect(check(4, [P, NEW_YEAR[0], ...normals(4)])).toEqual([]);
    expect(check(4, [P, NEW_YEAR[0], NEW_YEAR[1], ...normals(3)])).toEqual([]);
    const issues = check(4, [P, NEW_YEAR[0], NEW_YEAR[1], NEW_YEAR[2], ...normals(2)]);
    expect(codes(issues)).toEqual([`kit_count_max#${NEW_YEAR_CAP}`]);
    expect(issues[0].pokemon_indexes).toEqual([1, 2, 3]);
  });

  it('follows the same rules in a tiebreak round after week 4', () => {
    expect(check(5, [P, NEW_YEAR[0], ...normals(4)])).toEqual([]);
    expect(codes(check(5, [P, NEW_YEAR[0], NEW_YEAR[1], NEW_YEAR[2], ...normals(2)]))).toEqual([`kit_count_max#${NEW_YEAR_CAP}`]);
  });
});

describe('the pools of one player', () => {
  it('refuses a gift of another player, on its own slot', () => {
    const items = [...OWN, gift('junk_gifts', 'sudowoodo', 'p2')];
    const issues = check(1, [], { items, members: ['sudowoodo', ...normals(5)].map((id) => member(id)) });
    expect(issues).toEqual([
      { code: 'kit_not_allowed', constraint_index: ALLOWLIST, pokemon_indexes: [0], params: { species: 'sudowoodo' } },
      { code: 'kit_count_min', constraint_index: JUNK_WEEK_1, params: { source: 'your own junk gifts', min: 1, have: 0 } },
    ]);
  });

  it('refuses the premium gift of another player in week 3', () => {
    const items = [gift('junk_gifts', J1), gift('junk_gifts', J2), gift('premium_gift', 'tyranitar', 'p2')];
    const issues = check(3, [], { items, members: [J1, J2, 'tyranitar', ...normals(3)].map((id) => member(id)) });
    expect(codes(issues)).toEqual([`kit_not_allowed#${ALLOWLIST}`, `kit_count_min#${PREMIUM_REQUIRED}`]);
    expect(issues[0].pokemon_indexes).toEqual([2]);
  });

  it('refuses a species of no pool and names it', () => {
    const issues = check(1, [J1, 'garchomp', ...normals(4)]);
    expect(issues.find((i) => i.code === 'kit_not_allowed')).toEqual({ code: 'kit_not_allowed', constraint_index: ALLOWLIST, pokemon_indexes: [1], params: { species: 'garchomp' } });
  });

  it('lists each outsider as its own issue', () => {
    const issues = check(1, [J1, 'garchomp', 'dragapult', ...normals(3)]);
    const outsiders = issues.filter((i) => i.code === 'kit_not_allowed');
    expect(outsiders.map((i) => i.pokemon_indexes)).toEqual([[1], [2]]);
  });

  it('lets every player use the whole normal pool', () => {
    for (const id of NORMAL) expect(check(1, [J1, id], { members: [member(J1), member(id)] }).some((i) => i.code === 'kit_not_allowed')).toBe(false);
  });

  it('lets two players hold the same junk species', () => {
    const items = [gift('junk_gifts', J1), gift('junk_gifts', J1, 'p2')];
    expect(check(1, [J1, ...normals(5)], { items })).toEqual([]);
  });
});

describe('the team itself', () => {
  it('needs exactly six Pokémon', () => {
    const five = check(1, [J1, ...normals(4)]);
    expect(five.find((i) => i.code === 'kit_roster_size')).toEqual({ code: 'kit_roster_size', constraint_index: SIZE, params: { min: 6, max: 6, have: 5 } });
    const seven = check(1, [J1, ...normals(6)]);
    expect(seven.find((i) => i.code === 'kit_roster_size')?.params).toEqual({ min: 6, max: 6, have: 7 });
    expect(check(1, [J1, ...normals(5)]).some((i) => i.code === 'kit_roster_size')).toBe(false);
  });

  it('bans Terastallization on the slot that chose a Tera type', () => {
    const members = [J1, ...normals(5)].map((id, i) => member(id, i === 3 ? { teraType: 'Ice' } : {}));
    const issues = check(1, [], { members });
    expect(issues).toEqual([{ code: 'kit_tera_banned', constraint_index: TERA, pokemon_indexes: [3], params: {} }]);
  });
});

describe('the round decides', () => {
  it('judges the same team differently in different weeks', () => {
    const ids = [J1, ...normals(5)];
    expect(check(1, ids)).toEqual([]);
    expect(codes(check(2, ids))).toEqual([`kit_count_min#${JUNK_WEEKS_2_3}`]);
  });

  it('judges a week-4 team by week-3 rules when the match is a week-3 match', () => {
    const week4Team = [P, J1, NEW_YEAR[0], ...normals(3)];
    expect(check(4, week4Team)).toEqual([]);
    const asWeek3 = check(3, week4Team);
    expect(codes(asWeek3)).toEqual([`kit_count_min#${JUNK_WEEKS_2_3}`, `kit_count_max#${NEW_YEAR_CLOSED}`]);
  });
});
