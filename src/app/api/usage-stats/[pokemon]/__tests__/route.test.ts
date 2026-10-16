import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/usage-hybrid', () => ({
  getHybridPokemonDetail: vi.fn(),
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getSpeciesTypeInfo: vi.fn(),
  getBaseStats: vi.fn(),
  getMove: vi.fn(),
}));

vi.mock('@/lib/pkmn/formats', () => ({
  getFallbackFormats: vi.fn().mockReturnValue([]),
}));

import { GET } from '../route';
import { getHybridPokemonDetail } from '@/lib/supabase/queries/usage-hybrid';
import { getSpeciesTypeInfo, getBaseStats, getMove } from '@/lib/pkmn/dex';
import { getFallbackFormats } from '@/lib/pkmn/formats';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

// ── Test data ─────────────────────────────────────────────────────────

const mockDetail = {
  pokemon: 'Garchomp',
  format: 'gen9ou',
  usage_pct: 25.5,
  moves: { Earthquake: 80.2, 'Dragon Claw': 45.1 },
  items: { 'Choice Scarf': 60 },
  abilities: { 'Rough Skin': 70 },
  spreads: {},
  teammates: {},
  checks_and_counters: {},
};

describe('GET /api/usage-stats/[pokemon]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when format query param is missing', async () => {
    const req = makeRequest(undefined, {});
    const res = await GET(req, { params: makeParams({ pokemon: 'Garchomp' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('format query param is required');
    expect(json.code).toBe('usage_format_required');
  });

  it('returns 404 when no usage data found', async () => {
    vi.mocked(getHybridPokemonDetail).mockResolvedValue(null);
    vi.mocked(getFallbackFormats).mockReturnValue([]);

    const req = makeRequest(undefined, { format: 'gen9ou' });
    const res = await GET(req, { params: makeParams({ pokemon: 'Garchomp' }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain('No usage data for Garchomp');
    expect(json.code).toBe('usage_no_data');
    expect(json.params).toEqual({ pokemon: 'Garchomp' });
  });

  it('returns enriched usage data on happy path', async () => {
    vi.mocked(getHybridPokemonDetail).mockResolvedValue(mockDetail as never);
    vi.mocked(getSpeciesTypeInfo).mockReturnValue({ types: ['Dragon', 'Ground'] } as never);
    vi.mocked(getBaseStats).mockReturnValue({
      baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
    } as never);
    vi.mocked(getMove).mockImplementation((moveName: string) => {
      if (moveName === 'Earthquake') return { type: 'Ground', category: 'Physical', basePower: 100 } as never as never;
      if (moveName === 'Dragon Claw') return { type: 'Dragon', category: 'Physical', basePower: 80 } as never as never;
      return null as never;
    });

    const req = makeRequest(undefined, { format: 'gen9ou' });
    const res = await GET(req, { params: makeParams({ pokemon: 'Garchomp' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.types).toEqual(['Dragon', 'Ground']);
    expect(json.data.base_stats.atk).toBe(130);
    // Moves sorted by usage descending
    expect(json.data.enriched_moves[0].name).toBe('Earthquake');
    expect(json.data.enriched_moves[0].type).toBe('Ground');
    expect(json.data.enriched_moves[0].power).toBe(100);
    expect(json.data.enriched_moves[1].name).toBe('Dragon Claw');
  });

  it('decodes URI-encoded pokemon names', async () => {
    vi.mocked(getHybridPokemonDetail).mockResolvedValue(mockDetail as never);
    vi.mocked(getSpeciesTypeInfo).mockReturnValue({ types: ['Dragon', 'Ground'] } as never);
    vi.mocked(getBaseStats).mockReturnValue({
      baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
    } as never);
    vi.mocked(getMove).mockReturnValue(undefined as never);

    const req = makeRequest(undefined, { format: 'gen9ou' });
    const res = await GET(req, { params: makeParams({ pokemon: 'Tapu%20Koko' }) });
    await res.json();

    expect(getHybridPokemonDetail).toHaveBeenCalledWith(
      'Tapu Koko',
      expect.objectContaining({ format: 'gen9ou' }),
    );
  });

  it('tries fallback formats when primary has no data', async () => {
    vi.mocked(getHybridPokemonDetail)
      .mockResolvedValueOnce(null) // primary: no data
      .mockResolvedValueOnce(mockDetail as never); // fallback hit
    vi.mocked(getFallbackFormats).mockReturnValue(['gen9uu']);
    vi.mocked(getSpeciesTypeInfo).mockReturnValue({ types: [] } as never);
    vi.mocked(getBaseStats).mockReturnValue({ baseStats: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } } as never);
    vi.mocked(getMove).mockReturnValue(undefined as never);

    const req = makeRequest(undefined, { format: 'gen9ou' });
    const res = await GET(req, { params: makeParams({ pokemon: 'Garchomp' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.fallback_format).toBe('gen9uu');
  });

  it('passes season_id and tournament_id to query', async () => {
    vi.mocked(getHybridPokemonDetail).mockResolvedValue(mockDetail as never);
    vi.mocked(getSpeciesTypeInfo).mockReturnValue({ types: [] } as never);
    vi.mocked(getBaseStats).mockReturnValue({ baseStats: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } } as never);
    vi.mocked(getMove).mockReturnValue(undefined as never);

    const req = makeRequest(undefined, {
      format: 'gen9ou',
      season_id: 's1',
      tournament_id: 't1',
    });
    const res = await GET(req, { params: makeParams({ pokemon: 'Garchomp' }) });
    await res.json();

    expect(getHybridPokemonDetail).toHaveBeenCalledWith('Garchomp', {
      format: 'gen9ou',
      seasonId: 's1',
      tournamentId: 't1',
    });
  });

  it('handles move lookup returning null gracefully', async () => {
    vi.mocked(getHybridPokemonDetail).mockResolvedValue(mockDetail as never);
    vi.mocked(getSpeciesTypeInfo).mockReturnValue(undefined as never);
    vi.mocked(getBaseStats).mockReturnValue(undefined as never);
    vi.mocked(getMove).mockReturnValue(undefined as never);

    const req = makeRequest(undefined, { format: 'gen9ou' });
    const res = await GET(req, { params: makeParams({ pokemon: 'Garchomp' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.types).toEqual([]);
    expect(json.data.base_stats).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(json.data.enriched_moves[0].type).toBe('Normal');
    expect(json.data.enriched_moves[0].category).toBe('Status');
    expect(json.data.enriched_moves[0].power).toBeNull();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getHybridPokemonDetail).mockRejectedValue(new Error('Query failed'));

    const req = makeRequest(undefined, { format: 'gen9ou' });
    const res = await GET(req, { params: makeParams({ pokemon: 'Garchomp' }) });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    // safeErrorResponse hides internal error details
    expect(json.error).toBe('Failed to fetch pokemon usage detail');
  });
});
