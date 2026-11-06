import { describe, expect, it } from 'vitest';
import { entryMatchesSearch, speciesDisplayName } from '../entry-names';

describe('speciesDisplayName', () => {
  it('shows the German name of a species id in German', () => {
    expect(speciesDisplayName('charizard', 'de')).toBe('Glurak');
  });

  it('shows an id with a capital letter in English, and in German when there is no German name', () => {
    expect(speciesDisplayName('charizard', 'en')).toBe('Charizard');
    expect(speciesDisplayName('notarealspecies', 'de')).toBe('Notarealspecies');
  });

  it('shows the canonical English name where it is not the capitalised id', () => {
    expect(speciesDisplayName('mrmime', 'en')).toBe('Mr. Mime');
    expect(speciesDisplayName('hooh', 'en')).toBe('Ho-Oh');
    expect(speciesDisplayName('nidoranf', 'en')).toBe('Nidoran-F');
    expect(speciesDisplayName('mrmimegalar', 'en')).toBe('Mr. Mime-Galar');
    expect(speciesDisplayName('ursalunabloodmoon', 'en')).toBe('Ursaluna-Bloodmoon');
  });

  it('leaves a value that is already a name as it is', () => {
    expect(speciesDisplayName('Ursaluna-Bloodmoon', 'en')).toBe('Ursaluna-Bloodmoon');
  });
});

describe('entryMatchesSearch', () => {
  it('matches the English id and the German name, whatever the display language', () => {
    expect(entryMatchesSearch('charizard', 'chariz')).toBe(true);
    expect(entryMatchesSearch('charizard', 'Glurak')).toBe(true);
    expect(entryMatchesSearch('charizard', 'pika')).toBe(false);
  });

  it('ignores case, accents and spaces, and an empty query matches everything', () => {
    expect(entryMatchesSearch('ursalunabloodmoon', 'Ursaluna Blood')).toBe(true);
    expect(entryMatchesSearch('flabebe', 'flabébé')).toBe(true);
    expect(entryMatchesSearch('pikachu', '   ')).toBe(true);
  });
});
