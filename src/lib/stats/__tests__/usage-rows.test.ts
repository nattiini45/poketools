import { describe, it, expect } from 'vitest';
import { aggregatesToUsageRows, metaUsageToUsageRows } from '../usage-rows';
import type { Aggregate } from '@/types/game';
import type { MetaUsageRow } from '@/types/usage';
import { metaUsageFraction } from '@/lib/supabase/queries/meta-usage';

function makeAggregate(overrides: Partial<Aggregate> = {}): Aggregate {
  return {
    id: 'agg-1',
    scope_type: 'all_time',
    scope_id: null,
    pokemon_name: 'Garchomp',
    total_appearances: 10,
    total_brought: 10,
    total_led: 0,
    total_kos_dealt: 15,
    total_koed: 5,
    total_wins: 7,
    total_games: 12,
    move_counts: {},
    last_updated: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('aggregatesToUsageRows', () => {
  it('derives efficiency from total_kos_dealt / total_brought', () => {
    const [row] = aggregatesToUsageRows([makeAggregate({ total_kos_dealt: 15, total_brought: 10 })], 12);
    expect(row.efficiency).toBeCloseTo(1.5, 5);
  });

  it('returns efficiency = null when total_brought is 0 (Pokémon was never sent out)', () => {
    const [row] = aggregatesToUsageRows([makeAggregate({ total_kos_dealt: 0, total_brought: 0 })], 12);
    expect(row.efficiency).toBeNull();
  });

  it('handles zero KOs with non-zero brought (efficiency = 0, not null)', () => {
    const [row] = aggregatesToUsageRows([makeAggregate({ total_kos_dealt: 0, total_brought: 5 })], 12);
    expect(row.efficiency).toBe(0);
  });
});

describe('metaUsageFraction', () => {
  it('converts 0–100 Smogon percentages including sub-1% values', () => {
    expect(metaUsageFraction(25.5)).toBeCloseTo(0.255);
    expect(metaUsageFraction(0.5)).toBeCloseTo(0.005);
    expect(metaUsageFraction(1)).toBeCloseTo(0.01);
  });
});

describe('metaUsageToUsageRows', () => {
  it('converts normalized meta fractions to usage_percent', () => {
    const row: MetaUsageRow = {
      id: '1',
      format: 'gen9ou',
      pokemon_name: 'Garchomp',
      usage_pct: 0.25,
      lead_pct: 0.1,
      moves: {},
      items: {},
      abilities: {},
      teammates: {},
      spreads: {},
      tera_types: null,
      counters: null,
      viability: null,
      last_imported: '2025-01-01T00:00:00Z',
    };
    const [out] = metaUsageToUsageRows([row]);
    expect(out.usage_percent).toBe(25);
    expect(out.lead_rate).toBe(10);
  });

  it('preserves sub-1% usage after read-time normalization', () => {
    const row: MetaUsageRow = {
      id: '1',
      format: 'gen9ou',
      pokemon_name: 'Dugtrio',
      usage_pct: metaUsageFraction(0.5),
      lead_pct: null,
      moves: {},
      items: {},
      abilities: {},
      teammates: {},
      spreads: {},
      tera_types: null,
      counters: null,
      viability: null,
      last_imported: '2025-01-01T00:00:00Z',
    };
    const [out] = metaUsageToUsageRows([row]);
    expect(out.usage_percent).toBeCloseTo(0.5);
  });

  it('returns efficiency = null for the global meta fallback (no KO data)', () => {
    const row: MetaUsageRow = {
      id: '1',
      format: 'gen9ou',
      pokemon_name: 'Garchomp',
      usage_pct: 0.25,
      lead_pct: null,
      moves: {},
      items: {},
      abilities: {},
      teammates: {},
      spreads: {},
      tera_types: null,
      counters: null,
      viability: null,
      last_imported: '2025-01-01T00:00:00Z',
    };
    const [out] = metaUsageToUsageRows([row]);
    expect(out.efficiency).toBeNull();
  });
});
