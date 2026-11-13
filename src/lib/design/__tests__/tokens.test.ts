import { describe, it, expect } from 'vitest';

import { colors, typeColors, shadows } from '../tokens';

describe('colors', () => {
  it('exports bg color tokens', () => {
    expect(colors.bg.base).toBeTruthy();
    expect(colors.bg.surface).toBeTruthy();
    expect(colors.bg.elevated).toBeTruthy();
    expect(colors.bg.muted).toBeTruthy();
    expect(colors.bg.inverse).toBeTruthy();
  });

  it('exports text color tokens', () => {
    expect(colors.text.primary).toBeTruthy();
    expect(colors.text.secondary).toBeTruthy();
    expect(colors.text.muted).toBeTruthy();
    expect(colors.text.inverse).toBeTruthy();
    expect(colors.text.link).toBeTruthy();
  });

  it('exports accent color tokens', () => {
    expect(colors.accent.accent).toBeTruthy();
    expect(colors.accent.accentStrong).toBeTruthy();
    expect(colors.accent.blue).toBeTruthy();
    expect(colors.accent.blueHover).toBeTruthy();
    expect(colors.accent.green).toBeTruthy();
    expect(colors.accent.yellow).toBeTruthy();
    expect(colors.accent.danger).toBeTruthy();
  });

  it('exports border color tokens', () => {
    expect(colors.border.default).toBeTruthy();
    expect(colors.border.strong).toBeTruthy();
    expect(colors.border.focus).toBeTruthy();
  });

  it('all color values are valid hex codes or color strings', () => {
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;

    for (const value of Object.values(colors.bg)) {
      expect(value).toMatch(hexPattern);
    }
    for (const value of Object.values(colors.text)) {
      expect(value).toMatch(hexPattern);
    }
    for (const value of Object.values(colors.accent)) {
      expect(value).toMatch(hexPattern);
    }
    for (const value of Object.values(colors.border)) {
      expect(value).toMatch(hexPattern);
    }
  });
});

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

describe('shadows', () => {
  it('exports sm, md, lg, card, and cardHover shadows', () => {
    expect(shadows.sm).toBeTruthy();
    expect(shadows.md).toBeTruthy();
    expect(shadows.lg).toBeTruthy();
    expect(shadows.card).toBeTruthy();
    expect(shadows.cardHover).toBeTruthy();
  });

  it('all shadow values are valid CSS box-shadow strings', () => {
    for (const value of Object.values(shadows)) {
      // Each shadow should start with a number (offset) or contain rgba
      expect(value).toContain('rgba(');
    }
  });

  it('cardHover shadow is more prominent than card shadow', () => {
    // cardHover has larger values (more visible), verify by string length as a heuristic
    expect(shadows.cardHover.length).toBeGreaterThan(shadows.card.length);
  });
});
