import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/example-list.json';
import { foldId } from '../line-identity';

describe('foldId equals the @pkmn species id for every list stage name', () => {
  const names = new Set<string>();
  for (const e of fixture.entries) {
    names.add(e.base_pokemon);
    names.add(e.stage2_pokemon);
    if (e.stage3_pokemon) names.add(e.stage3_pokemon);
  }

  it.each([...names])('%s', (name) => {
    const species = Dex.species.get(name.normalize('NFC'));
    expect(species.exists).toBe(true);
    expect(foldId(name)).toBe(species.id);
  });

  it('the importer species ids in the fixture equal the dex ids (Flabébé is flabebe, not flabb)', () => {
    for (const e of fixture.entries) {
      expect(e.species_ids.base).toBe(Dex.species.get(e.base_pokemon).id);
      expect(e.species_ids.stage2).toBe(Dex.species.get(e.stage2_pokemon).id);
      if (e.stage3_pokemon) expect(e.species_ids.stage3).toBe(Dex.species.get(e.stage3_pokemon).id);
    }
    // An accented name folds like the dex (Flabébé is flabebe, not flabb), list or not.
    expect(foldId('Flabébé')).toBe(Dex.species.get('Flabébé').id);
  });
});
