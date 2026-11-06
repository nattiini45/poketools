import { describe, expect, it } from 'vitest';
import { toShowdownChallenge } from '../showdown-challenge';
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
    expect(challenge.startsWith('gen9nationaldexag @@@ -All Pokemon, +pikachu, +vivillonicysnow')).toBe(true);
    expect(challenge).toContain('-lightclay');
    expect(challenge).toContain('-normaliumz');
    expect(challenge).toContain('-moody');
    expect(challenge).toContain('-snowcloak');
    expect(challenge).toContain('Item Clause');
    expect(challenge).toContain('Species Clause');
    expect(challenge).toContain('Terastal Clause');
    expect(challenge).not.toContain('Sleep Clause');
  });

  it('keeps block lists and other allowlist categories', () => {
    const resolved = rulesFromBans({ gen: 9, bans: { pokemon: ['Garchomp'] }, allow: { moves: ['Thunder Shock'] } });
    expect(toShowdownChallenge(resolved)).toBe('gen9nationaldexag @@@ -garchomp, -All Moves, +thundershock');
  });
});
