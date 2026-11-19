import { describe, it, expect, vi, beforeEach } from 'vitest';

// DB-free: the meta and aggregate query modules are mocked (design pkmn-l10n.md §4.2, §7).
vi.mock('../meta-usage', () => ({
  getUsageByFormat: vi.fn(),
  getPokemonUsageStats: vi.fn(),
}));
vi.mock('../aggregates', () => ({
  getAggregates: vi.fn(),
  getAggregateForPokemon: vi.fn(),
  getTotalGamesInScope: vi.fn(),
}));
vi.mock('../phase-games', () => ({ getPhaseSeasonGameTotal: vi.fn() }));
vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: vi.fn() }));

import { getHybridPokemonDetail, getHybridUsageList } from '../usage-hybrid';
import { getPokemonUsageStats, getUsageByFormat } from '../meta-usage';
import { getAggregateForPokemon, getAggregates, getTotalGamesInScope } from '../aggregates';
import { getPhaseSeasonGameTotal } from '../phase-games';
import { getPhaseRouteMode } from '@/lib/league-phase/route-mode';

type MetaResult = Awaited<ReturnType<typeof getUsageByFormat>>;
type AggregateRows = Awaited<ReturnType<typeof getAggregates>>;

function aggregate(pokemonName: string, appearances: number): AggregateRows[number] {
  return {
    pokemon_name: pokemonName,
    total_appearances: appearances,
  } as AggregateRows[number];
}

function meta(rows: { pokemon_name: string; usage_pct: number }[]): MetaResult {
  return { data: rows, total: rows.length } as unknown as MetaResult;
}

describe('getHybridUsageList search (bilingual prefix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPhaseRouteMode).mockResolvedValue('legacy');
    vi.mocked(getTotalGamesInScope).mockResolvedValue(20);
    vi.mocked(getUsageByFormat).mockResolvedValue(meta([]));
    vi.mocked(getAggregates).mockResolvedValue([
      aggregate('Charizard', 10),
      aggregate('Garchomp', 8),
      aggregate('Glimmora', 4),
    ]);
  });

  it('uses native league games for both the list and detail even while frozen', async () => {
    vi.mocked(getPhaseRouteMode).mockResolvedValue('frozen_phase');
    vi.mocked(getPhaseSeasonGameTotal).mockResolvedValue(40);
    vi.mocked(getPokemonUsageStats).mockResolvedValue(null);
    vi.mocked(getAggregateForPokemon).mockResolvedValue({
      ...aggregate('Charizard', 10), total_led: 2, move_counts: {},
    });

    const scope = { format: 'gen9ou', seasonId: 'native-league' };
    const list = await getHybridUsageList(scope);
    const detail = await getHybridPokemonDetail('Charizard', scope);
    expect(list.data.find((row) => row.pokemon_name === 'Charizard')?.usage_pct).toBe(0.25);
    expect(detail).toMatchObject({ usage_pct: 0.25, lead_pct: 0.05, source: 'league' });
    expect(getPhaseSeasonGameTotal).toHaveBeenCalledTimes(2);
    expect(getTotalGamesInScope).not.toHaveBeenCalled();
  });

  it('propagates a failed native read instead of replacing league data with public meta', async () => {
    const failure = new Error('Native league game count unavailable');
    vi.mocked(getPhaseRouteMode).mockResolvedValue('phase');
    vi.mocked(getPhaseSeasonGameTotal).mockRejectedValueOnce(failure);

    await expect(getHybridUsageList({ format: 'gen9ou', seasonId: 'native-league' })).rejects.toBe(failure);
    expect(getUsageByFormat).not.toHaveBeenCalled();
    expect(getTotalGamesInScope).not.toHaveBeenCalled();
  });

  it('a German prefix ("Glu") matches a pokemon_name of Charizard (Glurak)', async () => {
    const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1', search: 'Glu' });
    expect(result.data.map((d) => d.pokemon_name)).toEqual(['Charizard']);
    expect(result.total).toBe(1);
  });

  it('keeps English prefix matching ("Gar" → Garchomp) and is case-insensitive', async () => {
    const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1', search: 'gar' });
    expect(result.data.map((d) => d.pokemon_name)).toEqual(['Garchomp']);
  });

  it('matches the German name of another species ("Knakr" → Garchomp, German "Knakrack")', async () => {
    const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1', search: 'Knakr' });
    expect(result.data.map((d) => d.pokemon_name)).toEqual(['Garchomp']);
  });

  it('does not match a mere substring (prefix semantics are kept)', async () => {
    const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1', search: 'izard' });
    expect(result.data).toEqual([]);
  });

  it('without a search every league row is returned', async () => {
    const result = await getHybridUsageList({ format: 'gen9ou', seasonId: 's1' });
    expect(result.data.map((d) => d.pokemon_name)).toEqual(['Charizard', 'Garchomp', 'Glimmora']);
  });
});

describe('getHybridUsageList search: meta-only rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAggregates).mockResolvedValue([]);
    vi.mocked(getTotalGamesInScope).mockResolvedValue(0);
  });

  it('a German query resolves to English candidate names for the DB filter and finds a meta-only row', async () => {
    vi.mocked(getUsageByFormat).mockResolvedValue(meta([{ pokemon_name: 'Garchomp', usage_pct: 0.2 }]));
    const result = await getHybridUsageList({ format: 'gen9ou', search: 'Knakr' });

    expect(getUsageByFormat).toHaveBeenCalledTimes(1);
    const [format, options] = vi.mocked(getUsageByFormat).mock.calls[0];
    expect(format).toBe('gen9ou');
    expect(options?.search).toBeUndefined();
    expect(options?.names).toContain('Garchomp');
    expect(options?.names).not.toContain('Charizard');
    expect(result).toMatchObject({ source: 'meta', total: 1 });
    expect(result.data.map((d) => d.pokemon_name)).toEqual(['Garchomp']);
  });

  it('"Glu" (Glurak) sends Charizard as a candidate', async () => {
    vi.mocked(getUsageByFormat).mockResolvedValue(meta([]));
    await getHybridUsageList({ format: 'gen9ou', search: 'Glu' });
    expect(vi.mocked(getUsageByFormat).mock.calls[0][1]?.names).toContain('Charizard');
  });

  it('an English prefix keeps the ilike path (search passed, no names)', async () => {
    vi.mocked(getUsageByFormat).mockResolvedValue(meta([{ pokemon_name: 'Garchomp', usage_pct: 0.2 }]));
    await getHybridUsageList({ format: 'gen9ou', search: 'Garch' });
    const options = vi.mocked(getUsageByFormat).mock.calls[0][1];
    expect(options?.search).toBe('Garch');
    expect(options?.names).toBeUndefined();
  });
});
