import { describe, it, expect } from 'vitest';
import { calculateDamage } from '../calc';
import type { CalculateDamageInput } from '../schemas';

describe('calculateDamage', () => {
  const cbGarchompEqVsHeatran: CalculateDamageInput = {
    gen: 9,
    attacker: {
      species: 'Garchomp',
      item: 'Choice Band',
      ability: 'Rough Skin',
      nature: 'Adamant',
      evs: { atk: 252 },
    },
    defender: {
      species: 'Heatran',
      nature: 'Hardy',
      evs: { hp: 0, def: 0 },
    },
    move: 'Earthquake',
  };

  it('computes a known stable OHKO calc (CB Garchomp EQ vs 0/0 Heatran)', () => {
    const result = calculateDamage(cbGarchompEqVsHeatran);
    expect(result.error).toBeUndefined();
    // Heatran is Fire/Steel — 4x weak to Ground. This is a comfortable OHKO.
    expect(result.damage.min_pct).toBeGreaterThan(50);
    expect(result.damage.max_pct).toBeGreaterThanOrEqual(result.damage.min_pct);
    expect(result.rolls.length).toBeGreaterThan(0);
    expect(result.ko_chance.toLowerCase()).toContain('ohko');
  });

  it('is deterministic — the same inputs yield identical damage', () => {
    const a = calculateDamage(cbGarchompEqVsHeatran);
    const b = calculateDamage(cbGarchompEqVsHeatran);
    expect(b.damage).toEqual(a.damage);
    expect(b.rolls).toEqual(a.rolls);
  });

  it('returns a safe error result for an unknown move', () => {
    const result = calculateDamage({
      ...cbGarchompEqVsHeatran,
      move: 'Notarealmove',
    });
    expect(result.damage.min_pct).toBe(0);
    expect(result.error).toBeDefined();
  });
});
