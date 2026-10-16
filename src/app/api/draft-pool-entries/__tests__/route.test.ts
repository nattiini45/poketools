import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  requireAuth: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;

    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({
  getPoolEntries: vi.fn(),
  createPoolEntry: vi.fn(),
  bulkCreatePoolEntries: vi.fn(),
  deleteAllPoolEntries: vi.fn(),
}));

import { GET, POST, DELETE } from '@/app/api/draft-pool-entries/route';
import { requireAuth, requireResourceAdmin } from '@/lib/auth/helpers';
import {
  getPoolEntries,
  createPoolEntry,
  bulkCreatePoolEntries,
  deleteAllPoolEntries,
} from '@/lib/supabase/queries/draft-pool-entries';

/* ── GET ──────────────────────────────────────────────────── */

describe('GET /api/draft-pool-entries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when season_id is missing', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);

    const request = {
      url: 'http://localhost:3000/api/draft-pool-entries',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('season_id is required');
    expect(payload.code).toBe('draft_season_id_required');
  });

  it('returns entries for a valid season_id', async () => {
    vi.mocked(requireAuth).mockResolvedValue(undefined as never);
    vi.mocked(getPoolEntries).mockResolvedValue([
      { id: 'entry-1', season_id: 'season-a', pokemon_name: 'Pikachu', power_tier: null, point_cost: null, created_at: '' },
    ] as never);

    const request = {
      url: 'http://localhost:3000/api/draft-pool-entries?season_id=season-a',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].pokemon_name).toBe('Pikachu');
  });

  it('returns auth error on failure', async () => {
    const { AuthError } = await import('@/lib/auth/helpers');
    vi.mocked(requireAuth).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const request = {
      url: 'http://localhost:3000/api/draft-pool-entries?season_id=season-a',
    } as unknown as NextRequest;

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.success).toBe(false);
  });
});

/* ── POST ─────────────────────────────────────────────────── */

describe('POST /api/draft-pool-entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects mixed-season bulk payloads', async () => {
    const request = {
      json: vi.fn().mockResolvedValue([
        { season_id: '00000000-0000-4000-a000-000000000001', pokemon_name: 'Pikachu' },
        { season_id: '00000000-0000-4000-b000-000000000002', pokemon_name: 'Eevee' },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string; code?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('share the same season_id');
    expect(payload.code).toBe('pool_entries_mixed_season');
    expect(vi.mocked(requireResourceAdmin)).not.toHaveBeenCalled();
    expect(vi.mocked(bulkCreatePoolEntries)).not.toHaveBeenCalled();
  });

  it('allows same-season bulk payloads after auth', async () => {
    vi.mocked(bulkCreatePoolEntries).mockResolvedValue([
      {
        id: 'entry-1',
        season_id: '00000000-0000-4000-a000-000000000001',
        pokemon_name: 'Pikachu',
        power_tier: null,
        point_cost: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const request = {
      json: vi.fn().mockResolvedValue([
        { season_id: '00000000-0000-4000-a000-000000000001', pokemon_name: 'Pikachu' },
        { season_id: '00000000-0000-4000-a000-000000000001', pokemon_name: 'Eevee' },
      ]),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('season', '00000000-0000-4000-a000-000000000001');
    expect(vi.mocked(bulkCreatePoolEntries)).toHaveBeenCalledTimes(1);
  });

  it('rejects empty bulk payloads', async () => {
    const request = {
      json: vi.fn().mockResolvedValue([]),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('At least one entry is required');
    expect(payload.code).toBe('pool_entries_empty');
  });

  it('creates a single entry with season_id and pokemon_name', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(createPoolEntry).mockResolvedValue({
      id: 'entry-1',
      season_id: '00000000-0000-4000-a000-000000000001',
      pokemon_name: 'Eevee',
      power_tier: null,
      point_cost: null,
      created_at: '',
    } as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        season_id: '00000000-0000-4000-a000-000000000001',
        pokemon_name: 'Eevee',
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.pokemon_name).toBe('Eevee');
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('season', '00000000-0000-4000-a000-000000000001');
  });

  it('returns 400 for single entry missing required fields', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ season_id: '00000000-0000-4000-a000-000000000001' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('pokemon_name');
    expect(payload.code).toBe('validation_failed');
    expect(payload.params.issues).toBe(payload.error);
  });
});

/* ── DELETE ────────────────────────────────────────────────── */

describe('DELETE /api/draft-pool-entries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when season_id is missing', async () => {
    const request = {
      url: 'http://localhost:3000/api/draft-pool-entries',
    } as unknown as NextRequest;

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('season_id is required');
    expect(payload.code).toBe('draft_season_id_required');
  });

  it('deletes all entries for a season', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(deleteAllPoolEntries).mockResolvedValue(undefined as never);

    const request = {
      url: 'http://localhost:3000/api/draft-pool-entries?season_id=season-a',
    } as unknown as NextRequest;

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toBeNull();
    expect(vi.mocked(requireResourceAdmin)).toHaveBeenCalledWith('season', 'season-a');
    expect(vi.mocked(deleteAllPoolEntries)).toHaveBeenCalledWith('season-a');
  });

  it('returns auth error on failure', async () => {
    const { AuthError } = await import('@/lib/auth/helpers');
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Forbidden', 403),
    );

    const request = {
      url: 'http://localhost:3000/api/draft-pool-entries?season_id=season-a',
    } as unknown as NextRequest;

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
  });
});
