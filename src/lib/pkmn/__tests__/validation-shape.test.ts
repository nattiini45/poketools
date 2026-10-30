/**
 * `validateTeam` against the real dex: the checks that need no learnset (shape and ranges of a set, duplicate moves, the
 * Item Clause by canonical id, ownership by dex id) and the universe-aware team constraints (a National Dex ruleset
 * resolves a Mega Evolution, so the legendary ban reaches it). Learnsets and abilities are in `team-legality.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { PokemonSet } from '@/types/team';
import type { TeamConstraints } from '@/types/ruleset';
import { validateTeam } from '../validation';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';

const OU = makeRuleset({ base_format: 'gen9ou', clauses: ['Species Clause', 'Item Clause'] });

const codesOf = (result: ReturnType<typeof validateTeam>): string[] => [
  ...result.issues.map((i) => i.code ?? ''),
  ...(result.team_issue_details ?? []).map((i) => i.code ?? ''),
];

describe('validateTeam: ranges of a set', () => {
  it('refuses a negative EV: five 252s and a -760 total 500, and used to pass', () => {
    const set = makeSet('Garchomp', { evs: { hp: -760, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 } });
    const result = validateTeam([set], OU);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'ev_stat_invalid', params: { stat: 'hp', value: -760 } }),
    );
  });

  it('keeps reporting an EV above 252 and a total above 510', () => {
    const result = validateTeam([makeSet('Garchomp', { evs: { hp: 300, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 } })], OU);
    expect(codesOf(result)).toEqual(expect.arrayContaining(['ev_stat_cap', 'ev_total']));
  });

  it('refuses a fractional EV and an IV outside 0 to 31', () => {
    const result = validateTeam(
      [makeSet('Garchomp', { evs: { hp: 0, atk: 0.5, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 32, atk: -1, def: 31, spa: 31, spd: 31, spe: 31 } })],
      OU,
    );
    expect(codesOf(result)).toEqual(expect.arrayContaining(['ev_stat_invalid', 'iv_range']));
    expect(result.issues.filter((i) => i.code === 'iv_range')).toHaveLength(2);
  });

  it.each([0, 101, 50.5, -3])('refuses level %s', (level) => {
    const result = validateTeam([makeSet('Garchomp', { level })], OU);
    expect(codesOf(result)).toContain('level_range');
  });

  it('accepts the boundary values 0, 252, 31 and levels 1 and 100', () => {
    const edge = makeSet('Garchomp', {
      evs: { hp: 6, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
      ivs: { hp: 0, atk: 31, def: 31, spa: 0, spd: 31, spe: 31 },
      level: 1,
    });
    expect(validateTeam([edge, makeSet('Dragonite', { level: 100, item: 'Heavy-Duty Boots', ability: 'Multiscale' })], OU).valid).toBe(true);
  });
});

describe('validateTeam: a set that is not a well-formed set never throws', () => {
  it('defaults a missing evs, ivs, moves, item and ability instead of throwing a TypeError', () => {
    const bare = { species: 'Garchomp' } as unknown as PokemonSet;
    const result = validateTeam([bare], OU);
    // The live check stays useful while a set is being built: it asks for a move.
    expect(codesOf(result)).toEqual(['min_moves']);
  });

  it.each([
    ['null', null],
    ['a string', 'Garchomp'],
    ['no species', { moves: ['Earthquake'] }],
    ['a numeric species', { species: 7 }],
    ['moves that are not a list', { species: 'Garchomp', moves: 'Earthquake' }],
    ['a move that is not text', { species: 'Garchomp', moves: [5] }],
    ['evs that are not an object', { species: 'Garchomp', evs: 252 }],
  ])('reports %s as a malformed set', (_label, raw) => {
    const result = validateTeam([makeSet('Dragonite'), raw as unknown as PokemonSet], OU);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ pokemon_index: 1, code: 'malformed_set', severity: 'error' }));
  });

  it('reports a team that is not a list as an empty team', () => {
    const result = validateTeam(undefined as unknown as PokemonSet[], OU);
    expect(result.team_issue_details?.[0].code).toBe('team_empty');
  });
});

describe('validateTeam: empty move slots (the editor keeps a fixed four-slot array)', () => {
  it('ignores empty and blank slots: one real move in four slots is a legal set', () => {
    const result = validateTeam([makeSet('Garchomp', { moves: ['Earthquake', '', '  ', ''] })], OU);
    expect(result.valid).toBe(true);
    expect(codesOf(result)).toEqual([]);
  });

  it('four empty slots are "no move" (min_moves) and nothing else: no unknown move, no max_moves', () => {
    const result = validateTeam([makeSet('Garchomp', { moves: ['', '', '', ''] })], OU);
    expect(codesOf(result)).toEqual(['min_moves']);
  });

  it('does not count empty slots towards the four-move cap or as duplicates', () => {
    const result = validateTeam([makeSet('Garchomp', { moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Stealth Rock', '', ''] })], OU);
    expect(codesOf(result)).toEqual([]);
  });
});

describe('validateTeam: duplicate moves', () => {
  it('flags a move named twice', () => {
    const result = validateTeam([makeSet('Garchomp', { moves: ['Earthquake', 'Dragon Claw', 'Earthquake'] })], OU);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'duplicate_move', params: { move: 'Earthquake' } }));
  });

  it('compares by move id, so another spelling of one move counts', () => {
    const result = validateTeam([makeSet('Garchomp', { moves: ['Stealth Rock', 'stealthrock'] })], OU);
    expect(codesOf(result)).toContain('duplicate_move');
  });

  it('does not flag two different moves', () => {
    expect(codesOf(validateTeam([makeSet('Garchomp')], OU))).not.toContain('duplicate_move');
  });
});

describe('validateTeam: Item Clause by canonical item id', () => {
  const team = (a: string, b: string): PokemonSet[] => [
    makeSet('Garchomp', { item: a }),
    makeSet('Dragonite', { item: b, ability: 'Multiscale' }),
  ];

  it.each([
    ['Choice Scarf', 'choicescarf'],
    ['Choice Scarf', 'CHOICE SCARF'],
    ['Heavy-Duty Boots', 'heavydutyboots'],
  ])('treats %s and %s as one item', (a, b) => {
    const result = validateTeam(team(a, b), OU);
    expect(result.valid).toBe(false);
    expect(result.team_issue_details).toContainEqual(expect.objectContaining({ code: 'item_clause' }));
  });

  it('names the canonical item in the issue', () => {
    const result = validateTeam(team('choicescarf', 'Choice Scarf'), OU);
    expect(result.team_issue_details?.find((i) => i.code === 'item_clause')?.params?.item).toBe('Choice Scarf');
  });

  it('lets two different items through', () => {
    expect(codesOf(validateTeam(team('Choice Scarf', 'Choice Band'), OU))).not.toContain('item_clause');
  });

  it('does not enforce the clause when the ruleset has none', () => {
    const noClause = makeRuleset({ base_format: 'gen9ou', clauses: ['Species Clause'] });
    expect(codesOf(validateTeam(team('Choice Scarf', 'choicescarf'), noClause))).not.toContain('item_clause');
  });
});

describe('validateTeam: draft ownership compares by dex id', () => {
  it('matches a roster name written another way', () => {
    const team = [makeSet('Rotom-Wash', { item: 'Leftovers', ability: 'Levitate' })];
    expect(codesOf(validateTeam(team, OU, { draftedPokemon: ['rotomwash'] }))).not.toContain('not_in_roster');
    expect(codesOf(validateTeam(team, OU, { draftedPokemon: ['Rotom-Heat'] }))).toContain('not_in_roster');
  });
});

describe('validateTeam: National Dex rulesets resolve past species in the team constraints', () => {
  const national = (teamConstraints: TeamConstraints) =>
    makeRuleset({
      base_format: 'gen9nationaldex',
      clauses: ['Species Clause'],
      universe: 'national',
      team_constraints: teamConstraints,
      rules: rulesFromBans({ gen: 9, formatKey: 'gen9nationaldex', universe: 'national', clauses: ['Species Clause'], teamConstraints }),
    });

  it('reports Mewtwo-Mega-X when legendaries are not allowed (it used to be skipped as an unknown species)', () => {
    const ruleset = national({ evolution_stage: { mode: 'nfe_only_plus_n_fe', fully_evolved_cap: 6, legendaries_allowed: false } });
    const result = validateTeam([makeSet('Mewtwo-Mega-X', { item: 'Mewtwonite X', ability: 'Steadfast', moves: ['Psystrike'] })], ruleset);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'legendary_phase', species: 'Mewtwo-Mega-X' }));
  });

  it('applies the unrestricted-mode legendary ban to a Mega too', () => {
    const ruleset = national({ evolution_stage: { mode: 'unrestricted', legendaries_allowed: false } });
    const result = validateTeam([makeSet('Mewtwo-Mega-Y', { item: 'Mewtwonite Y', ability: 'Insomnia', moves: ['Psystrike'] })], ruleset);
    expect(codesOf(result)).toContain('legendary');
  });

  it('counts a Mega Evolution as fully evolved against the cap', () => {
    const ruleset = national({ evolution_stage: { mode: 'nfe_only_plus_n_fe', fully_evolved_cap: 0, legendaries_allowed: true } });
    const result = validateTeam([makeSet('Charizard-Mega-X', { item: 'Charizardite X', ability: 'Tough Claws', moves: ['Flare Blitz'] })], ruleset);
    expect(codesOf(result)).toContain('evolution_stage_cap');
  });

  it('does not misread a Mega whose standard tier is Illegal as having no tier', () => {
    const ruleset = national({
      evolution_stage: { mode: 'nfe_only_plus_n_fe', fully_evolved_cap: 6, fully_evolved_tier_max: 'OU', legendaries_allowed: true },
    });
    const result = validateTeam([makeSet('Garchomp-Mega', { item: 'Garchompite', ability: 'Sand Force', moves: ['Earthquake'] })], ruleset);
    expect(codesOf(result)).not.toContain('fe_no_tier');
  });
});
