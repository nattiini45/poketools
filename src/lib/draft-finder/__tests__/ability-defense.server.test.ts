import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import { TYPES } from '@/lib/pkmn/type-chart';
import { ABILITY_DEFENSE, abilityMultiplier } from '../ability-defense';

describe('ABILITY_DEFENSE ids (draft-frontend §4.5)', () => {
  it.each(Object.keys(ABILITY_DEFENSE))('%s exists in @pkmn/dex and is not Nonstandard', (id) => {
    const ability = Dex.abilities.get(id);
    expect(ability.exists).toBe(true);
    expect(ability.id).toBe(id);
    expect(ability.isNonstandard ?? null).toBeNull();
  });

  it('every listed type is one of the 18 types', () => {
    for (const def of Object.values(ABILITY_DEFENSE)) {
      for (const t of [...(def.immune ?? []), ...(def.halve ?? [])]) expect(TYPES).toContain(t);
    }
  });

  it('has no Wind Rider (it blocks wind moves, not a type; FR-9)', () => {
    expect(Object.keys(ABILITY_DEFENSE)).not.toContain('windrider');
  });

  it('multiplies typing by the ability effect', () => {
    expect(abilityMultiplier('levitate', 'Ground', ['Ghost', 'Poison'])).toBe(0);
    expect(abilityMultiplier('thickfat', 'Ice', ['Normal'])).toBe(0.5);
    expect(abilityMultiplier('thickfat', 'Ice', ['Grass', 'Flying'])).toBe(2);
    expect(abilityMultiplier('levitate', 'Fire', ['Ghost'])).toBeNull();
    expect(abilityMultiplier('regenerator', 'Fire', ['Ghost'])).toBeNull();
  });
});
