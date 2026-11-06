import { describe, expect, it } from 'vitest';
import { showdownChallengeFormat, toShowdownChallenge, type ChallengeSpeciesLookup } from '../showdown-challenge';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';

describe('toShowdownChallenge', () => {
  it('writes a National Dex AG challenge with the exact allowlist, bans and clauses', () => {
    const resolved = rulesFromBans({
      gen: 9,
      universe: 'national',
      allow: { pokemon: ['Pikachu', 'Vivillon-Icy-Snow'] },
      bans: { items: ['Light Clay', 'Normalium Z'], abilities: ['Moody', 'Snow Cloak'] },
      clauses: ['Species Clause', 'Item Clause', 'Terastal Clause'],
    });
    const challenge = toShowdownChallenge(resolved);
    expect(challenge.startsWith('gen9nationaldexag @@@ -All Pokemon, +pokemon:pikachu, +pokemon:vivillonicysnow')).toBe(true);
    expect(challenge).toContain('-item:lightclay');
    expect(challenge).toContain('-item:normaliumz');
    expect(challenge).toContain('-ability:moody');
    expect(challenge).toContain('-ability:snowcloak');
    expect(challenge).toContain('Item Clause');
    expect(challenge).toContain('Species Clause');
    expect(challenge).toContain('Terastal Clause');
    expect(challenge).not.toContain('Sleep Clause');
  });

  it('keeps block lists and other allowlist categories', () => {
    const resolved = rulesFromBans({ gen: 9, universe: 'national', bans: { pokemon: ['Garchomp'] }, allow: { moves: ['Thunder Shock'] } });
    expect(toShowdownChallenge(resolved)).toBe('gen9nationaldexag @@@ -pokemon:garchomp, -All Moves, +move:thundershock');
  });

  it('prefixes every entry with its kind, so an id shared by a move and an item is unambiguous', () => {
    const resolved = rulesFromBans({ gen: 9, universe: 'national', bans: { moves: ['Metronome'], items: ['Metronome'] } });
    const rules = toShowdownChallenge(resolved).split(' @@@ ')[1].split(', ');
    expect(rules).toContain('-move:metronome');
    expect(rules).toContain('-item:metronome');
    expect(rules).not.toContain('-metronome');
  });

  it('closes every forme of an allowed base species that the allowlist does not list, and folds cosmetic formes into their base', () => {
    const lookup: ChallengeSpeciesLookup = (id) => {
      if (id === 'rayquaza') return { cosmeticOf: null, formes: ['rayquazamega'] };
      if (id === 'rotom') return { cosmeticOf: null, formes: ['rotomheat', 'rotomwash'] };
      if (id === 'rotomheat') return { cosmeticOf: null, formes: [] };
      if (id === 'vivillonicysnow') return { cosmeticOf: 'vivillon', formes: [] };
      return null;
    };
    const resolved = rulesFromBans({
      gen: 9,
      universe: 'national',
      allow: { pokemon: ['Rayquaza', 'Rotom', 'Rotom-Heat', 'Vivillon-Icy-Snow', 'Vivillon'] },
    });
    const rules = toShowdownChallenge(resolved, lookup).split(' @@@ ')[1].split(', ');
    expect(rules).toContain('+pokemon:rayquaza');
    expect(rules).toContain('-pokemon:rayquazamega');
    expect(rules).toContain('-pokemon:rotomwash');
    expect(rules).not.toContain('-pokemon:rotomheat');
    expect(rules).toContain('+pokemon:rotomheat');
    expect(rules).not.toContain('+pokemon:vivillonicysnow');
    // `vivillon` is listed twice (itself and as the base of the cosmetic forme) but written once.
    expect(rules.filter((rule) => rule === '+pokemon:vivillon')).toHaveLength(1);
  });
});

describe('showdownChallengeFormat', () => {
  it('derives the base format from the generation, universe and game type', () => {
    expect(showdownChallengeFormat({ gen: 9, universe: 'national', doubles: false })).toBe('gen9nationaldexag');
    expect(showdownChallengeFormat({ gen: 9, universe: 'standard', doubles: false })).toBe('gen9anythinggoes');
    expect(showdownChallengeFormat({ gen: 7, universe: 'standard', doubles: false })).toBe('gen7anythinggoes');
    expect(showdownChallengeFormat({ gen: 9, universe: 'standard', doubles: true })).toBe('gen9doublescustomgame');
    expect(showdownChallengeFormat({ gen: 8, universe: 'national', doubles: false })).toBe('gen8customgame');
    expect(showdownChallengeFormat({ gen: 4, universe: 'standard', doubles: false })).toBe('gen4customgame');
  });

  it('starts the challenge with the ruleset format, not a fixed one', () => {
    const resolved = rulesFromBans({ gen: 7, universe: 'standard' });
    expect(toShowdownChallenge(resolved).startsWith('gen7anythinggoes @@@')).toBe(true);
  });
});
