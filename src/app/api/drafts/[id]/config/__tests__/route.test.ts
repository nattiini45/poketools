/** PATCH /api/drafts/[id]/config (draft-backend §8.1 #3; B-ADM). */
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
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});

import { PATCH } from '@/app/api/drafts/[id]/config/route';
import { requireDraftAdmin, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getSeasonGroupMemberIds } from '@/lib/supabase/queries/season-groups';
import { expireDraftReads } from '@/lib/revalidation';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { DraftRuleError } from '@/lib/draft/errors';

const POOL = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const patch = (body: unknown) =>
  PATCH(new Request(`http://localhost/api/drafts/${POOL}/config`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: POOL }),
  });

const storedPool = {
  id: POOL,
  season_id: 'season-1',
  engine: 'queue',
  kind: 'initial',
  phase: 'setup',
  mode: 'live',
  roster_size: 9,
  point_budget: 180,
  pick_seconds: 300,
  makeup_seconds: 150,
  slow_ladder_seconds: [43_200, 21_600, 10_800, 5_400],
  redraft_max_lines: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: 'admin-1', isAdmin: true } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue(storedPool as never);
  vi.mocked(callDraftRpc).mockResolvedValue({ state_version: 4 });
  vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: A, name: 'Ash' }, { id: B, name: 'Brock' }] as never);
});

describe('PATCH /api/drafts/[id]/config', () => {
  it('sends the patch to draft_configure and expires the draft reads', async () => {
    const res = await patch({ pick_seconds: 240, extensions_enabled: false });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { state_version: 4 } });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_configure', {
      p_pool_id: POOL, p_actor_id: 'admin-1', p_patch: { pick_seconds: 240, extensions_enabled: false }, p_seats: null,
    });
    expect(expireDraftReads).toHaveBeenCalledWith('season-1');
  });

  it('checks the merged config: switching to slow keeps a 300 s pick clock → INVALID_CONFIG {pick_seconds}', async () => {
    const res = await patch({ mode: 'slow' });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'INVALID_CONFIG', params: { field: 'pick_seconds' } });
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('checks makeup_seconds against the stored pick clock', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...storedPool, pick_seconds: 120 } as never);
    const res = await patch({ makeup_seconds: 150 });
    expect(await res.json()).toMatchObject({ code: 'INVALID_CONFIG', params: { field: 'makeup_seconds' } });
  });

  it('maps participant_order to seats (only player ids) and leaves it out of the patch', async () => {
    await patch({ participant_order: [B, A] });

    expect(callDraftRpc).toHaveBeenCalledWith('draft_configure', {
      p_pool_id: POOL,
      p_actor_id: 'admin-1',
      p_patch: {},
      p_seats: [{ player_id: B, seat: 1 }, { player_id: A, seat: 2 }],
    });
  });

  it('refuses an order that is not the season participant set', async () => {
    const res = await patch({ participant_order: [A, C] });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('SEATS_INVALID');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it("a league group's pool takes exactly the group's members as its seat order", async () => {
    const GROUP = '22222222-2222-4222-8222-222222222222';
    vi.mocked(getDraftPoolById).mockResolvedValue({ ...storedPool, season_group_id: GROUP } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValue([{ id: A }, { id: B }, { id: C }] as never);
    vi.mocked(getSeasonGroupMemberIds).mockResolvedValue(new Set([A, C]));

    const ok = await patch({ participant_order: [C, A] });
    expect(ok.status).toBe(200);
    expect(getSeasonGroupMemberIds).toHaveBeenCalledWith(GROUP);
    expect(callDraftRpc).toHaveBeenCalledWith('draft_configure', expect.objectContaining({
      p_seats: [{ player_id: C, seat: 1 }, { player_id: A, seat: 2 }],
    }));

    // The whole league roster is not this pool's seat set.
    vi.mocked(callDraftRpc).mockClear();
    const wrong = await patch({ participant_order: [A, B, C] });
    expect(wrong.status).toBe(422);
    expect((await wrong.json()).code).toBe('SEATS_INVALID');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('a pool without a group never reads group members', async () => {
    await patch({ participant_order: [B, A] });
    expect(getSeasonGroupMemberIds).not.toHaveBeenCalled();
  });

  it('rejects unknown keys (strict)', async () => {
    const res = await patch({ token_purchase_cutoff_at: null });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
  });

  it('refuses a quiet_hours patch: quiet hours are frozen at creation from the format pack', async () => {
    const res = await patch({ quiet_hours: { start_hour: 0, end_hour: 6, time_zone: 'Europe/Berlin' } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('passes DRAFT_ALREADY_STARTED through', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('DRAFT_ALREADY_STARTED'));
    const res = await patch({ extensions_enabled: true });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('DRAFT_ALREADY_STARTED');
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required for this draft', 403),
    );
    expect((await patch({ pick_seconds: 240 })).status).toBe(403);
    expect(callDraftRpc).not.toHaveBeenCalled();
  });
});
