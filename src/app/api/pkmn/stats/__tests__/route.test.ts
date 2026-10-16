import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getBaseStats: vi.fn(),
}));

import { GET } from '../route';
import { getBaseStats } from '@/lib/pkmn/dex';

const mockGetBaseStats = getBaseStats as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/stats');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

describe('GET /api/pkmn/stats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns base stats for a valid species', async () => {
    const info = {
      name: 'Garchomp',
      types: ['Dragon', 'Ground'],
      baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
    };
    mockGetBaseStats.mockReturnValue(info);

    const res = await GET(makeRequest({ species: 'Garchomp' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(info);
    expect(mockGetBaseStats).toHaveBeenCalledWith('Garchomp');
  });

  it('returns 400 when species param is missing', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('species parameter required');
  });

  it('returns 404 for unknown species', async () => {
    mockGetBaseStats.mockReturnValue(null);

    const res = await GET(makeRequest({ species: 'FakeMon' }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toContain('FakeMon');
    expect(json.code).toBe('unknown_species');
    expect(json.params).toEqual({ pokemon: 'FakeMon' });
  });
});
