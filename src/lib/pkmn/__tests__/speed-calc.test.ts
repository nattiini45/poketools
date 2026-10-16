import { describe, it, expect } from 'vitest';
import { calcSpeed, getNatureEffect } from '../speed-calc';

describe('calcSpeed', () => {
  // ── Basic formula tests (Level 100) ──────────────────────────────

  it('Garchomp Jolly 252 Spe @ L100', () => {
    // Base 102, Jolly (+Spe), 252 EVs, 31 IVs
    // floor((floor((2*102 + 31 + 63) * 100/100) + 5) * 1.1)
    // = floor((298 + 5) * 1.1) = floor(333.3) = 333
    const result = calcSpeed({
      baseSpe: 102, level: 100, ev: 252, iv: 31, nature: 'positive',
    });
    expect(result.raw).toBe(333);
    expect(result.final).toBe(333);
  });

  it('Garchomp Adamant 0 Spe @ L100 (neutral Spe nature)', () => {
    // Adamant is neutral for Speed
    // floor((floor((2*102 + 31 + 0) * 100/100) + 5) * 1.0)
    // = floor((235 + 5) * 1.0) = 240
    const result = calcSpeed({
      baseSpe: 102, level: 100, ev: 0, iv: 31, nature: 'neutral',
    });
    expect(result.raw).toBe(240);
    expect(result.final).toBe(240);
  });

  it('Garchomp Brave 0 Spe 0 IV @ L100 (min speed)', () => {
    // Brave is -Spe
    // floor((floor((2*102 + 0 + 0) * 100/100) + 5) * 0.9)
    // = floor((204 + 5) * 0.9) = floor(188.1) = 188
    const result = calcSpeed({
      baseSpe: 102, level: 100, ev: 0, iv: 0, nature: 'negative',
    });
    expect(result.raw).toBe(188);
    expect(result.final).toBe(188);
  });

  // ── Level 50 (VGC) ──────────────────────────────────────────────

  it('Garchomp Jolly 252 Spe @ L50', () => {
    // floor((floor((2*102 + 31 + 63) * 50/100) + 5) * 1.1)
    // = floor((floor(149) + 5) * 1.1) = floor(154 * 1.1) = floor(169.4) = 169
    const result = calcSpeed({
      baseSpe: 102, level: 50, ev: 252, iv: 31, nature: 'positive',
    });
    expect(result.raw).toBe(169);
    expect(result.final).toBe(169);
  });

  it('Flutter Mane Timid 252 Spe @ L50', () => {
    // Base 135
    // floor((floor((2*135 + 31 + 63) * 50/100) + 5) * 1.1)
    // = floor((floor(182) + 5) * 1.1) = floor(187 * 1.1) = floor(205.7) = 205
    const result = calcSpeed({
      baseSpe: 135, level: 50, ev: 252, iv: 31, nature: 'positive',
    });
    expect(result.raw).toBe(205);
    expect(result.final).toBe(205);
  });

  // ── Item modifiers ───────────────────────────────────────────────

  it('Choice Scarf multiplies speed by 1.5', () => {
    const result = calcSpeed({
      baseSpe: 102, level: 50, ev: 252, iv: 31, nature: 'positive',
      item: 'Choice Scarf',
    });
    // 169 * 1.5 = 253.5 → floor = 253
    expect(result.raw).toBe(169);
    expect(result.withItem).toBe(253);
    expect(result.final).toBe(253);
    expect(result.modifiers.item).toEqual({ name: 'Choice Scarf', mod: 1.5 });
  });

  it('Iron Ball halves speed', () => {
    const result = calcSpeed({
      baseSpe: 102, level: 100, ev: 252, iv: 31, nature: 'positive',
      item: 'Iron Ball',
    });
    // 333 * 0.5 = 166.5 → floor = 166
    expect(result.withItem).toBe(166);
    expect(result.final).toBe(166);
  });

  it('Power Weight halves speed', () => {
    const result = calcSpeed({
      baseSpe: 100, level: 100, ev: 0, iv: 31, nature: 'neutral',
      item: 'Power Weight',
    });
    expect(result.modifiers.item?.mod).toBe(0.5);
  });

  // ── Ability modifiers ────────────────────────────────────────────

  it('Chlorophyll doubles speed in Sun', () => {
    const result = calcSpeed({
      baseSpe: 80, level: 100, ev: 252, iv: 31, nature: 'positive',
      ability: 'Chlorophyll', weather: 'Sun',
    });
    const baseResult = calcSpeed({
      baseSpe: 80, level: 100, ev: 252, iv: 31, nature: 'positive',
    });
    expect(result.final).toBe(Math.floor(baseResult.raw * 2));
    expect(result.modifiers.ability).toEqual({ name: 'Chlorophyll', mod: 2.0 });
  });

  it('Chlorophyll does nothing without Sun', () => {
    const result = calcSpeed({
      baseSpe: 80, level: 100, ev: 252, iv: 31, nature: 'positive',
      ability: 'Chlorophyll',
    });
    expect(result.modifiers.ability).toBeNull();
    expect(result.final).toBe(result.raw);
  });

  it('Swift Swim doubles speed in Rain', () => {
    const result = calcSpeed({
      baseSpe: 60, level: 100, ev: 252, iv: 31, nature: 'positive',
      ability: 'Swift Swim', weather: 'Rain',
    });
    expect(result.modifiers.ability?.mod).toBe(2.0);
  });

  it('Surge Surfer doubles speed in Electric Terrain', () => {
    const result = calcSpeed({
      baseSpe: 75, level: 100, ev: 252, iv: 31, nature: 'positive',
      ability: 'Surge Surfer', terrain: 'Electric',
    });
    expect(result.modifiers.ability?.mod).toBe(2.0);
  });

  it('Slow Start halves speed', () => {
    const result = calcSpeed({
      baseSpe: 100, level: 100, ev: 252, iv: 31, nature: 'positive',
      ability: 'Slow Start',
    });
    expect(result.modifiers.ability?.mod).toBe(0.5);
  });

  // ── Status modifiers ────────────────────────────────────────────

  it('Paralysis halves speed in Gen 7+', () => {
    const result = calcSpeed({
      baseSpe: 100, level: 100, ev: 252, iv: 31, nature: 'neutral',
      status: 'par', generation: 9,
    });
    const base = calcSpeed({
      baseSpe: 100, level: 100, ev: 252, iv: 31, nature: 'neutral',
    });
    expect(result.final).toBe(Math.floor(base.raw * 0.5));
  });

  it('Paralysis quarters speed in Gen 1-6', () => {
    const result = calcSpeed({
      baseSpe: 100, level: 100, ev: 252, iv: 31, nature: 'neutral',
      status: 'par', generation: 6,
    });
    const base = calcSpeed({
      baseSpe: 100, level: 100, ev: 252, iv: 31, nature: 'neutral',
    });
    expect(result.final).toBe(Math.floor(base.raw * 0.25));
  });

  // ── Boost stages ─────────────────────────────────────────────────

  it('+1 speed boost = 1.5× multiplier', () => {
    const base = calcSpeed({
      baseSpe: 100, level: 100, ev: 0, iv: 31, nature: 'neutral',
    });
    const boosted = calcSpeed({
      baseSpe: 100, level: 100, ev: 0, iv: 31, nature: 'neutral',
      boosts: 1,
    });
    expect(boosted.final).toBe(Math.floor(base.raw * 1.5));
  });

  it('-1 speed drop = 0.667× multiplier', () => {
    const base = calcSpeed({
      baseSpe: 100, level: 100, ev: 0, iv: 31, nature: 'neutral',
    });
    const dropped = calcSpeed({
      baseSpe: 100, level: 100, ev: 0, iv: 31, nature: 'neutral',
      boosts: -1,
    });
    // 2 / (2 - (-1)) = 2/3
    expect(dropped.final).toBe(Math.floor(base.raw * (2 / 3)));
  });

  // ── Combined modifiers ──────────────────────────────────────────

  it('Choice Scarf + Chlorophyll in Sun stacks', () => {
    const result = calcSpeed({
      baseSpe: 80, level: 100, ev: 252, iv: 31, nature: 'positive',
      item: 'Choice Scarf', ability: 'Chlorophyll', weather: 'Sun',
    });
    // raw * 1.5 (scarf) * 2.0 (chlorophyll) = raw * 3
    expect(result.final).toBe(Math.floor(result.raw * 1.5 * 2.0));
  });
});

describe('getNatureEffect', () => {
  it('identifies speed-positive natures', () => {
    expect(getNatureEffect('Jolly')).toBe('positive');
    expect(getNatureEffect('Timid')).toBe('positive');
    expect(getNatureEffect('Hasty')).toBe('positive');
    expect(getNatureEffect('Naive')).toBe('positive');
  });

  it('identifies speed-negative natures', () => {
    expect(getNatureEffect('Brave')).toBe('negative');
    expect(getNatureEffect('Relaxed')).toBe('negative');
    expect(getNatureEffect('Quiet')).toBe('negative');
    expect(getNatureEffect('Sassy')).toBe('negative');
  });

  it('identifies neutral natures', () => {
    expect(getNatureEffect('Adamant')).toBe('neutral');
    expect(getNatureEffect('Modest')).toBe('neutral');
    expect(getNatureEffect('Hardy')).toBe('neutral');
    expect(getNatureEffect('Serious')).toBe('neutral');
  });
});
