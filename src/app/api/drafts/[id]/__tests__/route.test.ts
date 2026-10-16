import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolById: vi.fn(),
  getDraftPoolWithDetails: vi.fn(),
  updateDraftPoolStatus: vi.fn(),
  deleteDraftPool: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { GET, PATCH, DELETE } from '@/app/api/drafts/[id]/route';
import { requirePlayer, requireDraftAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getDraftPoolById,
  getDraftPoolWithDetails,
  updateDraftPoolStatus,
  deleteDraftPool,
} from '@/lib/supabase/queries/drafts';
import { revalidateTag } from 'next/cache';

// ─── Helpers ─���──────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeParams = { params: Promise.resolve({ id: 'pool-1' }) };
/** GET guards the id shape before any read: its tests use a real uuid. */
const POOL_UUID = '11111111-1111-4111-8111-111111111111';
const getParams = () => ({ params: Promise.resolve({ id: POOL_UUID }) });

const mockPool = {
  id: 'pool-1',
  season_id: 'season-1',
  draft_type: 'snake',
  status: 'pending',
  season_name: 'Season One',
  participant_count: 4,
  pick_count: 0,
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('GET /api/drafts/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );

    const res = await GET({} as NextRequest, getParams());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
  });

  it('returns 404 when pool not found', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolWithDetails).mockResolvedValue(null);

    const res = await GET({} as NextRequest, getParams());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Draft pool not found');
    expect(json.code).toBe('POOL_NOT_FOUND');
  });

  it('returns pool with details', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolWithDetails).mockResolvedValue(mockPool as never);

    const res = await GET({} as NextRequest, getParams());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.season_name).toBe('Season One');
    expect(getDraftPoolWithDetails).toHaveBeenCalledWith(POOL_UUID);
  });

  it.each(['pool-1', 'not-a-uuid', "1' OR '1'='1"])(
    'answers a malformed id (%s) with 404 POOL_NOT_FOUND and never queries Postgres',
    async (badId) => {
      vi.mocked(requirePlayer).mockResolvedValue(undefined as never);

      const res = await GET({} as NextRequest, { params: Promise.resolve({ id: badId }) });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.code).toBe('POOL_NOT_FOUND');
      expect(getDraftPoolWithDetails).not.toHaveBeenCalled();
    },
  );
});

describe('PATCH /api/drafts/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not draft admin', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await PATCH(makeRequest({ status: 'in_progress' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 400 when status missing', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);

    const res = await PATCH(makeRequest({}), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('status');
  });

  it('returns 400 for invalid status', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);

    const res = await PATCH(makeRequest({ status: 'invalid' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Invalid option');
  });

  it('updates status successfully', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(updateDraftPoolStatus).mockResolvedValue({ ...mockPool, status: 'in_progress' } as never);

    const res = await PATCH(makeRequest({ status: 'in_progress' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('in_progress');
    expect(revalidateTag).toHaveBeenCalledWith('season:season-1', { expire: 0 });
  });

  it('refuses a bare status write on a queue-engine pool (422 INVALID_CONFIG {field: status})', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'queue' } as never);

    const res = await PATCH(makeRequest({ status: 'complete' }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json).toMatchObject({ code: 'INVALID_CONFIG', params: { field: 'status' } });
    expect(updateDraftPoolStatus).not.toHaveBeenCalled();
  });

  it('adds validation_failed to a bad body', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    const json = await (await PATCH(makeRequest({}), routeParams)).json();
    expect(json.code).toBe('validation_failed');
  });
});

describe('DELETE /api/drafts/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not draft admin', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('deletes pool successfully', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue(mockPool as never);
    vi.mocked(deleteDraftPool).mockResolvedValue(undefined as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(deleteDraftPool).toHaveBeenCalledWith('pool-1');
    // Its league's read-cache entries are expired after the delete (D37).
    expect(revalidateTag).toHaveBeenCalledWith('season:season-1', { expire: 0 });
  });

  it('checks the admin guard before reading the pool', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    await DELETE({} as NextRequest, routeParams);

    expect(getDraftPoolById).not.toHaveBeenCalled();
    expect(deleteDraftPool).not.toHaveBeenCalled();
  });

  it.each(['submissions', 'drafting', 'complete'])(
    'refuses a queue pool in phase %s with 409 POOL_NOT_DELETABLE',
    async (phase) => {
      vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
      vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'queue', phase } as never);

      const res = await DELETE({} as NextRequest, routeParams);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.success).toBe(false);
      expect(json.code).toBe('POOL_NOT_DELETABLE');
      expect(json.detail).toEqual({ phase });
      expect(deleteDraftPool).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
    },
  );

  // Route-level: deleteDraftPool is mocked here; its own queue rule (setup or
  // cancelled, whatever the status) is tested in queries/__tests__/drafts.test.ts.
  it.each(['setup', 'cancelled'])('deletes a queue pool in phase %s', async (phase) => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'queue', phase } as never);
    vi.mocked(deleteDraftPool).mockResolvedValue(undefined as never);

    const res = await DELETE({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(deleteDraftPool).toHaveBeenCalledWith('pool-1');
    expect(revalidateTag).toHaveBeenCalledWith('season:season-1', { expire: 0 });
  });

  it('keeps the legacy behaviour for a legacy pool whatever its phase column says', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'legacy', phase: 'drafting' } as never);
    vi.mocked(deleteDraftPool).mockResolvedValue(undefined as never);

    const res = await DELETE({} as NextRequest, routeParams);

    expect(res.status).toBe(200);
    expect(deleteDraftPool).toHaveBeenCalledWith('pool-1');
  });

  it('maps a redraft-child foreign-key violation (23503) to 409 POOL_HAS_REDRAFT', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...mockPool, engine: 'queue', phase: 'cancelled' } as never);
    vi.mocked(deleteDraftPool).mockRejectedValue(
      Object.assign(new Error('violates foreign key constraint'), { code: '23503' }),
    );

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('POOL_HAS_REDRAFT');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns safe fallback on delete failure', async () => {
    vi.mocked(requireDraftAdmin).mockResolvedValue(undefined as never);
    vi.mocked(deleteDraftPool).mockRejectedValue(new Error('Pool has existing picks'));

    const res = await DELETE({} as NextRequest, routeParams);
    const json = await res.json();

    // safeErrorResponse returns 500 + safe fallback (no longer leaks internal message)
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to delete draft pool');
  });
});
