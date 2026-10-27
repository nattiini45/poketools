/** POST /api/drafts/[id]/roll-order. */
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
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonParticipants: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupMemberIds: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
// A fixed "draw": the roster reversed, so a passing test proves the route seats the drawn order.
vi.mock('@/lib/draft/seat-draw', () => ({ drawSeatOrder: vi.fn((ids: readonly string[]) => [...ids].reverse()) }));
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});

import { POST } from '@/app/api/drafts/[id]/roll-order/route';
import { requireDraftAdmin, AuthError } from '@/lib/auth/helpers';
import { logAuditEvent } from '@/lib/audit/log';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getSeasonGroupMemberIds } from '@/lib/supabase/queries/season-groups';
import { expireDraftReads } from '@/lib/revalidation';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { drawSeatOrder } from '@/lib/draft/seat-draw';
import { DraftRuleError } from '@/lib/draft/errors';

const POOL = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const roll = (body?: string) =>
  POST(new Request(`http://localhost/api/drafts/${POOL}/roll-order`, { method: 'POST', body }), {
    params: Promise.resolve({ id: POOL }),
  });

const storedPool = {
  id: POOL,
  season_id: 'season-1',
  engine: 'queue',
  kind: 'initial',
  phase: 'setup',
  season_group_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin', isAdmin: true } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue(storedPool as never);
  vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 5 });
  vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: A }, { id: B }] as never);
});

describe('POST /api/drafts/[id]/roll-order', () => {
  it('draws the roster and seats it through draft_configure (seats only), then audits and expires the reads', async () => {
    const res = await roll();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { state_version: 5 } });
    expect(drawSeatOrder).toHaveBeenCalledWith([A, B]);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_configure', {
      p_pool_id: POOL,
      p_actor_id: 'admin-1',
      p_patch: {},
      p_seats: [{ player_id: B, seat: 1 }, { player_id: A, seat: 2 }],
    });
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'draft.order.roll',
      resource_type: 'draft_pool',
      resource_id: POOL,
      metadata: { season_id: 'season-1', season_group_id: null, seats: 2 },
    });
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');
  });

  it("a league group's pool draws within the group's members only", async () => {
    const GROUP = '22222222-2222-4222-8222-222222222222';
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...storedPool, season_group_id: GROUP } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: A }, { id: B }, { id: C }] as never);
    vi.mocked(getSeasonGroupMemberIds).mockResolvedValue(new Set([A, C]));

    const res = await roll();

    expect(res.status).toBe(200);
    expect(getSeasonGroupMemberIds).toHaveBeenCalledWith(GROUP);
    expect(drawSeatOrder).toHaveBeenCalledWith([A, C]);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_configure', expect.objectContaining({
      p_seats: [{ player_id: C, seat: 1 }, { player_id: A, seat: 2 }],
    }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { season_id: 'season-1', season_group_id: GROUP, seats: 2 },
    }));
  });

  it('a pool without a group never reads group members', async () => {
    await roll();
    expect(getSeasonGroupMemberIds).not.toHaveBeenCalled();
  });

  it('is admin-only and answers before any read or draw', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required for this draft', 403),
    );
    expect((await roll()).status).toBe(403);
    expect(getDraftPoolById).not.toHaveBeenCalled();
    expect(drawSeatOrder).not.toHaveBeenCalled();
    expect(callDraftRpc).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('passes DRAFT_ALREADY_STARTED through: setup-only is enforced by the RPC, and nothing is audited', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('DRAFT_ALREADY_STARTED'));
    const res = await roll();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DRAFT_ALREADY_STARTED');
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('passes SEATS_INVALID from the RPC through', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('SEATS_INVALID'));
    const res = await roll();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('SEATS_INVALID');
  });

  it('refuses a Redraft pool: its seats follow the standings, never a draw', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...storedPool, kind: 'redraft' } as never);
    const res = await roll();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'INVALID_CONFIG', params: { field: 'participant_order' } });
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('answers a missing pool (POOL_NOT_FOUND) and a legacy pool (POOL_ENGINE_LEGACY)', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue(null as never);
    expect((await roll()).status).toBe(404);

    vi.mocked(getDraftPoolById).mockResolvedValue({ ...storedPool, engine: 'legacy' } as never);
    const legacy = await roll();
    expect((await legacy.json()).code).toBe('POOL_ENGINE_LEGACY');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('accepts an empty body or {}, and rejects any other body (strict)', async () => {
    expect((await roll('{}')).status).toBe(200);
    const extra = await roll(JSON.stringify({ participant_order: [A, B] }));
    expect(extra.status).toBe(400);
    expect((await extra.json()).code).toBe('validation_failed');
  });

  it('a malformed JSON body answers the catalogued 400 invalid_json (not validation_failed) and logs the parse failure', async () => {
    const res = await roll('{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_json' });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('malformed JSON body'), expect.any(SyntaxError));
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});
