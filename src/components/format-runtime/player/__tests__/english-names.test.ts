// eslint-disable-next-line no-restricted-imports -- a test, never bundled: it checks the client-safe name map against the dex
import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import { IRREGULAR_ENGLISH_SPECIES } from '../english-names';

const capitalised = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

/** What the object must hold: every non-CAP species whose canonical name is not the capitalised id. */
function expected(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const species of Dex.species.all()) {
    if (species.isNonstandard === 'CAP' || species.isNonstandard === 'Custom') continue;
    if (species.name !== capitalised(species.id)) out[species.id] = species.name;
  }
  return out;
}

describe('IRREGULAR_ENGLISH_SPECIES', () => {
  it('matches the @pkmn/dex species list exactly (regenerate it when this fails)', () => {
    expect(IRREGULAR_ENGLISH_SPECIES).toEqual(expected());
  });

  it('holds the names the capitalised id gets wrong', () => {
    expect(IRREGULAR_ENGLISH_SPECIES.mrmime).toBe('Mr. Mime');
    expect(IRREGULAR_ENGLISH_SPECIES.hooh).toBe('Ho-Oh');
    expect(IRREGULAR_ENGLISH_SPECIES.nidoranf).toBe('Nidoran-F');
    expect(IRREGULAR_ENGLISH_SPECIES.ursalunabloodmoon).toBe('Ursaluna-Bloodmoon');
  });
});
