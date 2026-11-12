import { describe, it, expect } from 'vitest';

import { typeColors } from '../tokens';

describe('typeColors', () => {
  const expectedTypes = [
    'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
    'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
    'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
  ];

  it('has entries for all 18 Pokemon types', () => {
    expect(Object.keys(typeColors)).toHaveLength(18);
    for (const typeName of expectedTypes) {
      expect(typeColors[typeName]).toBeDefined();
    }
  });

  it('each type has bg and text properties', () => {
    for (const typeName of expectedTypes) {
      expect(typeColors[typeName].bg).toBeTruthy();
      expect(typeColors[typeName].text).toBeTruthy();
    }
  });

  it('bg values use hsl format', () => {
    for (const typeName of expectedTypes) {
      expect(typeColors[typeName].bg).toMatch(/^hsl\(/);
    }
  });

  it('text values are hex codes', () => {
    for (const typeName of expectedTypes) {
      expect(typeColors[typeName].text).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
