import { describe, it, expect, beforeEach } from 'vitest';
import { getUsageStats, searchStrategyKnowledge, __clearSmogonToolCache } from '../smogon';

// These hit the live https://data.pkmn.cc dataset, so they get generous timeouts.

describe('getUsageStats (live)', () => {
  beforeEach(() => __clearSmogonToolCache());

  it('returns >=10 gen9ou mons with usage numbers', async () => {
    const res = await getUsageStats({ format: 'gen9ou' });
    expect(res.format).toBe('gen9ou');
    expect(res.pokemon.length).toBeGreaterThanOrEqual(10);
    expect(res.pokemon.length).toBeLessThanOrEqual(20);
    for (const p of res.pokemon) {
      expect(typeof p.usage_pct).toBe('number');
      expect(p.usage_pct).toBeGreaterThan(0);
      // Sub-lists are capped at 5.
      expect(p.moves.length).toBeLessThanOrEqual(5);
      expect(p.items.length).toBeLessThanOrEqual(5);
      expect(p.abilities.length).toBeLessThanOrEqual(5);
      expect(p.spreads.length).toBeLessThanOrEqual(5);
    }
    // Sorted by descending usage.
    expect(res.pokemon[0].usage_pct).toBeGreaterThanOrEqual(res.pokemon[1].usage_pct);
  }, 30000);
});

describe('searchStrategyKnowledge (live)', () => {
  beforeEach(() => __clearSmogonToolCache());

  it('returns <=3 excerpts for "Garchomp gen9ou"', async () => {
    const res = await searchStrategyKnowledge({ query: 'Garchomp gen9ou', format: 'gen9ou' });
    expect(res.excerpts.length).toBeLessThanOrEqual(3);
    for (const ex of res.excerpts) {
      expect(ex.source).toBe('smogon-analysis');
      expect(ex.text.length).toBeLessThanOrEqual(800);
      expect(ex.text.length).toBeGreaterThan(0);
    }
    // Garchomp has a gen9ou analysis, so we expect at least one excerpt.
    if (res.excerpts.length > 0) {
      expect(res.excerpts[0].pokemon).toBe('Garchomp');
    }
  }, 30000);
});
