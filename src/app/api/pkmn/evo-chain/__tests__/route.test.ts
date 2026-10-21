import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  resolveEvoChain: vi.fn(),
  searchBaseFormSpecies: vi.fn(),
}));

import { GET } from '../route';
import { resolveEvoChain, searchBaseFormSpecies } from '@/lib/pkmn/dex';

const mockResolveEvoChain = resolveEvoChain as ReturnType<typeof vi.fn>;
const mockSearchBaseForm = searchBaseFormSpecies as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): Request {
  const url = new URL('http://localhost:3000/api/pkmn/evo-chain');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString());
}

describe('GET /api/pkmn/evo-chain', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Mode 1: Resolve chain by pokemon name ─────────────────────────

  it('returns evolution chain for a valid pokemon', async () => {
    const chain = { base: 'Charmander', mid: 'Charmeleon', final: 'Charizard' };
    mockResolveEvoChain.mockReturnValue(chain);

    const res = await GET(makeRequest({ pokemon: 'charmander' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, data: chain });
    expect(mockResolveEvoChain).toHaveBeenCalledWith('charmander');
  });

  it('returns 400 when pokemon has no 3-stage chain', async () => {
    mockResolveEvoChain.mockReturnValue(null);

    const res = await GET(makeRequest({ pokemon: 'eevee' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('eevee');
    expect(json.code).toBe('evo_chain_unsupported');
    expect(json.params).toEqual({ pokemon: 'eevee' });
  });

  // ── Mode 2: Search base forms ─────────────────────────────────────

  it('searches base form species with q param', async () => {
    const results = [{ name: 'Charmander' }, { name: 'Charjabug' }];
    mockSearchBaseForm.mockReturnValue(results);

    const res = await GET(makeRequest({ q: 'char' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, data: results });
    expect(mockSearchBaseForm).toHaveBeenCalledWith('char');
  });

  it('ignores q param shorter than 2 characters', async () => {
    const res = await GET(makeRequest({ q: 'c' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Provide');
  });

  // ── Validation ────────────────────────────────────────────────────

  it('returns 400 when no params provided', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Provide');
  });
});
