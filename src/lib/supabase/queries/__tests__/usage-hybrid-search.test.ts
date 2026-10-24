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

import { getHybridUsageList } from '../usage-hybrid';
import { getUsageByFormat } from '../meta-usage';
import { getAggregates, getTotalGamesInScope } from '../aggregates';

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
    vi.mocked(getTotalGamesInScope).mockResolvedValue(20);
    vi.mocked(getUsageByFormat).mockResolvedValue(meta([]));
    vi.mocked(getAggregates).mockResolvedValue([
      aggregate('Charizard', 10),
      aggregate('Garchomp', 8),
      aggregate('Glimmora', 4),
    ]);
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
