import { describe, it, expect } from 'vitest';
import { calculateDamage, type CalculateDamageResult, type CalculateDamageSuccess } from '../calc';
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

  function expectSuccess(result: CalculateDamageResult): CalculateDamageSuccess {
    if ('error' in result) throw new Error(`expected a calc result, got ${result.error_code}: ${result.error}`);
    return result;
  }

  it('computes a known stable OHKO calc (CB Garchomp EQ vs 0/0 Heatran)', () => {
    const result = expectSuccess(calculateDamage(cbGarchompEqVsHeatran));
    // Heatran is Fire/Steel — 4x weak to Ground. This is a comfortable OHKO.
    expect(result.damage.min_pct).toBeGreaterThan(50);
    expect(result.damage.max_pct).toBeGreaterThanOrEqual(result.damage.min_pct);
    expect(result.rolls.length).toBeGreaterThan(0);
    expect(result.ko_chance.toLowerCase()).toContain('ohko');
  });

  it('is deterministic — the same inputs yield identical damage', () => {
    const a = expectSuccess(calculateDamage(cbGarchompEqVsHeatran));
    const b = expectSuccess(calculateDamage(cbGarchompEqVsHeatran));
    expect(b.damage).toEqual(a.damage);
    expect(b.rolls).toEqual(a.rolls);
  });

  it('reports a type immunity as a real 0-damage result, not an error', () => {
    const result = expectSuccess(
      calculateDamage({ ...cbGarchompEqVsHeatran, defender: { species: 'Corviknight' } }),
    );
    expect(result.damage).toEqual({ min: 0, max: 0, min_pct: 0, max_pct: 0 });
    expect(result.ko_chance).toBe('N/A');
    expect(result.description).toBe('Garchomp Earthquake vs. Corviknight: 0-0 (0 - 0%)');
  });

  it('reports a status move as 0 damage without an error', () => {
    const result = expectSuccess(calculateDamage({ ...cbGarchompEqVsHeatran, move: 'Swords Dance' }));
    expect(result.damage.max).toBe(0);
  });

  it('returns an explicit error and NO damage numbers for an unknown move', () => {
    const result = calculateDamage({
      ...cbGarchompEqVsHeatran,
      move: 'Notarealmove',
    });
    expect(result).toEqual({
      move: 'Notarealmove',
      attacker: 'Garchomp',
      defender: 'Heatran',
      error: 'Unknown move: Notarealmove',
      error_code: 'unknown_move',
    });
    expect('damage' in result).toBe(false);
  });

  it('rejects an unknown item instead of silently ignoring it', () => {
    const result = calculateDamage({
      ...cbGarchompEqVsHeatran,
      attacker: { ...cbGarchompEqVsHeatran.attacker, item: 'Choice Bandd' },
    });
    expect(result).toMatchObject({ error_code: 'unknown_item', error: 'attacker: Unknown item: Choice Bandd' });
  });

  it('rejects an unknown defender species', () => {
    const result = calculateDamage({ ...cbGarchompEqVsHeatran, defender: { species: 'Fakemon' } });
    expect(result).toMatchObject({ error_code: 'unknown_species' });
  });

  it('applies the field: Reflect lowers physical damage', () => {
    const plain = expectSuccess(calculateDamage(cbGarchompEqVsHeatran));
    const screened = expectSuccess(calculateDamage({ ...cbGarchompEqVsHeatran, field: { isReflect: true } }));
    expect(screened.damage.max).toBeLessThan(plain.damage.max);
  });
});
