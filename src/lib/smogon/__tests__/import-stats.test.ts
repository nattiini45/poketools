import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/meta-usage', () => ({
  upsertUsageBatch: vi.fn(),
}));

vi.mock('@/lib/smogon/format-registry', () => ({
  getImportableFormats: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import { importFormatStats, importAllStats } from '../import-stats';
import { upsertUsageBatch } from '@/lib/supabase/queries/meta-usage';
import { getImportableFormats } from '@/lib/smogon/format-registry';

const mockUpsertUsageBatch = vi.mocked(upsertUsageBatch);
const mockGetImportableFormats = vi.mocked(getImportableFormats);

function makeStatsFile(pokemon: Record<string, unknown>) {
  return { battles: 1000, pokemon };
}

function makePokemonStats(_name: string) {
  return {
    usage: { weighted: 25.5, real: 20.0 },
    lead: { weighted: 10.0, real: 8.0 },
    moves: { Thunderbolt: 80, 'Volt Switch': 60 },
    items: { 'Light Ball': 90 },
    abilities: { Static: 70 },
    teammates: { Charizard: 30 },
    stats: { 'Timid:0/0/4/252/0/252': 50 },
    counters: { Garchomp: [50, 60, 70] },
    viability: [1, 2, 3],
    unique: 500,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertUsageBatch.mockResolvedValue(undefined as never);
});

// ─── importFormatStats ────────────────────────────────────────────

describe('importFormatStats', () => {
  it('returns success with pokemon count on successful import', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeStatsFile({
        Pikachu: makePokemonStats('Pikachu'),
        Charizard: makePokemonStats('Charizard'),
      })),
    });

    const result = await importFormatStats('gen9ou');
    expect(result.format).toBe('gen9ou');
    expect(result.pokemonCount).toBe(2);
    expect(result.status).toBe('success');
    expect(result.error).toBeUndefined();
  });

  it('returns skipped with error message for 404 responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await importFormatStats('gen1fakeformat');
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('Not found');
    expect(result.pokemonCount).toBe(0);
  });

  it('returns error for non-404 HTTP errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await importFormatStats('gen9ou');
    expect(result.status).toBe('error');
    expect(result.error).toContain('HTTP 500');
  });

  it('returns skipped when pokemon data is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeStatsFile({})),
    });

    const result = await importFormatStats('gen9ou');
    expect(result.status).toBe('skipped');
    expect(result.error).toContain('No Pokémon data');
    expect(result.pokemonCount).toBe(0);
  });

  it('calls upsertUsageBatch with transformed rows', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeStatsFile({
        Pikachu: makePokemonStats('Pikachu'),
      })),
    });

    await importFormatStats('gen9ou');
    expect(mockUpsertUsageBatch).toHaveBeenCalledTimes(1);

    const rows = mockUpsertUsageBatch.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].format).toBe('gen9ou');
    expect(rows[0].pokemon_name).toBe('Pikachu');
    expect(rows[0].usage_pct).toBe(25.5);
    expect(rows[0].lead_pct).toBe(10.0);
    expect(rows[0].moves).toEqual({ Thunderbolt: 80, 'Volt Switch': 60 });
    expect(rows[0].items).toEqual({ 'Light Ball': 90 });
    expect(rows[0].abilities).toEqual({ Static: 70 });
    expect(rows[0].teammates).toEqual({ Charizard: 30 });
  });

  it('batches in chunks of 500', async () => {
    // Create 600 pokemon entries
    const pokemon: Record<string, unknown> = {};
    for (let i = 0; i < 600; i++) {
      pokemon[`Mon${i}`] = makePokemonStats(`Mon${i}`);
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeStatsFile(pokemon)),
    });

    await importFormatStats('gen9ou');
    // 600 entries = 2 batches (500 + 100)
    expect(mockUpsertUsageBatch).toHaveBeenCalledTimes(2);
    expect(mockUpsertUsageBatch.mock.calls[0][0]).toHaveLength(500);
    expect(mockUpsertUsageBatch.mock.calls[1][0]).toHaveLength(100);
  });

  it('returns error status when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await importFormatStats('gen9ou');
    expect(result.status).toBe('error');
    expect(result.error).toBe('Network failure');
  });

  it('fetches from the correct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeStatsFile({ Pikachu: makePokemonStats('Pikachu') })),
    });

    await importFormatStats('gen9ou');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://pkmn.github.io/smogon/data/stats/gen9ou.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('handles legacy stats format (no unique field)', async () => {
    const legacyStats = {
      usage: { real: 15.0 },
      lead: { real: 5.0 },
      moves: { Tackle: 100 },
      items: { Leftovers: 50 },
      abilities: { Overgrow: 100 },
      teammates: {},
      stats: {},
      counters: null,
      // No 'unique' field = legacy format
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeStatsFile({ Bulbasaur: legacyStats })),
    });

    const result = await importFormatStats('gen1ou');
    expect(result.status).toBe('success');
    expect(result.pokemonCount).toBe(1);

    const rows = mockUpsertUsageBatch.mock.calls[0][0];
    expect(rows[0].usage_pct).toBe(15.0); // Falls back to real
    expect(rows[0].viability).toBeNull(); // Legacy has no viability
  });
});

// ─── importAllStats ───────────────────────────────────────────────

describe('importAllStats', () => {
  beforeEach(() => {
    // Make each fetch succeed quickly
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeStatsFile({
          Pikachu: makePokemonStats('Pikachu'),
        })),
      }),
    );
  });

  it('imports all formats from getImportableFormats when none specified', async () => {
    mockGetImportableFormats.mockResolvedValue(['gen9ou', 'gen8ou']);

    const results = await importAllStats();
    expect(results).toHaveLength(2);
    expect(results[0].format).toBe('gen9ou');
    expect(results[1].format).toBe('gen8ou');
  });

  it('imports specified formats when provided', async () => {
    const results = await importAllStats(['gen9ou']);
    expect(results).toHaveLength(1);
    expect(results[0].format).toBe('gen9ou');
    expect(mockGetImportableFormats).not.toHaveBeenCalled();
  });

  it('collects results from all format imports', async () => {
    const results = await importAllStats(['gen9ou', 'gen8ou']);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe('success');
      expect(r.pokemonCount).toBe(1);
    }
  });

  it('continues importing even if one format fails', async () => {
    let callIdx = 0;
    mockFetch.mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        return Promise.reject(new Error('Fail'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makeStatsFile({
          Pikachu: makePokemonStats('Pikachu'),
        })),
      });
    });

    const results = await importAllStats(['gen9ou', 'gen8ou']);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('error');
    expect(results[1].status).toBe('success');
  });
});
