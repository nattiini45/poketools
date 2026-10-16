import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getSpecies: vi.fn(),
  getSpeciesTypeInfo: vi.fn(),
}));

import { GET } from '../route';
import { getSpecies, getSpeciesTypeInfo } from '@/lib/pkmn/dex';

const mockGetSpecies = getSpecies as ReturnType<typeof vi.fn>;
const mockGetTypeInfo = getSpeciesTypeInfo as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeArgs(name: string): [NextRequest, { params: Promise<{ name: string }> }] {
  const url = new URL(`http://localhost:3000/api/pokemon/${encodeURIComponent(name)}`);
  const req = { url: url.toString(), nextUrl: url } as unknown as NextRequest;
  return [req, { params: Promise.resolve({ name }) }];
}

describe('GET /api/pokemon/[name]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns species data for a valid pokemon', async () => {
    mockGetSpecies.mockReturnValue({
      name: 'Garchomp',
      baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
      abilities: { '0': 'Sand Veil', '1': undefined, H: 'Rough Skin', S: undefined },
    });
    mockGetTypeInfo.mockReturnValue({ types: ['Dragon', 'Ground'] });

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Garchomp');
    expect(json.data.types).toEqual(['Dragon', 'Ground']);
    expect(json.data.baseStats.atk).toBe(130);
    expect(json.data.abilities).toEqual(['Sand Veil', 'Rough Skin']);
  });

  it('returns 404 for unknown pokemon', async () => {
    mockGetSpecies.mockReturnValue(null);

    const [req, ctx] = makeArgs('FakeMon');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toContain('FakeMon');
    expect(json.code).toBe('pokemon_not_found');
    expect(json.params).toEqual({ pokemon: 'FakeMon' });
  });

  it('decodes URI-encoded names', async () => {
    mockGetSpecies.mockReturnValue({
      name: 'Tapu Koko',
      baseStats: { hp: 70, atk: 115, def: 85, spa: 95, spd: 75, spe: 130 },
      abilities: { '0': 'Electric Surge', '1': undefined, H: 'Telepathy', S: undefined },
    });
    mockGetTypeInfo.mockReturnValue({ types: ['Electric', 'Fairy'] });

    const [req, ctx] = makeArgs('Tapu%20Koko');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.name).toBe('Tapu Koko');
  });

  it('handles missing type info gracefully', async () => {
    mockGetSpecies.mockReturnValue({
      name: 'Garchomp',
      baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
      abilities: { '0': 'Sand Veil' },
    });
    mockGetTypeInfo.mockReturnValue(null);

    const [req, ctx] = makeArgs('Garchomp');
    const res = await GET(req, ctx);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.types).toEqual([]);
  });
});
