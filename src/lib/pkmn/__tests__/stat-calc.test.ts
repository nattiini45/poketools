import { describe, it, expect } from 'vitest';
import {
  STAT_KEYS,
  STAT_LABELS,
  NATURE_MODIFIERS,
  ALL_NATURE_NAMES,
  NATURES,
  getNatureModifier,
  getNatureLabel,
  calcStat,
  calcAllStats,
} from '../stat-calc';
import type { StatSpread } from '@/types/team';

// ── STAT_KEYS ───────────────────────────────────────────────────────

describe('STAT_KEYS', () => {
  it('contains all 6 stat keys in order', () => {
    expect(STAT_KEYS).toEqual(['hp', 'atk', 'def', 'spa', 'spd', 'spe']);
  });
});

// ── STAT_LABELS ─────────────────────────────────────────────────────

describe('STAT_LABELS', () => {
  it('maps every stat key to its display label', () => {
    expect(STAT_LABELS.hp).toBe('HP');
    expect(STAT_LABELS.atk).toBe('Atk');
    expect(STAT_LABELS.def).toBe('Def');
    expect(STAT_LABELS.spa).toBe('SpA');
    expect(STAT_LABELS.spd).toBe('SpD');
    expect(STAT_LABELS.spe).toBe('Spe');
  });
});

// ── ALL_NATURE_NAMES ────────────────────────────────────────────────

describe('ALL_NATURE_NAMES', () => {
  it('has exactly 25 natures', () => {
    expect(ALL_NATURE_NAMES).toHaveLength(25);
  });

  it('is sorted alphabetically', () => {
    const sorted = [...ALL_NATURE_NAMES].sort();
    expect(ALL_NATURE_NAMES).toEqual(sorted);
  });

  it('includes the 5 neutral natures', () => {
    const neutrals = ['Hardy', 'Docile', 'Serious', 'Bashful', 'Quirky'];
    for (const n of neutrals) {
      expect(ALL_NATURE_NAMES).toContain(n);
    }
  });
});

// ── NATURE_MODIFIERS ────────────────────────────────────────────────

describe('NATURE_MODIFIERS', () => {
  it('has exactly 20 non-neutral natures', () => {
    expect(Object.keys(NATURE_MODIFIERS)).toHaveLength(20);
  });

  it('Adamant boosts atk, lowers spa', () => {
    expect(NATURE_MODIFIERS['Adamant']).toEqual({ plus: 'atk', minus: 'spa' });
  });

  it('Timid boosts spe, lowers atk', () => {
    expect(NATURE_MODIFIERS['Timid']).toEqual({ plus: 'spe', minus: 'atk' });
  });

  it('Modest boosts spa, lowers atk', () => {
    expect(NATURE_MODIFIERS['Modest']).toEqual({ plus: 'spa', minus: 'atk' });
  });

  it('Jolly boosts spe, lowers spa', () => {
    expect(NATURE_MODIFIERS['Jolly']).toEqual({ plus: 'spe', minus: 'spa' });
  });

  it('no nature has plus and minus on the same stat', () => {
    for (const [, mod] of Object.entries(NATURE_MODIFIERS)) {
      expect(mod.plus).not.toBe(mod.minus);
    }
  });

  it('neutral natures are not in the modifier table', () => {
    expect(NATURE_MODIFIERS['Hardy']).toBeUndefined();
    expect(NATURE_MODIFIERS['Docile']).toBeUndefined();
    expect(NATURE_MODIFIERS['Serious']).toBeUndefined();
    expect(NATURE_MODIFIERS['Bashful']).toBeUndefined();
    expect(NATURE_MODIFIERS['Quirky']).toBeUndefined();
  });
});

// ── NATURES ─────────────────────────────────────────────────────────

describe('NATURES', () => {
  it('has 25 entries matching ALL_NATURE_NAMES', () => {
    expect(NATURES).toHaveLength(25);
    expect(NATURES.map((n) => n.name)).toEqual(ALL_NATURE_NAMES);
  });

  it('non-neutral natures have plus and minus set', () => {
    const adamant = NATURES.find((n) => n.name === 'Adamant')!;
    expect(adamant.plus).toBe('atk');
    expect(adamant.minus).toBe('spa');
  });

  it('neutral natures have plus and minus as null', () => {
    const hardy = NATURES.find((n) => n.name === 'Hardy')!;
    expect(hardy.plus).toBeNull();
    expect(hardy.minus).toBeNull();
  });
});

// ── getNatureModifier ───────────────────────────────────────────────

describe('getNatureModifier', () => {
  it('returns 1.1 for boosted stat', () => {
    expect(getNatureModifier('Adamant', 'atk')).toBe(1.1);
  });

  it('returns 0.9 for lowered stat', () => {
    expect(getNatureModifier('Adamant', 'spa')).toBe(0.9);
  });

  it('returns 1.0 for unaffected stat', () => {
    expect(getNatureModifier('Adamant', 'spe')).toBe(1.0);
  });

  it('returns 1.0 for hp (no nature boosts hp)', () => {
    expect(getNatureModifier('Adamant', 'hp')).toBe(1.0);
  });

  it('returns 1.0 for neutral nature', () => {
    expect(getNatureModifier('Hardy', 'atk')).toBe(1.0);
    expect(getNatureModifier('Hardy', 'spe')).toBe(1.0);
  });

  it('returns 1.0 for unknown nature', () => {
    expect(getNatureModifier('FakeNature', 'atk')).toBe(1.0);
  });

  it('returns correct modifiers for Timid', () => {
    expect(getNatureModifier('Timid', 'spe')).toBe(1.1);
    expect(getNatureModifier('Timid', 'atk')).toBe(0.9);
    expect(getNatureModifier('Timid', 'spa')).toBe(1.0);
  });
});

// ── getNatureLabel ──────────────────────────────────────────────────

describe('getNatureLabel', () => {
  it('returns label with stat modifiers for Adamant', () => {
    expect(getNatureLabel('Adamant')).toBe('Adamant (+Atk / -SpA)');
  });

  it('returns label with stat modifiers for Timid', () => {
    expect(getNatureLabel('Timid')).toBe('Timid (+Spe / -Atk)');
  });

  it('returns label with stat modifiers for Bold', () => {
    expect(getNatureLabel('Bold')).toBe('Bold (+Def / -Atk)');
  });

  it('returns just the name for neutral natures', () => {
    expect(getNatureLabel('Hardy')).toBe('Hardy');
    expect(getNatureLabel('Docile')).toBe('Docile');
    expect(getNatureLabel('Serious')).toBe('Serious');
  });

  it('returns the name for unknown nature', () => {
    expect(getNatureLabel('FakeNature')).toBe('FakeNature');
  });

  it("is unchanged with an explicit 'en' locale", () => {
    expect(getNatureLabel('Adamant', 'en')).toBe('Adamant (+Atk / -SpA)');
    expect(getNatureLabel('Hardy', 'en')).toBe('Hardy');
  });

  it("localizes the nature and stat labels in 'de'", () => {
    expect(getNatureLabel('Adamant', 'de')).toBe('Hart (+Angr. / -Sp.-Angr.)');
    expect(getNatureLabel('Timid', 'de')).toBe('Scheu (+Init. / -Angr.)');
  });

  it("returns just the localized name for neutral natures in 'de', and unknown input unchanged", () => {
    expect(getNatureLabel('Hardy', 'de')).toBe('Robust');
    expect(getNatureLabel('FakeNature', 'de')).toBe('FakeNature');
  });
});

// ── calcStat ────────────────────────────────────────────────────────

describe('calcStat', () => {
  // HP formula: floor(((2*base + iv + floor(ev/4)) * level) / 100) + level + 10

  describe('HP calculation', () => {
    it('calculates HP for base 100, 31 IV, 252 EV at level 100', () => {
      // floor(((2*100 + 31 + 63) * 100) / 100) + 100 + 10 = 293 + 110 = 404
      // Wait: floor(((200 + 31 + 63) * 100) / 100) = floor(294 * 1) = 294
      // 294 + 100 + 10 = 404
      expect(calcStat('hp', 100, 31, 252, 100, 1.0)).toBe(404);
    });

    it('calculates HP for base 100, 31 IV, 0 EV at level 100', () => {
      // floor(((200 + 31 + 0) * 100) / 100) + 100 + 10 = 231 + 110 = 341
      expect(calcStat('hp', 100, 31, 0, 100, 1.0)).toBe(341);
    });

    it('calculates HP for base 100 at level 50', () => {
      // floor(((200 + 31 + 63) * 50) / 100) + 50 + 10 = floor(147) + 60 = 207
      expect(calcStat('hp', 100, 31, 252, 50, 1.0)).toBe(207);
    });

    it('ignores nature modifier for HP', () => {
      // HP formula does not use natureMod
      const with11 = calcStat('hp', 100, 31, 252, 100, 1.1);
      const with09 = calcStat('hp', 100, 31, 252, 100, 0.9);
      const with10 = calcStat('hp', 100, 31, 252, 100, 1.0);
      // HP does not multiply by nature, so all should be the same
      expect(with11).toBe(with10);
      expect(with09).toBe(with10);
    });

    it('returns 1 for Shedinja (base HP = 1)', () => {
      expect(calcStat('hp', 1, 31, 252, 100, 1.0)).toBe(1);
      expect(calcStat('hp', 1, 0, 0, 50, 1.0)).toBe(1);
    });

    it('calculates HP with 0 IVs and 0 EVs', () => {
      // floor(((200 + 0 + 0) * 100) / 100) + 100 + 10 = 200 + 110 = 310
      expect(calcStat('hp', 100, 0, 0, 100, 1.0)).toBe(310);
    });
  });

  // Other stats: floor((floor(((2*base + iv + floor(ev/4)) * level) / 100) + 5) * natureMod)

  describe('non-HP stat calculation', () => {
    it('calculates Atk for Garchomp base 130, Adamant, 252 EV at level 100', () => {
      // floor(((2*130 + 31 + 63) * 100 / 100) + 5) * 1.1)
      // inner = 260 + 31 + 63 = 354
      // floor(354 * 100 / 100) = 354
      // (354 + 5) * 1.1 = 359 * 1.1 = 394.9
      // floor(394.9) = 394
      expect(calcStat('atk', 130, 31, 252, 100, 1.1)).toBe(394);
    });

    it('calculates Spe for Garchomp base 102, Jolly, 252 EV at level 100', () => {
      // inner = 204 + 31 + 63 = 298
      // (298 + 5) * 1.1 = 303 * 1.1 = 333.3
      // floor(333.3) = 333
      expect(calcStat('spe', 102, 31, 252, 100, 1.1)).toBe(333);
    });

    it('calculates Spe at level 50 (VGC)', () => {
      // inner = floor((204 + 31 + 63) * 50 / 100) = floor(149) = 149
      // (149 + 5) * 1.1 = 154 * 1.1 = 169.4
      // floor(169.4) = 169
      expect(calcStat('spe', 102, 31, 252, 50, 1.1)).toBe(169);
    });

    it('calculates with negative nature modifier (0.9)', () => {
      // base 100, 31 IV, 0 EV, level 100, -nature
      // floor(((200 + 31) * 100 / 100) + 5) * 0.9)
      // = floor((231 + 5) * 0.9) = floor(236 * 0.9) = floor(212.4) = 212
      expect(calcStat('atk', 100, 31, 0, 100, 0.9)).toBe(212);
    });

    it('calculates with neutral nature (1.0)', () => {
      // base 100, 31 IV, 0 EV, level 100, neutral
      // (231 + 5) * 1.0 = 236
      expect(calcStat('atk', 100, 31, 0, 100, 1.0)).toBe(236);
    });

    it('calculates with min stats (0 IV, 0 EV, negative nature)', () => {
      // base 100, 0 IV, 0 EV, level 100, 0.9
      // floor((200 + 0 + 0) * 100 / 100) = 200
      // (200 + 5) * 0.9 = 184.5 -> 184
      expect(calcStat('atk', 100, 0, 0, 100, 0.9)).toBe(184);
    });

    it('handles odd EV values correctly (floor(ev/4))', () => {
      // 252 EV -> floor(63) = 63, 4 EV -> floor(1) = 1, 3 EV -> floor(0.75) = 0
      const ev252 = calcStat('atk', 100, 31, 252, 100, 1.0);
      const ev4 = calcStat('atk', 100, 31, 4, 100, 1.0);
      const ev3 = calcStat('atk', 100, 31, 3, 100, 1.0);
      const ev0 = calcStat('atk', 100, 31, 0, 100, 1.0);
      expect(ev252).toBeGreaterThan(ev4);
      expect(ev4).toBeGreaterThan(ev0);
      // 3 EVs floor to 0, same as 0 EVs
      expect(ev3).toBe(ev0);
    });
  });
});

// ── calcAllStats ────────────────────────────────────────────────────

describe('calcAllStats', () => {
  const garchompBase: StatSpread = { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 };

  it('calculates all 6 stats for Garchomp Jolly 0/252/0/0/4/252 at level 100', () => {
    const evs: StatSpread = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
    const result = calcAllStats(garchompBase, undefined, evs, 'Jolly', 100);

    // HP: floor(((216+31+0)*100/100)) + 110 = 247 + 110 = 357
    expect(result.hp).toBe(357);
    // Atk: Jolly is neutral for atk, mod=1.0
    // floor(((260+31+63)*100/100)+5)*1.0 = 354 + 5 = 359
    expect(result.atk).toBe(359);
    // Spe: Jolly is +spe, mod=1.1
    // floor(((204+31+63)*100/100)+5)*1.1 = (298+5)*1.1 = 333.3 -> 333
    expect(result.spe).toBe(333);
    // SpA: Jolly is -spa, mod=0.9
    // floor(((160+31+0)*100/100)+5)*0.9 = (191+5)*0.9 = 176.4 -> 176
    expect(result.spa).toBe(176);
  });

  it('defaults IVs to 31 when undefined', () => {
    const evs: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const result = calcAllStats(garchompBase, undefined, evs, 'Hardy', 100);
    // HP: floor(((216+31+0)*100/100)) + 110 = 247 + 110 = 357
    expect(result.hp).toBe(357);
  });

  it('defaults EVs to 0 when undefined', () => {
    const result = calcAllStats(garchompBase, undefined, undefined, 'Hardy', 100);
    // HP: floor(((216+31+0)*100/100)) + 110 = 247 + 110 = 357
    expect(result.hp).toBe(357);
    // Atk: (260+31+0)*100/100 + 5 = 291 + 5 = 296
    expect(result.atk).toBe(296);
  });

  it('uses partial IVs, defaulting missing to 31', () => {
    const ivs: Partial<StatSpread> = { hp: 0 };
    const result = calcAllStats(garchompBase, ivs, undefined, 'Hardy', 100);
    // HP with 0 IV: floor(((216+0+0)*100/100)) + 110 = 216 + 110 = 326
    expect(result.hp).toBe(326);
    // Atk with default 31 IV: 296
    expect(result.atk).toBe(296);
  });

  it('uses partial EVs, defaulting missing to 0', () => {
    const evs: Partial<StatSpread> = { spe: 252 };
    const result = calcAllStats(garchompBase, undefined, evs, 'Jolly', 100);
    // Spe: 252 EVs, Jolly = +spe
    expect(result.spe).toBe(333);
    // Atk: 0 EVs, Jolly = neutral for atk
    expect(result.atk).toBe(296);
  });

  it('returns all 6 stat keys', () => {
    const result = calcAllStats(garchompBase, undefined, undefined, 'Hardy', 100);
    expect(Object.keys(result).sort()).toEqual(['atk', 'def', 'hp', 'spa', 'spd', 'spe']);
  });

  it('calculates at level 50 (VGC)', () => {
    const evs: StatSpread = { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 };
    const result = calcAllStats(garchompBase, undefined, evs, 'Jolly', 50);
    // HP at L50: floor(((216+31+0)*50/100)) + 50 + 10 = floor(123.5) + 60 = 123 + 60 = 183
    expect(result.hp).toBe(183);
    // Spe at L50: floor(((204+31+63)*50/100)) + 5) * 1.1 = floor(149) + 5 = 154, * 1.1 = 169
    expect(result.spe).toBe(169);
  });
});
