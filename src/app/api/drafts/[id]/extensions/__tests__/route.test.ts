/** POST /api/drafts/[id]/extensions (draft-backend §8.1 #10; B-SNAP). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));
vi.mock('@/lib/draft/rpc-errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/draft/rpc-errors')>('@/lib/draft/rpc-errors');
  return { ...actual, callDraftRpc: vi.fn() };
});

import { POST } from '@/app/api/drafts/[id]/extensions/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import { callDraftRpc } from '@/lib/draft/rpc-errors';
import { DraftRuleError } from '@/lib/draft/errors';

const POOL = '11111111-1111-4111-8111-111111111111';
const SLOT = '22222222-2222-4222-8222-222222222222';

const post = (body: unknown, id = POOL) =>
  POST(
    new Request(`http://localhost/api/drafts/${id}/extensions`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p1', isAdmin: false, isResourceAdmin: false } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue({ id: POOL, season_id: 'season-1', engine: 'queue' } as never);
});

describe('POST /api/drafts/[id]/extensions', () => {
  it('applies the extension for the signed-in player only', async () => {
    vi.mocked(callDraftRpc).mockResolvedValue({ deadline_at: '2026-10-11T12:07:00Z', state_version: 9 });

    const res = await post({ kind: 'plus120', slot_id: SLOT });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { deadline_at: '2026-10-11T12:07:00Z', state_version: 9 } });
    expect(callDraftRpc).toHaveBeenCalledWith('draft_use_extension', {
      p_pool_id: POOL, p_player_id: 'p1', p_kind: 'plus120', p_slot_id: SLOT,
    });
  });

  it('rejects an invalid body with 400 validation_failed', async () => {
    const res = await post({ kind: 'plus300', slot_id: SLOT, player_id: 'p2' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('passes rule errors through with status, code and detail', async () => {
    vi.mocked(callDraftRpc).mockRejectedValue(new DraftRuleError('EXTENSION_USED', undefined, { kind: 'plus120' }));

    const res = await post({ kind: 'plus120', slot_id: SLOT });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toMatchObject({ code: 'EXTENSION_USED', detail: { kind: 'plus120' } });
  });

  it('refuses a legacy pool', async () => {
    vi.mocked(getDraftPoolById).mockResolvedValue({ id: POOL, season_id: 'season-1', engine: 'legacy' } as never);
    const res = await post({ kind: 'plus60', slot_id: SLOT });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('POOL_ENGINE_LEGACY');
    expect(callDraftRpc).not.toHaveBeenCalled();
  });

  it('requires a signed-in player', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );
    expect((await post({ kind: 'plus60', slot_id: SLOT })).status).toBe(401);
  });
});
