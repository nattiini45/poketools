import { describe, expect, it } from 'vitest';
import {
  entryTypes,
  habitatAccepts,
  HABITAT_TYPES,
  HABITATS,
  hasTypeData,
  normalizeType,
  POKEMON_TYPES,
  type PokemonType,
} from '../habitat-types';
import { ATTACK_TYPES, normalizeAttackType } from '../attack-moves';

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const T = (i: number): PokemonType => POKEMON_TYPES[i];
const idx = (t: PokemonType) => POKEMON_TYPES.indexOf(t);

describe('habitat-types: the one type vocabulary', () => {
  it('has 18 unique lower-case types', () => {
    expect(POKEMON_TYPES).toHaveLength(18);
    expect(new Set(POKEMON_TYPES).size).toBe(18);
    for (const t of POKEMON_TYPES) expect(t).toBe(t.toLowerCase());
  });

  it('normalizeType round-trips every spelling and returns null (not normal) for unknown or absent', () => {
    for (const t of POKEMON_TYPES) {
      expect(normalizeType(t)).toBe(t);
      expect(normalizeType(cap(t))).toBe(t);
      expect(normalizeType(` ${t.toUpperCase()} `)).toBe(t);
    }
    expect(normalizeType('Stellar')).toBeNull();
    expect(normalizeType('')).toBeNull();
    expect(normalizeType(undefined)).toBeNull();
    expect(normalizeType(null)).toBeNull();
  });

  it('attack-moves shares the tuple (same object, same order): the refactor is runtime-neutral', () => {
    expect(ATTACK_TYPES).toBe(POKEMON_TYPES);
    expect(normalizeAttackType('Stellar')).toBe(POKEMON_TYPES[0]);
    for (const t of POKEMON_TYPES) expect(normalizeAttackType(cap(t))).toBe(t);
  });

  it('entryTypes: baked types first, else the primary, else nothing; deduped, unknowns dropped', () => {
    expect(entryTypes({ primaryType: cap(T(2)), types: [cap(T(2)), cap(T(17))] })).toEqual([T(2), T(17)]);
    expect(entryTypes({ primaryType: cap(T(2)) })).toEqual([T(2)]);
    expect(entryTypes({ primaryType: cap(T(2)), types: [] })).toEqual([T(2)]);
    expect(entryTypes({ types: [cap(T(1)), 'Nonsense', cap(T(1))] })).toEqual([T(1)]);
    expect(entryTypes({})).toEqual([]);
    expect(hasTypeData({})).toBe(false);
    expect(hasTypeData({ primaryType: cap(T(0)) })).toBe(true);
  });
});

describe('HABITAT_TYPES', () => {
  it('is exhaustive over HABITATS, with a note and only known types per row', () => {
    expect(Object.keys(HABITAT_TYPES).sort()).toEqual([...HABITATS].sort());
    for (const id of HABITATS) {
      const rule = HABITAT_TYPES[id];
      expect(rule.note.length).toBeGreaterThan(5);
      expect(rule.primary.length).toBeGreaterThan(0);
      for (const list of [rule.primary, rule.anyType ?? [], rule.reject ?? [], rule.primaryWithoutTypes ?? []]) {
        for (const t of list) expect(POKEMON_TYPES).toContain(t);
      }
    }
  });

  it('habitat ids are not type words (lint-safe)', () => {
    for (const id of HABITATS) expect(normalizeType(id)).toBeNull();
  });

  it('street accepts any typed entry and nothing untyped', () => {
    for (const t of POKEMON_TYPES) expect(habitatAccepts('street', { primaryType: cap(t) })).toBe(true);
    expect(habitatAccepts('street', {})).toBe(false);
  });

  it('every habitat rejects an entry with no type data (fail closed)', () => {
    for (const id of HABITATS) expect(habitatAccepts(id, {})).toBe(false);
  });

  it('air: flying by either type with types baked; the disclosed over-inclusive primary fallback without', () => {
    const flying = HABITAT_TYPES.air.anyType![0];
    const fallbackOnly = HABITAT_TYPES.air.primaryWithoutTypes!.find((t) => !HABITAT_TYPES.air.primary.includes(t))!;
    expect(fallbackOnly).toBeDefined();
    // Secondary flying with types baked: accepted.
    expect(habitatAccepts('air', { primaryType: cap(T(1)), types: [cap(T(1)), cap(flying)] })).toBe(true);
    // The same figure on a primary-only manifest: not accepted (primary is not flying or the fallback).
    expect(habitatAccepts('air', { primaryType: cap(T(1)) })).toBe(false);
    // The fallback admits its extra primary only while types are absent.
    expect(habitatAccepts('air', { primaryType: cap(fallbackOnly) })).toBe(true);
    expect(habitatAccepts('air', { primaryType: cap(fallbackOnly), types: [cap(fallbackOnly), cap(T(5))] })).toBe(false);
  });

  it('snow: ice by either type once types are baked', () => {
    const ice = HABITAT_TYPES.snow.anyType![0];
    const other = T(idx(ice) === 14 ? 13 : 14);
    expect(habitatAccepts('snow', { primaryType: cap(other), types: [cap(other), cap(ice)] })).toBe(true);
    expect(habitatAccepts('snow', { primaryType: cap(other) })).toBe(false);
    expect(habitatAccepts('snow', { primaryType: cap(ice) })).toBe(true);
  });

  it('sky-isle: its reject list wins over an accepted type', () => {
    const rule = HABITAT_TYPES['sky-isle'];
    const accepted = rule.primary[0];
    const rejected = rule.reject![0];
    expect(habitatAccepts('sky-isle', { primaryType: cap(accepted), types: [cap(accepted)] })).toBe(true);
    expect(habitatAccepts('sky-isle', { primaryType: cap(rejected), types: [cap(rejected), cap(accepted)] })).toBe(false);
    expect(habitatAccepts('sky-isle', { primaryType: cap(accepted), types: [cap(accepted), cap(rejected)] })).toBe(false);
  });

  it('aquatic takes the primary only (a secondary match does not float)', () => {
    const water = HABITAT_TYPES.aquatic.primary[0];
    expect(habitatAccepts('aquatic', { primaryType: cap(water) })).toBe(true);
    expect(habitatAccepts('aquatic', { primaryType: cap(T(0)), types: [cap(T(0)), cap(water)] })).toBe(false);
  });
});
