/**
 * Admin corrections (draft-backend §8.1 #11–#14; B-ADM): void, correct,
 * resolve a blocked slot, penalty stage.
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
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntryByLineId: vi.fn() }));
vi.mock('@/lib/draft/line-catalog-data', () => ({ effectiveThresholds: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});

import { POST as voidPick } from '@/app/api/drafts/[id]/picks/[pickId]/void/route';
import { POST as correctPick } from '@/app/api/drafts/[id]/picks/[pickId]/correct/route';
import { POST as resolveSlot } from '@/app/api/drafts/[id]/slots/[slotId]/resolve/route';
import { POST as setPenalty } from '@/app/api/drafts/[id]/participants/[playerId]/penalty/route';
import { requireDraftAdmin, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { getListEntryByLineId } from '@/lib/supabase/queries/point-buy-lists';
import { effectiveThresholds } from '@/lib/draft/line-catalog-data';
import { expireDraftReads } from '@/lib/revalidation';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { DraftRuleError } from '@/lib/draft/errors';

const POOL = '11111111-1111-4111-8111-111111111111';
const PICK = '22222222-2222-4222-8222-222222222222';
const SLOT = '33333333-3333-4333-8333-333333333333';
const PLAYER = '44444444-4444-4444-8444-444444444444';
const REQ = '55555555-5555-4555-8555-555555555555';
const RSLOT = '66666666-6666-4666-8666-666666666666';
const LIST = '77777777-7777-4777-8777-777777777777';

const req = (body: unknown) => new Request('http://localhost/api/drafts/x', { method: 'POST', body: JSON.stringify(body) });
const forbidden = () =>
  new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required for this draft', 403);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: 'admin-1', isAdmin: false } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue({
    id: POOL, season_id: 'season-1', engine: 'queue', kind: 'initial', list_version_id: LIST,
  } as never);
  vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 12 });
});

describe('POST /api/drafts/[id]/picks/[pickId]/void', () => {
  const call = (body: unknown, pickId = PICK) => voidPick(req(body), { params: Promise.resolve({ id: POOL, pickId }) });

  it('voids with requeue, as the admin actor, and expires the draft reads', async () => {
    const res = await call({ reason: 'Wrong line clicked', requeue: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { state_version: 12 } });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_admin_void_pick', {
      p_pool_id: POOL, p_pick_id: PICK, p_actor_id: 'admin-1', p_reason: 'Wrong line clicked', p_requeue: true,
      p_replacement_line_id: null, p_replacement_thresholds: null, p_client_request_id: null,
    });
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');
  });

  it('requires reason and requeue', async () => {
    expect((await call({ reason: 'Wrong line clicked' })).status).toBe(400);
    expect((await call({ requeue: false })).status).toBe(400);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('rejects a pick id that is not a uuid', async () => {
    const res = await call({ reason: 'Wrong line', requeue: true }, 'nope');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
  });

  it('maps CORRECTION_REQUIRES_PAUSE and VOID_BLOCKED_PROGRESS {progress}', async () => {
    vi.mocked(callDraftRpc).mockRejectedValueOnce(new DraftRuleError('CORRECTION_REQUIRES_PAUSE'));
    const paused = await call({ reason: 'Wrong line', requeue: true });
    expect(paused.status).toBe(409);
    expect((await paused.json()).code).toBe('CORRECTION_REQUIRES_PAUSE');

    vi.mocked(callDraftRpc).mockRejectedValueOnce(new DraftRuleError('VOID_BLOCKED_PROGRESS', { progress: 2 }));
    const blocked = await call({ reason: 'Wrong line', requeue: false });
    expect(await blocked.json()).toMatchObject({ code: 'VOID_BLOCKED_PROGRESS', params: { progress: 2 } });
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await call({ reason: 'Wrong line', requeue: true })).status).toBe(403);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/drafts/[id]/picks/[pickId]/correct', () => {
  const call = (body: unknown) => correctPick(req(body), { params: Promise.resolve({ id: POOL, pickId: PICK }) });

  it('voids + requeues + picks the replacement in one RPC (initial pool: no thresholds)', async () => {
    const res = await call({ line_id: 'ralts--gallade', reason: 'Meant Gallade', client_request_id: REQ });

    expect(res.status).toBe(200);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_admin_void_pick', {
      p_pool_id: POOL, p_pick_id: PICK, p_actor_id: 'admin-1', p_reason: 'Meant Gallade', p_requeue: true,
      p_replacement_line_id: 'ralts--gallade', p_replacement_thresholds: null, p_client_request_id: REQ,
    });
    expect(getListEntryByLineId).not.toHaveBeenCalled();
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');
  });

  it('passes override-aware thresholds for a redraft pool', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue({
      id: POOL, season_id: 'season-1', engine: 'queue', kind: 'redraft', list_version_id: LIST,
    } as never);
    vi.mocked(getListEntryByLineId).mockResolvedValue({ id: 'entry-1' } as never);
    const thresholds = { line_id: 'ralts--gallade', stage2_kos: 3, stage3_kos: 7 };
    vi.mocked(effectiveThresholds).mockReturnValue(thresholds as never);

    await call({ line_id: 'ralts--gallade', reason: 'Meant Gallade', client_request_id: REQ });

    expect(getListEntryByLineId).toHaveBeenCalledWith(LIST, 'ralts--gallade');
    expect(vi.mocked(callDraftRpc).mock.calls[0][1]).toMatchObject({ p_replacement_thresholds: thresholds });
  });

  it('answers NOT_IN_LIST for an unknown redraft line before the RPC', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue({
      id: POOL, season_id: 'season-1', engine: 'queue', kind: 'redraft', list_version_id: LIST,
    } as never);
    vi.mocked(getListEntryByLineId).mockResolvedValue(null);

    const res = await call({ line_id: 'ralts--gallade', reason: 'Meant Gallade', client_request_id: REQ });

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('NOT_IN_LIST');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('requires client_request_id (critique B6)', async () => {
    const res = await call({ line_id: 'ralts--gallade', reason: 'Meant Gallade' });
    expect(res.status).toBe(400);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await call({ line_id: 'ralts--gallade', reason: 'Meant Gallade', client_request_id: REQ })).status).toBe(403);
  });
});

describe('POST /api/drafts/[id]/slots/[slotId]/resolve', () => {
  const call = (body: unknown) => resolveSlot(req(body), { params: Promise.resolve({ id: POOL, slotId: SLOT }) });

  it('assigns a line (resume defaults to true)', async () => {
    const res = await call({
      action: 'assign', line_id: 'ralts--gallade', reason: 'Player unreachable', client_request_id: REQ,
      redraft_slot_id: RSLOT,
    });

    expect(res.status).toBe(200);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_admin_resolve_slot', {
      p_pool_id: POOL, p_slot_id: SLOT, p_actor_id: 'admin-1', p_action: 'assign', p_line_id: 'ralts--gallade',
      p_reason: 'Player unreachable', p_client_request_id: REQ, p_redraft_slot_id: RSLOT, p_line_thresholds: null,
      p_resume: true,
    });
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');
  });

  it('forfeits without a line and can stay paused', async () => {
    await call({ action: 'forfeit', reason: 'No pick in time', resume: false });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_admin_resolve_slot', {
      p_pool_id: POOL, p_slot_id: SLOT, p_actor_id: 'admin-1', p_action: 'forfeit', p_line_id: null,
      p_reason: 'No pick in time', p_client_request_id: null, p_redraft_slot_id: null, p_line_thresholds: null,
      p_resume: false,
    });
  });

  it('requires client_request_id for assign', async () => {
    const res = await call({ action: 'assign', line_id: 'ralts--gallade', reason: 'Player unreachable' });
    expect(res.status).toBe(400);
  });

  it('maps SLOT_NOT_BLOCKED', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('SLOT_NOT_BLOCKED'));
    const res = await call({ action: 'forfeit', reason: 'No pick in time' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SLOT_NOT_BLOCKED');
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await call({ action: 'forfeit', reason: 'No pick in time' })).status).toBe(403);
  });
});

describe('POST /api/drafts/[id]/participants/[playerId]/penalty', () => {
  const call = (body: unknown, playerId = PLAYER) =>
    setPenalty(req(body), { params: Promise.resolve({ id: POOL, playerId }) });

  it('sets the stage and does not expire public reads (EXEMPT)', async () => {
    const res = await call({ stage: 2, reason: 'Repeated timeouts' });

    expect(res.status).toBe(200);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_admin_set_penalty', {
      p_pool_id: POOL, p_player_id: PLAYER, p_stage: 2, p_actor_id: 'admin-1', p_reason: 'Repeated timeouts',
    });
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('rejects stage > 5 and a non-uuid player', async () => {
    expect((await call({ stage: 6, reason: 'Repeated timeouts' })).status).toBe(400);
    expect((await call({ stage: 1, reason: 'Repeated timeouts' }, 'p1')).status).toBe(400);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('maps INVALID_CONFIG {field} from the ladder check', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('INVALID_CONFIG', { field: 'stage' }));
    const res = await call({ stage: 5, reason: 'Repeated timeouts' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'INVALID_CONFIG', params: { field: 'stage' } });
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(forbidden());
    expect((await call({ stage: 1, reason: 'Repeated timeouts' })).status).toBe(403);
  });
});
