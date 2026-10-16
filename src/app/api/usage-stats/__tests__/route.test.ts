import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/queries/usage-hybrid', () => ({
  getHybridUsageList: vi.fn(),
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getBaseStats: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/meta-usage', () => ({
  getLastImportDate: vi.fn(),
}));

import { GET } from '@/app/api/usage-stats/route';
import { getHybridUsageList } from '@/lib/supabase/queries/usage-hybrid';
import { getBaseStats } from '@/lib/pkmn/dex';
import { getLastImportDate } from '@/lib/supabase/queries/meta-usage';

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/usage-stats');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

describe('GET /api/usage-stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Validation ────────────────────────────────────────────

  it('rejects requests without format param', async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('format');
    expect(body.code).toBe('usage_format_required');
  });

  // ── Happy path ────────────────────────────────────────────

  it('returns enriched usage data with types and sprites', async () => {
    vi.mocked(getHybridUsageList).mockResolvedValue({
      data: [
        { pokemon_name: 'Garchomp', usage_pct: 25, types: ['Dragon', 'Ground'], sprite_id: 'garchomp', source: 'meta' as const },
        { pokemon_name: 'Pikachu', usage_pct: 15, types: ['Electric'], sprite_id: 'pikachu', source: 'meta' as const },
      ],
      total: 2,
      source: 'meta' as const,
    });

    vi.mocked(getBaseStats).mockImplementation((name: string) => {
      if (name === 'Garchomp') {
        return {
          types: ['Dragon', 'Ground'],
          baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
        } as ReturnType<typeof getBaseStats>;
      }
      if (name === 'Pikachu') {
        return {
          types: ['Electric'],
          baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
        } as ReturnType<typeof getBaseStats>;
      }
      return null as unknown as ReturnType<typeof getBaseStats>;
    });

    vi.mocked(getLastImportDate).mockResolvedValue(new Date('2026-04-01'));

    const res = await GET(makeRequest({ format: 'gen9vgc2024regh' }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.format).toBe('gen9vgc2024regh');
    expect(body.data.source).toBe('meta');
    expect(body.data.last_updated).toBe('2026-04-01T00:00:00.000Z');
    expect(body.data.pokemon).toHaveLength(2);
    expect(body.data.pokemon[0].types).toEqual(['Dragon', 'Ground']);
    expect(body.data.pokemon[0].sprite_id).toBe('garchomp');
  });

  it('filters out entries with empty pokemon_name', async () => {
    vi.mocked(getHybridUsageList).mockResolvedValue({
      data: [
        { pokemon_name: 'Pikachu', usage_pct: 10, types: ['Electric'], sprite_id: 'pikachu', source: 'meta' as const },
        { pokemon_name: '', usage_pct: 5, types: [], sprite_id: '', source: 'meta' as const },
        { pokemon_name: null as unknown as string, usage_pct: 3, types: [], sprite_id: '', source: 'meta' as const },
      ],
      total: 3,
      source: 'meta' as const,
    });

    vi.mocked(getBaseStats).mockReturnValue({
      types: ['Electric'],
      baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
    } as ReturnType<typeof getBaseStats>);

    vi.mocked(getLastImportDate).mockResolvedValue(null);

    const res = await GET(makeRequest({ format: 'gen9ou' }));
    const body = await res.json();
    expect(body.data.pokemon).toHaveLength(1);
    expect(body.data.pokemon[0].pokemon_name).toBe('Pikachu');
  });

  it('passes optional params to getHybridUsageList', async () => {
    vi.mocked(getHybridUsageList).mockResolvedValue({
      data: [],
      total: 0,
      source: 'meta' as const,
    });
    vi.mocked(getLastImportDate).mockResolvedValue(null);

    await GET(
      makeRequest({
        format: 'gen9ou',
        season_id: 's1',
        tournament_id: 't1',
        limit: '25',
        offset: '10',
        min_usage: '5',
        search: 'pika',
      }),
    );

    expect(vi.mocked(getHybridUsageList)).toHaveBeenCalledWith({
      format: 'gen9ou',
      seasonId: 's1',
      tournamentId: 't1',
      limit: 25,
      offset: 10,
      minUsage: 5,
      search: 'pika',
    });
  });

  it('clamps limit to 200', async () => {
    vi.mocked(getHybridUsageList).mockResolvedValue({
      data: [],
      total: 0,
      source: 'meta' as const,
    });
    vi.mocked(getLastImportDate).mockResolvedValue(null);

    await GET(makeRequest({ format: 'gen9ou', limit: '999' }));

    expect(vi.mocked(getHybridUsageList)).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200 }),
    );
  });

  // ── Error path ────────────────────────────────────────────

  it('returns 500 on internal error', async () => {
    vi.mocked(getHybridUsageList).mockRejectedValue(new Error('db fail'));

    const res = await GET(makeRequest({ format: 'gen9ou' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
