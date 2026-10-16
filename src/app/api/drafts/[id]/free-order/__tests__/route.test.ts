/**
 * POST /api/drafts/[id]/free-order: the admin escape for a stalled legacy draft. Only a running legacy pool in
 * snake/linear order switches; the switch is audited and expires the draft reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
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
  switchDraftPoolToFreeOrder: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));

import { POST } from '@/app/api/drafts/[id]/free-order/route';
import { AuthError, requireDraftAdmin } from '@/lib/auth/helpers';
import { getDraftPoolById, switchDraftPoolToFreeOrder } from '@/lib/supabase/queries/drafts';
import { logAuditEvent } from '@/lib/audit/log';
import { expireDraftReads } from '@/lib/revalidation';

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const routeParams = { params: Promise.resolve({ id: POOL_ID }) };

const pool = (overrides: Record<string, unknown> = {}) => ({
  id: POOL_ID,
  season_id: 'season-1',
  engine: 'legacy',
  draft_type: 'budget',
  pick_order: 'snake',
  status: 'in_progress',
  ...overrides,
});

async function post(body: unknown = {}) {
  const request = new Request(`http://localhost/api/drafts/${POOL_ID}/free-order`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const res = await POST(request, routeParams);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: ADMIN, name: 'Admin' } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue(pool() as never);
  vi.mocked(switchDraftPoolToFreeOrder).mockResolvedValue(pool({ pick_order: 'free' }) as never);
});

describe('POST /api/drafts/[id]/free-order', () => {
  it('switches a running snake draft to free order, audits it and expires the draft reads', async () => {
    const { status, json } = await post({ reason: 'Misty cannot afford a pick' });

    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true, data: { pick_order: 'free' } });
    expect(vi.mocked(requireDraftAdmin)).toHaveBeenCalledWith(POOL_ID);
    expect(vi.mocked(switchDraftPoolToFreeOrder)).toHaveBeenCalledWith(POOL_ID);
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: ADMIN,
        action: 'draft.pick_order.free',
        resource_type: 'draft_pool',
        resource_id: POOL_ID,
        metadata: { season_id: 'season-1', from: 'snake', to: 'free', reason: 'Misty cannot afford a pick' },
      }),
    );
    expect(vi.mocked(expireDraftReads)).toHaveBeenCalledWith('season-1');
  });

  it('a linear draft switches too; no reason is stored as null', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool({ pick_order: 'linear' }) as never);

    const { status } = await post();

    expect(status).toBe(200);
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ from: 'linear', reason: null }) }),
    );
  });

  it('refuses a non-admin before reading the body or the pool', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(new AuthError('Admin access required for this draft', 403));

    const { status } = await post();

    expect(status).toBe(403);
    expect(vi.mocked(getDraftPoolById)).not.toHaveBeenCalled();
    expect(vi.mocked(switchDraftPoolToFreeOrder)).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and an over-long reason', async () => {
    expect((await post({ pick_order: 'snake' })).json).toMatchObject({ code: 'validation_failed' });
    expect((await post({ reason: 'x'.repeat(501) })).json).toMatchObject({ code: 'validation_failed' });
    expect(vi.mocked(switchDraftPoolToFreeOrder)).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json for a malformed body', async () => {
    const { status, json } = await post('{');
    expect(status).toBe(400);
    expect(json).toMatchObject({ code: 'invalid_json' });
  });

  it('a missing pool is 404 POOL_NOT_FOUND', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(null);

    const { status, json } = await post();

    expect(status).toBe(404);
    expect(json).toMatchObject({ code: 'POOL_NOT_FOUND' });
  });

  it('an EvoLiga (queue engine) pool is 422 INVALID_CONFIG for pick_order', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool({ engine: 'queue' }) as never);

    const { status, json } = await post();

    expect(status).toBe(422);
    expect(json).toMatchObject({ code: 'INVALID_CONFIG', params: { field: 'pick_order' } });
    expect(vi.mocked(switchDraftPoolToFreeOrder)).not.toHaveBeenCalled();
  });

  it('a pool already in free order is 409 draft_free_order_already_free', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool({ pick_order: 'free' }) as never);

    const { status, json } = await post();

    expect(status).toBe(409);
    expect(json).toMatchObject({ code: 'draft_free_order_already_free', error: 'This draft already uses free order' });
  });

  it.each(['pending', 'complete'])('a %s pool is 409 draft_free_order_not_running', async (status) => {
    vi.mocked(getDraftPoolById).mockResolvedValue(pool({ status }) as never);

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: 'draft_free_order_not_running' });
    expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(expireDraftReads)).not.toHaveBeenCalled();
  });

  it('a lost race (the guarded update matched no row) reports why from a fresh read, writes no audit', async () => {
    vi.mocked(switchDraftPoolToFreeOrder).mockResolvedValue(null);
    vi.mocked(getDraftPoolById)
      .mockResolvedValueOnce(pool() as never)
      .mockResolvedValueOnce(pool({ status: 'complete' }) as never);

    const { status, json } = await post();

    expect(status).toBe(409);
    expect(json).toMatchObject({ code: 'draft_free_order_not_running' });
    expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(expireDraftReads)).not.toHaveBeenCalled();
  });

  it('a failed update is a 500 with the static fallback', async () => {
    vi.mocked(switchDraftPoolToFreeOrder).mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { status, json } = await post();

    expect(status).toBe(500);
    expect(json.error).toBe('Failed to switch the draft to free order');
  });
});
