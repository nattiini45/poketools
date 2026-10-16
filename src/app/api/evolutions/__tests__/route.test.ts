import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { EvolutionTier } from '@/types/evolution';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getTierList: vi.fn(),
  getWildcards: vi.fn(),
  getAllTiers: vi.fn(),
  createTier: vi.fn(),
  bulkCreateTiers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({
  createPoolEntry: vi.fn(),
  getPoolEntry: vi.fn(),
  bulkCreatePoolEntries: vi.fn(),
  getPoolEntries: vi.fn(),
}));

import { GET, POST } from '@/app/api/evolutions/route';
import { requireAuth, requireResourceAdmin } from '@/lib/auth/helpers';
import {
  getTierList,
  getWildcards,
  getAllTiers,
  createTier,
  bulkCreateTiers,
} from '@/lib/supabase/queries/evolutions';
import {
  createPoolEntry,
  getPoolEntry,
  bulkCreatePoolEntries,
  getPoolEntries,
} from '@/lib/supabase/queries/draft-pool-entries';

/* ── GET ──────────────────────────────────────────────────── */

describe('GET /api/evolutions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when season_id is missing', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);

    const request = {
      url: 'http://localhost:3000/api/evolutions',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('season_id is required');
    expect(payload.code).toBe('draft_season_id_required');
  });

  it('returns all tiers by default', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);
    vi.mocked(getAllTiers).mockResolvedValue([
      { id: 'tier-1', base_pokemon: 'Pichu' },
    ] as never);

    const request = {
      url: 'http://localhost:3000/api/evolutions?season_id=season-a',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toHaveLength(1);
    expect(vi.mocked(getAllTiers)).toHaveBeenCalledWith('season-a');
  });

  it('returns only tiers when type=tiers', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);
    vi.mocked(getTierList).mockResolvedValue([{ id: 'tier-1' }] as never);

    const request = {
      url: 'http://localhost:3000/api/evolutions?season_id=season-a&type=tiers',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(vi.mocked(getTierList)).toHaveBeenCalledWith('season-a');
  });

  it('returns only wildcards when type=wildcards', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);
    vi.mocked(getWildcards).mockResolvedValue([{ id: 'wc-1' }] as never);

    const request = {
      url: 'http://localhost:3000/api/evolutions?season_id=season-a&type=wildcards',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(vi.mocked(getWildcards)).toHaveBeenCalledWith('season-a');
  });
});

/* ── POST ─────────────────────────────────────────────────── */

describe('POST /api/evolutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects mixed-season bulk tier payloads', async () => {
    const request = {
      json: vi.fn().mockResolvedValue([
        {
          season_id: '00000000-0000-4000-a000-000000000001',
          base_pokemon: 'Pichu',
          stage2_pokemon: 'Pikachu',
          stage2_kos: 3,
        },
        {
          season_id: '00000000-0000-4000-b000-000000000002',
          base_pokemon: 'Eevee',
          stage2_pokemon: 'Vaporeon',
          stage2_kos: 3,
        },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string; code?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('share the same season_id');
    expect(payload.code).toBe('evolution_tiers_mixed_season');
    expect(vi.mocked(requireResourceAdmin)).not.toHaveBeenCalled();
    expect(vi.mocked(bulkCreateTiers)).not.toHaveBeenCalled();
  });

  it('allows same-season bulk tiers after auth', async () => {
    const created: EvolutionTier[] = [
      {
        id: 'tier-1',
        season_id: '00000000-0000-4000-a000-000000000001',
        player_id: 'player-1',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
        stage3_pokemon: null,
        stage3_kos: null,
        power_tier: 'C',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    vi.mocked(bulkCreateTiers).mockResolvedValue(created);

    const request = {
      json: vi.fn().mockResolvedValue([
        {
          season_id: '00000000-0000-4000-a000-000000000001',
          player_id: 'player-1',
          base_pokemon: 'Pichu',
          stage2_pokemon: 'Pikachu',
          stage2_kos: 3,
        },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; data: EvolutionTier[] };

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(created);
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('season', '00000000-0000-4000-a000-000000000001');
    expect(vi.mocked(bulkCreateTiers)).toHaveBeenCalledTimes(1);
  });

  it('bulk create auto-syncs non-wildcard tiers to pool entries', async () => {
    vi.mocked(bulkCreateTiers).mockResolvedValue([
      { id: 'tier-1', season_id: '00000000-0000-4000-a000-000000000001', base_pokemon: 'Pichu' },
    ] as never);
    vi.mocked(getPoolEntries).mockResolvedValue([] as never);
    vi.mocked(bulkCreatePoolEntries).mockResolvedValue([] as never);

    const request = {
      json: vi.fn().mockResolvedValue([
        {
          season_id: '00000000-0000-4000-a000-000000000001',
          base_pokemon: 'Pichu',
          stage2_pokemon: 'Pikachu',
          stage2_kos: 3,
          // No player_id => not a wildcard
        },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(201);

    expect(vi.mocked(bulkCreatePoolEntries)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pokemon_name: 'Pichu' }),
      ]),
    );
  });

  it('bulk create skips pool-entry sync for wildcards (player_id present)', async () => {
    vi.mocked(bulkCreateTiers).mockResolvedValue([
      { id: 'tier-1', season_id: '00000000-0000-4000-a000-000000000001', base_pokemon: 'Pichu', player_id: 'player-1' },
    ] as never);

    const request = {
      json: vi.fn().mockResolvedValue([
        {
          season_id: '00000000-0000-4000-a000-000000000001',
          player_id: 'player-1',
          base_pokemon: 'Pichu',
          stage2_pokemon: 'Pikachu',
          stage2_kos: 3,
        },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(201);

    // No pool entry sync for wildcards
    expect(vi.mocked(getPoolEntries)).not.toHaveBeenCalled();
  });

  it('returns 400 for single create with missing fields', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        base_pokemon: 'Pichu',
        // Missing stage2_pokemon and stage2_kos
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('stage2_pokemon');
    expect(payload.code).toBe('evolution_stage2_required');
  });

  it('creates a single tier and auto-syncs pool entry', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    const created: EvolutionTier = {
      id: 'tier-1',
      season_id: '00000000-0000-4000-a000-000000000001',
      player_id: null,
      base_pokemon: 'Pichu',
      stage2_pokemon: 'Pikachu',
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: 'C',
      created_at: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(createTier).mockResolvedValue(created);
    vi.mocked(getPoolEntry).mockResolvedValue(null);
    vi.mocked(createPoolEntry).mockResolvedValue({} as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
        power_tier: 'C',
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(created);
    expect(vi.mocked(createPoolEntry)).toHaveBeenCalledWith(
      expect.objectContaining({
        season_id: '00000000-0000-4000-a000-000000000001',
        pokemon_name: 'Pichu',
        power_tier: 'C',
      }),
    );
  });

  it('skips pool entry sync for single wildcard tier', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(createTier).mockResolvedValue({
      id: 'tier-1',
      season_id: '00000000-0000-4000-a000-000000000001',
      player_id: 'player-1',
      base_pokemon: 'Pichu',
      stage2_pokemon: 'Pikachu',
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: null as never as never,
      created_at: '',
    });

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        player_id: 'player-1',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(vi.mocked(getPoolEntry)).not.toHaveBeenCalled();
    expect(vi.mocked(createPoolEntry)).not.toHaveBeenCalled();
  });

  it('skips pool entry sync when entry already exists', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(createTier).mockResolvedValue({
      id: 'tier-1',
      season_id: '00000000-0000-4000-a000-000000000001',
      player_id: null,
      base_pokemon: 'Pichu',
      stage2_pokemon: 'Pikachu',
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: null as never as never,
      created_at: '',
    });
    vi.mocked(getPoolEntry).mockResolvedValue({ id: 'existing-entry' } as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        base_pokemon: 'Pichu',
        stage2_pokemon: 'Pikachu',
        stage2_kos: 3,
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(vi.mocked(getPoolEntry)).toHaveBeenCalledWith('00000000-0000-4000-a000-000000000001', 'Pichu');
    expect(vi.mocked(createPoolEntry)).not.toHaveBeenCalled();
  });
});
