import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { requireResourceAdmin: vi.fn(), AuthError };
});

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn().mockImplementation((_err: unknown, msg: string) =>
    NextResponse.json({ success: false, error: msg }, { status: 500 }),
  ),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getTierById: vi.fn(),
  updateTier: vi.fn(),
  deleteTier: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({
  getPoolEntry: vi.fn(),
  deletePoolEntry: vi.fn(),
  updatePoolEntry: vi.fn(),
}));

import { PATCH, DELETE } from '../route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getTierById, updateTier, deleteTier } from '@/lib/supabase/queries/evolutions';
import { getPoolEntry, deletePoolEntry } from '@/lib/supabase/queries/draft-pool-entries';

const mockRequireResourceAdmin = requireResourceAdmin as ReturnType<typeof vi.fn>;
const mockGetTier = getTierById as ReturnType<typeof vi.fn>;
const mockUpdateTier = updateTier as ReturnType<typeof vi.fn>;
const mockDeleteTier = deleteTier as ReturnType<typeof vi.fn>;
const mockGetPoolEntry = getPoolEntry as ReturnType<typeof vi.fn>;
const mockDeletePoolEntry = deletePoolEntry as ReturnType<typeof vi.fn>;

// ── Helpers ────────────────────────────────────────────────────────────

function makeArgs(
  id: string,
  body?: Record<string, unknown>,
  method = 'PATCH',
): [NextRequest, { params: Promise<{ id: string }> }] {
  const url = new URL(`http://localhost:3000/api/evolutions/${id}`);
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  const req = new Request(url.toString(), init) as unknown as NextRequest;
  return [req, { params: Promise.resolve({ id }) }];
}

const SAMPLE_TIER = {
  id: 'tier-1',
  season_id: 's-1',
  base_pokemon: 'Charmander',
  player_id: null,
  stage2_kos: 3,
  stage3_kos: 6,
  power_tier: 'A',
};

describe('PATCH /api/evolutions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireResourceAdmin.mockResolvedValue(undefined);
  });

  it('updates tier thresholds successfully', async () => {
    mockGetTier.mockResolvedValue(SAMPLE_TIER);
    const updated = { ...SAMPLE_TIER, stage2_kos: 5 };
    mockUpdateTier.mockResolvedValue(updated);

    const [req, ctx] = makeArgs('tier-1', { stage2_kos: 5 });
    const res = await PATCH(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.stage2_kos).toBe(5);
    expect(mockRequireResourceAdmin).toHaveBeenCalledWith('season', 's-1');
    expect(mockUpdateTier).toHaveBeenCalledWith('tier-1', { stage2_kos: 5 });
  });

  it('returns 404 when tier not found', async () => {
    mockGetTier.mockResolvedValue(null);

    const [req, ctx] = makeArgs('tier-missing', { stage2_kos: 5 });
    const res = await PATCH(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Evolution tier not found');
    expect(json.code).toBe('evolution_tier_not_found');
  });

  it('returns 400 when no valid fields provided', async () => {
    mockGetTier.mockResolvedValue(SAMPLE_TIER);

    const [req, ctx] = makeArgs('tier-1', { invalid_field: 'value' });
    const res = await PATCH(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('No valid fields');
    expect(json.code).toBe('draft_update_empty');
  });

  it('syncs pool entry when power_tier changes on non-wildcard tier', async () => {
    mockGetTier.mockResolvedValue(SAMPLE_TIER); // player_id is null (non-wildcard)
    mockUpdateTier.mockResolvedValue({ ...SAMPLE_TIER, power_tier: 'S' });
    mockGetPoolEntry.mockResolvedValue({ id: 'pool-1' });

    const [req, ctx] = makeArgs('tier-1', { power_tier: 'S' });
    await PATCH(req, ctx);

    expect(mockGetPoolEntry).toHaveBeenCalledWith('s-1', 'Charmander');
  });
});

describe('DELETE /api/evolutions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireResourceAdmin.mockResolvedValue(undefined);
  });

  it('deletes tier and syncs pool entry for non-wildcard', async () => {
    mockGetTier.mockResolvedValue(SAMPLE_TIER);
    mockDeleteTier.mockResolvedValue(undefined);
    mockGetPoolEntry.mockResolvedValue({ id: 'pool-1' });
    mockDeletePoolEntry.mockResolvedValue(undefined);

    const [req, ctx] = makeArgs('tier-1', undefined, 'DELETE');
    const res = await DELETE(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
    expect(mockDeleteTier).toHaveBeenCalledWith('tier-1');
    expect(mockDeletePoolEntry).toHaveBeenCalledWith('pool-1');
  });

  it('returns 404 when tier not found for delete', async () => {
    mockGetTier.mockResolvedValue(null);

    const [req, ctx] = makeArgs('tier-missing', undefined, 'DELETE');
    const res = await DELETE(req, ctx);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('evolution_tier_not_found');
    expect(json.success).toBe(false);
  });

  it('skips pool entry deletion for wildcard tiers (player_id set)', async () => {
    mockGetTier.mockResolvedValue({ ...SAMPLE_TIER, player_id: 'p-1' });
    mockDeleteTier.mockResolvedValue(undefined);

    const [req, ctx] = makeArgs('tier-1', undefined, 'DELETE');
    await DELETE(req, ctx);

    expect(mockGetPoolEntry).not.toHaveBeenCalled();
    expect(mockDeletePoolEntry).not.toHaveBeenCalled();
  });
});
