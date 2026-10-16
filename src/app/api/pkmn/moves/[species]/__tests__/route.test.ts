import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  listMovesForSpecies: vi.fn(),
}));

import { GET } from '../route';
import { listMovesForSpecies } from '@/lib/pkmn/dex';

const mockListMoves = listMovesForSpecies as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(
  species: string,
  queryParams: Record<string, string> = {},
): [NextRequest, { params: Promise<{ species: string }> }] {
  const url = new URL(`http://localhost:3000/api/pkmn/moves/${encodeURIComponent(species)}`);
  for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);
  const req = { url: url.toString(), nextUrl: url } as unknown as NextRequest;
  return [req, { params: Promise.resolve({ species }) }];
}

describe('GET /api/pkmn/moves/[species]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns moves for a valid species with default gen', async () => {
    const moves = [
      { name: 'Earthquake', type: 'Ground', basePower: 100, category: 'Physical' },
      { name: 'Dragon Claw', type: 'Dragon', basePower: 80, category: 'Physical' },
    ];
    mockListMoves.mockResolvedValue(moves);

    const [req, ctx] = makeRequest('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(moves);
    expect(mockListMoves).toHaveBeenCalledWith('Garchomp', 9);
  });

  it('respects gen query parameter', async () => {
    mockListMoves.mockResolvedValue([]);

    const [req, ctx] = makeRequest('Garchomp', { gen: '5' });
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(mockListMoves).toHaveBeenCalledWith('Garchomp', 5);
  });

  it('defaults to gen 9 for invalid gen', async () => {
    mockListMoves.mockResolvedValue([]);

    const [req, ctx] = makeRequest('Garchomp', { gen: 'abc' });
    await GET(req, ctx);

    expect(mockListMoves).toHaveBeenCalledWith('Garchomp', 9);
  });

  it('decodes URI-encoded species names', async () => {
    mockListMoves.mockResolvedValue([]);

    const [req, ctx] = makeRequest('Tapu%20Koko');
    await GET(req, ctx);

    // The route calls decodeURIComponent on the species param
    expect(mockListMoves).toHaveBeenCalledWith('Tapu Koko', 9);
  });

  // ── ?lang= (pkmn-l10n §3.6): the real dex-l10n wrapper over the mocked dex ──

  it('?lang=de replaces shortDesc with the German text and adds shortDescLang', async () => {
    const english = 'User switches out after damaging the target.';
    mockListMoves.mockResolvedValue([{ name: 'U-turn', id: 'uturn', shortDesc: english }]);

    const [req, ctx] = makeRequest('Landorus-Therian', { lang: 'de' });
    const json = await (await GET(req, ctx)).json();

    expect(json.data[0]).toMatchObject({ name: 'U-turn', id: 'uturn', shortDescLang: 'de' });
    expect(json.data[0].shortDesc).not.toBe(english);
  });

  it('treats an unsupported lang as en (rows unchanged)', async () => {
    const moves = [{ name: 'U-turn', id: 'uturn', shortDesc: 'User switches out after damaging the target.' }];
    mockListMoves.mockResolvedValue(moves);

    const [req, ctx] = makeRequest('Landorus-Therian', { lang: 'fr' });
    const json = await (await GET(req, ctx)).json();

    expect(json.data).toEqual(moves);
  });

  it('returns a safe 500 when the dex lookup throws', async () => {
    mockListMoves.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const [req, ctx] = makeRequest('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toMatchObject({ success: false, error: 'Failed to list moves for species' });
    errorSpy.mockRestore();
  });
});
