import { describe, it, expect } from 'vitest';
import {
  TYPES,
  TYPE_EFFECTIVENESS,
  getEffectiveness,
  getBestStabEffectiveness,
} from '../type-chart';

// ── TYPES constant ──────────────────────────────────────────────────

describe('TYPES', () => {
  it('has exactly 18 types', () => {
    expect(TYPES).toHaveLength(18);
  });

  it('includes all Gen 6+ types', () => {
    const expected = [
      'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
      'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
      'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
    ];
    expect([...TYPES]).toEqual(expected);
  });
});

// ── TYPE_EFFECTIVENESS chart ────────────────────────────────────────

describe('TYPE_EFFECTIVENESS', () => {
  it('has an entry for every type as attacker', () => {
    for (const t of TYPES) {
      expect(TYPE_EFFECTIVENESS[t]).toBeDefined();
    }
  });

  it('each attacking type maps to all 18 defending types', () => {
    for (const atk of TYPES) {
      for (const def of TYPES) {
        expect(typeof TYPE_EFFECTIVENESS[atk][def]).toBe('number');
      }
    }
  });

  // ── Spot-check known matchups ──

  it('Fire is super effective against Grass', () => {
    expect(TYPE_EFFECTIVENESS['Fire']['Grass']).toBe(2);
  });

  it('Water is super effective against Fire', () => {
    expect(TYPE_EFFECTIVENESS['Water']['Fire']).toBe(2);
  });

  it('Grass is super effective against Water', () => {
    expect(TYPE_EFFECTIVENESS['Grass']['Water']).toBe(2);
  });

  it('Normal is immune to Ghost', () => {
    expect(TYPE_EFFECTIVENESS['Normal']['Ghost']).toBe(0);
  });

  it('Ghost is immune to Normal', () => {
    expect(TYPE_EFFECTIVENESS['Ghost']['Normal']).toBe(0);
  });

  it('Electric is immune to Ground', () => {
    expect(TYPE_EFFECTIVENESS['Electric']['Ground']).toBe(0);
  });

  it('Ground is immune to Flying', () => {
    expect(TYPE_EFFECTIVENESS['Ground']['Flying']).toBe(0);
  });

  it('Fighting is immune to Ghost', () => {
    expect(TYPE_EFFECTIVENESS['Fighting']['Ghost']).toBe(0);
  });

  it('Psychic is immune to Dark', () => {
    expect(TYPE_EFFECTIVENESS['Psychic']['Dark']).toBe(0);
  });

  it('Dragon is immune to Fairy', () => {
    expect(TYPE_EFFECTIVENESS['Dragon']['Fairy']).toBe(0);
  });

  it('Poison is immune to Steel', () => {
    expect(TYPE_EFFECTIVENESS['Poison']['Steel']).toBe(0);
  });

  it('Fire resists itself', () => {
    expect(TYPE_EFFECTIVENESS['Fire']['Fire']).toBe(0.5);
  });

  it('Steel is super effective against Fairy', () => {
    expect(TYPE_EFFECTIVENESS['Steel']['Fairy']).toBe(2);
  });

  it('Fairy is super effective against Dragon', () => {
    expect(TYPE_EFFECTIVENESS['Fairy']['Dragon']).toBe(2);
  });

  it('Fairy is super effective against Dark', () => {
    expect(TYPE_EFFECTIVENESS['Fairy']['Dark']).toBe(2);
  });

  it('Fairy is super effective against Fighting', () => {
    expect(TYPE_EFFECTIVENESS['Fairy']['Fighting']).toBe(2);
  });

  it('Ice is super effective against Dragon', () => {
    expect(TYPE_EFFECTIVENESS['Ice']['Dragon']).toBe(2);
  });
});

// ── getEffectiveness ────────────────────────────────────────────────

describe('getEffectiveness', () => {
  it('returns 2 for super effective single type', () => {
    expect(getEffectiveness('Fire', ['Grass'])).toBe(2);
  });

  it('returns 0.5 for resisted single type', () => {
    expect(getEffectiveness('Fire', ['Water'])).toBe(0.5);
  });

  it('returns 0 for immune single type', () => {
    expect(getEffectiveness('Normal', ['Ghost'])).toBe(0);
  });

  it('returns 1 for neutral single type', () => {
    expect(getEffectiveness('Fire', ['Normal'])).toBe(1);
  });

  it('multiplies effectiveness across dual types (4x super effective)', () => {
    // Ice vs Ground/Flying: Ice->Ground=2, Ice->Flying=2 = 4
    expect(getEffectiveness('Ice', ['Ground', 'Flying'])).toBe(4);
  });

  it('multiplies effectiveness across dual types (4x resisted)', () => {
    // Fire vs Fire/Water: 0.5 * 0.5 = 0.25
    expect(getEffectiveness('Fire', ['Fire', 'Water'])).toBe(0.25);
  });

  it('immune overrides everything in dual type (0x)', () => {
    // Electric vs Water/Ground: 2 * 0 = 0
    expect(getEffectiveness('Electric', ['Water', 'Ground'])).toBe(0);
  });

  it('neutral against dual type where one is SE and one is NVE (1x)', () => {
    // Fire vs Grass/Water: 2 * 0.5 = 1
    expect(getEffectiveness('Fire', ['Grass', 'Water'])).toBe(1);
  });

  it('returns 1 for unknown attacking type (fallback)', () => {
    expect(getEffectiveness('FakeType', ['Normal'])).toBe(1);
  });

  it('returns 1 for unknown defending type (fallback)', () => {
    expect(getEffectiveness('Fire', ['FakeType'])).toBe(1);
  });

  it('returns 1 for empty defending types array', () => {
    expect(getEffectiveness('Fire', [])).toBe(1);
  });

  it('handles triple types (hypothetical extension)', () => {
    // Fire vs Grass/Bug/Steel: 2 * 2 * 2 = 8
    expect(getEffectiveness('Fire', ['Grass', 'Bug', 'Steel'])).toBe(8);
  });
});

// ── getBestStabEffectiveness ────────────────────────────────────────

describe('getBestStabEffectiveness', () => {
  it('returns highest effectiveness among attacking types', () => {
    // Fire/Flying attacker vs Grass: Fire->Grass=2, Flying->Grass=2. Best = 2
    expect(getBestStabEffectiveness(['Fire', 'Flying'], ['Grass'])).toBe(2);
  });

  it('picks the better type when one is NVE and one is SE', () => {
    // Water/Ground vs Fire: Water->Fire=2, Ground->Fire=2. Best = 2
    expect(getBestStabEffectiveness(['Water', 'Ground'], ['Fire'])).toBe(2);
  });

  it('picks the better type among mixed effectiveness', () => {
    // Fire/Fighting vs Ice: Fire->Ice=0.5, Fighting->Ice=2. Best = 2
    expect(getBestStabEffectiveness(['Fire', 'Fighting'], ['Ice'])).toBe(2);
  });

  it('handles immune matchup when other type is not immune', () => {
    // Normal/Fighting vs Ghost: Normal->Ghost=0, Fighting->Ghost=0. Best = 0
    expect(getBestStabEffectiveness(['Normal', 'Fighting'], ['Ghost'])).toBe(0);
  });

  it('returns correct value for single attacking type', () => {
    expect(getBestStabEffectiveness(['Fire'], ['Grass'])).toBe(2);
  });

  it('returns 0 for empty attacking types array', () => {
    expect(getBestStabEffectiveness([], ['Normal'])).toBe(0);
  });

  it('handles dual defending types with dual attacking types', () => {
    // Ghost/Dark vs Psychic/Normal
    // Ghost -> Psychic/Normal: Ghost->Psychic=2, Ghost->Normal=0 = 0
    // Dark -> Psychic/Normal: Dark->Psychic=2, Dark->Normal=1 = 2
    // Best = 2
    expect(getBestStabEffectiveness(['Ghost', 'Dark'], ['Psychic', 'Normal'])).toBe(2);
  });

  it('correctly returns 4x when one STAB is double super effective', () => {
    // Ice/Ground vs Dragon/Flying
    // Ice -> Dragon/Flying: 2 * 2 = 4
    // Ground -> Dragon/Flying: 1 * 0 = 0
    // Best = 4
    expect(getBestStabEffectiveness(['Ice', 'Ground'], ['Dragon', 'Flying'])).toBe(4);
  });

  it('returns neutral (1) when both STABs are neutral', () => {
    // Normal/Psychic vs Fire
    // Normal -> Fire = 1
    // Psychic -> Fire = 1
    expect(getBestStabEffectiveness(['Normal', 'Psychic'], ['Fire'])).toBe(1);
  });
});
