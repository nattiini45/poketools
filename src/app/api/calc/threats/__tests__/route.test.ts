import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { ThreatEntry } from '@/types/calc';

// ── Mocks ──────────────────────────────────────────────────────────────

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock('@/lib/pkmn/threat-list', () => ({
  getThreatsForFormat: vi.fn(),
}));

import { GET } from '../route';
import { getThreatsForFormat } from '@/lib/pkmn/threat-list';
import { rateLimitKey } from '@/lib/utils/rate-limit';
import { CALC_THREATS_RATE_LIMIT } from '@/lib/pkmn/calc-route';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/calc/threats');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString(), headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }) } as unknown as NextRequest;
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
    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });
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

  it.each(['abc', '-5', '0', '1.5', '', 'NaN'])('returns 400 for limit=%j instead of passing NaN or a negative on', async (limit) => {
    const res = await GET(makeRequest({ format: 'gen9ou', limit }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toContain('limit');
    expect(getThreatsForFormat).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed format id or an oversized exclude list', async () => {
    const badFormat = await GET(makeRequest({ format: 'gen9ou;drop' }));
    expect(badFormat.status).toBe(400);

    const exclude = Array.from({ length: 31 }, (_, i) => `Mon${i}`).join(',');
    const badExclude = await GET(makeRequest({ format: 'gen9ou', exclude }));
    expect(badExclude.status).toBe(400);
    expect(getThreatsForFormat).not.toHaveBeenCalled();
  });

  it('is rate limited per client IP in its own bucket (429 before any usage read)', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, hits: 61, retry_after_seconds: 9 }], error: null });

    const res = await GET(makeRequest({ format: 'gen9ou' }));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('9');
    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('calc-threats', '203.0.113.9'),
      p_window_seconds: CALC_THREATS_RATE_LIMIT.windowSeconds,
      p_max: CALC_THREATS_RATE_LIMIT.limit,
    });
    expect(getThreatsForFormat).not.toHaveBeenCalled();
  });
});
