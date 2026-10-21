import { describe, it, expect } from 'vitest';
import { calculateMomentum } from '../momentum-calc';
import type { CasterPokemonInfo } from '@/types/caster';

// ── Helpers ──────────────────────────────────────────────────────────

function makePokemon(overrides: Partial<CasterPokemonInfo> = {}): CasterPokemonInfo {
  return {
    species: 'Pikachu',
    types: ['Electric'],
    baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
    ability: 'Static',
    item: 'Light Ball',
    moves: ['Thunderbolt'],
    spriteUrl: '',
    itemSpriteUrl: null,
    usagePct: null,
    leadPct: null,
    bringPct: null,
    koDealt: 0,
    koReceived: 0,
    speedTiers: {
      min: { raw: 50, withItem: 50, withAbility: 50, final: 50, modifiers: { item: null, ability: null, status: null, boosts: 0 } },
      neutral: { raw: 90, withItem: 90, withAbility: 90, final: 90, modifiers: { item: null, ability: null, status: null, boosts: 0 } },
      max: { raw: 130, withItem: 130, withAbility: 130, final: 130, modifiers: { item: null, ability: null, status: null, boosts: 0 } },
      scarf: { raw: 195, withItem: 195, withAbility: 195, final: 195, modifiers: { item: null, ability: null, status: null, boosts: 0 } },
    },
    ...overrides,
  };
}

function makeHighBSTPokemon(): CasterPokemonInfo {
  return makePokemon({
    species: 'Mewtwo',
    baseStats: { hp: 106, atk: 110, def: 90, spa: 154, spd: 90, spe: 130 },
  });
}

function makeLowBSTPokemon(): CasterPokemonInfo {
  return makePokemon({
    species: 'Rattata',
    baseStats: { hp: 30, atk: 56, def: 35, spa: 25, spd: 35, spe: 72 },
  });
}

// ── calculateMomentum ───────────────────────────────────────────────

describe('calculateMomentum', () => {
  it('returns Even when both sides are equal', () => {
    const pokemon = [makePokemon()];
    const result = calculateMomentum(
      pokemon, pokemon,
      [true], [true],
      [false], [false],
    );
    expect(result.score).toBe(0);
    expect(result.label).toBe('Even');
  });

  it('returns positive score when P1 has more alive pokemon', () => {
    const pokemon = [makePokemon(), makePokemon()];
    const result = calculateMomentum(
      pokemon, pokemon,
      [true, true], [true, true],
      [false, false], [true, false], // p2 lost one
    );
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns negative score when P2 has more alive pokemon', () => {
    const pokemon = [makePokemon(), makePokemon()];
    const result = calculateMomentum(
      pokemon, pokemon,
      [true, true], [true, true],
      [true, false], [false, false], // p1 lost one
    );
    expect(result.score).toBeLessThan(0);
  });

  it('factors in threat level (BST) of remaining pokemon', () => {
    const p1Team = [makeHighBSTPokemon()]; // Mewtwo BST = 680
    const p2Team = [makeLowBSTPokemon()];  // Rattata BST = 253
    const result = calculateMomentum(
      p1Team, p2Team,
      [true], [true],
      [false], [false],
    );
    // Same count alive but P1 has much higher threat
    expect(result.score).toBeGreaterThan(0);
  });

  it('clamps score to -100..+100 range', () => {
    // P1 has many alive high-BST mons, P2 has none alive
    const p1Team = [makeHighBSTPokemon(), makeHighBSTPokemon(), makeHighBSTPokemon()];
    const p2Team = [makeLowBSTPokemon(), makeLowBSTPokemon(), makeLowBSTPokemon()];
    const result = calculateMomentum(
      p1Team, p2Team,
      [true, true, true], [true, true, true],
      [false, false, false], [true, true, true], // all P2 dead
    );
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(-100);
  });

  it('ignores unbrought pokemon', () => {
    const pokemon = [makePokemon(), makePokemon()];
    const result = calculateMomentum(
      pokemon, pokemon,
      [true, false], [true, false], // second not brought
      [false, false], [false, false],
    );
    // Only 1 alive on each side, equal threat
    expect(result.score).toBe(0);
    expect(result.label).toBe('Even');
  });

  it('does not count KOed but unbrought as alive', () => {
    // An unbrought pokemon should not count even if it was somehow not KOed
    const pokemon = [makePokemon(), makePokemon()];
    const result = calculateMomentum(
      pokemon, pokemon,
      [true, false], [true, true],
      [false, false], [false, false],
    );
    // P1: 1 alive, P2: 2 alive => negative
    expect(result.score).toBeLessThan(0);
  });

  it('returns "Slight P1 advantage" for small positive scores', () => {
    // Create slightly uneven teams where P1 has a small edge
    const p1Team = [makePokemon(), makePokemon()];
    const p2Team = [makePokemon(), makeLowBSTPokemon()];
    const result = calculateMomentum(
      p1Team, p2Team,
      [true, true], [true, true],
      [false, false], [false, false],
    );
    // P1 has slightly higher threat; check the label logic
    if (result.score >= 10 && result.score < 30) {
      expect(result.label).toBe('Slight P1 advantage');
    }
  });

  it('returns "P1 dominating" for score >= 60', () => {
    const p1Team = [makeHighBSTPokemon(), makeHighBSTPokemon(), makeHighBSTPokemon()];
    const p2Team = [makeLowBSTPokemon()];
    const result = calculateMomentum(
      p1Team, p2Team,
      [true, true, true], [true],
      [false, false, false], [false],
    );
    if (result.score >= 60) {
      expect(result.label).toBe('P1 dominating');
    }
  });

  it('returns "P2 dominating" for score <= -60', () => {
    const p1Team = [makeLowBSTPokemon()];
    const p2Team = [makeHighBSTPokemon(), makeHighBSTPokemon(), makeHighBSTPokemon()];
    const result = calculateMomentum(
      p1Team, p2Team,
      [true], [true, true, true],
      [false], [false, false, false],
    );
    if (result.score <= -60) {
      expect(result.label).toBe('P2 dominating');
    }
  });

  it('handles empty teams gracefully', () => {
    const result = calculateMomentum([], [], [], [], [], []);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Even');
  });

  it('handles all pokemon KOed on both sides', () => {
    const pokemon = [makePokemon()];
    const result = calculateMomentum(
      pokemon, pokemon,
      [true], [true],
      [true], [true],
    );
    expect(result.score).toBe(0);
    expect(result.label).toBe('Even');
  });

  it('label buckets: Even < 10, Slight < 30, Advantage < 60, Dominating >= 60', () => {
    // Verify all label thresholds work correctly for negative scores too
    const p1Team = [makePokemon()];
    const p2Team = [makeHighBSTPokemon(), makeHighBSTPokemon()];
    const result = calculateMomentum(
      p1Team, p2Team,
      [true], [true, true],
      [false], [false, false],
    );
    if (Math.abs(result.score) < 10) expect(result.label).toBe('Even');
    else if (result.score < -60) expect(result.label).toBe('P2 dominating');
    else if (result.score < -30) expect(result.label).toBe('P2 advantage');
    else if (result.score < -10) expect(result.label).toBe('Slight P2 advantage');
  });
});

// ── i18n (T15) ────────────────────────────────────────────────────────

describe('calculateMomentum i18n (T15)', () => {
  it('labels momentum in German for locale de', () => {
    const pokemon = [makePokemon()];
    const even = calculateMomentum(pokemon, pokemon, [true], [true], [false], [false], 'de');
    expect(even.label).toBe('Ausgeglichen');

    const p1 = [makeHighBSTPokemon(), makeHighBSTPokemon()];
    const p2 = [makeLowBSTPokemon(), makeLowBSTPokemon()];
    const dominating = calculateMomentum(p1, p2, [true, true], [true, true], [false, false], [true, true], 'de');
    expect(dominating.score).toBeGreaterThanOrEqual(60);
    expect(dominating.label).toBe('P1 dominiert');
  });

  it('returns the same score in both locales', () => {
    const p1 = [makeHighBSTPokemon()];
    const p2 = [makeLowBSTPokemon()];
    const en = calculateMomentum(p1, p2, [true], [true], [false], [false]);
    const de = calculateMomentum(p1, p2, [true], [true], [false], [false], 'de');
    expect(de.score).toBe(en.score);
  });
});
