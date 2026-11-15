import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import { computeEffective } from '@/lib/ruleset-kit/effective';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { resolvePresetRules } from '../preset-rules.server';
import { toShowdownChallenge } from '../showdown-challenge';
import { challengeSpeciesLookup } from '../showdown-challenge.server';

// Real dex, no mocks. The forme facts are read from the installed @pkmn/dex.

describe('challengeSpeciesLookup', () => {
  const lookup = challengeSpeciesLookup(9);

  it('reads cosmetic formes and the other formes of a base species from the dex', () => {
    expect(lookup('vivillonicysnow')).toEqual({ cosmeticOf: 'vivillon', formes: [] });
    expect(lookup('sawsbuckwinter')).toEqual({ cosmeticOf: 'sawsbuck', formes: [] });
    expect(lookup('deerlingwinter')).toEqual({ cosmeticOf: 'deerling', formes: [] });
    expect(lookup('rayquaza')).toEqual({ cosmeticOf: null, formes: ['rayquazamega'] });
    expect(lookup('sandslashalola')).toEqual({ cosmeticOf: null, formes: [] });
    expect(lookup('notapokemon')).toBeNull();
  });
});

describe('the Wichtelcup example challenge', () => {
  const preset = resolvePresetRules('gen9natdexwichtelcup');
  if (preset === null) throw new Error('the Wichtelcup preset is missing');
  const resolved = computeEffective(newRulesetDocument('Wichtelcup', 'en', 'gen9natdexwichtelcup'), preset);
  const challenge = toShowdownChallenge(resolved, challengeSpeciesLookup(resolved.gen));
  const rules = challenge.slice(challenge.indexOf('@@@') + 4).split(', ');
  const dex = Dex.forGen(9);

  it('starts with the National Dex AG base and rules out every Pokémon first', () => {
    expect(challenge.startsWith('gen9nationaldexag @@@ -All Pokemon, ')).toBe(true);
  });

  it('admits every made-up pool entry as a base species', () => {
    for (const id of resolved.pokemon.ids) expect(rules, id).toContain(`+pokemon:${id}`);
    expect(rules).toContain('+pokemon:pikachu');
    expect(rules).toContain('+pokemon:dragonite');
    expect(rules).toContain('+pokemon:mewtwo');
  });

  it('closes every Mega forme a base-form entry would open, and keeps the base species', () => {
    const allowed = new Set(resolved.pokemon.ids);
    for (const id of allowed) {
      const species = dex.species.get(id);
      if (!species.exists || species.baseSpecies !== species.name) continue;
      for (const formeName of species.otherFormes ?? []) {
        const forme = dex.species.get(formeName);
        if (allowed.has(forme.id)) continue;
        expect(rules, forme.id).toContain(`-pokemon:${forme.id}`);
      }
    }
    // A concrete pair: Charizard stays, its two Megas are closed.
    expect(rules).toContain('+pokemon:charizard');
    expect(rules).toContain('-pokemon:charizardmegax');
    expect(rules).toContain('-pokemon:charizardmegay');
  });

  it('bans the Mega stones, the Z-crystals and Light Clay, carries the clauses, and bans no move', () => {
    expect(rules).toEqual(
      expect.arrayContaining(['-item:lightclay', '-item:charizarditex', '-item:mewtwonitex', '-item:normaliumz', '-item:ultranecroziumz', 'Mega Rayquaza Clause', 'Terastal Clause']),
    );
    expect(rules.filter((rule) => rule.startsWith('-move:') || rule === '-All Moves')).toEqual([]);
  });

  it('bans exactly the items and abilities the example names (Light Clay, Mega Stones, Z-crystals; Moody and Snow Cloak)', () => {
    expect(rules.filter((rule) => rule.startsWith('-ability:'))).toEqual(['-ability:moody', '-ability:snowcloak']);
    const items = rules.filter((rule) => rule.startsWith('-item:')).map((rule) => rule.slice(6));
    const named = new Set(['lightclay']);
    expect(items.filter((id) => !named.has(id) && !dex.items.get(id).megaStone && !dex.items.get(id).zMove)).toEqual([]);
  });

  it('has no duplicate rule', () => {
    expect(new Set(rules).size).toBe(rules.length);
  });
});
