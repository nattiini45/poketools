import { describe, it, expect } from 'vitest';
import { getRatingTier, RATING_TIER_META } from '../tiers';

describe('getRatingTier', () => {
  it('returns Poké Ball for ratings below 1400', () => {
    expect(getRatingTier(1200, 40)).toBe('poke');
    expect(getRatingTier(1399, 40)).toBe('poke');
  });

  it('returns Great Ball for 1400 ≤ rating < 1600', () => {
    expect(getRatingTier(1400, 40)).toBe('great');
    expect(getRatingTier(1500, 40)).toBe('great');
    expect(getRatingTier(1599, 40)).toBe('great');
  });

  it('returns Ultra Ball for 1600 ≤ rating < 1900', () => {
    expect(getRatingTier(1600, 40)).toBe('ultra');
    expect(getRatingTier(1750, 40)).toBe('ultra');
    expect(getRatingTier(1899, 40)).toBe('ultra');
  });

  it('returns Master Ball only when rating ≥ 1900 AND rd ≤ 50', () => {
    expect(getRatingTier(1900, 50)).toBe('master');
    expect(getRatingTier(2000, 30)).toBe('master');
  });

  it('caps high-rating high-RD players at Ultra Ball (Master gate)', () => {
    expect(getRatingTier(1900, 51)).toBe('ultra');
    expect(getRatingTier(2200, 75)).toBe('ultra');
  });

  it('demotes any rating to Poké Ball when rd > 100 (provisional)', () => {
    expect(getRatingTier(1500, 101)).toBe('poke');
    expect(getRatingTier(2100, 200)).toBe('poke');
  });

  it('treats rd == 0 / null / undefined as "RD unknown" — skips provisional and Master gates', () => {
    // No demotion to Poké just because RD is unknown.
    expect(getRatingTier(1500, 0)).toBe('great');
    expect(getRatingTier(1500, null)).toBe('great');
    expect(getRatingTier(1500, undefined)).toBe('great');
    // No promotion to Master without RD evidence — caps at Ultra.
    expect(getRatingTier(2000, 0)).toBe('ultra');
    expect(getRatingTier(2000, null)).toBe('ultra');
  });
});

describe('RATING_TIER_META', () => {
  it('exposes Showdown item ids for all four tiers', () => {
    expect(RATING_TIER_META.poke.ballItemId).toBe('pokeball');
    expect(RATING_TIER_META.great.ballItemId).toBe('greatball');
    expect(RATING_TIER_META.ultra.ballItemId).toBe('ultraball');
    expect(RATING_TIER_META.master.ballItemId).toBe('masterball');
  });
});
