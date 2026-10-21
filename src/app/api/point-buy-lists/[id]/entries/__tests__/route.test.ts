import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn(),
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getPointBuyListById: vi.fn(),
  getListEntries: vi.fn(),
  bulkCreateListEntries: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from '../route';
import { revalidateTag } from 'next/cache';
import { requireAdmin } from '@/lib/auth/helpers';
import { bulkCreateListEntries, getPointBuyListById } from '@/lib/supabase/queries/point-buy-lists';

const VERSION_ID = '160b6331-5675-4c04-8fc7-5d950e0d5149';

const ENTRY = {
  line_number: 1,
  base_pokemon: 'Gible',
  stage2_pokemon: 'Gabite',
  stage3_pokemon: 'Garchomp',
  price: 3,
  kills_to_stage2: 2,
  price_group: 'mittel',
};

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: VERSION_ID }) };

describe('POST /api/point-buy-lists/[id]/entries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(getPointBuyListById).mockResolvedValue({
      id: VERSION_ID,
      name: 'EPB',
      version: 1,
      source: null,
      is_active: true,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(bulkCreateListEntries).mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("imports the entries and expires that version's cached entries (D37)", async () => {
    const res = await POST(makeRequest({ entries: [ENTRY] }), params);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({ success: true, data: { imported: 1 } });
    // The league matchup page reads the entries from the public read cache.
    expect(revalidateTag).toHaveBeenCalledWith(`point-buy-list:${VERSION_ID}`, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it('expires nothing when the version is an immutable snapshot (409)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(bulkCreateListEntries).mockRejectedValue({ code: 'P0001', message: 'immutable' });

    const res = await POST(makeRequest({ entries: [ENTRY] }), params);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('list_version_immutable');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('expires nothing when the version does not exist', async () => {
    vi.mocked(getPointBuyListById).mockResolvedValue(null);

    const res = await POST(makeRequest({ entries: [ENTRY] }), params);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Point-buy list not found');
    expect(json.code).toBe('point_buy_list_not_found');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers an invalid body with validation_failed and the issues as its param', async () => {
    const res = await POST(makeRequest({ entries: 'nope' }), params);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.params.issues).toContain('entries');
    expect(json.error).toBe(`Validation failed: ${json.params.issues}`);
    expect(bulkCreateListEntries).not.toHaveBeenCalled();
  });
});
