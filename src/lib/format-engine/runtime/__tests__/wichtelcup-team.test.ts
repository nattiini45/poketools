import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcup } from '@/lib/format-kit/presets/wichtelcup';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { evaluateConstraints, type ConstraintIssue, type TeamMember } from '../team';
import { item, stateFor } from './helpers';

// The shipped Wichtelcup EXAMPLE through the team constraints of its `cup` stage: the allowlist, the ordinal gift
// obligations (junk gift #1 in week 1, #2 in week 2, both from week 3, the premium from week 4) and the hidden surprise
// pool, per week and per player. Species are the made-up pool entries; the real tournament's data lives in the private pack.

const compiled = compile(wichtelcup);
if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
const DEF = compiled.definition as FormatDefinition;
const CUP = DEF.stages.find((stage) => stage.key === 'cup')?.constraints ?? [];

// Indexes into the constraint list (document order).
const SIZE = 0;
const TERA = 1;
const ALLOWLIST = 2;
const JUNK1_REQUIRED = 3;
const JUNK2_FORBIDDEN_W1 = 4;
const JUNK2_REQUIRED = 5;
const JUNK1_FORBIDDEN_W2 = 6;
const BOTH_JUNK = 7;
const NO_PREMIUM = 8;
const PREMIUM_REQUIRED = 9;
const NEW_YEAR_CLOSED = 10;

const pool = (key: string): string[] => (DEF.domains?.find((d) => d.key === key)?.entries ?? []).map((e) => e.id);
const NORMAL = pool('normal');
const JUNK = pool('junk');
const PREMIUM = pool('premium');
const NEW_YEAR = pool('new_year');

function member(id: string, over: Partial<TeamMember> = {}): TeamMember {
  return { name: id, species: id, baseName: id, baseSpecies: id, types: ['Ice'], item: `held-${id}`, itemName: `Held ${id}`, teraType: null, evolution: 'fe', ...over };
}

const gift = (resource: 'junk_gifts' | 'premium_gift', itemId: string, ordinal: number, player = 'p1') =>
  item({ resource, player_id: player, item_id: itemId, ordinal });

/** Player p1 holds junk gift #1 `starmie` (hazard removal), junk gift #2 `golem` (hazard setter) and the premium `dragonite`. */
const OWN = [gift('junk_gifts', 'starmie', 1), gift('junk_gifts', 'golem', 2), gift('premium_gift', 'dragonite', 1)];
const J1 = 'starmie';
const J2 = 'golem';
const P = 'dragonite';

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
    expect(CUP.map((c) => c.kind)).toEqual(['roster_size', 'tera', 'count', 'count', 'count', 'count', 'count', 'count', 'count', 'count', 'count']);
    expect(NORMAL).toHaveLength(8);
    expect(JUNK).toHaveLength(6);
    expect(PREMIUM).toHaveLength(6);
    expect(NEW_YEAR).toHaveLength(3);
    expect(JUNK).toContain(J1);
    expect(JUNK).toContain(J2);
    expect(PREMIUM).toContain(P);
  });
});

describe('week 1', () => {
  it('accepts junk gift #1 and five normal Pokémon', () => {
    expect(check(1, [J1, ...normals(5)])).toEqual([]);
  });

  it('asks for junk gift #1 when there is none', () => {
    expect(codes(check(1, normals(6)))).toEqual([`kit_count_min#${JUNK1_REQUIRED}`]);
  });

  it('refuses junk gift #2 in week 1', () => {
    const issues = check(1, [J1, J2, ...normals(4)]);
    expect(codes(issues)).toEqual([`kit_count_max#${JUNK2_FORBIDDEN_W1}`]);
    expect(issues[0].pokemon_indexes).toEqual([1]);
  });

  it('refuses the premium gift', () => {
    const issues = check(1, [J1, P, ...normals(4)]);
    expect(codes(issues)).toEqual([`kit_count_max#${NO_PREMIUM}`]);
    expect(issues[0].pokemon_indexes).toEqual([1]);
  });

  it('refuses a surprise species: outside the allowlist while locked, capped once unlocked', () => {
    const locked = check(1, [J1, NEW_YEAR[0], ...normals(4)]);
    expect(codes(locked)).toEqual([`kit_not_allowed#${ALLOWLIST}`]);
    expect(locked[0].pokemon_indexes).toEqual([1]);
    const open = check(1, [J1, NEW_YEAR[0], ...normals(4)], { flags: { 'domain:new_year': 'unlocked' } });
    expect(codes(open)).toEqual([`kit_count_max#${NEW_YEAR_CLOSED}`]);
    expect(open[0].pokemon_indexes).toEqual([1]);
  });
});

describe('week 2', () => {
  it('accepts junk gift #2 and five normal Pokémon', () => {
    expect(check(2, [J2, ...normals(5)])).toEqual([]);
  });

  it('asks for junk gift #2 and refuses junk gift #1', () => {
    expect(codes(check(2, [J1, ...normals(5)]))).toEqual([`kit_count_min#${JUNK2_REQUIRED}`, `kit_count_max#${JUNK1_FORBIDDEN_W2}`]);
  });

  it('refuses the premium gift', () => {
    expect(codes(check(2, [J2, P, ...normals(4)]))).toEqual([`kit_count_max#${NO_PREMIUM}`]);
  });
});

describe('week 3', () => {
  it('accepts both junk gifts and four normal Pokémon', () => {
    expect(check(3, [J1, J2, ...normals(4)])).toEqual([]);
  });

  it('asks for both junk gifts', () => {
    expect(codes(check(3, [J1, ...normals(5)]))).toEqual([`kit_count_min#${BOTH_JUNK}`]);
  });

  it('refuses the premium gift', () => {
    expect(codes(check(3, [J1, J2, P, ...normals(3)]))).toEqual([`kit_count_max#${NO_PREMIUM}`]);
  });

  it('keeps the surprise pool closed', () => {
    expect(codes(check(3, [J1, J2, NEW_YEAR[0], ...normals(3)]))).toEqual([`kit_not_allowed#${ALLOWLIST}`]);
  });
});

describe('week 4', () => {
  it('accepts both junk gifts, the premium gift and three normal Pokémon', () => {
    expect(check(4, [J1, J2, P, ...normals(3)])).toEqual([]);
  });

  it('keeps the premium gift mandatory', () => {
    expect(codes(check(4, [J1, J2, ...normals(4)]))).toEqual([`kit_count_min#${PREMIUM_REQUIRED}`]);
  });

  it('asks for both junk gifts', () => {
    expect(codes(check(4, [J1, P, ...normals(4)]))).toEqual([`kit_count_min#${BOTH_JUNK}`]);
  });

  it('keeps the surprise pool closed through week 4', () => {
    expect(codes(check(4, [J1, J2, P, NEW_YEAR[0], ...normals(2)]))).toEqual([`kit_not_allowed#${ALLOWLIST}`]);
    expect(codes(check(4, [J1, J2, P, NEW_YEAR[0], ...normals(2)], { flags: { 'domain:new_year': 'unlocked' } }))).toEqual([`kit_count_max#${NEW_YEAR_CLOSED}`]);
  });
});

describe('the pools of one player', () => {
  it('refuses a gift of another player, on its own slot', () => {
    const items = [...OWN, gift('junk_gifts', 'blissey', 1, 'p2')];
    const issues = check(1, [], { items, members: ['blissey', ...normals(5)].map((id) => member(id)) });
    expect(issues).toEqual([
      { code: 'kit_not_allowed', constraint_index: ALLOWLIST, pokemon_indexes: [0], params: { species: 'blissey' } },
      { code: 'kit_count_min', constraint_index: JUNK1_REQUIRED, params: { source: 'your own junk gifts #1', min: 1, have: 0 } },
    ]);
  });

  it('refuses the premium gift of another player in week 4', () => {
    const items = [gift('junk_gifts', J1, 1), gift('junk_gifts', J2, 2), gift('premium_gift', 'tyranitar', 1, 'p2')];
    const issues = check(4, [], { items, members: [J1, J2, 'tyranitar', ...normals(3)].map((id) => member(id)) });
    expect(codes(issues)).toEqual([`kit_not_allowed#${ALLOWLIST}`, `kit_count_min#${PREMIUM_REQUIRED}`]);
    expect(issues[0].pokemon_indexes).toEqual([2]);
  });

  it('refuses a species of no pool and names it', () => {
    const issues = check(1, [J1, 'arceus', ...normals(4)]);
    expect(issues.find((i) => i.code === 'kit_not_allowed')).toEqual({ code: 'kit_not_allowed', constraint_index: ALLOWLIST, pokemon_indexes: [1], params: { species: 'arceus' } });
  });

  it('lists each outsider as its own issue', () => {
    const issues = check(1, [J1, 'arceus', 'rayquaza', ...normals(3)]);
    const outsiders = issues.filter((i) => i.code === 'kit_not_allowed');
    expect(outsiders.map((i) => i.pokemon_indexes)).toEqual([[1], [2]]);
  });

  it('lets every player use the whole normal pool', () => {
    for (const id of NORMAL) expect(check(1, [J1, id], { members: [member(J1), member(id)] }).some((i) => i.code === 'kit_not_allowed')).toBe(false);
  });

  it('lets two players hold the same junk species', () => {
    const items = [gift('junk_gifts', J1, 1), gift('junk_gifts', J1, 1, 'p2')];
    expect(check(1, [J1, ...normals(5)], { items })).toEqual([]);
  });

  it('an unmapped legacy holding (null ordinal) satisfies no ordinal slot', () => {
    const items = [gift('junk_gifts', J1, 1), { ...gift('junk_gifts', J2, 2), ordinal: null }, gift('premium_gift', P, 1)];
    expect(codes(check(2, [J2, ...normals(5)], { items }))).toEqual([`kit_count_min#${JUNK2_REQUIRED}`]);
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
    expect(codes(check(2, ids))).toEqual([`kit_count_min#${JUNK2_REQUIRED}`, `kit_count_max#${JUNK1_FORBIDDEN_W2}`]);
  });

  it('judges a week-4 team by week-3 rules when the match is a week-3 match', () => {
    const week4Team = [J1, J2, P, ...normals(3)];
    expect(check(4, week4Team)).toEqual([]);
    expect(codes(check(3, week4Team))).toEqual([`kit_count_max#${NO_PREMIUM}`]);
  });
});