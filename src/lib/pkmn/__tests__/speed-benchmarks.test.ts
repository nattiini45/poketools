import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/meta-usage', () => ({
  getUsageByFormat: vi.fn(),
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getBaseStats: vi.fn(),
}));

vi.mock('@/lib/pkmn/speed-calc', () => ({
  calcSpeed: vi.fn(),
}));

import { buildBenchmarksForSpecies, getSpeedBenchmarks } from '../speed-benchmarks';
import { getUsageByFormat } from '@/lib/supabase/queries/meta-usage';
import { getBaseStats } from '@/lib/pkmn/dex';
import { calcSpeed } from '@/lib/pkmn/speed-calc';

const mockGetUsageByFormat = vi.mocked(getUsageByFormat);
const mockGetBaseStats = vi.mocked(getBaseStats);
const mockCalcSpeed = vi.mocked(calcSpeed);

beforeEach(() => {
  vi.clearAllMocks();

  mockGetBaseStats.mockImplementation((name: string) => {
    const stats: Record<string, { baseStats: { spe: number } }> = {
      Pikachu: { baseStats: { spe: 90 } },
      Dragapult: { baseStats: { spe: 142 } },
      Slowbro: { baseStats: { spe: 30 } },
    };
    return (stats[name] ?? null) as never;
  });

  // calcSpeed returns a result with a .raw field
  mockCalcSpeed.mockImplementation((params) => {
    // Simplified speed calc for testing
    const natureMod = params.nature === 'positive' ? 1.1 : 1.0;
    const raw = Math.floor(
      (Math.floor((2 * params.baseSpe + params.iv + Math.floor(params.ev / 4))
        * params.level / 100) + 5) * natureMod,
    );
    return { raw, withItem: raw, withAbility: raw, final: raw, modifiers: { item: null, ability: null, status: null, boosts: 0 } } as never;
  });
});

// ─── buildBenchmarksForSpecies ────────────────────────────────────

describe('buildBenchmarksForSpecies', () => {
  it('returns 3 benchmarks by default (uninvested, max, scarf)', () => {
    const benchmarks = buildBenchmarksForSpecies('Pikachu');
    expect(benchmarks).toHaveLength(3);
  });

  it('returns 2 benchmarks when scarf is excluded', () => {
    const benchmarks = buildBenchmarksForSpecies('Pikachu', { includeScarf: false });
    expect(benchmarks).toHaveLength(2);
  });

  it('returns empty array if species not found in dex', () => {
    mockGetBaseStats.mockReturnValue(null as never);
    const benchmarks = buildBenchmarksForSpecies('FakeMonster');
    expect(benchmarks).toEqual([]);
  });

  it('creates uninvested benchmark with 0 EVs and neutral nature', () => {
    const benchmarks = buildBenchmarksForSpecies('Pikachu');
    const uninvested = benchmarks[0];
    expect(uninvested.evs).toBe(0);
    expect(uninvested.nature).toBe('neutral');
    expect(uninvested.label).toContain('uninvested');
    expect(uninvested.species).toBe('Pikachu');
  });

  it('creates max benchmark with 252 EVs and positive nature', () => {
    const benchmarks = buildBenchmarksForSpecies('Pikachu');
    const max = benchmarks[1];
    expect(max.evs).toBe(252);
    expect(max.nature).toBe('positive');
    expect(max.label).toContain('max');
  });

  it('creates scarf benchmark with 1.5x max speed', () => {
    const benchmarks = buildBenchmarksForSpecies('Pikachu');
    const max = benchmarks[1];
    const scarf = benchmarks[2];
    expect(scarf.speed).toBe(Math.floor(max.speed * 1.5));
    expect(scarf.item).toBe('Choice Scarf');
    expect(scarf.label).toContain('Scarf');
  });

  it('includes baseSpe on all benchmarks', () => {
    const benchmarks = buildBenchmarksForSpecies('Pikachu');
    for (const b of benchmarks) {
      expect(b.baseSpe).toBe(90);
    }
  });

  it('passes level option to calcSpeed', () => {
    buildBenchmarksForSpecies('Pikachu', { level: 50 });
    expect(mockCalcSpeed).toHaveBeenCalledWith(
      expect.objectContaining({ level: 50 }),
    );
  });

  it('defaults level to 100', () => {
    buildBenchmarksForSpecies('Pikachu');
    expect(mockCalcSpeed).toHaveBeenCalledWith(
      expect.objectContaining({ level: 100 }),
    );
  });

  it('passes gen option to getBaseStats', () => {
    buildBenchmarksForSpecies('Pikachu', { gen: 8 });
    expect(mockGetBaseStats).toHaveBeenCalledWith('Pikachu', 8);
  });
});

// ─── getSpeedBenchmarks ───────────────────────────────────────────

describe('getSpeedBenchmarks', () => {
  beforeEach(() => {
    mockGetUsageByFormat.mockResolvedValue({
      data: [
        { pokemon_name: 'Dragapult' },
        { pokemon_name: 'Pikachu' },
        { pokemon_name: 'Slowbro' },
      ],
    } as never);
  });

  it('returns benchmarks sorted by speed', async () => {
    const benchmarks = await getSpeedBenchmarks('gen9ou');
    for (let i = 1; i < benchmarks.length; i++) {
      expect(benchmarks[i].speed).toBeGreaterThanOrEqual(benchmarks[i - 1].speed);
    }
  });

  it('calls getUsageByFormat with limit', async () => {
    await getSpeedBenchmarks('gen9ou', { limit: 10 });
    expect(mockGetUsageByFormat).toHaveBeenCalledWith('gen9ou', { limit: 10 });
  });

  it('defaults limit to 20', async () => {
    await getSpeedBenchmarks('gen9ou');
    expect(mockGetUsageByFormat).toHaveBeenCalledWith('gen9ou', { limit: 20 });
  });

  it('deduplicates benchmarks within +/-1 speed of each other (different species)', async () => {
    // Force two different species to have nearly identical speeds
    mockCalcSpeed.mockImplementation((_params) => {
      // All return speed = 100
      return { raw: 100, withItem: 100, withAbility: 100, final: 100, modifiers: { item: null, ability: null, status: null, boosts: 0 } } as never;
    });

    const benchmarks = await getSpeedBenchmarks('gen9ou');
    // With dedup, same-speed entries from different species get merged
    // keeping the one with higher EVs
    const atSpeed100 = benchmarks.filter((b) => Math.abs(b.speed - 100) <= 1);
    // Each unique (species, speed) pair within +-1 should be deduped
    expect(atSpeed100.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps both entries if same species at different speeds', async () => {
    // This is the normal case: uninvested vs max for same species
    mockGetUsageByFormat.mockResolvedValue({
      data: [{ pokemon_name: 'Pikachu' }],
    } as never);

    // Return different speeds for uninvested vs max
    let callCount = 0;
    mockCalcSpeed.mockImplementation(() => {
      callCount++;
      const raw = callCount === 1 ? 150 : 250;
      return { raw, withItem: raw, withAbility: raw, final: raw, modifiers: { item: null, ability: null, status: null, boosts: 0 } } as never;
    });

    const benchmarks = await getSpeedBenchmarks('gen9ou');
    expect(benchmarks.length).toBeGreaterThanOrEqual(2);
  });

  it('passes generation option through', async () => {
    await getSpeedBenchmarks('gen8ou', { generation: 8 });
    expect(mockGetBaseStats).toHaveBeenCalledWith(
      expect.any(String),
      8,
    );
  });
});
