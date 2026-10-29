/**
 * The learnset and ability layer of the team check, against the real dex (the same helpers as the per-slot picker).
 */
import { describe, expect, it } from 'vitest';
import { checkTeamLegality } from '../team-legality';
import { checkMoveLegality, getLegalAbilities, validateSetLegality } from '../dex';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';

const OU = makeRuleset({ base_format: 'gen9ou' });
const NATIONAL = makeRuleset({
  base_format: 'gen9nationaldex',
  universe: 'national',
  rules: rulesFromBans({ gen: 9, formatKey: 'gen9nationaldex', universe: 'national' }),
});

describe('checkTeamLegality: learnsets', () => {
  it('passes a team of moves its species learns', async () => {
    expect(await checkTeamLegality([makeSet('Garchomp'), makeSet('Dragonite', { ability: 'Multiscale', moves: ['Extreme Speed', 'Dragon Dance'] })], OU)).toEqual([]);
  });

  it('flags Garchomp with Spore as move_illegal', async () => {
    const issues = await checkTeamLegality([makeSet('Garchomp', { moves: ['Earthquake', 'Spore'] })], OU);
    expect(issues).toEqual([
      expect.objectContaining({
        pokemon_index: 0,
        species: 'Garchomp',
        severity: 'error',
        code: 'move_illegal',
        params: { species: 'Garchomp', move: 'Spore' },
        issue: 'Garchomp cannot legally learn Spore',
      }),
    ]);
  });

  it('restricts a standard ruleset to its own generation, like the picker', async () => {
    // Attract reaches Charizard only through old sources: legal in the National Dex, not in the Gen 9 ladder.
    const charizard = makeSet('Charizard', { ability: 'Blaze', moves: ['Attract'] });
    expect(await checkTeamLegality([charizard], OU)).toHaveLength(1);
    expect(await checkTeamLegality([charizard], NATIONAL)).toEqual([]);
  });

  it('reports nothing for a move or species the dex does not know (the plain validator names those)', async () => {
    expect(await checkTeamLegality([makeSet('Garchomp', { moves: ['Notarealmove'] })], OU)).toEqual([]);
    expect(await checkTeamLegality([makeSet('Notamon', { moves: ['Earthquake'] })], OU)).toEqual([]);
  });

  it('skips a species of an allowlist that no dex universe resolves (an unreleased Future entry)', async () => {
    // Mega Pikachu-like placeholder: the dex has no learnset for it, so there is nothing to judge by.
    const future = makeRuleset({
      base_format: 'gen9ou',
      rules: rulesFromBans({ gen: 9, formatKey: 'gen9ou', allow: { pokemon: ['Garchomp', 'Mewtwo-Mega-X'] } }),
    });
    expect(await checkTeamLegality([makeSet('Mewtwo-Mega-X', { moves: ['Spore'] })], future)).toEqual([]);
  });

  it('judges a National Dex Mega by the learnset of its species', async () => {
    const mega = (moves: string[]) => makeSet('Mewtwo-Mega-X', { item: 'Mewtwonite X', ability: 'Steadfast', moves });
    expect(await checkTeamLegality([mega(['Psystrike', 'Drain Punch'])], NATIONAL)).toEqual([]);
    const bad = await checkTeamLegality([mega(['Psystrike', 'Spore'])], NATIONAL);
    expect(bad).toEqual([expect.objectContaining({ code: 'move_illegal', species: 'Mewtwo-Mega-X' })]);
  });

  it('ignores an empty move slot', async () => {
    expect(await checkTeamLegality([makeSet('Garchomp', { moves: ['Earthquake', ''] })], OU)).toEqual([]);
  });
});

describe('checkTeamLegality: abilities', () => {
  it('flags Garchomp with Levitate as ability_illegal', async () => {
    const issues = await checkTeamLegality([makeSet('Garchomp', { ability: 'Levitate' })], OU);
    expect(issues).toEqual([
      expect.objectContaining({
        pokemon_index: 0,
        species: 'Garchomp',
        severity: 'error',
        code: 'ability_illegal',
        params: { species: 'Garchomp', ability: 'Levitate' },
      }),
    ]);
  });

  it('accepts either regular ability and the hidden one, written any way', async () => {
    for (const ability of ['Sand Veil', 'rough skin', 'ROUGHSKIN']) {
      expect(await checkTeamLegality([makeSet('Garchomp', { ability })], OU)).toEqual([]);
    }
    expect(await checkTeamLegality([makeSet('Gengar', { ability: 'Cursed Body', moves: ['Shadow Ball'] })], OU)).toEqual([]);
  });

  it('leaves an unset ability and an ability the dex does not know to other checks', async () => {
    expect(await checkTeamLegality([makeSet('Garchomp', { ability: '' })], OU)).toEqual([]);
    expect(await checkTeamLegality([makeSet('Garchomp', { ability: 'Notanability' })], OU)).toEqual([]);
  });

  it('judges a National Dex Mega by its own ability', async () => {
    const bad = await checkTeamLegality([makeSet('Mewtwo-Mega-X', { item: 'Mewtwonite X', ability: 'Pressure', moves: ['Psystrike'] })], NATIONAL);
    expect(bad).toEqual([expect.objectContaining({ code: 'ability_illegal' })]);
  });

  it('does not judge abilities in a generation that has none', async () => {
    const gen2 = makeRuleset({ base_format: 'gen2ou' });
    expect(await checkTeamLegality([makeSet('Snorlax', { ability: 'Whatever', item: 'Leftovers', moves: ['Body Slam'] })], gen2)).toEqual([]);
  });
});

describe('checkTeamLegality: robustness', () => {
  it('skips a set that cannot be read', async () => {
    const team = [null, { species: 'Garchomp', moves: 'Earthquake' }, makeSet('Garchomp', { moves: ['Spore'] })] as never;
    const issues = await checkTeamLegality(team, OU);
    expect(issues).toHaveLength(1);
    expect(issues[0].pokemon_index).toBe(2);
  });
});

describe('dex legality helpers keep their behaviour for the standard universe', () => {
  it('validateSetLegality compares the ability by dex id', async () => {
    expect((await validateSetLegality('Garchomp', 'rough skin', ['Earthquake'], 9)).abilityLegal).toBe(true);
    expect((await validateSetLegality('Garchomp', 'Levitate', ['Earthquake'], 9)).abilityLegal).toBe(false);
    expect((await validateSetLegality('Garchomp', '', [], 9)).abilityLegal).toBe(true);
  });

  it('a standard lookup does not resolve a Mega, a National Dex lookup does', async () => {
    expect(getLegalAbilities('Mewtwo-Mega-X', 9)).toEqual([]);
    expect(getLegalAbilities('Mewtwo-Mega-X', 9, 'national').map((a) => a.name)).toEqual(['Steadfast']);
    expect(await checkMoveLegality('Mewtwo-Mega-X', ['Psystrike'], 9)).toEqual([{ move: 'Psystrike', legal: false }]);
    expect(await checkMoveLegality('Mewtwo-Mega-X', ['Psystrike'], 9, 'national')).toEqual([{ move: 'Psystrike', legal: true }]);
  });
});
