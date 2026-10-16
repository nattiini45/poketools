import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  searchSpecies: vi.fn(),
  searchMoves: vi.fn(),
  searchItems: vi.fn(),
  searchAbilities: vi.fn(),
}));

import { GET } from '../route';
import { searchSpecies, searchMoves, searchItems, searchAbilities } from '@/lib/pkmn/dex';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

// ── Helpers ────────────────────────────────────────────────────────────

function mockAllSearches() {
  vi.mocked(searchSpecies).mockReturnValue([
    { name: 'Garchomp', id: 'Garchomp'.toLowerCase() },
    { name: 'Gardevoir', id: 'Gardevoir'.toLowerCase() },
  ]);
  vi.mocked(searchMoves).mockReturnValue([
    { name: 'Giga Drain', id: 'Giga Drain'.toLowerCase() },
  ]);
  vi.mocked(searchItems).mockReturnValue([
    { name: 'Garchompite', id: 'Garchompite'.toLowerCase() },
  ]);
  vi.mocked(searchAbilities).mockReturnValue([
    { name: 'Gale Wings', id: 'Gale Wings'.toLowerCase() },
  ]);
}

describe('GET /api/wiki/search', () => {
  // Public: no auth required
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Short/missing query ────────────────────────────────────────────

  it('returns empty results for missing query', async () => {
    const res = await GET(makeRequest(undefined, {}));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns empty results for query shorter than 2 characters', async () => {
    const res = await GET(makeRequest(undefined, { q: 'a' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  // ── Unfiltered search ──────────────────────────────────────────────

  it('searches all categories when no type filter is set', async () => {
    mockAllSearches();

    const res = await GET(makeRequest(undefined, { q: 'gar' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    // Should have results from all categories
    const types = body.data.map((r: { type: string }) => r.type);
    expect(types).toContain('pokemon');
    expect(types).toContain('move');
    expect(types).toContain('item');
    expect(types).toContain('ability');

    // All search functions called with perCategory=5
    expect(searchSpecies).toHaveBeenCalledWith('gar', 9, 5);
    expect(searchMoves).toHaveBeenCalledWith('gar', 9, 5);
    expect(searchItems).toHaveBeenCalledWith('gar', 9, 5);
    expect(searchAbilities).toHaveBeenCalledWith('gar', 9, 5);
  });

  // ── Filtered search (single type) ─────────────────────────────────

  it('searches only pokemon when type=pokemon', async () => {
    vi.mocked(searchSpecies).mockReturnValue([{ name: 'Garchomp', id: 'Garchomp'.toLowerCase() }]);

    const res = await GET(makeRequest(undefined, { q: 'gar', type: 'pokemon' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe('pokemon');
    expect(body.data[0].name).toBe('Garchomp');

    // Uses MAX_RESULTS (20) for single-type search
    expect(searchSpecies).toHaveBeenCalledWith('gar', 9, 20);
    expect(searchMoves).not.toHaveBeenCalled();
    expect(searchItems).not.toHaveBeenCalled();
    expect(searchAbilities).not.toHaveBeenCalled();
  });

  it('searches only moves when type=move', async () => {
    vi.mocked(searchMoves).mockReturnValue([{ name: 'Earthquake', id: 'Earthquake'.toLowerCase() }]);

    const res = await GET(makeRequest(undefined, { q: 'earth', type: 'move' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe('move');
    expect(searchSpecies).not.toHaveBeenCalled();
  });

  it('searches only items when type=item', async () => {
    vi.mocked(searchItems).mockReturnValue([{ name: 'Choice Band', id: 'Choice Band'.toLowerCase() }]);

    const res = await GET(makeRequest(undefined, { q: 'choice', type: 'item' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe('item');
    expect(searchSpecies).not.toHaveBeenCalled();
  });

  it('searches only abilities when type=ability', async () => {
    vi.mocked(searchAbilities).mockReturnValue([{ name: 'Intimidate', id: 'Intimidate'.toLowerCase() }]);

    const res = await GET(makeRequest(undefined, { q: 'intim', type: 'ability' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe('ability');
    expect(searchSpecies).not.toHaveBeenCalled();
  });

  // ── Tera type search ───────────────────────────────────────────────

  it('searches tera types when type=tera', async () => {
    const res = await GET(makeRequest(undefined, { q: 'fire', type: 'tera' }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].type).toBe('tera');
    expect(body.data[0].name).toBe('Fire');
  });

  it('includes tera types in unfiltered search', async () => {
    mockAllSearches();

    const res = await GET(makeRequest(undefined, { q: 'fire' }));
    const body = await res.json();

    const teraResults = body.data.filter((r: { type: string }) => r.type === 'tera');
    expect(teraResults.length).toBeGreaterThan(0);
    expect(teraResults[0].name).toBe('Fire');
  });

  it('matches tera types case-insensitively', async () => {
    const res = await GET(makeRequest(undefined, { q: 'STEEL', type: 'tera' }));
    const body = await res.json();

    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].name).toBe('Steel');
  });

  it('returns Stellar tera type for "stellar" query', async () => {
    const res = await GET(makeRequest(undefined, { q: 'stellar', type: 'tera' }));
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe('Stellar');
  });

  // ── Result limits ──────────────────────────────────────────────────

  it('limits total results to 20', async () => {
    // Return many results from each category
    vi.mocked(searchSpecies).mockReturnValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `species${i}`, name: `Species${i}` })),
    );
    vi.mocked(searchMoves).mockReturnValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `move${i}`, name: `Move${i}` })),
    );
    vi.mocked(searchItems).mockReturnValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `item${i}`, name: `Item${i}` })),
    );
    vi.mocked(searchAbilities).mockReturnValue(
      Array.from({ length: 10 }, (_, i) => ({ id: `ability${i}`, name: `Ability${i}` })),
    );

    const res = await GET(makeRequest(undefined, { q: 'test' }));
    const body = await res.json();

    expect(body.data.length).toBeLessThanOrEqual(20);
  });

  // ── Cache headers ──────────────────────────────────────────────────

  it('sets cache headers on response', async () => {
    const res = await GET(makeRequest(undefined, { q: 'gar' }));

    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });

  it('sets cache headers even for empty results', async () => {
    const res = await GET(makeRequest(undefined, {}));

    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600');
  });

  // ── shortDesc field ────────────────────────────────────────────────

  it('includes empty shortDesc for all result types', async () => {
    mockAllSearches();

    const res = await GET(makeRequest(undefined, { q: 'gar' }));
    const body = await res.json();

    for (const result of body.data) {
      expect(result).toHaveProperty('shortDesc', '');
    }
  });
});
