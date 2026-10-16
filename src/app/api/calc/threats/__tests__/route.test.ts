import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { ThreatEntry } from '@/types/calc';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/pkmn/threat-list', () => ({
  getThreatsForFormat: vi.fn(),
}));

import { GET } from '../route';
import { getThreatsForFormat } from '@/lib/pkmn/threat-list';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/calc/threats');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString() } as unknown as NextRequest;
}

const MOCK_THREATS: ThreatEntry[] = [
  {
    species: 'Garchomp',
    usage_pct: 25.3,
    default_set: { species: 'Garchomp', ability: 'Rough Skin' },
    types: ['Dragon', 'Ground'],
  },
  {
    species: 'Gholdengo',
    usage_pct: 20.1,
    default_set: { species: 'Gholdengo', ability: 'Good as Gold' },
    types: ['Steel', 'Ghost'],
  },
];

describe('GET /api/calc/threats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getThreatsForFormat).mockResolvedValue(MOCK_THREATS);
  });

  it('returns threats for a valid format', async () => {
    const res = await GET(makeRequest({ format: 'gen9ou' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.threats).toEqual(MOCK_THREATS);
    expect(getThreatsForFormat).toHaveBeenCalledWith('gen9ou', {
      limit: 12,
      excludeSpecies: [],
    });
  });

  it('returns 400 when format is missing', async () => {
    const res = await GET(makeRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('format query param is required');
  });

  it('respects custom limit (capped at 20)', async () => {
    await GET(makeRequest({ format: 'gen9ou', limit: '15' }));
    expect(getThreatsForFormat).toHaveBeenCalledWith('gen9ou', {
      limit: 15,
      excludeSpecies: [],
    });
  });

  it('caps limit at 20 even if higher value is requested', async () => {
    await GET(makeRequest({ format: 'gen9ou', limit: '50' }));
    expect(getThreatsForFormat).toHaveBeenCalledWith('gen9ou', {
      limit: 20,
      excludeSpecies: [],
    });
  });

  it('parses exclude list from comma-separated string', async () => {
    await GET(makeRequest({ format: 'gen9ou', exclude: 'Garchomp,Gholdengo' }));
    expect(getThreatsForFormat).toHaveBeenCalledWith('gen9ou', {
      limit: 12,
      excludeSpecies: ['Garchomp', 'Gholdengo'],
    });
  });

  it('returns 500 when getThreatsForFormat throws', async () => {
    vi.mocked(getThreatsForFormat).mockRejectedValue(new Error('DB unavailable'));

    const res = await GET(makeRequest({ format: 'gen9ou' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Failed to fetch threats');
  });

  it('uses default limit of 12 when not specified', async () => {
    await GET(makeRequest({ format: 'gen9ou' }));
    expect(getThreatsForFormat).toHaveBeenCalledWith('gen9ou', expect.objectContaining({ limit: 12 }));
  });
});
