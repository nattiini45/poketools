import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/meta-usage', () => ({
  getUsageByFormat: vi.fn(),
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getBaseStats: vi.fn(),
}));

vi.mock('@/lib/pkmn/spread-parser', () => ({
  getMostPopularSpread: vi.fn(),
}));

import { getThreatsForFormat } from '../threat-list';
import { getUsageByFormat } from '@/lib/supabase/queries/meta-usage';
import { getBaseStats } from '@/lib/pkmn/dex';
import { getMostPopularSpread } from '@/lib/pkmn/spread-parser';

const mockGetUsageByFormat = vi.mocked(getUsageByFormat);
const mockGetBaseStats = vi.mocked(getBaseStats);
const mockGetMostPopularSpread = vi.mocked(getMostPopularSpread);

function makeUsageRow(name: string, usagePct: number) {
  return {
    pokemon_name: name,
    usage_pct: usagePct,
    moves: { 'Thunderbolt': 80, 'Volt Switch': 60, 'Hidden Power Ice': 40, 'Roost': 30 },
    abilities: { 'Static': 70, 'Lightning Rod': 30 },
    items: { 'Light Ball': 90, 'Leftovers': 10 },
    spreads: { 'Timid:0/0/4/252/0/252': 50 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockGetUsageByFormat.mockResolvedValue({
    data: [
      makeUsageRow('Pikachu', 25.5),
      makeUsageRow('Charizard', 20.3),
      makeUsageRow('Blastoise', 15.1),
    ],
  } as never);

  mockGetBaseStats.mockImplementation((name: string) => {
    const statsMap: Record<string, { baseStats: Record<string, number>; types: string[] }> = {
      Pikachu: { baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 }, types: ['Electric'] },
      Charizard: { baseStats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, types: ['Fire', 'Flying'] },
      Blastoise: { baseStats: { hp: 79, atk: 83, def: 100, spa: 85, spd: 105, spe: 78 }, types: ['Water'] },
    };
    return (statsMap[name] ?? null) as never;
  });

  mockGetMostPopularSpread.mockReturnValue({
    nature: 'Timid',
    evs: { hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252 },
  } as never);
});

// ─── Tests ────────────────────────────────────────────────────────

describe('getThreatsForFormat', () => {
  it('returns threat entries with species, usage, default_set, and types', async () => {
    const threats = await getThreatsForFormat('gen9ou');
    expect(threats.length).toBeGreaterThan(0);

    const first = threats[0];
    expect(first).toHaveProperty('species');
    expect(first).toHaveProperty('usage_pct');
    expect(first).toHaveProperty('default_set');
    expect(first).toHaveProperty('types');
  });

  it('includes correct species data', async () => {
    const threats = await getThreatsForFormat('gen9ou');
    const pikachu = threats.find((t) => t.species === 'Pikachu');
    expect(pikachu).toBeDefined();
    expect(pikachu!.usage_pct).toBe(25.5);
    expect(pikachu!.types).toEqual(['Electric']);
  });

  it('populates default_set with top moves, ability, item', async () => {
    const threats = await getThreatsForFormat('gen9ou');
    const first = threats[0];
    expect(first.default_set.species).toBe('Pikachu');
    expect(first.default_set.moves).toHaveLength(4);
    expect(first.default_set.ability).toBe('Static');
    expect(first.default_set.item).toBe('Light Ball');
    expect(first.default_set.level).toBe(100);
  });

  it('populates default_set nature and evs from spread', async () => {
    const threats = await getThreatsForFormat('gen9ou');
    const first = threats[0];
    expect(first.default_set.nature).toBe('Timid');
    expect(first.default_set.evs).toEqual({
      hp: 0, atk: 0, def: 4, spa: 252, spd: 0, spe: 252,
    });
  });

  it('defaults limit to 12', async () => {
    mockGetUsageByFormat.mockResolvedValue({
      data: Array.from({ length: 25 }, (_, i) => makeUsageRow(`Pokemon${i}`, 50 - i)),
    } as never);
    mockGetBaseStats.mockReturnValue({
      baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 },
      types: ['Normal'],
    } as never);

    const threats = await getThreatsForFormat('gen9ou');
    expect(threats.length).toBeLessThanOrEqual(12);
  });

  it('respects custom limit option', async () => {
    const threats = await getThreatsForFormat('gen9ou', { limit: 2 });
    expect(threats.length).toBeLessThanOrEqual(2);
  });

  it('excludes species in excludeSpecies (case-insensitive)', async () => {
    const threats = await getThreatsForFormat('gen9ou', {
      excludeSpecies: ['pikachu'],
    });
    const pikachu = threats.find((t) => t.species === 'Pikachu');
    expect(pikachu).toBeUndefined();
  });

  it('skips species not found in getBaseStats', async () => {
    mockGetBaseStats.mockImplementation((name: string) => {
      if (name === 'Pikachu') return null as never;
      return {
        baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 },
        types: ['Normal'],
      } as never;
    });

    const threats = await getThreatsForFormat('gen9ou');
    const pikachu = threats.find((t) => t.species === 'Pikachu');
    expect(pikachu).toBeUndefined();
  });

  it('calls getUsageByFormat with limit + 10 buffer', async () => {
    await getThreatsForFormat('gen9ou', { limit: 5 });
    expect(mockGetUsageByFormat).toHaveBeenCalledWith('gen9ou', { limit: 15 });
  });

  it('handles multi-type Pokemon', async () => {
    const threats = await getThreatsForFormat('gen9ou');
    const charizard = threats.find((t) => t.species === 'Charizard');
    expect(charizard?.types).toEqual(['Fire', 'Flying']);
  });
});
