import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getBaseStats: vi.fn(),
}));

vi.mock('@/lib/pkmn/speed-calc', () => ({
  calcSpeed: vi.fn(),
}));

import { POST } from '../route';
import { getBaseStats } from '@/lib/pkmn/dex';
import { calcSpeed } from '@/lib/pkmn/speed-calc';

const mockGetBaseStats = getBaseStats as ReturnType<typeof vi.fn>;
const mockCalcSpeed = calcSpeed as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/pkmn/speed-calc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/pkmn/speed-calc', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns speed solutions for a valid species', async () => {
    mockGetBaseStats.mockReturnValue({ baseStats: { spe: 102 } });
    // calcSpeed is called multiple times during binary search.
    // Return a final value that exceeds the target for positive natures.
    mockCalcSpeed.mockImplementation(({ ev }: { ev: number }) => ({
      final: ev >= 100 ? 350 : 200,
    }));

    const res = await POST(makeRequest({
      species: 'Garchomp',
      target_speed: 300,
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.impossible).toBe(false);
    expect(json.data.solutions.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown species', async () => {
    mockGetBaseStats.mockReturnValue(null);

    const res = await POST(makeRequest({
      species: 'FakeMon',
      target_speed: 300,
    }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toContain('FakeMon');
    expect(json.code).toBe('unknown_species');
    expect(json.params).toEqual({ pokemon: 'FakeMon' });
  });

  it('marks impossible when no solution found', async () => {
    mockGetBaseStats.mockReturnValue({ baseStats: { spe: 30 } });
    mockCalcSpeed.mockReturnValue({ final: 50 }); // Always too slow

    const res = await POST(makeRequest({
      species: 'Ferrothorn',
      target_speed: 999,
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.impossible).toBe(true);
    expect(json.data.solutions).toEqual([]);
    expect(json.data.note).toBeDefined();
  });

  it('respects nature constraint filter', async () => {
    mockGetBaseStats.mockReturnValue({ baseStats: { spe: 102 } });
    mockCalcSpeed.mockImplementation(({ ev }: { ev: number }) => ({
      final: ev >= 100 ? 350 : 200,
    }));

    const res = await POST(makeRequest({
      species: 'Garchomp',
      target_speed: 300,
      constraints: { nature: 'positive' },
    }));
    const json = await res.json();

    expect(json.success).toBe(true);
    // All solutions should come from positive natures only (Jolly/Timid/Hasty/Naive)
    for (const sol of json.data.solutions) {
      expect(['Jolly', 'Timid', 'Hasty', 'Naive']).toContain(sol.nature);
    }
  });

  it('returns 500 on unexpected error', async () => {
    mockGetBaseStats.mockImplementation(() => { throw new Error('dex failure'); });

    const res = await POST(makeRequest({
      species: 'Garchomp',
      target_speed: 300,
    }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
  });
});
