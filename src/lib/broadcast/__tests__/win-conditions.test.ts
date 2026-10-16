import { describe, it, expect } from 'vitest';
import { analyzeWinConditions } from '../win-conditions';
import type { CasterPokemonInfo } from '@/types/caster';

// ── Helpers ──────────────────────────────────────────────────────────

const baseSpeedTier = {
  min: { raw: 50, withItem: 50, withAbility: 50, final: 50, modifiers: { item: null, ability: null, status: null, boosts: 0 } },
  neutral: { raw: 70, withItem: 70, withAbility: 70, final: 70, modifiers: { item: null, ability: null, status: null, boosts: 0 } },
  max: { raw: 100, withItem: 100, withAbility: 100, final: 100, modifiers: { item: null, ability: null, status: null, boosts: 0 } },
  scarf: { raw: 150, withItem: 150, withAbility: 150, final: 150, modifiers: { item: null, ability: null, status: null, boosts: 0 } },
};

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
    speedTiers: { ...baseSpeedTier },
    ...overrides,
  };
}

// ── analyzeWinConditions ────────────────────────────────────────────

describe('analyzeWinConditions', () => {
  describe('sweeper detection', () => {
    it('identifies primary sweeper for each team', () => {
      const p1 = [
        makePokemon({
          species: 'Mewtwo',
          baseStats: { hp: 106, atk: 110, def: 90, spa: 154, spd: 90, spe: 130 },
        }),
      ];
      const p2 = [
        makePokemon({
          species: 'Gengar',
          baseStats: { hp: 60, atk: 65, def: 60, spa: 130, spd: 75, spe: 110 },
        }),
      ];
      const result = analyzeWinConditions(p1, p2, 'Alice', 'Bob');
      const sweepers = result.filter((c) => c.type === 'sweeper');
      expect(sweepers).toHaveLength(2);
      const p1Sweeper = sweepers.find((c) => c.player === 1);
      const p2Sweeper = sweepers.find((c) => c.player === 2);
      expect(p1Sweeper?.description).toContain('Mewtwo');
      expect(p1Sweeper?.description).toContain('Alice');
      expect(p2Sweeper?.description).toContain('Gengar');
      expect(p2Sweeper?.description).toContain('Bob');
    });

    it('picks the pokemon with highest max(atk,spa) + spe as sweeper', () => {
      const p1 = [
        makePokemon({
          species: 'Snorlax',
          baseStats: { hp: 160, atk: 110, def: 65, spa: 65, spd: 110, spe: 30 },
        }),
        makePokemon({
          species: 'Jolteon',
          baseStats: { hp: 65, atk: 65, def: 60, spa: 110, spd: 95, spe: 130 },
        }),
      ];
      const result = analyzeWinConditions(p1, [], 'Alice', 'Bob');
      const p1Sweeper = result.find((c) => c.player === 1 && c.type === 'sweeper');
      // Jolteon: max(65,110) + 130 = 240
      // Snorlax: max(110,65) + 30 = 140
      expect(p1Sweeper?.description).toContain('Jolteon');
    });

    it('returns no sweepers for empty teams', () => {
      const result = analyzeWinConditions([], [], 'Alice', 'Bob');
      const sweepers = result.filter((c) => c.type === 'sweeper');
      expect(sweepers).toHaveLength(0);
    });
  });

  describe('speed advantage', () => {
    it('detects P1 speed advantage when fastest is > 20 faster than P2', () => {
      const p1 = [
        makePokemon({
          species: 'Jolteon',
          speedTiers: {
            ...baseSpeedTier,
            max: { ...baseSpeedTier.max, raw: 200 },
          },
        }),
      ];
      const p2 = [
        makePokemon({
          species: 'Snorlax',
          speedTiers: {
            ...baseSpeedTier,
            max: { ...baseSpeedTier.max, raw: 100 },
          },
        }),
      ];
      const result = analyzeWinConditions(p1, p2, 'Alice', 'Bob');
      const speedCond = result.find((c) => c.type === 'speed_advantage');
      expect(speedCond).toBeDefined();
      expect(speedCond?.player).toBe(1);
      expect(speedCond?.description).toContain('Alice');
      expect(speedCond?.description).toContain('200');
    });

    it('detects P2 speed advantage', () => {
      const p1 = [
        makePokemon({
          speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 80 } },
        }),
      ];
      const p2 = [
        makePokemon({
          speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 150 } },
        }),
      ];
      const result = analyzeWinConditions(p1, p2, 'Alice', 'Bob');
      const speedCond = result.find((c) => c.type === 'speed_advantage');
      expect(speedCond).toBeDefined();
      expect(speedCond?.player).toBe(2);
      expect(speedCond?.description).toContain('Bob');
    });

    it('does not detect speed advantage when difference <= 20', () => {
      const p1 = [
        makePokemon({
          speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 100 } },
        }),
      ];
      const p2 = [
        makePokemon({
          speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 110 } },
        }),
      ];
      const result = analyzeWinConditions(p1, p2, 'Alice', 'Bob');
      const speedCond = result.find((c) => c.type === 'speed_advantage');
      expect(speedCond).toBeUndefined();
    });

    it('uses 0 as fallback for empty speed arrays', () => {
      const result = analyzeWinConditions([], [], 'Alice', 'Bob');
      const speedCond = result.find((c) => c.type === 'speed_advantage');
      // Both maxSpeeds = 0, difference = 0, no advantage
      expect(speedCond).toBeUndefined();
    });
  });

  describe('no_answer detection', () => {
    it('detects when a single pokemon is the only answer to a threat', () => {
      // Fire threat against a team with only one Water type
      const fireThreat = makePokemon({
        species: 'Charizard',
        types: ['Fire', 'Flying'],
        baseStats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 },
      });
      const waterCheck = makePokemon({
        species: 'Blastoise',
        types: ['Water'],
        baseStats: { hp: 79, atk: 83, def: 100, spa: 85, spd: 105, spe: 78 },
      });
      const grassMon = makePokemon({
        species: 'Venusaur',
        types: ['Grass', 'Poison'],
        baseStats: { hp: 80, atk: 82, def: 83, spa: 100, spd: 100, spe: 80 },
      });

      // P1 has Charizard; P2 has Blastoise and Venusaur
      // Venusaur: Fire -> Grass/Poison = 2*0.5 = 1 (neutral), and Grass -> Fire = 0.5, Poison -> Fire = 1
      //   Venusaur doesn't resist Fire (eff = 1) and doesn't threaten back (best STAB = 1)
      // Blastoise: Fire -> Water = 0.5 (resists), Water -> Fire = 2 (threatens)
      //   Blastoise qualifies as the only check
      const result = analyzeWinConditions([fireThreat], [waterCheck, grassMon], 'Alice', 'Bob');
      const noAnswer = result.filter((c) => c.type === 'no_answer');
      // Should find that if Blastoise goes down, Bob has no answer to Charizard
      expect(noAnswer.length).toBeGreaterThanOrEqual(1);
      const charizardCondition = noAnswer.find((c) => c.description.includes('Charizard'));
      if (charizardCondition) {
        expect(charizardCondition.description).toContain('Blastoise');
        expect(charizardCondition.importance).toBe(5);
      }
    });

    it('does not flag no_answer when multiple checks exist', () => {
      // Two water types against a fire type
      const fireThreat = makePokemon({ species: 'Charizard', types: ['Fire'] });
      const water1 = makePokemon({ species: 'Blastoise', types: ['Water'] });
      const water2 = makePokemon({ species: 'Vaporeon', types: ['Water'] });

      const result = analyzeWinConditions([fireThreat], [water1, water2], 'Alice', 'Bob');
      const noAnswer = result.filter(
        (c) => c.type === 'no_answer' && c.description.includes('Charizard'),
      );
      // Both waters resist fire and threaten it => 2 checks, not flagged
      expect(noAnswer).toHaveLength(0);
    });

    it('does not flag no_answer when zero checks exist', () => {
      // No checks at all means 0 checks, not 1
      const fireThreat = makePokemon({ species: 'Charizard', types: ['Fire'] });
      const normalMon = makePokemon({ species: 'Snorlax', types: ['Normal'] });

      const result = analyzeWinConditions([fireThreat], [normalMon], 'Alice', 'Bob');
      const noAnswer = result.filter(
        (c) => c.type === 'no_answer' && c.description.includes('Charizard'),
      );
      // 0 checks != 1 check, so not flagged
      expect(noAnswer).toHaveLength(0);
    });
  });

  describe('defensive core detection', () => {
    it('detects defensive core when 2+ pokemon have bulky stats', () => {
      const bulky1 = makePokemon({
        species: 'Blissey',
        types: ['Normal'],
        baseStats: { hp: 255, atk: 10, def: 10, spa: 75, spd: 135, spe: 55 },
        // HP+DEF+SPD = 255+10+135 = 400 > 300
      });
      const _bulky2 = makePokemon({
        species: 'Skarmory',
        types: ['Steel', 'Flying'],
        baseStats: { hp: 65, atk: 80, def: 140, spa: 40, spd: 70, spe: 70 },
        // HP+DEF+SPD = 65+140+70 = 275 < 300 -- this is close
      });
      const _bulky3 = makePokemon({
        species: 'Slowbro',
        types: ['Water', 'Psychic'],
        baseStats: { hp: 95, atk: 75, def: 110, spa: 100, spd: 80, spe: 30 },
        // HP+DEF+SPD = 95+110+80 = 285 < 300
      });
      // Only Blissey qualifies (> 300). Need two bulky mons for a core.
      // Let's make a team with two that qualify:
      const realBulky = makePokemon({
        species: 'Toxapex',
        types: ['Poison', 'Water'],
        baseStats: { hp: 50, atk: 63, def: 152, spa: 53, spd: 142, spe: 35 },
        // HP+DEF+SPD = 50+152+142 = 344 > 300
      });

      const result = analyzeWinConditions([bulky1, realBulky], [], 'Alice', 'Bob');
      const core = result.find((c) => c.player === 1 && c.type === 'defensive_core');
      expect(core).toBeDefined();
      expect(core?.description).toContain('Alice');
      // The two bulkiest should be listed, sorted by total bulk desc
      // Blissey: 400, Toxapex: 344
      expect(core?.description).toContain('Blissey');
      expect(core?.description).toContain('Toxapex');
      expect(core?.importance).toBe(2);
    });

    it('does not detect defensive core with fewer than 2 bulky mons', () => {
      const bulky = makePokemon({
        species: 'Blissey',
        baseStats: { hp: 255, atk: 10, def: 10, spa: 75, spd: 135, spe: 55 },
      });
      const frail = makePokemon({
        species: 'Jolteon',
        baseStats: { hp: 65, atk: 65, def: 60, spa: 110, spd: 95, spe: 130 },
        // HP+DEF+SPD = 65+60+95 = 220 < 300
      });
      const result = analyzeWinConditions([bulky, frail], [], 'Alice', 'Bob');
      const core = result.find((c) => c.player === 1 && c.type === 'defensive_core');
      expect(core).toBeUndefined();
    });
  });

  describe('sorting and importance', () => {
    it('sorts conditions by importance descending', () => {
      // Create a team that triggers multiple conditions
      const p1 = [
        makePokemon({
          species: 'Mewtwo',
          types: ['Psychic'],
          baseStats: { hp: 106, atk: 110, def: 90, spa: 154, spd: 90, spe: 130 },
          speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 200 } },
        }),
      ];
      const p2 = [
        makePokemon({
          species: 'Rattata',
          types: ['Normal'],
          baseStats: { hp: 30, atk: 56, def: 35, spa: 25, spd: 35, spe: 72 },
          speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 72 } },
        }),
      ];
      const result = analyzeWinConditions(p1, p2, 'Alice', 'Bob');
      for (let i = 1; i < result.length; i++) {
        expect(result[i].importance).toBeLessThanOrEqual(result[i - 1].importance);
      }
    });

    it('sweeper importance is 3', () => {
      const p1 = [makePokemon()];
      const result = analyzeWinConditions(p1, [], 'Alice', 'Bob');
      const sweeper = result.find((c) => c.type === 'sweeper');
      expect(sweeper?.importance).toBe(3);
    });

    it('speed_advantage importance is 3', () => {
      const p1 = [
        makePokemon({
          speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 200 } },
        }),
      ];
      const p2 = [
        makePokemon({
          speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 80 } },
        }),
      ];
      const result = analyzeWinConditions(p1, p2, 'Alice', 'Bob');
      const speed = result.find((c) => c.type === 'speed_advantage');
      expect(speed?.importance).toBe(3);
    });
  });

  it('returns empty array for empty teams', () => {
    const result = analyzeWinConditions([], [], 'Alice', 'Bob');
    expect(result).toEqual([]);
  });
});

// ── i18n (T15) ────────────────────────────────────────────────────────

describe('analyzeWinConditions i18n (T15)', () => {
  const mewtwo = makePokemon({
    species: 'Mewtwo',
    baseStats: { hp: 106, atk: 110, def: 90, spa: 154, spd: 90, spe: 130 },
  });
  const charizard = makePokemon({
    species: 'Charizard',
    baseStats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 },
  });

  it('keeps the English description by default', () => {
    const result = analyzeWinConditions([mewtwo], [charizard], 'Alice', 'Bob');
    const p1Sweeper = result.find((c) => c.type === 'sweeper' && c.player === 1);
    expect(p1Sweeper?.description).toBe("Mewtwo is Alice's primary sweeper threat");
  });

  it('writes German descriptions with German Pokémon names', () => {
    const result = analyzeWinConditions([mewtwo], [charizard], 'Alice', 'Bob', 'de');
    const p1Sweeper = result.find((c) => c.type === 'sweeper' && c.player === 1);
    const p2Sweeper = result.find((c) => c.type === 'sweeper' && c.player === 2);
    expect(p1Sweeper?.description).toBe('Mewtu ist der gefährlichste Sweeper von Alice');
    expect(p2Sweeper?.description).toBe('Glurak ist der gefährlichste Sweeper von Bob');
  });

  it('uses the data locale for names independently of the text locale', () => {
    const result = analyzeWinConditions([mewtwo], [charizard], 'Alice', 'Bob', 'de', 'en');
    const p1Sweeper = result.find((c) => c.type === 'sweeper' && c.player === 1);
    expect(p1Sweeper?.description).toBe('Mewtwo ist der gefährlichste Sweeper von Alice');
  });

  it('localizes the speed-advantage sentence', () => {
    const fast = makePokemon({ species: 'Fast', speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 200 } } });
    const slow = makePokemon({ species: 'Slow', speedTiers: { ...baseSpeedTier, max: { ...baseSpeedTier.max, raw: 100 } } });
    const result = analyzeWinConditions([fast], [slow], 'Alice', 'Bob', 'de');
    const speed = result.find((c) => c.type === 'speed_advantage');
    expect(speed?.description).toBe('Alice hat den Speed-Vorteil (Schnellstes: 200 vs. 100)');
  });
});
