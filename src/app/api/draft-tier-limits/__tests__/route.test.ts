import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

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

vi.mock('@/lib/supabase/queries/draft-tier-limits', () => ({
  getTierLimits: vi.fn(),
  upsertTierLimits: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, POST } from '@/app/api/draft-tier-limits/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getTierLimits, upsertTierLimits } from '@/lib/supabase/queries/draft-tier-limits';
import { safeErrorResponse } from '@/lib/api/error-response';

// ─── Helpers ────────────────────────────────────────────────────────

function makeGetRequest(params: Record<string, string>): Request {
  const url = new URL('http://localhost/api/draft-tier-limits');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString() } as unknown as Request;
}

function makePostRequest(body: Record<string, unknown>): Request {
  return { json: () => Promise.resolve(body) } as unknown as Request;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/draft-tier-limits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when season_id missing', async () => {
    const res = await GET(makeGetRequest({}));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('season_id is required');
    expect(json.code).toBe('draft_season_id_required');
  });

  it('returns tier limits for a season', async () => {
    const limits = [
      { power_tier: 'S', max_picks: 1 },
      { power_tier: 'A', max_picks: 2 },
    ];
    vi.mocked(getTierLimits).mockResolvedValue(limits as never);

    const res = await GET(makeGetRequest({ season_id: 'season-1' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(limits);
    expect(getTierLimits).toHaveBeenCalledWith('season-1');
  });

  it('delegates to safeErrorResponse on failure', async () => {
    vi.mocked(getTierLimits).mockRejectedValue(new Error('DB error'));

    await GET(makeGetRequest({ season_id: 'season-1' }));
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});

describe('POST /api/draft-tier-limits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when season_id missing', async () => {
    const res = await POST(makePostRequest({ limits: [] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('season_id');
    expect(json.code).toBe('validation_failed');
  });

  it('returns 400 when limits is not an array', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const res = await POST(makePostRequest({ season_id: '00000000-0000-4000-a000-000000000001', limits: 'not-array' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('limits');
    expect(json.code).toBe('validation_failed');
  });

  it('upserts tier limits successfully', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    const savedLimits = [{ power_tier: 'S', max_picks: 1, season_id: '00000000-0000-4000-a000-000000000001' }];
    vi.mocked(upsertTierLimits).mockResolvedValue(savedLimits as never);

    const res = await POST(
      makePostRequest({
        season_id: '00000000-0000-4000-a000-000000000001',
        limits: [{ power_tier: 'S', max_picks: 1 }],
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual(savedLimits);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', '00000000-0000-4000-a000-000000000001');
  });

  it('delegates to safeErrorResponse on failure', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new Error('Not admin'));

    await POST(makePostRequest({ season_id: '00000000-0000-4000-a000-000000000001', limits: [{ power_tier: 'S', max_picks: 1 }] }));
    expect(safeErrorResponse).toHaveBeenCalled();
  });
});
