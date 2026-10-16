import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/dex', () => ({
  getTeamTypeAnalysis: vi.fn(),
}));

import { POST } from '../route';
import { getTeamTypeAnalysis } from '@/lib/pkmn/dex';

const mockAnalysis = getTeamTypeAnalysis as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new Request('http://localhost:3000/api/pkmn/type-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('POST /api/pkmn/type-analysis', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns type analysis for a team', async () => {
    const analysis = {
      weaknesses: { Fire: 2 },
      resistances: { Water: 1 },
      immunities: { Ground: 1 },
    };
    mockAnalysis.mockReturnValue(analysis);

    const res = await POST(makeRequest({ species: ['Garchomp', 'Corviknight'] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(analysis);
    expect(mockAnalysis).toHaveBeenCalledWith(['Garchomp', 'Corviknight'], 9);
  });

  it('uses custom gen when provided', async () => {
    mockAnalysis.mockReturnValue({});

    await POST(makeRequest({ species: ['Garchomp'], gen: 5 }));

    expect(mockAnalysis).toHaveBeenCalledWith(['Garchomp'], 5);
  });

  it('returns 400 when species is missing', async () => {
    const res = await POST(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('species');
  });

  it('returns 400 when species is not an array', async () => {
    const res = await POST(makeRequest({ species: 'Garchomp' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('returns 500 when analysis throws', async () => {
    mockAnalysis.mockImplementation(() => { throw new Error('type engine error'); });

    const res = await POST(makeRequest({ species: ['Garchomp'] }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to analyze types');
  });
});
