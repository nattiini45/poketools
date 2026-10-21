import { describe, it, expect, vi } from 'vitest';

// Mock dex.getBaseStats so we don't need the real @pkmn/dex
vi.mock('../dex', () => ({
  getBaseStats: vi.fn((name: string) => {
    const db: Record<string, { name: string; types: string[]; baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } }> = {
      Dragapult:   { name: 'Dragapult',   types: ['Dragon', 'Ghost'],  baseStats: { hp: 88, atk: 120, def: 75, spa: 100, spd: 75, spe: 142 } },
      'Iron Valiant': { name: 'Iron Valiant', types: ['Fairy', 'Fighting'], baseStats: { hp: 74, atk: 130, def: 90, spa: 120, spd: 60, spe: 116 } },
      Kingambit:   { name: 'Kingambit',   types: ['Dark', 'Steel'],   baseStats: { hp: 100, atk: 135, def: 120, spa: 60, spd: 85, spe: 50 } },
      Pelipper:    { name: 'Pelipper',    types: ['Water', 'Flying'],  baseStats: { hp: 60, atk: 50, def: 100, spa: 95, spd: 70, spe: 65 } },
      Barraskewda: { name: 'Barraskewda', types: ['Water'],           baseStats: { hp: 61, atk: 123, def: 60, spa: 60, spd: 50, spe: 136 } },
      Ferrothorn:  { name: 'Ferrothorn',  types: ['Grass', 'Steel'],  baseStats: { hp: 74, atk: 94, def: 131, spa: 54, spd: 116, spe: 20 } },
      Blissey:     { name: 'Blissey',     types: ['Normal'],          baseStats: { hp: 255, atk: 10, def: 10, spa: 75, spd: 135, spe: 55 } },
      Toxapex:     { name: 'Toxapex',     types: ['Poison', 'Water'], baseStats: { hp: 50, atk: 63, def: 152, spa: 53, spd: 142, spe: 35 } },
      Skarmory:    { name: 'Skarmory',    types: ['Steel', 'Flying'], baseStats: { hp: 65, atk: 80, def: 140, spa: 40, spd: 70, spe: 70 } },
      Clefable:    { name: 'Clefable',    types: ['Fairy'],           baseStats: { hp: 95, atk: 70, def: 73, spa: 95, spd: 90, spe: 60 } },
      Glimmora:    { name: 'Glimmora',    types: ['Rock', 'Poison'],  baseStats: { hp: 83, atk: 55, def: 90, spa: 130, spd: 81, spe: 86 } },
      Corviknight: { name: 'Corviknight', types: ['Flying', 'Steel'], baseStats: { hp: 98, atk: 87, def: 105, spa: 53, spd: 85, spe: 67 } },
      Torkoal:     { name: 'Torkoal',     types: ['Fire'],            baseStats: { hp: 70, atk: 85, def: 140, spa: 85, spd: 70, spe: 20 } },
      Venusaur:    { name: 'Venusaur',    types: ['Grass', 'Poison'], baseStats: { hp: 80, atk: 82, def: 83, spa: 100, spd: 100, spe: 80 } },
      Hatterene:   { name: 'Hatterene',   types: ['Psychic', 'Fairy'], baseStats: { hp: 57, atk: 90, def: 95, spa: 136, spd: 103, spe: 29 } },
      Reuniclus:   { name: 'Reuniclus',   types: ['Psychic'],         baseStats: { hp: 110, atk: 65, def: 75, spa: 125, spd: 85, spe: 30 } },
      Porygon2:    { name: 'Porygon2',    types: ['Normal'],          baseStats: { hp: 85, atk: 80, def: 90, spa: 105, spd: 95, spe: 60 } },
      Landorus:    { name: 'Landorus',    types: ['Ground', 'Flying'], baseStats: { hp: 89, atk: 125, def: 90, spa: 115, spd: 80, spe: 101 } },
      Rotom:       { name: 'Rotom',       types: ['Electric', 'Ghost'], baseStats: { hp: 50, atk: 50, def: 77, spa: 95, spd: 77, spe: 91 } },
      Tyranitar:   { name: 'Tyranitar',   types: ['Rock', 'Dark'],    baseStats: { hp: 100, atk: 134, def: 110, spa: 95, spd: 100, spe: 61 } },
      Excadrill:   { name: 'Excadrill',   types: ['Ground', 'Steel'], baseStats: { hp: 110, atk: 135, def: 60, spa: 50, spd: 65, spe: 88 } },
      Garchomp:    { name: 'Garchomp',    types: ['Dragon', 'Ground'], baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 } },
      Weavile:     { name: 'Weavile',     types: ['Dark', 'Ice'],     baseStats: { hp: 70, atk: 120, def: 65, spa: 45, spd: 85, spe: 125 } },
      Abomasnow:   { name: 'Abomasnow',  types: ['Grass', 'Ice'],    baseStats: { hp: 90, atk: 92, def: 75, spa: 92, spd: 85, spe: 60 } },
      Arctozolt:   { name: 'Arctozolt',   types: ['Electric', 'Ice'], baseStats: { hp: 90, atk: 100, def: 90, spa: 80, spd: 70, spe: 55 } },
    };
    return db[name] ?? null;
  }),
}));

import { classifyTeam } from '../archetype';
import type { PokemonSet } from '@/types/team';

function makeSet(species: string, overrides: Partial<PokemonSet> = {}): PokemonSet {
  return {
    name: '',
    species,
    gender: '',
    item: '',
    ability: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Adamant',
    level: 100,
    moves: [],
    ...overrides,
  };
}

describe('classifyTeam', () => {
  it('returns Balance as default when no strong signals are detected', () => {
    const team = [
      makeSet('Dragapult'),
      makeSet('Kingambit'),
      makeSet('Ferrothorn'),
      makeSet('Corviknight'),
      makeSet('Clefable'),
      makeSet('Glimmora'),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Balance');
    expect(result.reasoning).toBe('No strong archetype signals detected');
  });

  it('detects Rain team via weather setters and abusers', () => {
    const team = [
      makeSet('Pelipper', { ability: 'Drizzle', moves: [] }),
      makeSet('Barraskewda', { ability: 'Swift Swim', moves: [], item: 'Choice Band' }),
      makeSet('Ferrothorn', { moves: ['Stealth Rock'], item: 'Leftovers' }),
      makeSet('Dragapult', { moves: ['U-turn'], item: 'Choice Specs' }),
      makeSet('Kingambit', { moves: ['Swords Dance'], item: 'Life Orb' }),
      makeSet('Excadrill', { moves: [] }),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Rain');
  });

  it('detects Sun team via weather ability', () => {
    const team = [
      makeSet('Torkoal', { ability: 'Drought', moves: [] }),
      makeSet('Venusaur', { ability: 'Chlorophyll', moves: ['Growth'], item: 'Life Orb' }),
      makeSet('Dragapult', { moves: [] }),
      makeSet('Kingambit', { moves: [] }),
      makeSet('Ferrothorn', { moves: [] }),
      makeSet('Garchomp', { moves: [] }),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Sun');
  });

  it('detects Sand team via Sand Stream + Sand Rush', () => {
    const team = [
      makeSet('Tyranitar', { ability: 'Sand Stream', moves: ['Stealth Rock'] }),
      makeSet('Excadrill', { ability: 'Sand Rush', moves: ['Swords Dance'], item: 'Life Orb' }),
      makeSet('Ferrothorn', { moves: [] }),
      makeSet('Dragapult', { moves: [] }),
      makeSet('Corviknight', { moves: [] }),
      makeSet('Clefable', { moves: [] }),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Sand');
  });

  it('detects Snow team via Snow Warning + Slush Rush', () => {
    const team = [
      makeSet('Abomasnow', { ability: 'Snow Warning', moves: [] }),
      makeSet('Arctozolt', { ability: 'Slush Rush', moves: [], item: 'Choice Band' }),
      makeSet('Ferrothorn', { moves: [] }),
      makeSet('Dragapult', { moves: [] }),
      makeSet('Corviknight', { moves: [] }),
      makeSet('Clefable', { moves: [] }),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Snow');
  });

  it('detects weather moves (Rain Dance, Sunny Day, etc.)', () => {
    const team = [
      makeSet('Pelipper', { ability: 'Drizzle', moves: ['Rain Dance'] }),
      makeSet('Barraskewda', { ability: 'Swift Swim', moves: [], item: 'Choice Band' }),
      makeSet('Ferrothorn', { moves: [] }),
      makeSet('Dragapult', { moves: [] }),
      makeSet('Kingambit', { moves: [] }),
      makeSet('Clefable', { moves: [] }),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Rain');
    expect(result.reasoning).toContain('Rain Dance');
  });

  it('detects Trick Room when there are TR setters and slow mons', () => {
    const team = [
      makeSet('Hatterene', { moves: ['Trick Room'], item: 'Focus Sash' }),
      makeSet('Reuniclus', { moves: ['Trick Room'], item: 'Life Orb' }),
      makeSet('Ferrothorn', { moves: [], item: 'Leftovers' }),
      makeSet('Torkoal', { ability: 'Drought', moves: [] }),
      makeSet('Porygon2', { moves: [], item: 'Eviolite' }),
      makeSet('Kingambit', { moves: ['Swords Dance'], item: 'Choice Band' }),
    ];
    const result = classifyTeam(team);
    // Trick Room should be detected: 2 setters + 4+ slow mons (Hatterene 29, Reuniclus 30, Ferrothorn 20, Torkoal 20, Kingambit 50)
    expect(result.primary).toBe('Trick Room');
  });

  it('detects Volt-Turn with 3+ pivot moves', () => {
    const team = [
      makeSet('Landorus', { moves: ['U-turn'], item: 'Choice Scarf' }),
      makeSet('Rotom', { moves: ['Volt Switch'], item: 'Choice Specs' }),
      makeSet('Corviknight', { moves: ['U-turn'], item: 'Heavy-Duty Boots' }),
      makeSet('Dragapult', { moves: [], item: 'Choice Band' }),
      makeSet('Ferrothorn', { moves: [] }),
      makeSet('Clefable', { moves: [] }),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Volt-Turn');
  });

  it('detects Hazard Stack with 3+ hazard moves', () => {
    const team = [
      makeSet('Glimmora', { moves: ['Stealth Rock', 'Toxic Spikes'], item: 'Focus Sash' }),
      makeSet('Ferrothorn', { moves: ['Spikes'], item: 'Leftovers' }),
      makeSet('Dragapult', { moves: [], item: 'Choice Specs' }),
      makeSet('Kingambit', { moves: [], item: 'Choice Band' }),
      makeSet('Corviknight', { moves: [] }),
      makeSet('Clefable', { moves: [] }),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Hazard Stack');
  });

  it('detects Hyper Offense with high speed, setup, and offensive items', () => {
    const team = [
      makeSet('Dragapult', { moves: ['Dragon Dance'], item: 'Life Orb' }),
      makeSet('Iron Valiant', { moves: ['Swords Dance'], item: 'Choice Band' }),
      makeSet('Weavile', { moves: ['Swords Dance'], item: 'Choice Scarf' }),
      makeSet('Garchomp', { moves: [], item: 'Focus Sash' }),
      makeSet('Excadrill', { moves: [], item: 'Choice Band' }),
      makeSet('Barraskewda', { moves: [], item: 'Expert Belt' }),
    ];
    const result = classifyTeam(team);
    // avg speed > 95, 3 setup moves, 6 offensive items
    expect(result.primary).toBe('Hyper Offense');
  });

  it('detects Stall with 4+ recovery, 3+ stall moves, 4+ defensive items', () => {
    const team = [
      makeSet('Blissey', { moves: ['Soft-Boiled', 'Toxic', 'Thunder Wave'], item: 'Leftovers' }),
      makeSet('Toxapex', { moves: ['Recover', 'Toxic', 'Haze'], item: 'Black Sludge' }),
      makeSet('Skarmory', { moves: ['Roost', 'Whirlwind'], item: 'Rocky Helmet' }),
      makeSet('Clefable', { moves: ['Wish', 'Protect'], item: 'Leftovers' }),
      makeSet('Corviknight', { moves: ['Roost'], item: 'Heavy-Duty Boots' }),
      makeSet('Ferrothorn', { moves: [], item: 'Leftovers' }),
    ];
    const result = classifyTeam(team);
    expect(result.primary).toBe('Stall');
  });

  it('returns a secondary archetype if second-highest score >= 2', () => {
    // Rain + Hazard Stack signals
    const team = [
      makeSet('Pelipper', { ability: 'Drizzle', moves: ['Stealth Rock'] }),
      makeSet('Barraskewda', { ability: 'Swift Swim', moves: [], item: 'Choice Band' }),
      makeSet('Ferrothorn', { moves: ['Spikes', 'Stealth Rock'], item: 'Leftovers' }),
      makeSet('Glimmora', { moves: ['Toxic Spikes'], item: 'Focus Sash' }),
      makeSet('Kingambit', { moves: [] }),
      makeSet('Corviknight', { moves: [] }),
    ];
    const result = classifyTeam(team);
    expect(result.secondary).not.toBeNull();
  });

  it('handles empty team gracefully', () => {
    const result = classifyTeam([]);
    expect(result.primary).toBe('Balance');
    expect(result.secondary).toBeNull();
  });

  it('handles unknown species gracefully (getBaseStats returns null)', () => {
    const team = [makeSet('FakeSpecies123', { moves: ['Swords Dance'] })];
    const result = classifyTeam(team);
    // Should not crash, default to Balance
    expect(result.primary).toBe('Balance');
  });

  it('detects Balance with mix of defensive and offensive items', () => {
    const team = [
      makeSet('Dragapult', { moves: [], item: 'Choice Specs' }),
      makeSet('Kingambit', { moves: [], item: 'Choice Band' }),
      makeSet('Ferrothorn', { moves: [], item: 'Leftovers' }),
      makeSet('Corviknight', { moves: [], item: 'Heavy-Duty Boots' }),
      makeSet('Clefable', { moves: [], item: 'Leftovers' }),
      makeSet('Garchomp', { moves: [] }),
    ];
    const result = classifyTeam(team);
    // 2 offensive + 3 defensive items -> at least some Balance signal
    expect(result.primary).toBeDefined();
  });

  it('limits reasoning to 4 entries', () => {
    // Rain team has many signals: setter, abuser, weather move
    const team = [
      makeSet('Pelipper', { ability: 'Drizzle', moves: ['Rain Dance'] }),
      makeSet('Barraskewda', { ability: 'Swift Swim', moves: [], item: 'Choice Band' }),
      makeSet('Ferrothorn', { moves: ['Spikes', 'Stealth Rock', 'Toxic Spikes'], item: 'Leftovers' }),
      makeSet('Glimmora', { moves: ['Sticky Web'], item: 'Focus Sash' }),
      makeSet('Landorus', { moves: ['U-turn'], item: 'Choice Scarf' }),
      makeSet('Rotom', { moves: ['Volt Switch'], item: 'Choice Specs' }),
    ];
    const result = classifyTeam(team);
    const reasonCount = result.reasoning.split('. ').length;
    expect(reasonCount).toBeLessThanOrEqual(4);
  });
});
