/** POST /api/drafts/[id]/start, /end, /pause (draft-backend §8.1 #4–#6; B-ADM). */
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
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});

import { POST as start } from '@/app/api/drafts/[id]/start/route';
import { POST as end } from '@/app/api/drafts/[id]/end/route';
import { POST as pause } from '@/app/api/drafts/[id]/pause/route';
import { requireDraftAdmin, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { expireDraftReads } from '@/lib/revalidation';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { DraftRuleError } from '@/lib/draft/errors';

const POOL = '11111111-1111-4111-8111-111111111111';
type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const call = (handler: Handler, body?: unknown, id = POOL) =>
  handler(
    new Request(`http://localhost/api/drafts/${id}/x`, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const forbidden = () =>
  new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required for this draft', 403);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: 'admin-1', isAdmin: true } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue({ id: POOL, season_id: 'season-1', engine: 'queue', kind: 'initial' } as never);
});

describe('POST /api/drafts/[id]/start', () => {
  it('starts the draft as the admin actor and expires the draft reads', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 3, active_slot_id: 'slot-1' });

    const res = await call(start);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { state_version: 3 } });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_start', { p_pool_id: POOL, p_actor_id: 'admin-1' });
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');
  });

  it('accepts an explicit empty object and rejects unknown keys', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 3 });
    expect((await call(start, {})).status).toBe(200);

    const bad = await call(start, { force: true });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('validation_failed');
  });

  it('is admin-only (403 before any RPC)', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await call(start)).status).toBe(403);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('maps rule errors and does not expire on failure', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('DRAFT_ALREADY_STARTED'));
    const res = await call(start);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DRAFT_ALREADY_STARTED');
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('refuses a legacy pool', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue({ id: POOL, season_id: 'season-1', engine: 'legacy' } as never);
    const res = await call(start);
    expect((await res.json()).code).toBe('POOL_ENGINE_LEGACY');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/drafts/[id]/end', () => {
  it('passes the reason to draft_end and expires the draft reads', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 8, phase: 'complete' });

    const res = await call(end, { reason: 'League cancelled' });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ state_version: 8 });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_end', {
      p_pool_id: POOL, p_actor_id: 'admin-1', p_reason: 'League cancelled',
    });
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');
  });

  it('requires a reason of at least 3 characters', async () => {
    const res = await call(end, { reason: ' x ' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await call(end, { reason: 'stop now' })).status).toBe(403);
  });
});

describe('POST /api/drafts/[id]/pause', () => {
  it('pauses with a reason and does not expire public reads (EXEMPT)', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 5, paused: true });

    const res = await call(pause, { paused: true, reason: 'Server trouble' });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ state_version: 5 });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_set_paused', {
      p_pool_id: POOL, p_actor_id: 'admin-1', p_paused: true, p_reason: 'Server trouble',
    });
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('resumes without a reason (null)', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 6, paused: false });
    await call(pause, { paused: false });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_set_paused', {
      p_pool_id: POOL, p_actor_id: 'admin-1', p_paused: false, p_reason: null,
    });
  });

  it('maps BLOCKED_SLOT_UNRESOLVED', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('BLOCKED_SLOT_UNRESOLVED'));
    const res = await call(pause, { paused: false });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('BLOCKED_SLOT_UNRESOLVED');
  });

  it('rejects a body without `paused`', async () => {
    const res = await call(pause, { reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await call(pause, { paused: true })).status).toBe(403);
  });
});
