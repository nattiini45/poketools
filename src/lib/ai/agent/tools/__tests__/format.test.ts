import { describe, it, expect } from 'vitest';
import { parseGenFromFormat } from '../format';

describe('parseGenFromFormat', () => {
  it('reads the leading gen number', () => {
    expect(parseGenFromFormat('gen9ou')).toBe(9);
    expect(parseGenFromFormat('gen8uu')).toBe(8);
    expect(parseGenFromFormat('gen1ou')).toBe(1);
  });

  it('does not let digit-bearing suffixes bleed into the gen', () => {
    expect(parseGenFromFormat('gen9vgc2025')).toBe(9);
    expect(parseGenFromFormat('gen8bdspou')).toBe(8);
  });

  it('is case-insensitive', () => {
    expect(parseGenFromFormat('GEN9OU')).toBe(9);
  });

  it('falls back to 9 for bare/garbage/missing input', () => {
    expect(parseGenFromFormat('ou')).toBe(9);
    expect(parseGenFromFormat('garbage')).toBe(9);
    expect(parseGenFromFormat('')).toBe(9);
    expect(parseGenFromFormat(undefined)).toBe(9);
    expect(parseGenFromFormat(null)).toBe(9);
  });

  it('clamps out-of-range gens into 1..9', () => {
    expect(parseGenFromFormat('gen0test')).toBe(1);
    expect(parseGenFromFormat('gen42test')).toBe(9);
  });
});
