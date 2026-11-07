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

describe('the Wichtelcup challenge', () => {
  const preset = resolvePresetRules('gen9natdexwichtelcup');
  if (preset === null) throw new Error('the Wichtelcup preset is missing');
  const resolved = computeEffective(newRulesetDocument('Wichtelcup', 'en', 'gen9natdexwichtelcup'), preset);
  const challenge = toShowdownChallenge(resolved, challengeSpeciesLookup(resolved.gen));
  const rules = challenge.slice(challenge.indexOf('@@@') + 4).split(', ');

  it('starts with the National Dex AG base and rules out every Pokémon first', () => {
    expect(challenge.startsWith('gen9nationaldexag @@@ -All Pokemon, ')).toBe(true);
  });

  it('closes the formes a "base form" entry would open: Mega Rayquaza, Primal Groudon, the Origin formes, Necrozma fusions, Low-Key', () => {
    const closed = [
      'rayquazamega', 'groudonprimal', 'dialgaorigin', 'palkiaorigin', 'necrozmaultra', 'necrozmaduskmane',
      'necrozmadawnwings', 'magearnaoriginal', 'magearnamega', 'toxtricitylowkey',
    ];
    for (const forme of closed) expect(rules, forme).toContain(`-pokemon:${forme}`);
    for (const base of ['rayquaza', 'groudon', 'dialga', 'palkia', 'necrozma', 'magearna', 'toxtricity']) {
      expect(rules, base).toContain(`+pokemon:${base}`);
    }
  });

  it('writes the exact-pattern cosmetic entries as their base species, once', () => {
    for (const id of ['vivillonicysnow', 'deerlingwinter', 'sawsbuckwinter']) expect(challenge).not.toContain(id);
    for (const base of ['vivillon', 'deerling', 'sawsbuck']) expect(rules.filter((rule) => rule === `+pokemon:${base}`)).toHaveLength(1);
  });

  it('never closes a forme the cup lists, and keeps a listed forme whose base is not listed', () => {
    expect(rules).toContain('+pokemon:rotomfrost');
    expect(rules).not.toContain('-pokemon:rotomfrost');
    expect(rules).toContain('+pokemon:sandslashalola');
    expect(rules).not.toContain('+pokemon:sandslash');
  });

  it('bans the forme-changing items and the Mega Rayquaza route, and carries the Mega Rayquaza Clause', () => {
    expect(rules).toEqual(
      expect.arrayContaining(['-item:redorb', '-item:adamantcrystal', '-item:lustrousglobe', '-item:lightclay', '-move:dragonascent', 'Mega Rayquaza Clause', 'Terastal Clause']),
    );
  });

  it('has no duplicate rule', () => {
    expect(new Set(rules).size).toBe(rules.length);
  });
});
