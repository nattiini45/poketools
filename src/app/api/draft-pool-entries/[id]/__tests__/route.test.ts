import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/queries/draft-pool-entries', () => ({
  updatePoolEntry: vi.fn(),
  deletePoolEntry: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────��─────

import { PATCH, DELETE } from '@/app/api/draft-pool-entries/[id]/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { supabase } from '@/lib/supabase/client';
import { updatePoolEntry, deletePoolEntry } from '@/lib/supabase/queries/draft-pool-entries';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeParams = { params: Promise.resolve({ id: 'entry-1' }) };

function mockSupabaseEntry(data: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  vi.mocked(supabase.from).mockReturnValue(chain as never);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('PATCH /api/draft-pool-entries/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when entry not found', async () => {
    mockSupabaseEntry(null);

    const res = await PATCH(makeRequest({ power_tier: 'S' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Pool entry not found');
    expect(json.code).toBe('pool_entry_not_found');
  });

  it('returns 400 when no valid fields to update', async () => {
    mockSupabaseEntry({ id: 'entry-1', season_id: 'season-1' });
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const res = await PATCH(makeRequest({}), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('No valid fields to update');
    expect(json.code).toBe('draft_update_empty');
  });

  it('updates power_tier successfully', async () => {
    mockSupabaseEntry({ id: 'entry-1', season_id: 'season-1' });
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    const updated = { id: 'entry-1', power_tier: 'S', pokemon_name: 'Pikachu' };
    vi.mocked(updatePoolEntry).mockResolvedValue(updated as never);

    const res = await PATCH(makeRequest({ power_tier: 'S' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.power_tier).toBe('S');
    expect(updatePoolEntry).toHaveBeenCalledWith('entry-1', { power_tier: 'S' });
  });

  it('updates point_cost successfully', async () => {
    mockSupabaseEntry({ id: 'entry-1', season_id: 'season-1' });
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    const updated = { id: 'entry-1', point_cost: 5 };
    vi.mocked(updatePoolEntry).mockResolvedValue(updated as never);

    const res = await PATCH(makeRequest({ point_cost: 5 }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(updatePoolEntry).toHaveBeenCalledWith('entry-1', { point_cost: 5 });
  });
});

describe('DELETE /api/draft-pool-entries/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when entry not found', async () => {
    mockSupabaseEntry(null);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Pool entry not found');
    expect(json.code).toBe('pool_entry_not_found');
  });

  it('deletes entry successfully', async () => {
    mockSupabaseEntry({ id: 'entry-1', season_id: 'season-1' });
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(deletePoolEntry).mockResolvedValue(undefined as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(deletePoolEntry).toHaveBeenCalledWith('entry-1');
  });
});
