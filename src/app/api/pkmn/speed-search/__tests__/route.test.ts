import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  searchSpeciesRich: vi.fn(),
}));

vi.mock('@/lib/pkmn/speed-benchmarks', () => ({
  buildBenchmarksForSpecies: vi.fn(),
}));

import { GET } from '../route';
import { searchSpeciesRich } from '@/lib/pkmn/dex';
import { buildBenchmarksForSpecies } from '@/lib/pkmn/speed-benchmarks';

const mockSearchSpecies = searchSpeciesRich as ReturnType<typeof vi.fn>;
const mockBuildBenchmarks = buildBenchmarksForSpecies as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/speed-search');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

describe('GET /api/pkmn/speed-search', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns benchmarks for matching species', () => {
    mockSearchSpecies.mockReturnValue([
      { name: 'Garchomp' },
      { name: 'Gardevoir' },
    ]);
    mockBuildBenchmarks.mockImplementation((name: string) => [
      { species: name, speed: 200, label: `${name} max` },
    ]);

    const res = GET(makeRequest({ q: 'gar' }));
    const json = res.json();

    return json.then((data: Record<string, unknown>) => {
      expect((data as { success: boolean }).success).toBe(true);
      expect((data as { data: unknown[] }).data).toHaveLength(2);
      expect(mockSearchSpecies).toHaveBeenCalledWith('gar', 9, 10);
      expect(mockBuildBenchmarks).toHaveBeenCalledWith('Garchomp', { level: 100, gen: 9 });
      expect(mockBuildBenchmarks).toHaveBeenCalledWith('Gardevoir', { level: 100, gen: 9 });
    });
  });

  it('returns empty array for short query', () => {
    const res = GET(makeRequest({ q: 'g' }));
    const json = res.json();

    return json.then((data: Record<string, unknown>) => {
      expect((data as { success: boolean }).success).toBe(true);
      expect((data as { data: unknown[] }).data).toEqual([]);
      expect(mockSearchSpecies).not.toHaveBeenCalled();
    });
  });

  it('returns empty array when q is missing', () => {
    const res = GET(makeRequest({}));
    const json = res.json();

    return json.then((data: Record<string, unknown>) => {
      expect((data as { success: boolean }).success).toBe(true);
      expect((data as { data: unknown[] }).data).toEqual([]);
    });
  });

  it('respects gen and level params', () => {
    mockSearchSpecies.mockReturnValue([{ name: 'Garchomp' }]);
    mockBuildBenchmarks.mockReturnValue([]);

    GET(makeRequest({ q: 'gar', gen: '5', level: '50' }));

    expect(mockSearchSpecies).toHaveBeenCalledWith('gar', 5, 10);
    expect(mockBuildBenchmarks).toHaveBeenCalledWith('Garchomp', { level: 50, gen: 5 });
  });
});
