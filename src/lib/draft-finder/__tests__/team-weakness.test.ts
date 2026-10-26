import { describe, expect, it } from 'vitest';
import { TYPES } from '@/lib/pkmn/type-chart';
import { prepareIndex, lineStage } from '../prepare';
import { defensiveProfile, effectOf, multiplierLabel, summarizeTeam, type DefensiveProfile } from '../team-weakness';
import { buildFixtureIndex, stubNames } from './fixture-index';

/** The multiplier of attacking type `atk` in a profile. */
const against = (profile: DefensiveProfile | null, atk: (typeof TYPES)[number]) => profile![TYPES.indexOf(atk)];

describe('defensiveProfile', () => {
  it('has one multiplier per attacking type in TYPES order', () => {
    const profile = defensiveProfile(['Water']);
    expect(profile).toHaveLength(TYPES.length);
    expect(against(profile, 'Grass')).toBe(2);
    expect(against(profile, 'Fire')).toBe(0.5);
    expect(against(profile, 'Normal')).toBe(1);
  });

  it('multiplies a dual typing: 4× weakness, ¼× resistance, immunity', () => {
    const ground = defensiveProfile(['Ground', 'Rock']);
    expect(against(ground, 'Water')).toBe(4); // 2 × 2
    expect(against(ground, 'Normal')).toBe(0.5); // 1 × 0.5
    expect(against(ground, 'Electric')).toBe(0); // Ground is immune
    const steelBug = defensiveProfile(['Bug', 'Steel']);
    expect(against(steelBug, 'Grass')).toBe(0.25); // 0.5 × 0.5
    expect(against(defensiveProfile(['Ghost', 'Poison']), 'Normal')).toBe(0);
  });

  it('has no profile for empty types: "no data", never an all-neutral row', () => {
    expect(defensiveProfile([])).toBeNull();
  });

  it('differs between a line’s base and final typing (Normal -> Ground / Normal)', () => {
    const index = prepareIndex(buildFixtureIndex(), stubNames);
    const line = index.byLineId.get('teddiursa--ursaluna')!;
    const base = defensiveProfile(lineStage(line, 'base').types);
    const final = defensiveProfile(lineStage(line, 'final').types);
    expect(against(base, 'Fighting')).toBe(2);
    expect(against(base, 'Water')).toBe(1);
    expect(against(final, 'Water')).toBe(2);
    expect(against(final, 'Electric')).toBe(0);
    expect(against(final, 'Ghost')).toBe(0); // Normal immunity survives the second type
  });
});

describe('effectOf and multiplierLabel', () => {
  it('classes every multiplier a typing can produce', () => {
    expect([0, 0.25, 0.5, 1, 2, 4].map(effectOf)).toEqual(['immune', 'resist', 'resist', 'neutral', 'weak', 'quad']);
  });

  it('labels the cells: 0×, ¼×, ½×, 2×, 4×, and nothing for 1×', () => {
    expect([0, 0.25, 0.5, 1, 2, 4].map(multiplierLabel)).toEqual(['0×', '¼×', '½×', '', '2×', '4×']);
  });
});

describe('summarizeTeam', () => {
  const gengar = defensiveProfile(['Ghost', 'Poison']);
  const ursaluna = defensiveProfile(['Ground', 'Normal']);
  const at = (tallies: ReturnType<typeof summarizeTeam>, atk: (typeof TYPES)[number]) => tallies[TYPES.indexOf(atk)];

  it('counts weak (2× and 4×), resist (¼× and ½×) and immune (0×) per attacking type', () => {
    const tallies = summarizeTeam([gengar, ursaluna, defensiveProfile(['Ground', 'Rock'])]);
    expect(tallies).toHaveLength(TYPES.length);
    // Water: Gengar 1×, Ursaluna 2×, Ground/Rock 4× -> two weak.
    expect(at(tallies, 'Water')).toEqual({ weak: 2, resist: 0, immune: 0 });
    // Normal: Gengar immune, Ursaluna 1×, Ground/Rock ½× -> one immune, one resist.
    expect(at(tallies, 'Normal')).toEqual({ weak: 0, resist: 1, immune: 1 });
    // Electric: Ursaluna and Ground/Rock immune, Gengar 1×.
    expect(at(tallies, 'Electric')).toEqual({ weak: 0, resist: 0, immune: 2 });
  });

  it('counts a neutral 1× nowhere', () => {
    expect(at(summarizeTeam([gengar]), 'Dragon')).toEqual({ weak: 0, resist: 0, immune: 0 });
  });

  it('skips profiles without data', () => {
    expect(summarizeTeam([null, gengar])).toEqual(summarizeTeam([gengar]));
  });

  it('is all zero for an empty team', () => {
    expect(summarizeTeam([]).every((t) => t.weak === 0 && t.resist === 0 && t.immune === 0)).toBe(true);
  });
});
