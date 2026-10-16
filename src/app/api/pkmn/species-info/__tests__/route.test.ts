import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getSpeciesInfoBatch: vi.fn(),
}));

import { GET } from '../route';
import { getSpeciesInfoBatch } from '@/lib/pkmn/dex';

const mockGetBatch = getSpeciesInfoBatch as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/pkmn/species-info');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

describe('GET /api/pkmn/species-info', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns batch species info for comma-separated names', async () => {
    const result = [
      { name: 'Garchomp', types: ['Dragon', 'Ground'], baseStats: { hp: 108 } },
      { name: 'Corviknight', types: ['Flying', 'Steel'], baseStats: { hp: 98 } },
    ];
    mockGetBatch.mockReturnValue(result);

    const res = await GET(makeRequest({ names: 'Garchomp,Corviknight' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(result);
    expect(mockGetBatch).toHaveBeenCalledWith(['Garchomp', 'Corviknight']);
  });

  it('returns 400 when names param is missing', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('names parameter required');
  });

  it('returns 400 when names list is empty', async () => {
    const res = await GET(makeRequest({ names: ',,,' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('1-12');
  });

  it('returns 400 when more than 12 species provided', async () => {
    const names = Array.from({ length: 13 }, (_, i) => `Mon${i}`).join(',');
    const res = await GET(makeRequest({ names }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('1-12');
  });

  it('trims whitespace from species names', async () => {
    mockGetBatch.mockReturnValue([]);

    await GET(makeRequest({ names: ' Garchomp , Corviknight ' }));

    expect(mockGetBatch).toHaveBeenCalledWith(['Garchomp', 'Corviknight']);
  });
});
