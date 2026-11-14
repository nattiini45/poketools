import { describe, expect, it } from 'vitest';
import type { Aggregate } from '@/types/game';
import { combinePokemonUsage } from '../combined-statistics';

const live: Aggregate = {
  id: 'live-row', scope_type: 'all_time', scope_id: null, pokemon_name: 'Pikachu',
  total_appearances: 4, total_games: 6, total_brought: 2, total_led: 1,
  total_kos_dealt: 3, total_koed: 1, total_wins: 2, move_counts: {}, last_updated: '',
};

describe('combinePokemonUsage', () => {
  it('adds paired appearances to the battle denominator and preserves distinct live game counters', () => {
    const [row] = combinePokemonUsage([live], 10, {
      battleCount: 5, coverage: [],
      pokemon: [{ pokemonName: 'Pikachu', appearances: 3, wins: 2, kos: 9 }],
    });
    expect(row.total_appearances).toBe(7);
    expect(row.total_games).toBe(9);
    expect(row.usage_percent).toBeCloseTo(7 / 15 * 100);
    expect(row.win_rate).toBeCloseTo(4 / 7 * 100);
    expect(row.kos_dealt).toBe(12);
    expect(row.sourceCounts).toEqual({ liveAppearances: 4, historicalAppearances: 3, liveKos: 3, historicalKos: 9 });
  });

  it('keeps faint, efficiency, bring and lead rates confined to their recorded live sample', () => {
    const [row] = combinePokemonUsage([live], 10, {
      battleCount: 5, coverage: [],
      pokemon: [{ pokemonName: 'Pikachu', appearances: 3, wins: 2, kos: 99 }],
    });
    expect(row.koed_rate).toBe(25);
    expect(row.efficiency).toBe(1.5);
    expect(row.bring_rate).toBeCloseTo(2 / 6 * 100);
    expect(row.lead_rate).toBeCloseTo(1 / 6 * 100);
  });

  it('unions species and does not invent appearances, wins or deaths from a KO-only record', () => {
    const rows = combinePokemonUsage([live], 10, {
      battleCount: 0, coverage: [],
      pokemon: [{ pokemonName: 'Eevee', appearances: null, wins: null, kos: 8 }],
    });
    expect(rows.find((row) => row.pokemon_name === 'Eevee')).toMatchObject({
      total_appearances: null, total_games: null, usage_percent: null, kos_dealt: 8,
      koed_rate: null, efficiency: null, bring_rate: null, lead_rate: null, win_rate: null,
    });
  });

  it('preserves explicitly unknown counters even when another historical cohort has paired battles', () => {
    const [row] = combinePokemonUsage([], 0, {
      battleCount: 5, coverage: [],
      pokemon: [{ pokemonName: 'Eevee', appearances: null, wins: null, kos: 8 }],
    });
    expect(row.total_appearances).toBeNull();
    expect(row.usage_percent).toBeNull();
  });

  it('does not turn unknown wins or KOs into zero in an appearance-only record', () => {
    const [row] = combinePokemonUsage([], 0, {
      battleCount: 5, coverage: [],
      pokemon: [{ pokemonName: 'Eevee', appearances: 2, wins: null, kos: null }],
    });
    expect(row.usage_percent).toBe(40);
    expect(row.win_rate).toBeNull();
    expect(row.kos_dealt).toBeNull();
  });

  it('retains live-only counters when no historical data applies', () => {
    const [row] = combinePokemonUsage([live], 10, { battleCount: 0, pokemon: [], coverage: [] });
    expect(row).toMatchObject({ total_appearances: 4, total_games: 6, usage_percent: 40, kos_dealt: 3, win_rate: 50 });
    expect(combinePokemonUsage([], 0, { battleCount: 0, pokemon: [], coverage: [] })).toEqual([]);
  });
});
