import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/speed-benchmarks', () => ({
  getSpeedBenchmarks: vi.fn(),
}));

import { GET } from '../route';
import { getSpeedBenchmarks } from '@/lib/pkmn/speed-benchmarks';

const mockGetBenchmarks = getSpeedBenchmarks as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/speed-tiers');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

describe('GET /api/pkmn/speed-tiers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns speed tiers for a valid format', async () => {
    mockGetBenchmarks.mockResolvedValue([
      { species: 'Garchomp', speed: 333, baseSpe: 102, evs: 252, nature: 'Jolly', item: null },
      { species: 'Garchomp', speed: 499, baseSpe: 102, evs: 252, nature: 'Jolly', item: 'Choice Scarf' },
      { species: 'Slowbro', speed: 146, baseSpe: 30, evs: 0, nature: 'Bold', item: null },
    ]);

    const res = await GET(makeRequest({ format: 'gen9vgc2024regg' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.format).toBe('gen9vgc2024regg');
    expect(json.data.benchmarks).toHaveLength(3);
    expect(json.data.min_speed).toBeDefined();
    expect(json.data.max_speed).toBeDefined();
    expect(json.data.common_ranges).toBeDefined();
    expect(mockGetBenchmarks).toHaveBeenCalledWith('gen9vgc2024regg', {
      limit: 20,
      includeScarf: true,
      level: 100,
      seasonId: undefined,
    });
  });

  it('returns 400 when format param is missing', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('format');
  });

  it('passes optional params through', async () => {
    mockGetBenchmarks.mockResolvedValue([]);

    await GET(makeRequest({
      format: 'gen9ou',
      limit: '10',
      include_scarf: 'false',
      level: '50',
      season_id: 'abc-123',
    }));

    expect(mockGetBenchmarks).toHaveBeenCalledWith('gen9ou', {
      limit: 10,
      includeScarf: false,
      level: 50,
      seasonId: 'abc-123',
    });
  });

  it('returns 500 when benchmark fetching fails', async () => {
    mockGetBenchmarks.mockRejectedValue(new Error('DB error'));

    const res = await GET(makeRequest({ format: 'gen9ou' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
  });
});
