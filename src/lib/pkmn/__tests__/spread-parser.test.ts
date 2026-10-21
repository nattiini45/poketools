import { describe, it, expect } from 'vitest';
import { parseSpread, getMostPopularSpread } from '../spread-parser';

// ── parseSpread ─────────────────────────────────────────────────────

describe('parseSpread', () => {
  it('parses a standard Jolly physical attacker spread', () => {
    const result = parseSpread('Jolly:0/252/4/0/0/252');
    expect(result).toEqual({
      nature: 'Jolly',
      evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 },
    });
  });

  it('parses a Modest special attacker spread', () => {
    const result = parseSpread('Modest:4/0/0/252/0/252');
    expect(result).toEqual({
      nature: 'Modest',
      evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
    });
  });

  it('parses a bulky spread with all nonzero values', () => {
    const result = parseSpread('Bold:252/0/252/4/0/0');
    expect(result).toEqual({
      nature: 'Bold',
      evs: { hp: 252, atk: 0, def: 252, spa: 4, spd: 0, spe: 0 },
    });
  });

  it('parses spread with all zeros', () => {
    const result = parseSpread('Hardy:0/0/0/0/0/0');
    expect(result).toEqual({
      nature: 'Hardy',
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    });
  });

  it('parses spread with all 252 (invalid EV total but parseable)', () => {
    const result = parseSpread('Adamant:252/252/252/252/252/252');
    expect(result).toEqual({
      nature: 'Adamant',
      evs: { hp: 252, atk: 252, def: 252, spa: 252, spd: 252, spe: 252 },
    });
  });

  it('returns null when no colon is present', () => {
    expect(parseSpread('Jolly0/252/4/0/0/252')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSpread('')).toBeNull();
  });

  it('returns null when fewer than 6 EV values', () => {
    expect(parseSpread('Jolly:0/252/4/0/0')).toBeNull();
  });

  it('returns null when more than 6 EV values', () => {
    expect(parseSpread('Jolly:0/252/4/0/0/252/8')).toBeNull();
  });

  it('returns null when EV values contain non-numeric characters', () => {
    expect(parseSpread('Jolly:0/252/abc/0/0/252')).toBeNull();
  });

  it('handles nature with colon in value portion gracefully', () => {
    // "Jolly:" is the nature, rest is "0/252/4:0/0/252" which has a colon in EVs
    // indexOf(':') finds the FIRST colon, so nature="Jolly", evsStr="0/252/4:0/0/252"
    // "4:0".split('/') would not produce NaN; but the parts would be wrong
    // Actually "0/252/4:0/0/252".split('/') = ['0','252','4:0','0','252'] = 5 parts, not 6
    const result = parseSpread('Jolly:0/252/4:0/0/252');
    expect(result).toBeNull();
  });

  it('handles leading/trailing whitespace in nature (no trimming in source)', () => {
    // The source does not trim, so nature will include whitespace
    const result = parseSpread(' Jolly :0/252/4/0/0/252');
    expect(result).not.toBeNull();
    expect(result!.nature).toBe(' Jolly ');
  });
});

// ── getMostPopularSpread ────────────────────────────────────────────

describe('getMostPopularSpread', () => {
  it('returns the spread with the highest usage count', () => {
    const spreads: Record<string, number> = {
      'Jolly:0/252/4/0/0/252': 35,
      'Adamant:0/252/4/0/0/252': 50,
      'Modest:4/0/0/252/0/252': 10,
    };
    const result = getMostPopularSpread(spreads);
    expect(result).toEqual({
      nature: 'Adamant',
      evs: { hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252 },
    });
  });

  it('returns null for empty spreads object', () => {
    expect(getMostPopularSpread({})).toBeNull();
  });

  it('handles single entry', () => {
    const result = getMostPopularSpread({ 'Timid:0/0/0/252/4/252': 100 });
    expect(result).toEqual({
      nature: 'Timid',
      evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 },
    });
  });

  it('returns null when the top spread key is malformed', () => {
    const result = getMostPopularSpread({ 'InvalidKey': 100 });
    expect(result).toBeNull();
  });

  it('returns the first by sort when counts are tied', () => {
    const spreads: Record<string, number> = {
      'Jolly:0/252/4/0/0/252': 50,
      'Adamant:0/252/4/0/0/252': 50,
    };
    const result = getMostPopularSpread(spreads);
    // Both have 50, sort is stable so either could be first
    // The function just sorts descending and takes [0], so it depends on sort stability
    expect(result).not.toBeNull();
    expect(result!.nature === 'Jolly' || result!.nature === 'Adamant').toBe(true);
  });
});
